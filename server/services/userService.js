'use strict';

/**
 * Staff administration.
 *
 * The rules that protect the deployment from locking itself out — the last
 * administrator, self-demotion, self-deletion — live here rather than in a
 * route handler, so they hold no matter which entry point is used.
 */

const { transaction } = require('../db/pool');
const userRepository = require('../repositories/userRepository');
const categoryRepository = require('../repositories/categoryRepository');
const settingsRepository = require('../repositories/settingsRepository');
const authService = require('./authService');
const auditService = require('./auditService');
const { BadRequestError, ConflictError, NotFoundError, ForbiddenError } = require('../lib/errors');

const SETTING_ALLOW_REGISTRATION = 'allow_user_registration';

function list() {
  return userRepository.listAll();
}

async function statistics() {
  const [totals, breakdown] = await Promise.all([
    userRepository.statistics(),
    userRepository.categoryBreakdown()
  ]);

  return {
    totalUsers: totals.total_users,
    activeUsers: totals.active_users,
    adminCount: totals.admin_count,
    totalCategories: totals.total_categories,
    totalChats: totals.total_chats,
    categoriesBreakdown: breakdown
  };
}

async function selfRegistrationEnabled() {
  return (await settingsRepository.getValue(SETTING_ALLOW_REGISTRATION)) === 'true';
}

/**
 * Create an account.
 *
 * @param {object} input      Already validated by the request schema.
 * @param {object|null} actor The acting administrator, or null for self-registration.
 *
 * Self-registration never grants a role and never activates the account: an
 * administrator has to review it. Only an administrator may set a role.
 */
async function create(input, actor, ipAddress) {
  const isSuperAdminActor = actor?.role === 'superadmin';
  const isAdminActor = actor?.role === 'admin' || isSuperAdminActor;

  if (!isAdminActor && !(await selfRegistrationEnabled())) {
    throw new ForbiddenError('إنشاء الحسابات مقتصر على مسؤول المنظومة');
  }

  if (input.role === 'superadmin' && !isSuperAdminActor) {
    throw new ForbiddenError('لا يمكن منح صلاحية المدير العام الأعلى (Super Admin) إلا من قبل المدير العام');
  }

  const passwordProblem = authService.validatePassword(input.password);
  if (passwordProblem) throw new BadRequestError(passwordProblem);

  const category = await categoryRepository.findById(input.categoryId);
  if (!category) throw new BadRequestError('التصنيف المؤسسي المحدد غير موجود بالنظام');

  if (await userRepository.existsByUsername(input.username)) {
    throw new ConflictError('اسم المستخدم مسجل مسبقاً، يرجى اختيار اسم دخول آخر');
  }

  const role = isAdminActor && input.role ? input.role : 'user';
  const status = isAdminActor ? 'active' : 'suspended';

  const id = await userRepository.insert({
    username: input.username,
    passwordHash: authService.hashPassword(input.password),
    displayName: input.displayName?.trim() || input.username,
    role,
    department: category.name,
    categoryId: category.id,
    jobTitle: input.jobTitle?.trim() || 'مستشار إداري',
    status,
    notes: input.notes?.trim() || '',
    // An administrator-issued password is temporary by definition.
    mustChangePassword: isAdminActor
  });

  await auditService.record({
    userId: actor?.id ?? null,
    action: isAdminActor
      ? auditService.ACTIONS.USER_CREATED
      : auditService.ACTIONS.USER_SELF_REGISTERED,
    details: { createdUserId: id, createdUser: input.username, role, category: category.name, status },
    ipAddress
  });

  return {
    message: isAdminActor
      ? 'تم إنشاء الحساب. سيُطلب من المستخدم تغيير كلمة المرور عند أول دخول.'
      : 'تم استلام طلب الحساب. لن يُفعَّل الحساب إلا بعد اعتماده من مسؤول المنظومة.',
    user: authService.toPublicUser(await userRepository.findById(id))
  };
}

async function update(targetId, input, actor, ipAddress) {
  const existing = await userRepository.findByIdWithSecret(targetId);
  if (!existing) throw new NotFoundError('المستخدم غير موجود');

  const isSuperAdminActor = actor.role === 'superadmin';

  if (existing.role === 'superadmin' && !isSuperAdminActor) {
    throw new ForbiddenError('لا يمكن تعديل حساب المدير العام الأعلى (Super Admin) إلا من قبل المدير العام');
  }

  if (input.role === 'superadmin' && !isSuperAdminActor) {
    throw new ForbiddenError('لا يمكن منح صلاحية المدير العام الأعلى (Super Admin) إلا من قبل المدير العام');
  }

  // ---- validate everything before writing anything ----
  if (targetId === actor.id) {
    if (input.role && input.role !== actor.role) {
      throw new BadRequestError('لا يمكنك سحب صلاحيات الإشراف عن حسابك الشخصي');
    }
    if (input.status === 'suspended') {
      throw new BadRequestError('لا يمكنك تجميد حسابك الشخصي الحالي');
    }
  }

  let department = existing.department;
  let categoryId = existing.category_id;

  if (input.categoryId && input.categoryId !== existing.category_id) {
    const category = await categoryRepository.findById(input.categoryId);
    if (!category) throw new BadRequestError('التصنيف المؤسسي المحدد غير صالح');
    department = category.name;
    categoryId = category.id;
  }

  let passwordHash = null;
  if (input.newPassword !== undefined && String(input.newPassword).trim() !== '') {
    const problem = authService.validatePassword(String(input.newPassword).trim());
    if (problem) throw new BadRequestError(problem);
    passwordHash = authService.hashPassword(String(input.newPassword).trim());
  }

  const nextRole = input.role ?? existing.role;
  const nextStatus = input.status ?? existing.status;

  // Removing the last active administrator would lock everyone out.
  const isTargetAdmin = existing.role === 'admin' || existing.role === 'superadmin';
  const isNextAdmin = nextRole === 'admin' || nextRole === 'superadmin';
  const losingAdmin =
    isTargetAdmin &&
    existing.status === 'active' &&
    (!isNextAdmin || nextStatus !== 'active');

  if (losingAdmin && (await userRepository.countActiveAdmins()) <= 1) {
    throw new BadRequestError('لا يمكن سحب صلاحية أو تجميد المشرف الوحيد المتبقي في المنظومة');
  }

  // Any change to privileges, state or credentials terminates live sessions.
  const revoke = nextRole !== existing.role || nextStatus !== existing.status || passwordHash !== null;

  // ---- apply atomically ----
  await transaction(async () => {
    await userRepository.updateProfile(targetId, {
      displayName: input.displayName !== undefined ? input.displayName.trim() : existing.display_name,
      role: nextRole,
      department,
      categoryId,
      jobTitle: input.jobTitle !== undefined ? input.jobTitle.trim() : existing.job_title,
      status: nextStatus,
      notes: input.notes !== undefined ? input.notes.trim() : existing.notes
    });

    if (passwordHash) {
      await userRepository.updatePassword(targetId, passwordHash, { mustChangePassword: true });
    } else if (revoke) {
      await userRepository.revokeSessions(targetId);
    }
  });

  if (passwordHash) {
    await auditService.record({
      userId: actor.id,
      action: auditService.ACTIONS.USER_PASSWORD_RESET,
      details: { targetUserId: targetId },
      ipAddress
    });
  }

  await auditService.record({
    userId: actor.id,
    action: auditService.ACTIONS.USER_UPDATED,
    details: { targetUserId: targetId, role: nextRole, status: nextStatus, categoryId, sessionsRevoked: revoke },
    ipAddress
  });

  return {
    message: 'تم تحديث بيانات المستخدم وتصنيفه بنجاح',
    user: authService.toPublicUser(await userRepository.findById(targetId))
  };
}

async function remove(targetId, actor, ipAddress) {
  if (targetId === actor.id) {
    throw new BadRequestError('لا يمكنك حذف حسابك الشخصي الحالي');
  }

  const target = await userRepository.findByIdWithSecret(targetId);
  if (!target) throw new NotFoundError('المستخدم غير موجود');

  if (target.role === 'superadmin' && actor.role !== 'superadmin') {
    throw new ForbiddenError('لا يمكن حذف حساب المدير العام الأعلى (Super Admin) إلا من قبل المدير العام');
  }

  if ((target.role === 'admin' || target.role === 'superadmin') && target.status === 'active') {
    if ((await userRepository.countActiveAdmins()) <= 1) {
      throw new BadRequestError('لا يمكن حذف المشرف الوحيد المتبقي في المنظومة');
    }
  }

  await userRepository.remove(targetId);

  await auditService.record({
    userId: actor.id,
    action: auditService.ACTIONS.USER_DELETED,
    details: { deletedUserId: targetId, deletedUsername: target.username },
    ipAddress
  });

  return { message: 'تم حذف المستخدم وجميع سجلاته بنجاح' };
}

/**
 * Break-glass reset used by the CLI recovery script.
 * Returns the generated password; it is displayed once and never stored.
 */
async function resetPassword(username) {
  const account = await userRepository.findByUsernameWithSecret(username);
  if (!account) throw new NotFoundError(`لا يوجد حساب باسم "${username}"`);

  const password = authService.generatePassword();
  await userRepository.updatePassword(account.id, authService.hashPassword(password), {
    mustChangePassword: true
  });

  await auditService.record({
    userId: account.id,
    action: auditService.ACTIONS.USER_PASSWORD_RESET,
    details: { username, via: 'cli' },
    ipAddress: 'localhost'
  });

  return { username: account.username, password };
}

module.exports = {
  list,
  statistics,
  create,
  update,
  remove,
  resetPassword,
  selfRegistrationEnabled,
  SETTING_ALLOW_REGISTRATION
};
