const { Pool, types } = require('pg');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { AsyncLocalStorage } = require('async_hooks');

// Parse PostgreSQL int8 (bigint) as integers so COUNT(*) returns numeric values
types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));

// No credential fallback in source. A connection string committed to the
// repository is a published database password, which is how the previous
// default administrator credential leaked.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and set the PostgreSQL connection string before starting the server.'
  );
}

const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

// Transaction context via AsyncLocalStorage so queries within transactions automatically share the client
const txStorage = new AsyncLocalStorage();

async function query(sql, params = []) {
  const client = txStorage.getStore() || pool;
  return await client.query(sql, params);
}

function postProcessSql(sql) {
  let res = sql.trim();

  // Translate SQLite's INSERT OR IGNORE INTO
  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(res)) {
    res = res.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
    if (!/ON\s+CONFLICT/i.test(res)) {
      res += ' ON CONFLICT DO NOTHING';
    }
  }

  // Translate SQLite's INSERT OR REPLACE INTO settings (key, value)
  if (/INSERT\s+OR\s+REPLACE\s+INTO\s+settings/i.test(res)) {
    res = res.replace(
      /INSERT\s+OR\s+REPLACE\s+INTO\s+settings\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
      'INSERT INTO settings ($1) VALUES ($2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'
    );
  }

  return res;
}

function translateSqlAndParams(sql, rawArgs) {
  // If named parameters were used like @id, @name
  if (
    rawArgs.length === 1 &&
    rawArgs[0] !== null &&
    typeof rawArgs[0] === 'object' &&
    !Array.isArray(rawArgs[0]) &&
    !(rawArgs[0] instanceof Buffer) &&
    !(rawArgs[0] instanceof Date)
  ) {
    const obj = rawArgs[0];
    const params = [];
    let idx = 1;
    let translated = sql.replace(/@([a-zA-Z0-9_]+)/g, (_, name) => {
      params.push(obj[name]);
      return `$${idx++}`;
    });
    return { sql: postProcessSql(translated), params };
  }

  const params = rawArgs.length === 1 && Array.isArray(rawArgs[0]) ? rawArgs[0] : rawArgs;
  let idx = 1;
  let translated = sql.replace(/\?/g, () => `$${idx++}`);
  return { sql: postProcessSql(translated), params };
}

function prepare(sql) {
  return {
    all: async (...args) => {
      const { sql: finalSql, params } = translateSqlAndParams(sql, args);
      const res = await query(finalSql, params);
      return res.rows;
    },
    get: async (...args) => {
      const { sql: finalSql, params } = translateSqlAndParams(sql, args);
      const res = await query(finalSql, params);
      return res.rows[0];
    },
    run: async (...args) => {
      let { sql: finalSql, params } = translateSqlAndParams(sql, args);
      const isInsert = /^\s*INSERT\s+INTO/i.test(finalSql);
      if (isInsert && !/RETURNING/i.test(finalSql)) {
        finalSql = finalSql.trim() + ' RETURNING *';
      }
      const res = await query(finalSql, params);
      const inserted = res.rows[0];
      return {
        changes: res.rowCount,
        rowCount: res.rowCount,
        lastInsertRowid: inserted
          ? (inserted.id !== undefined ? inserted.id : (inserted.ref !== undefined ? inserted.ref : inserted.key))
          : null
      };
    }
  };
}

function transaction(fn) {
  return async function (...args) {
    const existingClient = txStorage.getStore();
    if (existingClient) {
      return await fn(...args);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await txStorage.run(client, async () => {
        return await fn(...args);
      });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  };
}

// -------------------------------------------------------------
// BASE SYSTEM PROMPT & DEFAULT SEEDS
// -------------------------------------------------------------
const BASE_SYSTEM_PROMPT = [
  'أنت المستشار الذكي لمنظومة OSS في الجمهورية العربية السورية.',
  'تجيب بلغة عربية فصحى رفيعة المستوى وبصياغة إدارية وقانونية رصينة.',
  '',
  'قواعد إلزامية لا يجوز مخالفتها:',
  '1. لا تختلق أي رقم أو إحصاءة أو نسبة أو تاريخ أو مرجع قانوني. استخدم فقط ما ورد في رسالة المستخدم أو في المستند المرفق.',
  '2. إذا لم تتوفر لديك البيانات المطلوبة فصرّح بذلك نصاً واطلبها من المستخدم، ولا تملأ الجداول بقيم تقديرية.',
  '3. عند ترك قيمة غير معروفة في جدول، اكتب «غير متوفر» بدل تقدير رقم.',
  '4. لا تدّعِ أنك اعتمدت أو وثّقت أو ختمت أي وثيقة؛ فأنت تنتج مسودات تخضع لمراجعة وتوقيع الجهة المختصة.'
].join('\n');

const defaultCategories = [
  {
    id: 'cat_exec',
    name: 'القيادة والإدارة العليا',
    code: 'EXEC',
    clearance_level: 'top_secret',
    icon: 'ShieldAlert',
    color: '#B79E6A',
    description: 'اتخاذ القرارات الاستراتيجية والسيادية، الإشراف العام، واعتماد السياسات والمراسيم العليا.',
    prompt_context: 'أنت تقدم المشورة للقيادة والإدارة العليا. اعتمد الأسلوب التنفيذي الموجز والحاسم، مع إبراز المؤشرات الاستراتيجية والمخاطر والتوصيات المباشرة لدعم القرار السليم.'
  },
  {
    id: 'cat_strategy',
    name: 'التحليل والدراسات الاستراتيجية',
    code: 'STRAT',
    clearance_level: 'secret',
    icon: 'TrendingUp',
    color: '#02443A',
    description: 'إعداد البحوث والدراسات المقارنة، استشراف السيناريوهات، وتحليل الأبعاد المؤسسية.',
    prompt_context: 'أنت مستشار شعبة التحليل والدراسات الاستراتيجية. قدّم تحليلات معمقة وممنهجة مع مصفوفات مقارنة واستشراف للآفاق المستقبلية.'
  },
  {
    id: 'cat_legal',
    name: 'الشؤون القانونية والمراسلات الرسمية',
    code: 'LEGAL',
    clearance_level: 'official',
    icon: 'Scale',
    color: '#2E6B4F',
    description: 'صياغة وتدقيق مشاريع القرارات، المذكرات، الاتفاقيات، ومطابقة النصوص مع التشريعات السارية.',
    prompt_context: 'أنت المستشار القانوني للمنظومة. ركّز على الدقة التشريعية المطلقة، الصياغات القانونية المحكمة، والمصطلحات الإدارية الرسمية المعتمدة في الدولة.'
  },
  {
    id: 'cat_finance',
    name: 'المالية والموازنات العامة',
    code: 'FIN',
    clearance_level: 'secret',
    icon: 'DollarSign',
    color: '#8B6F3E',
    description: 'التخطيط المالي، دراسات الموازنات، مراجعة جداول النفقات، وتحليل المؤشرات المالية.',
    prompt_context: 'أنت خبير التحليل المالي والموازنات. احرص على تقديم جداول رقمية واضحة ونسب مئوية ومصفوفات قابلة للتصدير بصيغة CSV. لا تفترض أي رقم غير وارد في مُدخلات المستخدم.'
  },
  {
    id: 'cat_tech',
    name: 'التحول الرقمي وتكنولوجيا المعلومات',
    code: 'TECH',
    clearance_level: 'official',
    icon: 'Cpu',
    color: '#1E40AF',
    description: 'أتمتة العمليات الحكومية، البنية التحتية، الأمان والسيادة الرقمية، وهندسة البرمجيات.',
    prompt_context: 'أنت خبير التحول الرقمي وهندسة النظم. ركّز على الأمان السيبراني، معمارية الأنظمة، كفاءة الأداء، والسيادة الرقمية المحلية.'
  },
  {
    id: 'cat_audit',
    name: 'التدقيق الداخلي والرقابة والمتابعة',
    code: 'AUDIT',
    clearance_level: 'official',
    icon: 'ClipboardCheck',
    color: '#475569',
    description: 'متابعة الالتزام بالأنظمة، تدقيق الإجراءات والمعاملات، ومراقبة جودة الأداء المؤسسي.',
    prompt_context: 'أنت مدقق المنظومة الداخلي. تحرّ الدقة الصارمة، الشفافية، ومطابقة المعاملات للمعايير واللوائح التنظيمية.'
  },
  {
    id: 'cat_hr',
    name: 'الموارد البشرية والشؤون الإدارية',
    code: 'HR',
    clearance_level: 'official',
    icon: 'Users',
    color: '#6B21A8',
    description: 'تنظيم الهيكل الإداري، تدريب الكوادر، متابعة المهام الوظيفية والخدمات الإدارية.',
    prompt_context: 'أنت مستشار الموارد البشرية والشؤون الإدارية. ركّز على كفاءة الكوادر، التوصيف الوظيفي، وتطوير الآليات المؤسسية.'
  }
];

const defaultSettings = [
  ['lm_studio_url', 'http://127.0.0.1:1234/v1'],
  ['system_name', 'منظومة OSS للذكاء الاصطناعي'],
  ['organization_name', 'الجمهورية العربية السورية — الهيئة الوطنية للتحول الرقمي'],
  ['default_system_prompt', BASE_SYSTEM_PROMPT],
  ['allow_user_registration', 'false'],
  ['enforce_audit_logging', 'true']
];

const defaultTemplates = [
  {
    id: 'official-letter',
    title: 'صياغة كتاب رسمي إداري',
    category: 'المراسلات الإدارية',
    description: 'صياغة مراسلة رسمية موجهة لجهة حكومية وفق الأصول والأساليب الإدارية المعتمدة.',
    icon: 'FileText',
    prompt: `المطلوب صياغة مسودة **كتاب رسمي إداري** موجه إلى: [اسم الجهة أو الإدارة المعنية].
**موضوع الكتاب:** [أدخل الموضوع باختصار].
**المعطيات والأسباب الموجبة:**
- [أدخل النقطة الأولى].
- [أدخل النقطة الثانية].
يرجى اعتماد الصياغة القانونية والإدارية الرسمية، والاقتصار على المعطيات الواردة أعلاه دون إضافة أرقام أو مراجع غير مذكورة.`
  },
  {
    id: 'ministerial-circular',
    title: 'صياغة تعميم وزاري تنظيمي',
    category: 'التعاميم والتعليمات',
    description: 'صياغة تعميم موحد صادر عن الإدارة العامة يُعمم على كافة الجهات التابعة للالتزام بتعليمات معينة.',
    icon: 'Send',
    prompt: `المطلوب صياغة **تعميم وزاري تنفيذي** بشأن: [موضوع التعميم].
**الجهات الموجه إليها التعميم:** كافة الإدارات والمديريات العامة والجهات التابعة.
**الأهداف التنظيمية:**
1. [الهدف أو التوجيه الأول].
2. [الهدف أو التوجيه الثاني].
يرجى صياغة بنود التعميم بشكل مرقم وواضح. اترك تاريخ السريان ورقم التعميم فارغين لتعبئتهما من الجهة المختصة.`
  },
  {
    id: 'executive-memo',
    title: 'مذكرة عرض ومقترح قرار',
    category: 'القرارات والمذكرات',
    description: 'مذكرة إحالة رسمية تتضمن عرض الواقع والمبررات الفنية والمالية ومقترح القرار المطلوب اعتماده.',
    icon: 'Scale',
    prompt: `المطلوب إعداد **مذكرة عرض ومقترح قرار** للعرض على أصحاب القرار بخصوص: [الموضوع المقترح].
**عناصر المذكرة المطلوبة:**
1. عرض الواقع الحالي والتحديات القائمة.
2. المبررات والأسانيد الإدارية والفنية.
3. المقترح الإجرائي والتوصيات التنفيذية.
4. مشروع القرار المقترح لإصداره.
اقتصر على المعطيات التي أزودك بها، وصرّح بما ينقصك من بيانات بدل افتراضه.`
  },
  {
    id: 'contract-audit',
    title: 'تدقيق عقد أو اتفاقية قانونية',
    category: 'التدقيق والامتثال',
    description: 'مراجعة مسودة اتفاقية أو شروط مناقصة، واستخراج البنود الحرجة والشروط الجزائية وملاحظات الحوكمة.',
    icon: 'CheckSquare',
    prompt: `المطلوب إجراء **تدقيق ومراجعة للعقد/الاتفاقية المرفقة**:
1. رصد التزامات الطرفين والحقوق المتبادلة كما وردت حرفياً في النص.
2. تدقيق الشروط الجزائية، غرامات التأخير، وبنود الفسخ.
3. إبراز المخاطر القانونية والمالية وتقديم التوصيات.
اذكر رقم البند ونصه عند كل ملاحظة. إن لم يرد بند ما في المستند فصرّح بغيابه بدل استنتاجه.`
  },
  {
    id: 'budget-table-analysis',
    title: 'تحليل موازنة وجدول مؤشرات (CSV)',
    category: 'البيانات المالية والإحصائية',
    description: 'تحليل مصفوفة أرقام أو بيانات مالية واستخراج الجداول التفصيلية ونسب التنفيذ بصيغة جاهزة للتصدير.',
    icon: 'FileSpreadsheet',
    prompt: `المطلوب **تحليل البيانات المالية المرفقة** وإخراج النتائج في **جدول مقارن**:
- استخراج نسب التنفيذ الفعلية مقارنة بالمخطط، محسوبة من الأرقام المرفقة حصراً.
- إبراز بنود الوفر والانحراف.
- أعمدة الجدول: (المعرف، البند، المخصص، الفعلي، نسبة الإنجاز، الملاحظة).
اكتب «غير متوفر» في أي خانة لا يوجد لها رقم في المرفق، ولا تقدّر أي قيمة.`
  },
  {
    id: 'strategic-summary',
    title: 'تلخيص تقرير استراتيجي ومحضر اجتماع',
    category: 'الدراسات والتقارير',
    description: 'تلخيص الوثائق الطويلة واستخراج مصفوفة القرارات، التوصيات، وتوزيع المهام والمسؤوليات.',
    icon: 'BookOpen',
    prompt: `المطلوب تلخيص **التقرير / محضر الاجتماع المرفق** بأسلوب تنفيذي موجز:
1. ملخص تنفيذي للمحاور الرئيسية.
2. جدول التكليفات: (المهمة، الجهة أو المسؤول، الإطار الزمني).
3. أبرز التوصيات والقرارات الواجب متابعتها.
اقتصر على ما ورد في المحضر، ولا تضف مهاماً أو مسؤولين غير مذكورين فيه.`
  }
];

// -------------------------------------------------------------
// SCHEMA INITIALIZATION & SEEDING
// -------------------------------------------------------------
async function initDb() {
  const client = await pool.connect();
  try {
    // 1. Create pgvector extension if available
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    } catch (e) {
      console.warn('Note: pgvector extension not installed or permission denied. Standard tables will continue.');
    }

    // 2. Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        code TEXT UNIQUE NOT NULL,
        clearance_level TEXT DEFAULT 'official',
        icon TEXT DEFAULT 'Briefcase',
        color TEXT DEFAULT '#02443A',
        prompt_context TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        role TEXT DEFAULT 'user',
        department TEXT DEFAULT 'الإدارة العامة',
        category_id TEXT REFERENCES categories(id),
        job_title TEXT DEFAULT 'مستشار إداري',
        status TEXT DEFAULT 'active',
        notes TEXT,
        token_version INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        model TEXT,
        system_prompt TEXT,
        classification TEXT DEFAULT 'official',
        pinned INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        attachments TEXT,
        model_used TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        prompt TEXT NOT NULL,
        icon TEXT DEFAULT 'FileText',
        is_system INTEGER DEFAULT 0,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS document_registry (
        ref TEXT PRIMARY KEY,
        year INTEGER NOT NULL,
        serial INTEGER NOT NULL,
        content_sha256 TEXT NOT NULL,
        title TEXT,
        classification TEXT,
        kind TEXT NOT NULL,
        issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        issued_by_name TEXT,
        model TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_registry_serial ON document_registry(year, serial DESC);

      ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT DEFAULT 'الإدارة العامة';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS category_id TEXT REFERENCES categories(id);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT DEFAULT 'مستشار إداري';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password INTEGER NOT NULL DEFAULT 0;
    `);

    // 3. Seed categories if empty
    const catCheck = await client.query('SELECT COUNT(*) as count FROM categories');
    if (parseInt(catCheck.rows[0].count, 10) === 0) {
      for (const c of defaultCategories) {
        await client.query(`
          INSERT INTO categories (id, name, code, clearance_level, icon, color, description, prompt_context)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO NOTHING
        `, [c.id, c.name, c.code, c.clearance_level, c.icon, c.color, c.description, c.prompt_context]);
      }
      console.log('Institutional categories seeded in PostgreSQL.');
    }

    // 4. Seed settings if empty
    for (const [k, v] of defaultSettings) {
      await client.query(`
        INSERT INTO settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO NOTHING
      `, [k, v]);
    }

    // 5. Seed administrator if empty
    const userCheck = await client.query('SELECT COUNT(*) as count FROM users');
    if (parseInt(userCheck.rows[0].count, 10) === 0) {
      const initialPassword = process.env.INITIAL_ADMIN_PASSWORD || 'admin123';
      await client.query(`
        INSERT INTO users (username, password_hash, display_name, role, department, category_id, job_title, status, must_change_password)
        VALUES ($1, $2, $3, 'admin', $4, 'cat_exec', $5, 'active', 0)
      `, [
        'admin',
        bcrypt.hashSync(initialPassword, 12),
        'المدير العام (مسؤول المنظومة)',
        'القيادة والإدارة العليا',
        'المدير العام ومسؤول المنظومة'
      ]);
      console.log('Default administrator account seeded in PostgreSQL.');
    }

    // 6. Seed templates if empty
    const tmplCheck = await client.query('SELECT COUNT(*) as count FROM templates');
    if (parseInt(tmplCheck.rows[0].count, 10) === 0) {
      for (const t of defaultTemplates) {
        await client.query(`
          INSERT INTO templates (id, title, category, description, prompt, icon, is_system)
          VALUES ($1, $2, $3, $4, $5, $6, 1)
          ON CONFLICT (id) DO NOTHING
        `, [t.id, t.title, t.category, t.description, t.prompt, t.icon]);
      }
      console.log('Default templates seeded in PostgreSQL.');
    }

    // 7. Security remediation, applied once and recorded.
    //    (a) Earlier releases shipped a documented default administrator
    //        password. Any account still using it must change it, and its
    //        existing sessions are invalidated.
    const accounts = await client.query('SELECT id, username, password_hash, must_change_password FROM users');
    for (const row of accounts.rows) {
      if (!row.must_change_password && bcrypt.compareSync('admin123', row.password_hash)) {
        await client.query(
          'UPDATE users SET must_change_password = 1, token_version = token_version + 1 WHERE id = $1',
          [row.id]
        );
        console.warn(`SECURITY: account "${row.username}" still uses the old published default password. A change is now required at next login.`);
      }
    }

    //    (b) Open self-registration was the shipped default. Close it once,
    //        leaving an administrator free to re-enable it deliberately.
    const migrated = await client.query("SELECT value FROM settings WHERE key = 'security_migration_v2'");
    if (migrated.rowCount === 0) {
      const reg = await client.query("SELECT value FROM settings WHERE key = 'allow_user_registration'");
      if (reg.rows[0]?.value === 'true') {
        await client.query("UPDATE settings SET value = 'false' WHERE key = 'allow_user_registration'");
        console.warn('SECURITY: open self-registration was enabled and has been closed. Re-enable it from the settings panel only if it is genuinely required.');
      }
      await client.query(
        "INSERT INTO settings (key, value) VALUES ('security_migration_v2', $1) ON CONFLICT (key) DO NOTHING",
        [new Date().toISOString()]
      );
    }

    console.log('✓ PostgreSQL connected and verified successfully.');
  } finally {
    client.release();
  }
}

// -------------------------------------------------------------
// HELPERS
// -------------------------------------------------------------
async function logAudit(userId, action, details, ipAddress = null) {
  try {
    const payload = details === undefined || details === null
      ? {}
      : (typeof details === 'object' ? details : { message: String(details) });

    await prepare(`
      INSERT INTO audit_logs (user_id, action, details, ip_address)
      VALUES (?, ?, ?, ?)
    `).run(userId || null, action, JSON.stringify(payload), ipAddress || null);
  } catch (err) {
    console.error('Audit logging error:', err);
  }
}

async function registerDocument({ content, title, classification, kind, userId, userName, model }) {
  const year = new Date().getFullYear();
  const contentSha256 = crypto.createHash('sha256').update(String(content), 'utf8').digest('hex');

  const last = await prepare('SELECT MAX(serial) as maxserial FROM document_registry WHERE year = ?').get(year);
  const serial = (last?.maxserial || last?.maxSerial || 0) + 1;
  const prefix = kind === 'dataset' ? 'SY-DATA' : 'SY-GOV';
  const ref = `${prefix}-${year}-${String(serial).padStart(6, '0')}`;

  await prepare(`
    INSERT INTO document_registry (ref, year, serial, content_sha256, title, classification, kind, issued_by, issued_by_name, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ref, year, serial, contentSha256, title || null, classification || null, kind, userId || null, userName || null, model || null);

  return { ref, contentSha256, serial, year };
}

async function close() {
  await pool.end();
}

const db = {
  pool,
  query,
  prepare,
  transaction,
  all: (sql, ...args) => prepare(sql).all(...args),
  get: (sql, ...args) => prepare(sql).get(...args),
  run: (sql, ...args) => prepare(sql).run(...args),
  initDb,
  logAudit,
  registerDocument,
  close,
  BASE_SYSTEM_PROMPT
};

module.exports = db;
module.exports.db = db;
module.exports.initDb = initDb;
module.exports.logAudit = logAudit;
module.exports.registerDocument = registerDocument;
module.exports.BASE_SYSTEM_PROMPT = BASE_SYSTEM_PROMPT;
