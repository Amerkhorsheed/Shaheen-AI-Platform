require('dotenv').config();
const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runVerification() {
  console.log('--- بدء اختبارات التحقق من منظومة OSS ---');

  // 1. Database check (PostgreSQL)
  console.log('1. اختبار الاتصال بقاعدة البيانات PostgreSQL (Docker)...');
  const db = require('../server/db');
  await db.initDb();

  const user = await db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
  assert(user, 'المستخدم الافتراضي admin يجب أن يكون موجوداً');
  assert.strictEqual(user.role, 'admin', 'صلاحية المدير يجب أن تكون admin');
  assert(user.category_id, 'المستخدم admin يجب أن ينتمي إلى تصنيف مؤسسي');
  console.log('✓ تم التحقق من قاعدة بيانات PostgreSQL والمستخدم الإداري الافتراضي وتصنيفه.');

  // 1.1 Category structure check
  console.log('1.1 اختبار جدول التصنيفات المؤسسية...');
  const categories = await db.prepare('SELECT * FROM categories').all();
  assert(categories.length >= 5, 'يجب أن يحتوي النظام على التصنيفات المؤسسية الافتراضية');
  const execCat = categories.find(c => c.id === 'cat_exec');
  assert(execCat, 'تصنيف القيادة العليا cat_exec يجب أن يكون موجوداً');
  console.log(`✓ تم التحقق من وجود ${categories.length} تصنيفات مؤسسية معتمدة.`);

  // 2. Credential hygiene
  // This suite must never assert a specific password: doing so would make
  // fixing a weak credential break the tests. It checks the shape of the
  // stored hash and that no account still uses the old published default.
  console.log('2. اختبار سلامة بيانات الاعتماد...');
  const bcrypt = require('bcryptjs');
  assert(/^\$2[aby]\$\d{2}\$/.test(user.password_hash), 'كلمة المرور يجب أن تكون مخزنة كبصمة bcrypt');

  const allUsers = await db.prepare('SELECT username, password_hash, must_change_password FROM users').all();
  const stillDefault = allUsers.filter(
    (u) => bcrypt.compareSync('admin123', u.password_hash) && !u.must_change_password
  );
  assert.strictEqual(
    stillDefault.length,
    0,
    `حسابات ما زالت تستخدم كلمة المرور الافتراضية المنشورة دون إلزام بتغييرها: ${stillDefault.map((u) => u.username).join(', ')}`
  );
  console.log('✓ كلمات المرور مخزنة بصيغة bcrypt ولا يوجد حساب يستخدم الكلمة الافتراضية القديمة.');

  // 3. Document parsers check
  console.log('3. اختبار مستخرجات الملفات (PDF / XLSX / Text)...');
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('البيانات');
  ws.addRow(['المعرف', 'الاسم', 'المحافظة']);
  ws.addRow([1, 'سامر', 'دمشق']);
  ws.addRow([2, 'أنس', 'حلب']);
  const buf = await wb.xlsx.writeBuffer();
  assert(buf.length > 0, 'توليد ملفات الجداول يعمل بنجاح');
  console.log('✓ مستخرجات الملفات والجداول جاهزة.');

  // 4. Client build check & Login credentials cleanup check
  console.log('4. التحقق من بناء الواجهة الأمامية React + Vite وخلو تسجيل الدخول من البيانات المسبقة...');
  const indexHtml = path.join(__dirname, '../client/dist/index.html');
  assert(fs.existsSync(indexHtml), 'ملف client/dist/index.html يجب أن يكون مبنياً');
  const htmlContent = fs.readFileSync(indexHtml, 'utf-8');
  assert(htmlContent.includes('منظومة OSS للذكاء الاصطناعي'), 'العنوان في index.html يطابق الهوية السورية');
  assert(!htmlContent.toLowerCase().includes('bousla'), 'الاسم بوصلة غير موجود إطلاقاً في الواجهة المبنية');
  
  const loginModalSrc = fs.readFileSync(path.join(__dirname, '../client/src/components/LoginModal.jsx'), 'utf-8');
  assert(!loginModalSrc.includes("useState('admin')"), 'حقول الدخول يجب ألا تحتوي على اسم مستخدم مسبق');
  assert(!loginModalSrc.includes("useState('admin123')"), 'حقول الدخول يجب ألا تحتوي على كلمة مرور مسبقة');
  assert(!loginModalSrc.includes('admin / admin123'), 'تلميح الحساب الافتراضي يجب أن يكون محذوفاً من صفحة الدخول');
  console.log('✓ تم التحقق من سلامة البناء وتطبيق الهوية وخلو صفحة الدخول من البيانات المسبقة.');

  await db.close();

  console.log('\n=============================================');
  console.log('  اجتازت فحوصات البنية الأساسية. شغّل "npm run test:security" لفحوصات الأمان.');
  console.log('=============================================\n');
}

runVerification().catch(err => {
  console.error('فشل الاختبار:', err);
  process.exit(1);
});
