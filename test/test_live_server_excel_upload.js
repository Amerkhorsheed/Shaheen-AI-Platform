'use strict';

/**
 * Comprehensive Live Server Excel & Spreadsheet Upload Test Suite
 * 
 * Verifies end-to-end file uploading and text extraction via the HTTP API:
 * 1. Standard XLSX with sparse rows & financial numbers
 * 2. Legacy Al-Ameen / Al-Bayan HTML table disguised as .xls
 * 3. XML Spreadsheet 2003 format
 * 4. Macro-enabled .xlsm format
 * 5. Windows-1256 encoded Arabic CSV
 * 6. Batch multi-file upload
 */

const ExcelJS = require('exceljs');
const pool = require('../server/db/pool');
const authService = require('../server/services/authService');

const BASE_URL = process.env.SERVER_URL || 'http://127.0.0.1:3001';

async function runTest() {
  console.log('======================================================================');
  console.log('  فحص رفع وتدقيق ملفات الإكسل الحي على السيرفر (Live Server Excel Upload)');
  console.log('======================================================================\n');

  // 1. Authenticate & Obtain Valid Institutional JWT
  const adminUser = (await pool.query("SELECT * FROM users WHERE role = 'superadmin' LIMIT 1")).rows[0];
  if (!adminUser) {
    throw new Error('لم يتم العثور على مستخدم مشرف في قاعدة البيانات.');
  }
  const token = authService.issueToken(adminUser);
  console.log(`[✓] تم إصدار بطاقة الدخول المعتمدة للمشرف: ${adminUser.username}\n`);

  const results = [];

  // Helper to send multipart/form-data via fetch
  async function uploadFiles(fileList) {
    const formData = new FormData();
    for (const f of fileList) {
      const blob = new Blob([f.buffer], { type: f.mimetype || 'application/octet-stream' });
      formData.append('files', blob, f.originalname);
    }

    const res = await fetch(`${BASE_URL}/api/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    });

    const body = await res.json();
    return { status: res.status, body };
  }

  // --- Test Case 1: Standard XLSX with Sparse Rows & Syrian Pounds ---
  console.log('[1] تجربة رفع ملف إكسل رسمي XLSX (ميزانية عمومية سورية):');
  const wb1 = new ExcelJS.Workbook();
  const ws1 = wb1.addWorksheet('الميزانية_العمومية');
  ws1.addRow(['رمز الحساب', 'اسم الحساب المحاسبي', 'الرصيد بالليرة السورية']);
  ws1.addRow(['101', 'صندوق دمشق الرئيسي', 25000000]);
  ws1.addRow([]); // Sparse empty row
  ws1.addRow(['102', 'المصرف التجاري السوري', 185000000]);
  ws1.getCell('D4').value = { formula: 'C2+C4', result: 210000000 };
  const buf1 = Buffer.from(await wb1.xlsx.writeBuffer());

  const res1 = await uploadFiles([{ originalname: 'الميزانية_الختامية_2026.xlsx', buffer: buf1, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }]);
  const fileResult1 = res1.body?.files?.[0];
  const pass1 = res1.status === 200 && fileResult1?.success === true && fileResult1.text.includes('المصرف التجاري السوري') && fileResult1.text.includes('185000000');
  console.log(`    - رمز الاستجابة: HTTP ${res1.status}`);
  console.log(`    - نجاح الاستخراج: ${fileResult1?.success ? '✓ ناجح' : '✗ فشل'}`);
  console.log(`    - حجم النص المستخرج: ${fileResult1?.text?.length || 0} حرفاً`);
  results.push({
    test: '1. Standard XLSX (ميزانية سورية)',
    filename: 'الميزانية_الختامية_2026.xlsx',
    status: pass1 ? 'PASS' : 'FAIL',
    chars: fileResult1?.text?.length || 0,
    detail: 'استخراج الأرقام السورية والأسطر المتفرقة بنجاح'
  });

  // --- Test Case 2: Al-Ameen / Al-Bayan HTML Table disguised as .xls ---
  console.log('\n[2] تجربة رفع كشف حساب صادر عن برنامج الأمين (HTML Table متخفي بـ .xls):');
  const htmlAmeen = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>
      <body>
        <table>
          <tr><th>رقم السند</th><th>البيان</th><th>مدين (ل.س)</th><th>دائن (ل.س)</th></tr>
          <tr><td>4011</td><td>توريد مستلزمات طبية - حلب</td><td>7800000</td><td>0</td></tr>
          <tr><td>4012</td><td>سداد دفعة مصرفية - فرع المزة</td><td>0</td><td>7800000</td></tr>
        </table>
      </body>
    </html>
  `;
  const buf2 = Buffer.from(htmlAmeen, 'utf8');
  const res2 = await uploadFiles([{ originalname: 'كشف_حساب_الأمين_2026.xls', buffer: buf2, mimetype: 'application/vnd.ms-excel' }]);
  const fileResult2 = res2.body?.files?.[0];
  const pass2 = res2.status === 200 && fileResult2?.success === true && fileResult2.text.includes('توريد مستلزمات طبية - حلب') && fileResult2.text.includes('7800000');
  console.log(`    - رمز الاستجابة: HTTP ${res2.status}`);
  console.log(`    - نجاح الاستخراج: ${fileResult2?.success ? '✓ ناجح' : '✗ فشل'}`);
  console.log(`    - المحتوى المستخرج: ${fileResult2?.text ? 'مطابق ومقروء' : 'غير مقروء'}`);
  results.push({
    test: '2. Al-Ameen HTML disguised as .xls',
    filename: 'كشف_حساب_الأمين_2026.xls',
    status: pass2 ? 'PASS' : 'FAIL',
    chars: fileResult2?.text?.length || 0,
    detail: 'تحليل وتفكيك جدول HTML وتنسيقه كـ CSV'
  });

  // --- Test Case 3: XML Spreadsheet 2003 format ---
  console.log('\n[3] تجربة رفع جدول XML Spreadsheet 2003:');
  const xmlSpreadsheet = `<?xml version="1.0"?>
    <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">
      <Worksheet ss:Name="جدول_المستودعات">
        <Table>
          <Row>
            <Cell><Data ss:Type="String">المستودع</Data></Cell>
            <Cell><Data ss:Type="String">الموقع</Data></Cell>
            <Cell><Data ss:Type="Number">15400</Data></Cell>
          </Row>
          <Row>
            <Cell><Data ss:Type="String">مستودع عدرا المركزي</Data></Cell>
            <Cell><Data ss:Type="String">ريف دمشق</Data></Cell>
            <Cell><Data ss:Type="Number">42000</Data></Cell>
          </Row>
        </Table>
      </Worksheet>
    </Workbook>
  `;
  const buf3 = Buffer.from(xmlSpreadsheet, 'utf8');
  const res3 = await uploadFiles([{ originalname: 'مستودعات_عدرا.xlsx', buffer: buf3, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }]);
  const fileResult3 = res3.body?.files?.[0];
  const pass3 = res3.status === 200 && fileResult3?.success === true && fileResult3.text.includes('مستودع عدرا المركزي');
  console.log(`    - رمز الاستجابة: HTTP ${res3.status}`);
  console.log(`    - نجاح الاستخراج: ${fileResult3?.success ? '✓ ناجح' : '✗ فشل'}`);
  results.push({
    test: '3. XML Spreadsheet 2003',
    filename: 'مستودعات_عدرا.xlsx',
    status: pass3 ? 'PASS' : 'FAIL',
    chars: fileResult3?.text?.length || 0,
    detail: 'استخراج صفوف وخلايا XML بدقة'
  });

  // --- Test Case 4: Macro-Enabled .xlsm ---
  console.log('\n[4] تجربة رفع ملف ماكرو XLSM:');
  const wb4 = new ExcelJS.Workbook();
  const ws4 = wb4.addWorksheet('مؤشرات_الأداء');
  ws4.addRow(['المؤشر المالي', 'النسبة المستهدفة']);
  ws4.addRow(['معدل العائد على الأصول', '18.5%']);
  const buf4 = Buffer.from(await wb4.xlsx.writeBuffer());
  const res4 = await uploadFiles([{ originalname: 'macro_analysis.xlsm', buffer: buf4, mimetype: 'application/vnd.ms-excel.sheet.macroEnabled.12' }]);
  const fileResult4 = res4.body?.files?.[0];
  const pass4 = res4.status === 200 && fileResult4?.success === true && fileResult4.text.includes('معدل العائد على الأصول');
  console.log(`    - رمز الاستجابة: HTTP ${res4.status}`);
  console.log(`    - نجاح الاستخراج: ${fileResult4?.success ? '✓ ناجح' : '✗ فشل'}`);
  results.push({
    test: '4. Macro-enabled .xlsm',
    filename: 'macro_analysis.xlsm',
    status: pass4 ? 'PASS' : 'FAIL',
    chars: fileResult4?.text?.length || 0,
    detail: 'معالجة ملفات الماكرو بنجاح دون أي خطأ'
  });

  // --- Test Case 5: Windows-1256 Arabic CSV ---
  console.log('\n[5] تجربة رفع ملف CSV بالترميز العربي لويندوز (Windows-1256 / CP1256):');
  const win1256Bytes = Buffer.from([
    0xC7, 0xE1, 0xDD, 0xD1, 0xDA, 0x2C, // الفرع,
    0xC7, 0xE1, 0xE3, 0xCF, 0xED, 0xE4, 0x2C, // المدين,
    0xC7, 0xE1, 0xCF, 0xC7, 0xC6, 0xE4, 0x0A, // الدائن\n
    0xDD, 0xD1, 0xDA, 0x20, 0xCD, 0xE3, 0xD5, 0x2C, // فرع حمص,
    0x39, 0x35, 0x30, 0x30, 0x30, 0x30, 0x2C, // 950000,
    0x30 // 0
  ]);
  const res5 = await uploadFiles([{ originalname: 'حسابات_الفروع_win1256.csv', buffer: win1256Bytes, mimetype: 'text/csv' }]);
  const fileResult5 = res5.body?.files?.[0];
  const pass5 = res5.status === 200 && fileResult5?.success === true && fileResult5.text.includes('فرع حمص');
  console.log(`    - رمز الاستجابة: HTTP ${res5.status}`);
  console.log(`    - سلامة الحروف العربية: ${fileResult5?.text?.includes('فرع حمص') ? '✓ سليمة تماماً دون أي تلف' : '✗ مشوهة'}`);
  results.push({
    test: '5. Windows-1256 Arabic CSV',
    filename: 'حسابات_الفروع_win1256.csv',
    status: pass5 ? 'PASS' : 'FAIL',
    chars: fileResult5?.text?.length || 0,
    detail: 'فك ترميز CP1256 العربي التلقائي بدون علامات استفهام'
  });

  // --- Test Case 6: Batch Multi-File Upload ---
  console.log('\n[6] تجربة الرفع المتعدد (Batch Upload لثلاثة ملفات دفعة واحدة):');
  const res6 = await uploadFiles([
    { originalname: 'دفتر_اليومية_1.xlsx', buffer: buf1, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { originalname: 'دفتر_اليومية_2.xls', buffer: buf2, mimetype: 'application/vnd.ms-excel' },
    { originalname: 'تقرير_الرواتب.csv', buffer: win1256Bytes, mimetype: 'text/csv' }
  ]);
  const pass6 = res6.status === 200 && Array.isArray(res6.body?.files) && res6.body.files.length === 3 && res6.body.files.every(f => f.success === true);
  console.log(`    - عدد الملفات المعالجة: ${res6.body?.files?.length || 0} / 3`);
  console.log(`    - نجاح جميع الملفات: ${pass6 ? '✓ نعم' : '✗ لا'}`);
  results.push({
    test: '6. Batch Upload (3 files)',
    filename: '3 ملفات محاسبية متنوعة',
    status: pass6 ? 'PASS' : 'FAIL',
    chars: res6.body?.files?.reduce((acc, f) => acc + (f.text?.length || 0), 0) || 0,
    detail: 'معالجة متزامنة لكافة جداول البيانات دفعة واحدة'
  });

  // Print Summary Table
  console.log('\n======================================================================');
  console.log('         نتائج فحص رفع وتدقيق الإكسل على السيرفر الحي (Summary)');
  console.log('======================================================================');
  console.table(results);

  const allPassed = results.every(r => r.status === 'PASS');
  if (allPassed) {
    console.log('\n✅ كافّة اختبارات رفع جداول الإكسل والبيانات المحاسبية نجحت بنسبة 100%!');
  } else {
    console.error('\n❌ توجد بعض الاختبارات التي لم تنجح.');
    process.exit(1);
  }

  await pool.close();
  process.exit(0);
}

runTest().catch((err) => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
