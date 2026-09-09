'use strict';

const ExcelJS = require('exceljs');
const pool = require('../server/db/pool');
const authService = require('../server/services/authService');

const BASE_URL = process.env.SERVER_URL || 'http://127.0.0.1:3001';

async function testHugeExcelStream() {
  console.log('======================================================================');
  console.log('  فحص رفع وتوليد ملف إكسل ضخم بالبث المباشر (Huge Excel SSE Stream Test)');
  console.log('======================================================================\n');

  // 1. Authenticate
  const adminUser = (await pool.query("SELECT * FROM users WHERE role = 'superadmin' LIMIT 1")).rows[0];
  const token = authService.issueToken(adminUser);
  console.log(`[✓] المصادقة معتمدة للمستخدم: ${adminUser.username}`);

  // 2. Generate large Excel sheet (3,000 rows of quality control / financial data)
  console.log('[*] إنشاء مصنّف إكسل ضخم يحاكي ملفات الفحص والتدقيق الواقعية (3000 سطر)...');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('سجل_ضبط_الجودة_والتدقيق');
  ws.addRow(['رقم الفحص', 'الموقع / الورشة', 'الحالة الفنية', 'نسبة المطابقة', 'التكلفة بالليرة السورية', 'ملاحظات وتوصيات اللجنة']);
  for (let i = 1; i <= 3000; i++) {
    ws.addRow([
      `QC-2026-${i}`,
      i % 2 === 0 ? 'مجمع دمشق الصناعي - عدرا' : 'معمل حلب المركزي',
      i % 5 === 0 ? 'معلق للمراجعة' : 'مطابق للمواصفات',
      `${(85 + (i % 15))}%`,
      1500000 + (i * 2500),
      `تم التدقيق الميداني والاعتماد الفني للأصول رقم ${i}`
    ]);
  }
  const fileBuf = Buffer.from(await wb.xlsx.writeBuffer());
  console.log(`    - حجم الملف الثنائي المولد: ${(fileBuf.length / 1024).toFixed(1)} KB`);

  // 3. Upload file via /api/upload
  console.log('\n[*] جاري رفع الملف عبر API المنظومة (/api/upload)...');
  const formData = new FormData();
  formData.append('files', new Blob([fileBuf]), 'Automotive_QC_Inspection_Large.xlsx');
  const uploadRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });

  if (!uploadRes.ok) {
    throw new Error(`Upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }
  const uploadData = await uploadRes.json();
  const uploadedFile = uploadData.files[0];
  console.log(`[✓] تم رفع واستخراج الملف بنجاح!`);
  console.log(`    - حجم النص المستخرج: ${uploadedFile.text.length} حرفاً (مقصوص تلقائياً ضمن ميزانية السياق)`);
  console.log(`    - هل تم الاقتطاع بأمان: ${uploadedFile.truncated ? '✓ نعم (Truncated cleanly)' : 'لا'}`);

  // 4. Send chat message with the attached file content via /api/llm/chat
  console.log('\n[*] إرسال استعلام التحليل المحاسبي والإحصائي إلى النموذج (/api/llm/chat)...');
  const chatPrompt = `يرجى تدقيق بيانات ملف الجودة والإكسل المرفق، واستخراج أهم 3 مؤشرات وجدول ملخص بالأرقام.\n\n[محتوى الملف المرفق: ${uploadedFile.filename}]\n\`\`\`\n${uploadedFile.text}\n\`\`\``;

  const chatRes = await fetch(`${BASE_URL}/api/llm/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'auto',
      messages: [{ role: 'user', content: chatPrompt }]
    })
  });

  console.log(`    - رمز استجابة خادم الدردشة: HTTP ${chatRes.status}`);
  if (!chatRes.ok) {
    const errText = await chatRes.text();
    throw new Error(`Chat failed with HTTP ${chatRes.status}: ${errText}`);
  }

  // 5. Read SSE Stream
  console.log('\n[*] استلام وتدفق الرد من النموذج عبر البث المباشر (SSE Stream)...');
  const reader = chatRes.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let receivedChunks = 0;
  let accumulatedText = '';
  let resolvedModel = chatRes.headers.get('X-Resolved-Model') || 'auto';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    receivedChunks++;
    const chunkText = decoder.decode(value, { stream: true });
    accumulatedText += chunkText;
    if (receivedChunks <= 3 || receivedChunks % 20 === 0) {
      process.stdout.write('.');
    }
  }

  console.log('\n\n[✓] اكتمل توليد الرد من النموذج بنجاح تام وبدون أي انقطاع!');
  console.log(`    - النموذج الذي تم اختياره: ${resolvedModel}`);
  console.log(`    - عدد حزم البث المستلمة: ${receivedChunks}`);
  console.log(`    - إجمالي حجم الرد: ${accumulatedText.length} حرفاً`);

  // Verify that there is no error block in the streamed response
  if (accumulatedText.includes('"error":')) {
    throw new Error(`Stream contained an error payload: ${accumulatedText.slice(0, 300)}`);
  }

  console.log('\n======================================================================');
  console.log('✅ اختبار رفع ملف إكسل ضخم والتحليل الذكي عبر البث المباشر نجح بنسبة 100%!');
  console.log('======================================================================\n');

  await pool.close();
  process.exit(0);
}

testHugeExcelStream().catch((err) => {
  console.error('\n❌ فشل الاختبار:', err.message);
  process.exit(1);
});
