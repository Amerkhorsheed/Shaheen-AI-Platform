'use strict';

/**
 * Authentication and credentials.
 *
 * Authority is never taken from the token. A token proves *which account* is
 * calling; the account's role, status and token version are re-read from the
 * database on every request, so suspending, demoting or deleting a user takes
 * effect immediately rather than whenever the token happens to expire.
 */

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const config = require('../config');
const userRepository = require('../repositories/userRepository');
const auditService = require('./auditService');
const {
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
  NotFoundError
} = require('../lib/errors');

// Compared against when the account does not exist, so a caller cannot tell a
// missing username from a wrong password by response timing.
const DUMMY_HASH = bcrypt.hashSync('timing-equalisation-placeholder', config.security.bcryptRounds);

/** @returns {string|null} an Arabic explanation, or null when acceptable. */
function validatePassword(password) {
  const value = typeof password === 'string' ? password : '';

  if (value.length < config.security.minPasswordLength) {
    return `كلمة المرور يجب ألا تقل عن ${config.security.minPasswordLength} خانات`;
  }
  // Latin or Arabic letters, plus at least one digit.
  if (!/[A-Za-z؀-ۿ]/.test(value) || !/[0-9]/.test(value)) {
    return 'كلمة المرور يجب أن تجمع بين الحروف والأرقام';
  }
  return null;
}

function hashPassword(password) {
  return bcrypt.hashSync(password, config.security.bcryptRounds);
}

function issueToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      tokenVersion: Number(user.token_version ?? 1)
    },
    config.security.jwtSecret,
    { expiresIn: config.security.tokenTtl }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.security.jwtSecret);
  } catch (err) {
    throw new UnauthorizedError('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً', { cause: err });
  }
}

/**
 * Resolve a verified token into the current account state.
 * Throws if the account is gone, suspended, or the token predates a change.
 */
async function resolveSession(payload) {
  const user = await userRepository.findForAuthentication(payload.id);

  if (!user) {
    throw new UnauthorizedError('الحساب لم يعد موجوداً في المنظومة');
  }
  if (user.status !== 'active') {
    throw new ForbiddenError('هذا الحساب موقوف إدارياً، يرجى مراجعة إدارة المنظومة');
  }
  if (Number(payload.tokenVersion) !== Number(user.token_version)) {
    throw new UnauthorizedError(
      'تم إبطال هذه الجلسة بعد تعديل بيانات الحساب. يرجى تسجيل الدخول مجدداً.'
    );
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name,
    department: user.department,
    jobTitle: user.job_title,
    categoryId: user.category_id,
    categoryName: user.category_name,
    categoryPromptContext: user.category_prompt_context,
    mustChangePassword: Boolean(user.must_change_password)
  };
}

/** Shape returned to the client. Never includes the hash or token version. */
function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    department: row.department,
    jobTitle: row.job_title,
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryCode: row.category_code,
    categoryColor: row.category_color,
    categoryClearance: row.category_clearance,
    createdAt: row.created_at
  };
}

async function login({ username, password, ipAddress }) {
  const account = await userRepository.findByUsernameWithSecret(username);

  // Always run a comparison so the two failure paths cost the same.
  const passwordMatches = bcrypt.compareSync(password, account?.password_hash || DUMMY_HASH);

  if (!account || !passwordMatches) {
    await auditService.record({
      userId: account?.id ?? null,
      action: auditService.ACTIONS.LOGIN_FAILED,
      details: { username },
      ipAddress
    });
    throw new UnauthorizedError('اسم المستخدم أو كلمة المرور غير صحيحة');
  }

  if (account.status !== 'active') {
    await auditService.record({
      userId: account.id,
      action: auditService.ACTIONS.LOGIN_BLOCKED,
      details: { username: account.username, reason: 'suspended' },
      ipAddress
    });
    throw new ForbiddenError('هذا الحساب موقوف إدارياً، يرجى مراجعة إدارة المنظومة');
  }

  await auditService.record({
    userId: account.id,
    action: auditService.ACTIONS.LOGIN_SUCCESS,
    details: { username: account.username, role: account.role },
    ipAddress
  });

  return {
    token: issueToken(account),
    user: toPublicUser(await userRepository.findById(account.id))
  };
}

async function getProfile(userId) {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError('المستخدم غير موجود');
  return toPublicUser(user);
}

/**
 * Self-service password change. Also clears any forced-change flag and
 * invalidates every other session for the account.
 */
async function changePassword({ userId, currentPassword, newPassword, ipAddress }) {
  const account = await userRepository.findByIdWithSecret(userId);
  if (!account) throw new NotFoundError('المستخدم غير موجود');

  if (!currentPassword || !bcrypt.compareSync(currentPassword, account.password_hash)) {
    await auditService.record({
      userId,
      action: auditService.ACTIONS.PASSWORD_CHANGE_FAILED,
      details: { reason: 'current password mismatch' },
      ipAddress
    });
    throw new UnauthorizedError('كلمة المرور الحالية غير صحيحة');
  }

  const problem = validatePassword(newPassword);
  if (problem) throw new BadRequestError(problem);

  if (bcrypt.compareSync(newPassword, account.password_hash)) {
    throw new BadRequestError('كلمة المرور الجديدة يجب أن تختلف عن الحالية');
  }

  await userRepository.updatePassword(userId, hashPassword(newPassword), {
    mustChangePassword: false
  });

  await auditService.record({
    userId,
    action: auditService.ACTIONS.PASSWORD_CHANGED,
    details: { username: account.username },
    ipAddress
  });

  const refreshed = await userRepository.findByIdWithSecret(userId);
  return {
    token: issueToken(refreshed),
    user: toPublicUser(await userRepository.findById(userId))
  };
}

/** Cryptographically random, satisfies the policy, safe to read aloud once. */
function generatePassword() {
  const body = crypto.randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, '');
  return `Sy${body.slice(0, 12)}${crypto.randomInt(10, 100)}`;
}

module.exports = {
  validatePassword,
  hashPassword,
  issueToken,
  verifyToken,
  resolveSession,
  toPublicUser,
  login,
  getProfile,
  changePassword,
  generatePassword
};
