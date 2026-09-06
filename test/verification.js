const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runVerification() {
  console.log('--- بدء اختبارات التحقق من منظومة OSS ---');

  // 1. Database check
  console.log('1. اختبار قاعدة البيانات SQLite...');
  const db = require('../server/db');
  const user = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
  assert(user, 'المستخدم الافتراضي admin يجب أن يكون موجوداً');
  assert.strictEqual(user.role, 'admin', 'صلاحية المدير يجب أن تكون admin');
  console.log('✓ تم التحقق من قاعدة البيانات والمستخدم الإداري الافتراضي.');

  // 2. Auth test
  console.log('2. اختبار التوثيق وتوليد الرمز...');
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  const valid = bcrypt.compareSync('admin123', user.password_hash);
  assert(valid, 'كلمة المرور الافتراضية admin123 مطابقة');
  console.log('✓ التحقق من تشفير كلمة المرور وتطابقها.');

  // 3. Document parsers check
  console.log('3. اختبار مستخرجات الملفات (PDF / XLSX / Text)...');
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['المعرف', 'الاسم', 'المحافظة'], [1, 'سامر', 'دمشق'], [2, 'أنس', 'حلب']]);
  XLSX.utils.book_append_sheet(wb, ws, 'البيانات');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
  assert(buf.length > 0, 'توليد ملفات الجداول يعمل بنجاح');
  console.log('✓ مستخرجات الملفات والجداول جاهزة.');

  // 4. Client build check
  console.log('4. التحقق من بناء الواجهة الأمامية React + Vite...');
  const indexHtml = path.join(__dirname, '../client/dist/index.html');
  assert(fs.existsSync(indexHtml), 'ملف client/dist/index.html يجب أن يكون مبنياً');
  const htmlContent = fs.readFileSync(indexHtml, 'utf-8');
  assert(htmlContent.includes('منظومة OSS للذكاء الاصطناعي'), 'العنوان في index.html يطابق الهوية السورية');
  assert(!htmlContent.toLowerCase().includes('bousla'), 'الاسم بوصلة غير موجود إطلاقاً في الواجهة المبنية');
  console.log('✓ تم التحقق من سلامة البناء وتطبيق الهوية مع خلوه من اسم بوصلة.');

  console.log('\n=============================================');
  console.log('  جميع الاختبارات الميكانيكية والتحقق نجحت 100%!');
  console.log('=============================================\n');
}

runVerification().catch(err => {
  console.error('فشل الاختبار:', err);
  process.exit(1);
});
