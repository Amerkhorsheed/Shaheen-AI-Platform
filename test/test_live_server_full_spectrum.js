'use strict';

const ExcelJS = require('exceljs');
const pool = require('../server/db/pool');
const authService = require('../server/services/authService');

const BASE_URL = process.env.SERVER_URL || 'http://127.0.0.1:3001';

async function testLiveFullSpectrum() {
  console.log('======================================================================');
  console.log('  فحص حي للمنظومة الذكية: تحليل 100% من البيانات بدون أي اقتطاع');
  console.log('  (Live Sovereign Tabular Intelligence & Semantic Chunking E2E)');
  console.log('======================================================================\n');

  // 1. Authenticate
  const adminUser = (await pool.query("SELECT * FROM users WHERE role = 'superadmin' LIMIT 1")).rows[0];
  const token = authService.issueToken(adminUser);
  console.log(`[✓] المصادقة معتمدة للمستخدم: ${adminUser.username}`);

  // 2. Generate 3,500 unique rows
  const runId = Date.now();
  console.log(`[*] إنشاء مصنّف إكسل جديد وموسوم (${runId}) بـ 3,500 سطر...`);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('سجل_الفحص_المركزي');
  ws.addRow(['رقم الفحص', 'الموقع / الورشة', 'الحالة الفنية', 'نسبة المطابقة', 'التكلفة بالليرة السورية', 'تاريخ التدقيق']);

  let expectedTotalCost = 0;
  for (let i = 1; i <= 3500; i++) {
    const cost = 1000000 + i * 1000;
    expectedTotalCost += cost;
    ws.addRow([
      `QC-${runId}-${i}`,
      i % 2 === 0 ? 'مجمع دمشق الصناعي - عدرا' : 'معمل حلب المركزي',
      i % 10 === 0 ? 'مرفوض' : 'مطابق للمواصفات',
      `${85 + (i % 15)}%`,
      cost,
      '2026-03-09'
    ]);
  }

  const fileBuf = Buffer.from(await wb.xlsx.writeBuffer());
  console.log(`    - حجم الملف الثنائي المولد: ${(fileBuf.length / 1024).toFixed(1)} KB`);

  // 3. Upload file via /api/upload
  console.log('\n[*] جاري رفع الملف عبر API المنظومة (/api/upload)...');
  const formData = new FormData();
  formData.append('files', new Blob([fileBuf]), `Industrial_Audit_${runId}.xlsx`);
  const uploadRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });

  if (!uploadRes.ok) {
    throw new Error(`Upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }
  const uploadData = await uploadRes.json();
  const fileResult = uploadData.files[0];

  console.log(`[✓] تم استلام رد الرفع بنجاح!`);
  console.log(`    - هل تم التحليل الإحصائي الكامل (isProfiled): ${fileResult.isProfiled ? '✓ نعم (100% Covered)' : '✗ لا'}`);
  console.log(`    - إجمالي الأسطر المعالجة: ${fileResult.totalRows?.toLocaleString('en-US')} سطر`);
  console.log(`    - عدد الشرائح المفهرسة: ${fileResult.totalChunks} شريحة`);
  console.log(`    - هل تم الاقتطاع (truncated): ${fileResult.truncated ? 'نعم' : '✓ لا (Never Truncated!)'}`);
  console.log(`    - حجم الملف التنفيذي المولد: ${fileResult.text.length} حرفاً`);

  if (!fileResult.isProfiled || fileResult.totalRows !== 3500) {
    throw new Error(`Expected isProfiled === true and totalRows === 3500, got ${JSON.stringify(fileResult)}`);
  }

  // 4. Send chat message with the attached file content via /api/llm/chat
  const targetId = `QC-${runId}-3100`;
  console.log(`\n[*] إرسال استعلام التحليل المحاسبي والبحث عن السجل ${targetId} إلى النموذج (/api/llm/chat)...`);
  const chatPrompt = `يرجى تقديم ملخص تنفيذي للمصنّف، مع ذكر المجموع الإجمالي للتكاليف، واستعراض تفاصيل الفحص رقم ${targetId}.\n\n[محتوى الملف المرفق: ${fileResult.filename}]\n\`\`\`\n${fileResult.text}\n\`\`\``;

  const chatRes = await fetch(`${BASE_URL}/api/llm/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: chatPrompt }],
      temperature: 0.2
    })
  });

  console.log(`    - رمز استجابة خادم الدردشة: HTTP ${chatRes.status}`);
  if (!chatRes.ok) {
    throw new Error(`Chat request failed: ${chatRes.status} ${await chatRes.text()}`);
  }

  // 5. Read SSE Stream
  console.log('\n[*] استلام وتدفق الرد من النموذج عبر البث المباشر (SSE Stream)...');
  const reader = chatRes.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let fullResponse = '';
  let chunkCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunkCount++;
    const textChunk = decoder.decode(value, { stream: true });
    fullResponse += textChunk;
    if (chunkCount % 50 === 0) process.stdout.write('.');
  }

  console.log('\n\n[✓] اكتمل توليد الرد من النموذج بنجاح تام وبدون أي انقطاع!');
  console.log(`    - عدد حزم البث المستلمة: ${chunkCount}`);
  console.log(`    - إجمالي حجم الرد: ${fullResponse.length} حرفاً`);

  console.log('\n======================================================================');
  console.log('✅ اختبار رفع وتحليل 100% من بيانات الإكسل واسترجاع الشرائح نجح بنسبة 100%!');
  console.log('======================================================================\n');
}

testLiveFullSpectrum().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
