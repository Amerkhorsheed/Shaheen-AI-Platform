const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');

async function migrate() {
  console.log('--- بدء ترحيل البيانات من SQLite إلى PostgreSQL ---');
  const sqlite = new Database(path.join(__dirname, 'shaheen.db'));
  const pg = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://shaheen_admin:SecurePassword2026!@127.0.0.1:5432/shaheen_ai'
  });

  // Test connection
  await pg.query('SELECT 1');
  console.log('✓ تم الاتصال بنجاح بخادم PostgreSQL على المنفذ 5432.');

  // 1. Categories
  const categories = sqlite.prepare('SELECT * FROM categories').all();
  for (const c of categories) {
    await pg.query(
      `INSERT INTO categories (id, name, description, code, clearance_level, icon, color, prompt_context, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [c.id, c.name, c.description, c.code, c.clearance_level, c.icon, c.color, c.prompt_context, c.created_at]
    );
  }
  console.log(`✓ تم ترحيل ${categories.length} فئة وتصنيف مؤسسي.`);

  // 2. Users
  const users = sqlite.prepare('SELECT * FROM users').all();
  for (const u of users) {
    await pg.query(
      `INSERT INTO users (id, username, password_hash, display_name, role, department, category_id, job_title, status, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.username, u.password_hash, u.display_name, u.role, u.department, u.category_id, u.job_title, u.status, u.notes, u.created_at]
    );
  }
  await pg.query("SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 1) FROM users))");
  console.log(`✓ تم ترحيل ${users.length} مستخدم مع الحفاظ على التشفير والصلاحيات.`);

  // 3. Settings
  const settings = sqlite.prepare('SELECT * FROM settings').all();
  for (const s of settings) {
    await pg.query(
      `INSERT INTO settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [s.key, s.value]
    );
  }
  console.log(`✓ تم ترحيل ${settings.length} إعدادات نظام.`);

  // 4. Templates
  const templates = sqlite.prepare('SELECT * FROM templates').all();
  for (const t of templates) {
    await pg.query(
      `INSERT INTO templates (id, title, category, description, prompt, icon, is_system, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [t.id, t.title, t.category, t.desc, t.prompt, t.icon, t.is_system, t.created_by, t.created_at, t.updated_at]
    );
  }
  console.log(`✓ تم ترحيل ${templates.length} قوالب رسمية.`);

  // 5. Chats
  const chats = sqlite.prepare('SELECT * FROM chats').all();
  for (const ch of chats) {
    await pg.query(
      `INSERT INTO chats (id, user_id, title, model, system_prompt, classification, pinned, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [ch.id, ch.user_id, ch.title, ch.model, ch.system_prompt, ch.classification, ch.pinned, ch.created_at, ch.updated_at]
    );
  }
  console.log(`✓ تم ترحيل ${chats.length} جلسة محادثة.`);

  // 6. Messages
  const messages = sqlite.prepare('SELECT * FROM messages').all();
  for (const m of messages) {
    await pg.query(
      `INSERT INTO messages (id, chat_id, role, content, attachments, model_used, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [m.id, m.chat_id, m.role, m.content, m.attachments, m.model_used, m.created_at]
    );
  }
  console.log(`✓ تم ترحيل ${messages.length} رسالة وسجل محادثة.`);

  // 7. Audit logs
  const logs = sqlite.prepare('SELECT * FROM audit_logs').all();
  for (const l of logs) {
    await pg.query(
      `INSERT INTO audit_logs (id, user_id, action, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [l.id, l.user_id, l.action, l.details, l.ip_address, l.created_at]
    );
  }
  await pg.query("SELECT setval('audit_logs_id_seq', (SELECT COALESCE(MAX(id), 1) FROM audit_logs))");
  console.log(`✓ تم ترحيل ${logs.length} سجل تدقيق إداري.`);

  await pg.end();
  console.log('\n=============================================');
  console.log('  اكتمل ترحيل قاعدة البيانات إلى PostgreSQL بنجاح 100%!');
  console.log('=============================================\n');
}

migrate().catch(err => {
  console.error('فشل الترحيل:', err);
  process.exit(1);
});
