const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db, logAudit } = require('./db');

// -------------------------------------------------------------
// SIGNING KEY
// -------------------------------------------------------------
function resolveJwtSecret() {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.trim().length >= 32) return fromEnv.trim();

  if (fromEnv && fromEnv.trim().length > 0) {
    throw new Error('JWT_SECRET must be at least 32 characters long.');
  }

  return 'shaheen_institutional_platform_secure_jwt_secret_2026_syria_sovereign_ai';
}

const JWT_SECRET = resolveJwtSecret();
const TOKEN_TTL = process.env.TOKEN_TTL || '8h';
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 10;

// Endpoints an authenticated user may still reach while their password is expired.
const PASSWORD_CHANGE_EXEMPT = new Set(['/api/auth/me', '/api/auth/change-password']);

// -------------------------------------------------------------
// RATE LIMITERS
// -------------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: false,
  // Count attempts per IP *and* per targeted username so that distributed
  // guessing against one account is throttled too.
  keyGenerator: (req) => `${req.ip}|${String(req.body?.username || '').trim().toLowerCase()}`,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    logAudit(null, 'LOGIN_RATE_LIMITED', { username: String(req.body?.username || '').slice(0, 64) }, req.ip);
    res.status(429).json({ error: 'تم تجاوز عدد محاولات الدخول المسموح بها. يرجى الانتظار 15 دقيقة قبل المحاولة مجدداً.' });
  }
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'عدد كبير من الطلبات في وقت قصير. يرجى الإبطاء قليلاً.' }
});

// -------------------------------------------------------------
// MIDDLEWARE
// -------------------------------------------------------------

/**
 * Verifies the bearer token *and* re-reads the account from the database on
 * every request. A signature alone is not enough: suspending, demoting or
 * deleting a user has to take effect immediately, not when the token expires.
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً' });
  }

  let decoded;
  try {
    decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً' });
  }

  try {
    const user = await db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.department, u.job_title, u.status,
             u.category_id, u.token_version, u.must_change_password,
             c.name as category_name, c.prompt_context as category_prompt_context
      FROM users u
      LEFT JOIN categories c ON u.category_id = c.id
      WHERE u.id = ?
    `).get(decoded.id);

    if (!user) {
      return res.status(401).json({ error: 'الحساب لم يعد موجوداً في المنظومة' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'هذا الحساب موقوف إدارياً، يرجى مراجعة إدارة المنظومة' });
    }
    if (Number(decoded.tokenVersion) !== Number(user.token_version)) {
      return res.status(401).json({ error: 'تم إبطال هذه الجلسة بعد تعديل بيانات الحساب. يرجى تسجيل الدخول مجدداً.' });
    }
    if (user.must_change_password && !PASSWORD_CHANGE_EXEMPT.has(req.path)) {
      return res.status(403).json({
        code: 'PASSWORD_CHANGE_REQUIRED',
        error: 'يجب تغيير كلمة المرور قبل استخدام المنظومة'
      });
    }

    // Authorisation always comes from the database row, never from the token.
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
      department: user.department,
      jobTitle: user.job_title,
      categoryId: user.category_id,
      categoryName: user.category_name,
      categoryPromptContext: user.category_prompt_context
    };
    next();
  } catch (err) {
    console.error('authMiddleware error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء التحقق من صلاحية الجلسة' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  logAudit(req.user?.id, 'FORBIDDEN_ADMIN_ATTEMPT', { path: req.originalUrl, method: req.method }, req.ip);
  return res.status(403).json({ error: 'عذراً، هذه العملية تتطلب صلاحيات المشرف العام' });
}

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      tokenVersion: Number(user.token_version ?? 1)
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function validatePassword(password) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `كلمة المرور يجب ألا تقل عن ${MIN_PASSWORD_LENGTH} خانات`;
  }
  if (!/[A-Za-z\u0600-\u06FF]/.test(password) || !/[0-9]/.test(password)) {
    return 'كلمة المرور يجب أن تجمع بين الحروف والأرقام';
  }
  return null;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    department: row.department,
    jobTitle: row.job_title,
    status: row.status,
    mustChangePassword: !!row.must_change_password,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryCode: row.category_code,
    categoryColor: row.category_color,
    categoryClearance: row.category_clearance,
    createdAt: row.created_at
  };
}

const USER_SELECT = `
  SELECT u.id, u.username, u.display_name, u.role, u.department, u.job_title, u.status,
         u.category_id, u.notes, u.must_change_password, u.created_at,
         c.name as category_name, c.code as category_code,
         c.color as category_color, c.clearance_level as category_clearance
  FROM users u
  LEFT JOIN categories c ON u.category_id = c.id
`;

// -------------------------------------------------------------
// ROUTES
// -------------------------------------------------------------
function registerAuthRoutes(app) {
  // ---------------- AUTHENTICATION ----------------

  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUsername);

    // Same message and comparable timing for both failure modes, so the
    // response cannot be used to enumerate valid usernames.
    const hash = user?.password_hash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const valid = bcrypt.compareSync(String(password), hash);

    if (!user || !valid) {
      logAudit(user?.id || null, 'LOGIN_FAILED', { username: cleanUsername }, req.ip);
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    if (user.status !== 'active') {
      logAudit(user.id, 'LOGIN_BLOCKED', { username: user.username, reason: 'suspended' }, req.ip);
      return res.status(403).json({ error: 'هذا الحساب موقوف إدارياً، يرجى مراجعة إدارة المنظومة' });
    }

    const token = generateToken(user);
    logAudit(user.id, 'LOGIN_SUCCESS', { username: user.username, role: user.role }, req.ip);

    const full = await db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(user.id);
    res.json({ token, user: publicUser(full) });
  });

  app.get('/api/auth/me', authMiddleware, async (req, res) => {
    const user = await db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json(publicUser(user));
  });

  // Self-service password change. Also clears the forced-change flag and
  // invalidates every other session belonging to this account.
  app.post('/api/auth/change-password', authMiddleware, writeLimiter, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    if (!currentPassword || !bcrypt.compareSync(String(currentPassword), user.password_hash)) {
      logAudit(user.id, 'PASSWORD_CHANGE_FAILED', { reason: 'current password mismatch' }, req.ip);
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }

    const problem = validatePassword(newPassword);
    if (problem) return res.status(400).json({ error: problem });
    if (bcrypt.compareSync(String(newPassword), user.password_hash)) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية' });
    }

    await db.prepare(`
      UPDATE users
      SET password_hash = ?, must_change_password = 0, token_version = token_version + 1
      WHERE id = ?
    `).run(bcrypt.hashSync(String(newPassword), BCRYPT_ROUNDS), user.id);

    logAudit(user.id, 'PASSWORD_CHANGED', { username: user.username }, req.ip);

    const updated = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    const full = await db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(user.id);
    res.json({
      message: 'تم تغيير كلمة المرور بنجاح',
      token: generateToken(updated),
      user: publicUser(full)
    });
  });

  // ---------------- CATEGORIES ----------------

  app.get('/api/categories', authMiddleware, async (req, res) => {
    const categories = await db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.category_id = c.id) as user_count
      FROM categories c
      ORDER BY c.created_at ASC
    `).all();
    res.json(categories);
  });

  app.post('/api/categories', authMiddleware, adminMiddleware, writeLimiter, async (req, res) => {
    const { name, code, description, clearance_level = 'official', color = '#02443A', prompt_context = '' } = req.body || {};

    if (!name || !String(name).trim()) return res.status(400).json({ error: 'اسم التصنيف مطلوب' });
    if (!code || !String(code).trim()) return res.status(400).json({ error: 'رمز التصنيف الكودي مطلوب (مثال: SEC, LAW)' });

    const VALID_CLEARANCE = ['top_secret', 'secret', 'official', 'unclassified'];
    if (!VALID_CLEARANCE.includes(clearance_level)) {
      return res.status(400).json({ error: 'درجة السرية المحددة غير معتمدة' });
    }

    const cleanName = String(name).trim();
    const cleanCode = String(code).trim().toUpperCase();

    if (await db.prepare('SELECT id FROM categories WHERE name = ? OR code = ?').get(cleanName, cleanCode)) {
      return res.status(400).json({ error: 'اسم التصنيف أو رمزه الكودي مسجل مسبقاً' });
    }

    const categoryId = 'cat_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
    await db.prepare(`
      INSERT INTO categories (id, name, code, description, clearance_level, color, prompt_context)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(categoryId, cleanName, cleanCode, String(description || '').trim(), clearance_level, color, String(prompt_context || '').trim());

    logAudit(req.user.id, 'CATEGORY_CREATED', { categoryId, name: cleanName, code: cleanCode }, req.ip);
    res.status(201).json({
      message: 'تم إنشاء التصنيف المؤسسي بنجاح',
      category: await db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId)
    });
  });

  app.delete('/api/categories/:id', authMiddleware, adminMiddleware, async (req, res) => {
    const categoryId = req.params.id;
    const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
    if (!category) return res.status(404).json({ error: 'التصنيف غير موجود' });

    const countRow = await db.prepare('SELECT COUNT(*) as count FROM users WHERE category_id = ?').get(categoryId);
    const count = countRow ? countRow.count : 0;
    if (count > 0) {
      return res.status(400).json({
        error: `لا يمكن حذف هذا التصنيف لوجود ${count} مستخدم مرتبط به حالياً. يرجى نقل المستخدمين إلى تصنيف آخر أولاً.`
      });
    }

    await db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
    logAudit(req.user.id, 'CATEGORY_DELETED', { categoryId, name: category.name }, req.ip);
    res.json({ message: 'تم حذف التصنيف المؤسسي بنجاح' });
  });

  // ---------------- USERS (administrator only) ----------------

  app.get('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
    const users = await db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.department, u.job_title, u.status,
             u.category_id, u.notes, u.must_change_password, u.created_at,
             c.name as category_name, c.code as category_code,
             c.color as category_color, c.clearance_level as category_clearance,
             (SELECT COUNT(*) FROM chats ch WHERE ch.user_id = u.id) as chat_count
      FROM users u
      LEFT JOIN categories c ON u.category_id = c.id
      ORDER BY u.created_at DESC
    `).all();
    res.json(users);
  });

  app.get('/api/users/stats', authMiddleware, adminMiddleware, async (req, res) => {
    const [totalUsers, activeUsers, adminCount, totalCategories, totalChats, categoriesBreakdown] = await Promise.all([
      db.prepare('SELECT COUNT(*) as count FROM users').get(),
      db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get(),
      db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get(),
      db.prepare('SELECT COUNT(*) as count FROM categories').get(),
      db.prepare('SELECT COUNT(*) as count FROM chats').get(),
      db.prepare(`
        SELECT c.name, c.code, c.color, COUNT(u.id) as user_count
        FROM categories c
        LEFT JOIN users u ON u.category_id = c.id
        GROUP BY c.id, c.name, c.code, c.color
        ORDER BY user_count DESC
      `).all()
    ]);

    res.json({
      totalUsers: totalUsers.count,
      activeUsers: activeUsers.count,
      adminCount: adminCount.count,
      totalCategories: totalCategories.count,
      totalChats: totalChats.count,
      categoriesBreakdown
    });
  });

  // Account creation is an administrative act. Self-registration is available
  // only when an administrator has explicitly enabled it, and never grants a
  // role or a clearance the requester chose for themselves.
  app.post('/api/users', writeLimiter, async (req, res) => {
    const regSetting = await db.prepare("SELECT value FROM settings WHERE key = 'allow_user_registration'").get();
    const selfRegistrationEnabled = regSetting?.value === 'true';

    let actingAdmin = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
        const row = await db.prepare('SELECT id, role, status, token_version FROM users WHERE id = ?').get(decoded.id);
        if (row && row.status === 'active' && row.role === 'admin' && Number(row.token_version) === Number(decoded.tokenVersion)) {
          actingAdmin = row;
        }
      } catch (e) {
        // Fall through to the self-registration path.
      }
    }

    if (!actingAdmin && !selfRegistrationEnabled) {
      return res.status(403).json({ error: 'إنشاء الحسابات مقتصر على مسؤول المنظومة' });
    }

    const { username, password, displayName, role, categoryId, jobTitle, notes } = req.body || {};

    if (!username || !String(username).trim()) {
      return res.status(400).json({ error: 'اسم المستخدم للدخول مطلوب' });
    }
    const cleanUsername = String(username).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'اسم المستخدم يجب أن يتكون من 3 إلى 32 خانة (أحرف لاتينية صغيرة وأرقام و . _ - فقط)' });
    }

    const passwordProblem = validatePassword(password);
    if (passwordProblem) return res.status(400).json({ error: passwordProblem });

    if (!categoryId) {
      return res.status(400).json({ error: 'يجب تحديد التصنيف / الإدارة المؤسسية للمستخدم (حقل إلزامي)' });
    }
    const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
    if (!category) {
      return res.status(400).json({ error: 'التصنيف المؤسسي المحدد غير موجود بالنظام' });
    }

    if (await db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername)) {
      return res.status(400).json({ error: 'اسم المستخدم مسجل مسبقاً، يرجى اختيار اسم دخول آخر' });
    }

    // Only an administrator may assign a role; self-registration is always 'user'.
    const VALID_ROLES = ['admin', 'analyst', 'auditor', 'user'];
    const assignedRole = actingAdmin && VALID_ROLES.includes(role) ? role : 'user';

    // Self-registered accounts start suspended and unassigned to any sensitive
    // clearance until an administrator reviews them.
    const initialStatus = actingAdmin ? 'active' : 'suspended';

    const info = await db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, department, category_id, job_title, status, notes, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cleanUsername,
      bcrypt.hashSync(String(password), BCRYPT_ROUNDS),
      String(displayName || '').trim() || cleanUsername,
      assignedRole,
      category.name,
      category.id,
      String(jobTitle || '').trim() || 'مستشار إداري',
      initialStatus,
      String(notes || '').trim(),
      actingAdmin ? 1 : 0
    );

    logAudit(actingAdmin?.id || null, actingAdmin ? 'USER_CREATED' : 'USER_SELF_REGISTERED', {
      createdUserId: info.lastInsertRowid,
      createdUser: cleanUsername,
      role: assignedRole,
      category: category.name,
      status: initialStatus
    }, req.ip);

    const created = await db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(info.lastInsertRowid);

    res.status(201).json({
      message: actingAdmin
        ? 'تم إنشاء الحساب. سيُطلب من المستخدم تغيير كلمة المرور عند أول دخول.'
        : 'تم استلام طلب الحساب. لن يُفعَّل الحساب إلا بعد اعتماده من مسؤول المنظومة.',
      user: publicUser(created)
    });
  });

  app.put('/api/users/:id', authMiddleware, adminMiddleware, writeLimiter, async (req, res) => {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'معرف المستخدم غير صالح' });

    const { displayName, role, categoryId, jobTitle, status, notes, newPassword } = req.body || {};

    const existing = await db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!existing) return res.status(404).json({ error: 'المستخدم غير موجود' });

    // ---- validate everything before writing anything ----
    if (targetId === req.user.id) {
      if (role && role !== 'admin') {
        return res.status(400).json({ error: 'لا يمكنك سحب صلاحيات الإشراف عن حسابك الشخصي' });
      }
      if (status === 'suspended') {
        return res.status(400).json({ error: 'لا يمكنك تجميد حسابك الشخصي الحالي' });
      }
    }

    const VALID_ROLES = ['admin', 'analyst', 'auditor', 'user'];
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'الصلاحية المحددة غير معتمدة' });
    }
    if (status !== undefined && !['active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'حالة الحساب المحددة غير معتمدة' });
    }

    let department = existing.department;
    let assignedCategoryId = existing.category_id;
    if (categoryId && categoryId !== existing.category_id) {
      const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
      if (!category) return res.status(400).json({ error: 'التصنيف المؤسسي المحدد غير صالح' });
      department = category.name;
      assignedCategoryId = category.id;
    }

    let newHash = null;
    if (newPassword !== undefined && String(newPassword).trim()) {
      const problem = validatePassword(String(newPassword).trim());
      if (problem) return res.status(400).json({ error: problem });
      newHash = bcrypt.hashSync(String(newPassword).trim(), BCRYPT_ROUNDS);
    }

    // Removing the last active administrator would lock the system out.
    const nextRole = role !== undefined ? role : existing.role;
    const nextStatus = status !== undefined ? status : existing.status;
    if (existing.role === 'admin' && existing.status === 'active' && (nextRole !== 'admin' || nextStatus !== 'active')) {
      const adminCheck = await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND status = 'active'").get();
      if ((adminCheck?.count || 0) <= 1) {
        return res.status(400).json({ error: 'لا يمكن سحب صلاحية أو تجميد المشرف الوحيد المتبقي في المنظومة' });
      }
    }

    // Any change to privileges, account state or credentials must terminate
    // the target's existing sessions.
    const revokeSessions =
      nextRole !== existing.role || nextStatus !== existing.status || newHash !== null;

    // ---- apply atomically ----
    await db.transaction(async () => {
      await db.prepare(`
        UPDATE users
        SET display_name = ?, role = ?, department = ?, category_id = ?, job_title = ?, status = ?, notes = ?
        WHERE id = ?
      `).run(
        displayName !== undefined ? String(displayName).trim() : existing.display_name,
        nextRole,
        department,
        assignedCategoryId,
        jobTitle !== undefined ? String(jobTitle).trim() : existing.job_title,
        nextStatus,
        notes !== undefined ? String(notes).trim() : existing.notes,
        targetId
      );

      if (newHash) {
        await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(newHash, targetId);
      }
      if (revokeSessions) {
        await db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(targetId);
      }
    })();

    if (newHash) logAudit(req.user.id, 'USER_PASSWORD_RESET', { targetUserId: targetId }, req.ip);
    logAudit(req.user.id, 'USER_UPDATED', {
      targetUserId: targetId,
      role: nextRole,
      status: nextStatus,
      categoryId: assignedCategoryId,
      sessionsRevoked: revokeSessions
    }, req.ip);

    res.json({
      message: 'تم تحديث بيانات المستخدم وتصنيفه بنجاح',
      user: publicUser(await db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(targetId))
    });
  });

  app.delete('/api/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'معرف المستخدم غير صالح' });
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'لا يمكنك حذف حسابك الشخصي الحالي' });
    }

    const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });

    if (target.role === 'admin' && target.status === 'active') {
      const adminCheck = await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND status = 'active'").get();
      if ((adminCheck?.count || 0) <= 1) {
        return res.status(400).json({ error: 'لا يمكن حذف المشرف الوحيد المتبقي في المنظومة' });
      }
    }

    await db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    logAudit(req.user.id, 'USER_DELETED', { deletedUserId: targetId, deletedUsername: target.username }, req.ip);
    res.json({ message: 'تم حذف المستخدم وجميع سجلاته بنجاح' });
  });

  // ---------------- AUDIT TRAIL ----------------

  app.get('/api/audit-logs', authMiddleware, adminMiddleware, async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const [logs, totalCheck] = await Promise.all([
      db.prepare(`
        SELECT a.*, u.username, u.display_name
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.id
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset),
      db.prepare('SELECT COUNT(*) as count FROM audit_logs').get()
    ]);

    res.json({
      total: totalCheck?.count || 0,
      limit,
      offset,
      logs
    });
  });
}

module.exports = {
  authMiddleware,
  adminMiddleware,
  registerAuthRoutes,
  generateToken,
  validatePassword,
  writeLimiter,
  JWT_SECRET
};
