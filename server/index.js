require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const db = require('./db');
const { logAudit } = require('./db');
const { authMiddleware, adminMiddleware, registerAuthRoutes, writeLimiter } = require('./auth');
const { registerUploadRoutes } = require('./upload');
const { registerLmStudioRoutes, assertSafeLmStudioUrl } = require('./lmstudio');
const { registerExportRoutes } = require('./exportService');
const { registerTemplateRoutes } = require('./templates');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Behind a reverse proxy the client IP arrives in X-Forwarded-For. Enabled only
// when the operator says so, because trusting it blindly lets anyone spoof the
// address used for rate limiting and audit records.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
} else {
  app.set('trust proxy', false);
}
app.disable('x-powered-by');

// -------------------------------------------------------------
// SECURITY HEADERS
// -------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        // React and Tailwind emit style attributes, which CSP treats as inline styles.
        'style-src': ["'self'", "'unsafe-inline'"],
        'font-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'none'"],
        'object-src': ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' },
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    xContentTypeOptions: true
  })
);

// -------------------------------------------------------------
// CORS
// -------------------------------------------------------------
// Production deployments serve the frontend and backend from the same origin.
// In development, Vite runs on port 5173.
const allowedOrigins = (
  process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('محظور بموجب سياسة أمان النطاقات (CORS)'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

// -------------------------------------------------------------
// BODY PARSING
// -------------------------------------------------------------
// Chat queries, prompt templates, and administrative payloads. File uploads
// go through multer on /api/upload and bypass this parser entirely.
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// -------------------------------------------------------------
// ROUTE MODULES
// -------------------------------------------------------------
registerAuthRoutes(app);
registerUploadRoutes(app, authMiddleware);
registerLmStudioRoutes(app, authMiddleware);
registerExportRoutes(app, authMiddleware);
registerTemplateRoutes(app, authMiddleware);

// -------------------------------------------------------------
// CHATS & MESSAGES
// -------------------------------------------------------------
const VALID_CLASSIFICATIONS = ['top_secret', 'secret', 'official', 'unclassified'];

/**
 * Load a chat only if it belongs to the caller. Every chat and message route
 * goes through this: an id in the URL is not proof of ownership.
 */
async function ownedChat(chatId, userId) {
  return await db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(chatId, userId);
}

app.get('/api/chats', authMiddleware, async (req, res) => {
  const chats = await db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) as message_count,
      (SELECT content FROM messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message
    FROM chats c
    WHERE c.user_id = ?
    ORDER BY c.pinned DESC, c.updated_at DESC
  `).all(req.user.id);
  res.json(chats);
});

app.post('/api/chats', authMiddleware, writeLimiter, async (req, res) => {
  const {
    id,
    title = 'جلسة عمل جديدة',
    model = '',
    systemPrompt = '',
    classification = 'official'
  } = req.body || {};

  if (!VALID_CLASSIFICATIONS.includes(classification)) {
    return res.status(400).json({ error: 'درجة التصنيف المحددة غير معتمدة' });
  }

  // Client-supplied ids are accepted for optimistic UI, but constrained so
  // they cannot collide with or impersonate another namespace.
  let chatId = typeof id === 'string' && /^chat_[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
  if (!chatId) {
    chatId = 'chat_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
  }
  if (await db.prepare('SELECT id FROM chats WHERE id = ?').get(chatId)) {
    return res.status(409).json({ error: 'معرف الجلسة مستخدم مسبقاً' });
  }

  try {
    await db.prepare(`
      INSERT INTO chats (id, user_id, title, model, system_prompt, classification)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(chatId, req.user.id, String(title).slice(0, 300), String(model), String(systemPrompt), classification);

    res.status(201).json(await db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId));
  } catch (err) {
    console.error('Error creating chat session:', err);
    res.status(500).json({ error: 'فشل إنشاء الجلسة' });
  }
});

app.get('/api/chats/:id', authMiddleware, async (req, res) => {
  const chat = await ownedChat(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'المحادثة غير موجودة' });

  const rawMessages = await db
    .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC')
    .all(req.params.id);

  const messages = rawMessages.map((m) => {
    let attachments = [];
    try {
      attachments = m.attachments ? JSON.parse(m.attachments) : [];
    } catch (e) {
      attachments = [];
    }
    return { ...m, attachments };
  });

  res.json({ ...chat, messages });
});

app.put('/api/chats/:id', authMiddleware, writeLimiter, async (req, res) => {
  const chat = await ownedChat(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'المحادثة غير موجودة' });

  const { title, pinned, model, systemPrompt, classification } = req.body || {};

  if (classification !== undefined && !VALID_CLASSIFICATIONS.includes(classification)) {
    return res.status(400).json({ error: 'درجة التصنيف المحددة غير معتمدة' });
  }

  await db.prepare(`
    UPDATE chats
    SET title = ?, pinned = ?, model = ?, system_prompt = ?, classification = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(
    title !== undefined ? String(title).trim().slice(0, 300) : chat.title,
    pinned !== undefined ? (pinned ? 1 : 0) : chat.pinned,
    model !== undefined ? String(model) : chat.model,
    systemPrompt !== undefined ? String(systemPrompt) : chat.system_prompt,
    classification !== undefined ? classification : chat.classification,
    req.params.id,
    req.user.id
  );

  res.json(await db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id));
});

app.delete('/api/chats/:id', authMiddleware, async (req, res) => {
  const chat = await ownedChat(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'المحادثة غير موجودة أو تم حذفها مسبقاً' });

  // messages cascade via the foreign key, but the delete is wrapped anyway so
  // a partial removal can never be observed.
  await db.transaction(async () => {
    await db.prepare('DELETE FROM messages WHERE chat_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM chats WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  })();

  logAudit(req.user.id, 'DELETE_CHAT', { chatId: req.params.id, title: chat.title }, req.ip);
  res.json({ message: 'تم حذف المحادثة بنجاح' });
});

app.post('/api/chats/:id/messages', authMiddleware, writeLimiter, async (req, res) => {
  const chat = await ownedChat(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'المحادثة غير موجودة' });

  const { id, role, content, attachments = [] } = req.body || {};

  if (!['user', 'assistant', 'system'].includes(role)) {
    return res.status(400).json({ error: 'نوع الرسالة غير صالح' });
  }
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'محتوى الرسالة غير صالح' });
  }

  const messageId =
    typeof id === 'string' && /^msg_[A-Za-z0-9_-]{1,64}$/.test(id)
      ? id
      : 'msg_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');

  await db.transaction(async () => {
    await db.prepare(`
      INSERT INTO messages (id, chat_id, role, content, attachments)
      VALUES (?, ?, ?, ?, ?)
    `).run(messageId, req.params.id, role, content, JSON.stringify(Array.isArray(attachments) ? attachments : []));

    await db.prepare('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  })();

  res.status(201).json(await db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId));
});

// Clearing a conversation is destructive, so it checks ownership like every
// other chat route and leaves an audit record.
app.delete('/api/chats/:id/messages', authMiddleware, async (req, res) => {
  const chat = await ownedChat(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'المحادثة غير موجودة' });

  const countRow = await db.prepare('SELECT COUNT(*) as count FROM messages WHERE chat_id = ?').get(req.params.id);
  const removed = countRow ? countRow.count : 0;

  await db.transaction(async () => {
    await db.prepare('DELETE FROM messages WHERE chat_id = ?').run(req.params.id);
    await db.prepare('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  })();

  logAudit(req.user.id, 'CLEAR_CHAT_MESSAGES', {
    chatId: req.params.id,
    title: chat.title,
    messagesRemoved: removed
  }, req.ip);

  res.json({ message: 'تم إفراغ سجل الرسائل بنجاح', messagesRemoved: removed });
});

// -------------------------------------------------------------
// SETTINGS
// -------------------------------------------------------------
// Keys the API is allowed to read and write. The JWT signing key lives in the
// same table and must never be exposed or overwritten through this endpoint.
const PUBLIC_SETTING_KEYS = [
  'lm_studio_url',
  'system_name',
  'organization_name',
  'default_system_prompt',
  'allow_user_registration',
  'enforce_audit_logging'
];

app.get('/api/settings', authMiddleware, async (req, res) => {
  const rows = await db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${PUBLIC_SETTING_KEYS.map(() => '?').join(',')})`)
    .all(...PUBLIC_SETTING_KEYS);

  const settings = {};
  rows.forEach((r) => { settings[r.key] = r.value; });
  res.json(settings);
});

app.put('/api/settings', authMiddleware, adminMiddleware, writeLimiter, async (req, res) => {
  const updates = req.body || {};

  const unknown = Object.keys(updates).filter((k) => !PUBLIC_SETTING_KEYS.includes(k));
  if (unknown.length > 0) {
    return res.status(400).json({ error: `إعدادات غير معروفة: ${unknown.join(', ')}` });
  }

  if (updates.lm_studio_url !== undefined) {
    try {
      assertSafeLmStudioUrl(String(updates.lm_studio_url));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  if (updates.allow_user_registration !== undefined &&
      !['true', 'false'].includes(String(updates.allow_user_registration))) {
    return res.status(400).json({ error: 'قيمة السماح بالتسجيل الذاتي يجب أن تكون true أو false' });
  }

  await db.transaction(async (entries) => {
    for (const [k, v] of entries) {
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, String(v));
    }
  })(Object.entries(updates));

  logAudit(req.user.id, 'SETTINGS_UPDATED', { keys: Object.keys(updates) }, req.ip);
  res.json({ message: 'تم حفظ الإعدادات بنجاح' });
});

// -------------------------------------------------------------
// HEALTH
// -------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()), database: 'PostgreSQL' });
});

// -------------------------------------------------------------
// SPA + ERROR HANDLING
// -------------------------------------------------------------
// Unknown API routes must return JSON 404s, never the SPA shell.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'المسار المطلوب غير موجود' });
});

const clientDist = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, dotfiles: 'deny' }));
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/assets') || req.path.startsWith('/fonts')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  console.warn('client/dist not found — run "npm run build" to serve the web interface.');
}

// Centralised error handler: log the detail, return a generic message.
// Stack traces and driver errors must not reach the browser.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return req.socket.destroy();

  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'حجم الطلب يتجاوز الحد المسموح به' });
  }
  res.status(500).json({ error: 'حدث خطأ داخلي في الخادم. تمت كتابة التفاصيل في سجل الخادم.' });
});

// -------------------------------------------------------------
// START / SHUTDOWN
// -------------------------------------------------------------
let server;

async function startServer() {
  await db.initDb();
  server = app.listen(PORT, HOST, () => {
    console.log('=======================================================');
    console.log('  منظومة OSS للذكاء الاصطناعي (OSS AI Platform)');
    console.log(`  الخادم المحلي يعمل على: http://localhost:${PORT}`);
    console.log('  قاعدة البيانات: PostgreSQL (Docker) متصلة وجاهزة');
    console.log('  النظام معزول ولا يجري أي اتصال بخدمات خارجية');
    console.log('=======================================================');
  });
}

function shutdown(signal) {
  console.log(`\n${signal} received — closing the server and the database cleanly...`);
  if (server) {
    server.close(async () => {
      try { await db.close(); } catch (e) { /* already closed */ }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
  // Do not hang forever on open SSE streams.
  setTimeout(() => process.exit(0), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer().catch((err) => {
  console.error('فشل بدء تشغيل الخادم:', err);
  process.exit(1);
});

module.exports = { app, server };
