const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db, logAudit } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'shaheen-local-secret-key-2026-secure';

// Middleware to authenticate requests
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً' });
  }
}

// Middleware for admin-only endpoints
function adminMiddleware(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'عذراً، هذه العملية تتطلب صلاحيات المشرف العام' });
  }
}

// Generate JWT token
function generateToken(user) {
  return jwt.sign(
    { 
      id: user.id, 
      username: user.username, 
      role: user.role, 
      displayName: user.display_name,
      department: user.department || 'الإدارة العامة'
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Auth endpoints router
function registerAuthRoutes(app) {
  // Login
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'يرجى تزويد اسم المستخدم وكلمة المرور' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
    if (!user) {
      logAudit(null, 'LOGIN_FAILED', { username: username.trim(), reason: 'المستخدم غير موجود' }, req.ip);
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      logAudit(user.id, 'LOGIN_FAILED', { username: user.username, reason: 'كلمة المرور غير مطابقة' }, req.ip);
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const token = generateToken(user);
    logAudit(user.id, 'LOGIN_SUCCESS', { username: user.username, role: user.role }, req.ip);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        department: user.department,
        createdAt: user.created_at
      }
    });
  });

  // Get current user profile
  app.get('/api/auth/me', authMiddleware, (req, res) => {
    const user = db.prepare('SELECT id, username, display_name, role, department, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      department: user.department,
      createdAt: user.created_at
    });
  });

  // Register new account
  app.post('/api/auth/register', (req, res) => {
    const allowReg = db.prepare("SELECT value FROM settings WHERE key = 'allow_user_registration'").get()?.value === 'true';
    const authHeader = req.headers.authorization;
    let isAdmin = false;
    let actingUserId = null;
    if (authHeader) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        if (decoded.role === 'admin') {
          isAdmin = true;
          actingUserId = decoded.id;
        }
      } catch (e) {}
    }

    if (!allowReg && !isAdmin) {
      return res.status(403).json({ error: 'إنشاء الحسابات مقيد حالياً من قِبل مدير النظام' });
    }

    const { username, password, displayName, role, department } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
    if (existing) {
      return res.status(400).json({ error: 'اسم المستخدم مسجل مسبقاً، يرجى اختيار اسم آخر' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const assignedRole = (isAdmin && role) ? role : 'user';
    const name = displayName?.trim() || username.trim();
    const dept = department?.trim() || 'الإدارة العامة';

    const info = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, department)
      VALUES (?, ?, ?, ?, ?)
    `).run(username.trim(), passwordHash, name, assignedRole, dept);

    logAudit(actingUserId || info.lastInsertRowid, 'USER_CREATED', { createdUser: username.trim(), role: assignedRole }, req.ip);

    const newUser = { id: info.lastInsertRowid, username: username.trim(), displayName: name, role: assignedRole, department: dept };
    const token = generateToken({ id: info.lastInsertRowid, username: username.trim(), display_name: name, role: assignedRole, department: dept });

    res.json({ message: 'تم إنشاء الحساب بنجاح', user: newUser, token });
  });

  // Admin: List all users
  app.get('/api/users', authMiddleware, adminMiddleware, (req, res) => {
    const users = db.prepare('SELECT id, username, display_name, role, department, created_at FROM users ORDER BY created_at DESC').all();
    res.json(users);
  });

  // Admin: List audit logs
  app.get('/api/audit-logs', authMiddleware, adminMiddleware, (req, res) => {
    const logs = db.prepare(`
      SELECT a.*, u.username, u.display_name 
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT 100
    `).all();
    res.json(logs);
  });

  // Admin: Delete user
  app.delete('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
    const targetId = parseInt(req.params.id, 10);
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'لا يمكنك حذف حسابك الشخصي الحالي' });
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    logAudit(req.user.id, 'USER_DELETED', { deletedUserId: targetId }, req.ip);
    res.json({ message: 'تم حذف المستخدم بنجاح' });
  });
}

module.exports = {
  authMiddleware,
  adminMiddleware,
  registerAuthRoutes
};
