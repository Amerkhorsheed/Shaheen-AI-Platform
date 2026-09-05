const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'shaheen.db');
const db = new Database(dbPath);

// Enable WAL mode for high performance and concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize complete institutional schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT DEFAULT 'user', -- 'admin', 'analyst', 'user', 'auditor'
    department TEXT DEFAULT 'الإدارة العامة',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    model TEXT,
    system_prompt TEXT,
    classification TEXT DEFAULT 'official', -- 'top_secret', 'secret', 'official', 'unclassified'
    pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    attachments TEXT,
    model_used TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    desc TEXT,
    prompt TEXT NOT NULL,
    icon TEXT DEFAULT 'FileText',
    is_system INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
  );
`);

// Add classification column if not exists (migration safe)
try {
  db.exec("ALTER TABLE chats ADD COLUMN classification TEXT DEFAULT 'official'");
} catch (e) {
  // Column already exists
}

// Add department column to users if not exists
try {
  db.exec("ALTER TABLE users ADD COLUMN department TEXT DEFAULT 'الإدارة العامة'");
} catch (e) {
  // Column already exists
}

// Seed default institutional settings
const defaultSettings = [
  ['lm_studio_url', 'http://127.0.0.1:1234/v1'],
  ['system_name', 'منظومة شاهين للذكاء الاصطناعي السيادي'],
  ['organization_name', 'الجمهورية العربية السورية — الهيئة الوطنية للتحول الرقمي'],
  ['default_system_prompt', 'أنت المستشار السيادي الذكي لمنظومة شاهين في الجمهورية العربية السورية. تجيب بلغة عربية فصحى رفيعة المستوى، وبصياغة إدارية وقانونية معتمدة ورصينة، وتراعي الدقة المطلقة في المخرجات والجداول والأرقام.'],
  ['allow_user_registration', 'true'],
  ['enforce_audit_logging', 'true']
];

const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
for (const [k, v] of defaultSettings) {
  insertSetting.run(k, v);
}

// Seed default admin account if no users exist
const userCount = db.prepare(`SELECT COUNT(*) as count FROM users`).get().count;
if (userCount === 0) {
  const adminHash = bcrypt.hashSync('admin123', 10);
  db.prepare(`
    INSERT INTO users (username, password_hash, display_name, role, department)
    VALUES (?, ?, ?, ?, ?)
  `).run('admin', adminHash, 'المدير العام (مسؤول المنظومة)', 'admin', 'رئاسة الهيئة');
  console.log('Default institutional admin initialized: admin / admin123');
}

// Seed default official government templates if none exist
const templateCount = db.prepare(`SELECT COUNT(*) as count FROM templates`).get().count;
if (templateCount === 0) {
  const defaultTemplates = [
    {
      id: 'official-letter',
      title: 'صياغة كتاب رسمي إداري',
      category: 'المراسلات الإدارية',
      desc: 'صياغة مراسلة رسمية موجهة لجهة حكومية وفق الأصول والأساليب الإدارية المعتمدة.',
      icon: 'FileText',
      is_system: 1,
      prompt: `المطلوب صياغة مسودة **كتاب رسمي إداري** موجه إلى: [اسم الجهة أو الإدارة المعنية].
**موضوع الكتاب:** [أدخل الموضوع باختصار].
**المعطيات والأسباب الموجبة:**
- [أدخل النقطة الأولى].
- [أدخل النقطة الثانية].
يرجى اعتماد الصياغة القانونية والإدارية الرسمية السورية، مع تضمين التوجيهات التنفيذية وجدول التوقيع والاعتماد.`
    },
    {
      id: 'ministerial-circular',
      title: 'صياغة تعميم وزاري تنظيمي',
      category: 'التعاميم والتعليمات',
      desc: 'صياغة تعميم موحد صادر عن الإدارة العامة يُعمم على كافة الجهات التابعة للالتزام بتعليمات معينة.',
      icon: 'Send',
      is_system: 1,
      prompt: `المطلوب صياغة **تعميم وزاري تنفيذي** بشأن: [موضوع التعميم].
**الجهات الموجه إليها التعميم:** كافة الإدارات والمديريات العامة والجهات التابعة.
**الأهداف التنظيمية:**
1. [الهدف أو التوجيه الأول].
2. [الهدف أو التوجيه الثاني].
يرجى صياغة مواد التعميم وبنوده بشكل مرقم وواضح مع التأكيد على تاريخ سريانه ومسؤولية الجهات الرقابية عن المتابعة.`
    },
    {
      id: 'executive-memo',
      title: 'مذكرة عرض ومقترح قرار',
      category: 'القرارات والمذكرات',
      desc: 'مذكرة إحالة رسمية تتضمن عرض الواقع والمبررات الفنية والمالية ومقترح القرار المطلوب اعتماده.',
      icon: 'Scale',
      is_system: 1,
      prompt: `المطلوب إعداد **مذكرة عرض ومقترح قرار** للعرض على أصحاب القرار بخصوص: [الموضوع المقترح].
**عناصر المذكرة المطلوبة:**
1. عرض الواقع الحالي والتحديات القائمة.
2. المبررات والأسانيد الإدارية والفنية للتعديل.
3. المقترح الإجرائي والتوصيات التنفيذية المحددة.
4. مشروع القرار المقترح لإصداره.`
    },
    {
      id: 'contract-audit',
      title: 'تدقيق عقد أو اتفاقية قانونية',
      category: 'التدقيق والامتثال',
      desc: 'مراجعة مسودة اتفاقية أو شروط مناقصة، واستخراج البنود الحرجة والشروط الجزائية وملاحظات الحوكمة.',
      icon: 'CheckSquare',
      is_system: 1,
      prompt: `المطلوب إجراء **تدقيق ومراجعة شاملة للعقد/الاتفاقية** المرفقة:
1. التحقق من اتساق بنود العقد مع القوانين والأنظمة المعمول بها.
2. رصد التزامات الطرفين والحقوق المتبادلة.
3. تدقيق الشروط الجزائية، غرامات التأخير، وبنود فسخ العقد.
4. إبراز المخاطر القانونية والمالية وتقديم التوصيات اللازمة لتعديل البنود الحساسة.`
    },
    {
      id: 'budget-table-analysis',
      title: 'تحليل موازنة وجدول مؤشرات (CSV)',
      category: 'البيانات المالية والإحصائية',
      desc: 'تحليل مصفوفة أرقام أو بيانات مالية واستخراج الجداول التفصيلية ونسب التنفيذ بصيغة جاهزة للتصدير إلى CSV.',
      icon: 'FileSpreadsheet',
      is_system: 1,
      prompt: `المطلوب **تحليل البيانات والبيانات المالية المرفقة** وإخراج النتائج في شكل **جدول بيانات مقارن وشامل**:
- استخراج نسب التنفيذ الفعلية مقارنة بالمخطط.
- إبراز بنود الوفر والانحراف المالي إن وجدت.
- تجهيز الجدول بأعمدة منظمة (المعرف، البند، المخصص، الفعلي، نسبة الإنجاز، التقييم) ليكون قابلاً للتصدير الفوري كملف CSV أو طباعته رسمياً كتقرير.`
    },
    {
      id: 'strategic-summary',
      title: 'تلخيص تقرير استراتيجي ومحضر اجتماع',
      category: 'الدراسات والتقارير',
      desc: 'تلخيص الوثائق الطويلة واستخراج مصفوفة القرارات، التوصيات، وتوزيع المهام والمسؤوليات.',
      icon: 'BookOpen',
      is_system: 1,
      prompt: `المطلوب تلخيص **التقرير / محضر الاجتماع** المرفق بأسلوب تنفيذي موجز:
1. ملخص تنفيذي للمحاور الرئيسية (في فقرة موجزة).
2. جدول التكليفات والمهام: (المهمة، الجهة أو المسؤول، الإطار الزمني للتنفيذ).
3. أبرز التوصيات الاستراتيجية والقرارات الواجب متابعتها.`
    }
  ];

  const insertTemplate = db.prepare(`
    INSERT OR IGNORE INTO templates (id, title, category, desc, prompt, icon, is_system)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const t of defaultTemplates) {
    insertTemplate.run(t.id, t.title, t.category, t.desc, t.prompt, t.icon, t.is_system);
  }
  console.log('Default official government templates seeded successfully.');
}

// Audit logging helper
function logAudit(userId, action, details, ipAddress = '127.0.0.1') {
  try {
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, details, ip_address)
      VALUES (?, ?, ?, ?)
    `).run(userId || null, action, typeof details === 'object' ? JSON.stringify(details) : String(details), ipAddress);
  } catch (err) {
    console.error('Audit logging error:', err);
  }
}

db.db = db;
db.logAudit = logAudit;

module.exports = db;
module.exports.db = db;
module.exports.logAudit = logAudit;
