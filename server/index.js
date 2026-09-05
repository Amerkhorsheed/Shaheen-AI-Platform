const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { authMiddleware, adminMiddleware, registerAuthRoutes } = require('./auth');
const { registerUploadRoutes } = require('./upload');
const { registerLmStudioRoutes } = require('./lmstudio');
const { registerExportRoutes } = require('./exportService');
const { registerTemplateRoutes } = require('./templates');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files (for assets, fonts, uploads)
app.use('/assets', express.static(path.join(__dirname, '../client/src/assets')));
app.use('/fonts', express.static(path.join(__dirname, '../client/public/fonts')));

// Register specialized sub-routers
registerAuthRoutes(app);
registerUploadRoutes(app, authMiddleware);
registerLmStudioRoutes(app, authMiddleware);
registerExportRoutes(app);
registerTemplateRoutes(app, authMiddleware);

// -------------------------------------------------------------
// CHATS & MESSAGES API (Local Database CRUD)
// -------------------------------------------------------------

// List user's chats
app.get('/api/chats', authMiddleware, (req, res) => {
  const chats = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) as message_count,
      (SELECT content FROM messages m WHERE m.chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
    FROM chats c
    WHERE c.user_id = ?
    ORDER BY c.pinned DESC, c.updated_at DESC
  `).all(req.user.id);
  res.json(chats);
});

// Create new chat
app.post('/api/chats', authMiddleware, (req, res) => {
  const { id, title = 'جلسة عمل جديدة', model = '', systemPrompt = '', classification = 'official' } = req.body;
  const chatId = id || ('chat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));

  try {
    db.prepare(`
      INSERT INTO chats (id, user_id, title, model, system_prompt, classification)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(chatId, req.user.id, title, model, systemPrompt, classification);

    const created = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
    res.json(created);
  } catch (err) {
    console.error('Error creating chat session:', err);
    res.status(500).json({ error: 'فشل إنشاء الجلسة: ' + err.message });
  }
});

// Get single chat and its messages
app.get('/api/chats/:id', authMiddleware, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'المحادثة غير موجودة' });

  const messages = db.prepare(`
    SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC
  `).all(req.params.id);

  const parsedMessages = messages.map(m => ({
    ...m,
    attachments: m.attachments ? JSON.parse(m.attachments) : []
  }));

  res.json({ ...chat, messages: parsedMessages });
});

// Update chat (title, pin, model, classification)
app.put('/api/chats/:id', authMiddleware, (req, res) => {
  const { title, pinned, model, systemPrompt, classification } = req.body;
  const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'المحادثة غير موجودة' });

  if (title !== undefined) {
    db.prepare('UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(title.trim(), req.params.id);
  }
  if (pinned !== undefined) {
    db.prepare('UPDATE chats SET pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(pinned ? 1 : 0, req.params.id);
  }
  if (model !== undefined) {
    db.prepare('UPDATE chats SET model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(model, req.params.id);
  }
  if (systemPrompt !== undefined) {
    db.prepare('UPDATE chats SET system_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(systemPrompt, req.params.id);
  }
  if (classification !== undefined) {
    db.prepare('UPDATE chats SET classification = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(classification, req.params.id);
  }

  const updated = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// Delete chat
app.delete('/api/chats/:id', authMiddleware, (req, res) => {
  const chat = db.prepare('SELECT id, title FROM chats WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'المحادثة غير موجودة أو تم حذفها مسبقاً' });

  // Delete messages first to maintain clean data integrity
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(req.params.id);
  // Delete the chat
  db.prepare('DELETE FROM chats WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);

  if (typeof db.logAudit === 'function') {
    db.logAudit(req.user.id, 'DELETE_CHAT', `حذف جلسة العمل: ${chat.title} (${req.params.id})`, req.ip);
  }

  res.json({ message: 'تم حذف المحادثة بنجاح' });
});

// Save a new message in chat
app.post('/api/chats/:id/messages', authMiddleware, (req, res) => {
  const { id, role, content, attachments = [] } = req.body;
  const chatId = req.params.id;

  const chat = db.prepare('SELECT id FROM chats WHERE id = ? AND user_id = ?').get(chatId, req.user.id);
  if (!chat) return res.status(404).json({ error: 'المحادثة غير موجودة' });

  const messageId = id || ('msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));
  const attachmentsJson = JSON.stringify(attachments);

  db.prepare(`
    INSERT INTO messages (id, chat_id, role, content, attachments)
    VALUES (?, ?, ?, ?, ?)
  `).run(messageId, chatId, role, content, attachmentsJson);

  // Update chat updated_at
  db.prepare('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(chatId);

  res.json({
    id: messageId,
    chat_id: chatId,
    role,
    content,
    attachments,
    created_at: new Date().toISOString()
  });
});

// Clear all messages in chat
app.delete('/api/chats/:id/messages', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(req.params.id);
  db.prepare('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  res.json({ message: 'تم إفراغ سجل الرسائل بنجاح' });
});

// -------------------------------------------------------------
// SETTINGS API
// -------------------------------------------------------------

// Get system settings
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

// Update system settings (admin only)
app.put('/api/settings', authMiddleware, adminMiddleware, (req, res) => {
  const updates = req.body;
  const updateStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const updateMany = db.transaction((entries) => {
    for (const [k, v] of entries) {
      updateStmt.run(k, String(v));
    }
  });

  updateMany(Object.entries(updates));
  res.json({ message: 'تم حفظ الإعدادات بنجاح' });
});

// -------------------------------------------------------------
// SERVE STATIC PRODUCTION BUILD OF CLIENT (SPA Fallback)
// -------------------------------------------------------------
const clientDist = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/assets')) {
      return res.sendFile(path.join(clientDist, 'index.html'));
    }
    next();
  });
}

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`  منصة شاهين للذكاء الاصطناعي (Shaheen AI Platform)`);
  console.log(`  الخادم المحلي يعمل على: http://localhost:${PORT}`);
  console.log(`  النظام معزول ويعمل دون أي خدمات سحابية خارجية`);
  console.log(`=======================================================`);
});
