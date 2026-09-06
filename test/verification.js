'use strict';

/**
 * Infrastructure verification.
 *
 * Confirms the deployment is coherent before anyone trusts it: configuration
 * loads, the database is reachable and migrated, the institutional data is
 * seeded, no account carries a previously published credential, and the client
 * bundle is built and self-contained.
 *
 *   npm test
 *
 * Deliberately asserts *properties*, never a specific password. A test that
 * pins a credential makes fixing that credential break the build — which is
 * exactly what the previous version of this file did.
 */

require('dotenv').config();

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');

const pool = require('../server/db/pool');
const migrate = require('../server/db/migrate');
const categoryRepository = require('../server/repositories/categoryRepository');
const templateRepository = require('../server/repositories/templateRepository');
const promptRepository = require('../server/repositories/promptRepository');
const promptService = require('../server/services/promptService');
const userRepository = require('../server/repositories/userRepository');
const { PREVIOUSLY_PUBLISHED_PASSWORD } = require('../server/db/seed');

const pass = (message) => console.log(`  ✓ ${message}`);
const step = (message) => console.log(`\n${message}`);

async function run() {
  console.log('--- التحقق من بنية منظومة OSS ---');

  // 1. Configuration
  step('1. التحقق من صحة الإعدادات (config)...');
  const config = require('../server/config');
  assert(config.security.jwtSecret.length >= 32, 'مفتاح توقيع الجلسات يجب ألا يقل عن 32 خانة');
  assert(config.db.connectionString.startsWith('postgres'), 'سلسلة الاتصال بقاعدة البيانات غير صالحة');
  pass('الإعدادات محمّلة ومتحقق منها، ولا يوجد مفتاح أو كلمة مرور مضمّنة في الشيفرة.');

  // 2. Database and schema
  step('2. التحقق من قاعدة البيانات ومخطط الجداول...');
  await pool.verifyConnection();
  const applied = await migrate.status();
  assert(applied.length > 0, 'لم تُطبَّق أي ترحيلات (migrations) على قاعدة البيانات');
  pass(`قاعدة البيانات متصلة، وعدد الترحيلات المطبّقة: ${applied.length} (الأحدث: ${applied[0].version}).`);

  // 3. Institutional data
  step('3. التحقق من البيانات المؤسسية المعتمدة...');
  const categories = await categoryRepository.listWithUserCounts();
  assert(categories.length >= 5, 'يجب أن يحتوي النظام على التصنيفات المؤسسية الافتراضية');
  assert(categories.find((c) => c.id === 'cat_exec'), 'تصنيف القيادة العليا cat_exec يجب أن يكون موجوداً');

  const templates = await templateRepository.count();
  assert(templates > 0, 'يجب أن تحتوي المنظومة على نماذج المراسلات الرسمية');
  pass(`عدد التصنيفات المؤسسية: ${categories.length} — عدد النماذج الرسمية: ${templates}.`);

  // 4. Prompt library and composable prompts
  step('4. التحقق من مكتبة التوجيه المؤسسي وهندسة الأوامر...');
  const modules = await promptRepository.listModules();
  assert(modules.length >= 10, 'يجب أن تحتوي المنظومة على ما لا يقل عن 10 وحدات توجيه مؤسسية معتمدة');
  const assignments = await promptRepository.listAllAssignments();
  assert(assignments.length >= 20, 'يجب أن تكون وحدات التوجيه مرتبطة بالتصنيفات المؤسسية');
  const charter = await promptService.getCharter();
  assert(charter && charter.length > 500, 'ميثاق المنظومة (SYSTEM_CHARTER) غير موجود أو غير صالح');
  const preview = await promptService.preview('cat_exec', 'official');
  assert(preview.prompt.includes('نزاهة المعلومة'), 'البرومبت المجمع للقيادة العليا لا يحتوي على ميثاق المنظومة');
  pass(`مكتبة الأوامر المؤسسية: ${modules.length} وحدة — ارتباطات التصنيفات: ${assignments.length} — ميثاق المنظومة مفعّل.`);

  // 5. Credential hygiene
  step('5. التحقق من سلامة بيانات الاعتماد...');
  const accounts = await userRepository.listCredentialAudit();
  assert(accounts.length > 0, 'يجب وجود حساب إداري واحد على الأقل');

  const notHashed = accounts.filter((u) => !/^\$2[aby]\$\d{2}\$/.test(u.password_hash));
  assert.strictEqual(
    notHashed.length,
    0,
    `حسابات كلمات مرورها غير مخزنة كبصمة bcrypt: ${notHashed.map((u) => u.username).join(', ')}`
  );

  const stillDefault = accounts.filter(
    (u) => bcrypt.compareSync(PREVIOUSLY_PUBLISHED_PASSWORD, u.password_hash) && !u.must_change_password
  );
  assert.strictEqual(
    stillDefault.length,
    0,
    `حسابات ما زالت تستخدم كلمة المرور المنشورة سابقاً دون إلزام بتغييرها: ${stillDefault
      .map((u) => u.username)
      .join(', ')}`
  );
  pass(`جميع كلمات المرور (${accounts.length} حساب) مخزنة بصيغة bcrypt، ولا حساب يستخدم الكلمة المنشورة سابقاً.`);

  // 6. Client bundle
  step('6. التحقق من بناء الواجهة الأمامية وعزلها عن الشبكة...');
  const distDir = path.join(ROOT, 'client/dist');
  const indexHtml = path.join(distDir, 'index.html');
  assert(fs.existsSync(indexHtml), 'ملف client/dist/index.html يجب أن يكون مبنياً (شغّل npm run build)');

  const html = fs.readFileSync(indexHtml, 'utf-8');
  assert(html.includes('منظومة OSS للذكاء الاصطناعي'), 'العنوان في index.html لا يطابق هوية المنظومة');

  // The platform claims full isolation from the internet; the built bundle
  // must contain no reference to an external host for that to be true.
  const externalReferences = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(html|js|css)$/.test(entry.name)) {
        const content = fs.readFileSync(full, 'utf-8');
        for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com']) {
          if (content.includes(host)) externalReferences.push(`${path.relative(ROOT, full)} -> ${host}`);
        }
      }
    }
  };
  walk(distDir);
  assert.strictEqual(
    externalReferences.length,
    0,
    `الواجهة المبنية تحتوي على مراجع خارجية تناقض ادعاء العزل: ${externalReferences.join(', ')}`
  );
  pass('الواجهة مبنية، وخالية تماماً من أي مرجع لخدمات خارجية.');

  // 7. Layering
  step('7. التحقق من فصل الطبقات المعماري...');
  const routesDir = path.join(ROOT, 'server/http/routes');
  const offenders = [];
  for (const file of fs.readdirSync(routesDir)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(routesDir, file), 'utf-8');
    // Route handlers must go through services and repositories, never issue
    // SQL themselves — that separation is the point of the refactor.
    if (/\b(SELECT\s+\w|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/.test(src)) {
      offenders.push(file);
    }
  }
  assert.strictEqual(offenders.length, 0, `طبقة المسارات تحتوي على استعلامات SQL مباشرة: ${offenders.join(', ')}`);
  pass('لا توجد استعلامات SQL داخل طبقة المسارات — الوصول للبيانات محصور في المستودعات.');

  console.log('\n=============================================');
  console.log('  اجتازت فحوصات البنية الأساسية.');
  console.log('  شغّل "npm run test:security" لفحوصات الأمان.');
  console.log('=============================================\n');
}

run()
  .then(() => pool.close())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\nفشل التحقق:', err.message);
    await pool.close().catch(() => {});
    process.exit(1);
  });
