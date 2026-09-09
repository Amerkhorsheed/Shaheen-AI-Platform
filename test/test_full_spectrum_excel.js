'use strict';

const assert = require('node:assert');
const ExcelJS = require('exceljs');

// Set dummy test env so config loads
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret123456789012345678901234567890';

const fileService = require('../server/services/fileService');
const chunkingService = require('../server/services/chunkingService');
const promptService = require('../server/services/promptService');
const { estimateMessagesTokens } = require('../server/lib/tokenEstimator');

async function testFullSpectrumExcel() {
  console.log('======================================================================');
  console.log('  فحص منظومة استيعاب وتحليل الإكسل الشاملة (Full-Spectrum Excel Intelligence)');
  console.log('======================================================================\n');

  // 1. Generate 4,000-row workbook with 2 sheets
  console.log('[*] إنشاء مصنّف إكسل ثنائي الأوراق بـ 4,000 سطر...');
  const wb = new ExcelJS.Workbook();

  // Sheet 1: 3,000 rows
  const ws1 = wb.addWorksheet('سجل_الجودة');
  ws1.addRow(['رقم الفحص', 'الموقع', 'الحالة الفنية', 'نسبة المطابقة', 'التكلفة بالليرة', 'تاريخ الفحص']);
  let expectedSheet1Sum = 0;
  for (let i = 1; i <= 3000; i++) {
    const cost = 2000000 + i * 500;
    expectedSheet1Sum += cost;
    ws1.addRow([
      `QC-2026-${i}`,
      i % 2 === 0 ? 'دمشق' : 'حلب',
      i % 10 === 0 ? 'مرفوض' : 'مطابق',
      `${80 + (i % 20)}%`,
      cost,
      '2026-03-09'
    ]);
  }

  // Sheet 2: 1,000 rows
  const ws2 = wb.addWorksheet('بيانات_الموردين');
  ws2.addRow(['كود المورد', 'اسم الشركة', 'الكمية الموردة', 'سعر الوحدة', 'مستوى التقييم']);
  let expectedSheet2Qty = 0;
  for (let j = 1; j <= 1000; j++) {
    const qty = 50 + (j % 50);
    expectedSheet2Qty += qty;
    ws2.addRow([
      `SUP-${j}`,
      `شركة الأمل للتوريدات الصناعية رقم ${j}`,
      qty,
      15000,
      j % 5 === 0 ? 'ممتاز' : 'جيد جداً'
    ]);
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  console.log(`[✓] تم إنشاء المصنف بنجاح (الحجم: ${(buffer.length / 1024).toFixed(1)} KB)`);

  // 2. Extract via fileService.extract
  console.log('\n[*] تشغيل المعالجة والتحليل الإحصائي الشامل عبر fileService.extract...');
  const startExtract = Date.now();
  const result = await fileService.extract({
    originalname: 'Comprehensive_Industrial_Audit_2026.xlsx',
    size: buffer.length,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer
  });
  const duration = Date.now() - startExtract;

  console.log(`[✓] تمت المعالجة الكاملة في ${duration}ms:`);
  console.log(`    - نجاح الاستخراج: ${result.success ? '✓ نعم' : '✗ لا'}`);
  console.log(`    - هل تم التحليل الإحصائي الشامل (isProfiled): ${result.isProfiled ? '✓ نعم' : '✗ لا'}`);
  console.log(`    - إجمالي الأسطر المقروءة: ${result.totalRows.toLocaleString('en-US')} سطر (100% Data Coverage)`);
  console.log(`    - عدد الأعمدة: ${result.totalColumns}`);
  console.log(`    - عدد الشرائح المفهرسة: ${result.totalChunks} شريحة`);
  console.log(`    - هل تم الاقتطاع (truncated): ${result.truncated ? 'نعم' : '✓ لا (Never Truncated!)'}`);
  console.log(`    - حجم الملخص التنفيذي المستخرج: ${result.text.length} حرفاً`);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.isProfiled, true);
  assert.strictEqual(result.totalRows, 4000);
  assert.strictEqual(result.totalChunks, 40);
  assert.strictEqual(result.truncated, false);

  // 3. Verify Exact Arithmetic
  assert.ok(result.text.includes(expectedSheet1Sum.toLocaleString('en-US')), 'Sheet 1 cost sum must match exactly');
  assert.ok(result.text.includes(expectedSheet2Qty.toLocaleString('en-US')), 'Sheet 2 quantity sum must match exactly');
  console.log(`[✓] تم تدقيق المجاميع الحسابية القطعية:`);
  console.log(`    - مجموع التكاليف لـ 3000 سطر: ${expectedSheet1Sum.toLocaleString('en-US')} (تطابق 100%)`);
  console.log(`    - مجموع كميات 1000 سطر: ${expectedSheet2Qty.toLocaleString('en-US')} (تطابق 100%)`);

  // 4. Test Targeted Chunk Retrieval
  console.log('\n[*] اختبار استرجاع الشرائح المستهدفة بالبحث الدقيق (Targeted Drill-down)...');
  const search1 = chunkingService.searchChunks(result.fileHash, 'QC-2026-2850', 1);
  assert.ok(search1.length > 0);
  assert.ok(search1[0].csv.includes('QC-2026-2850'));
  console.log(`    - استرجاع سجل QC-2026-2850: تم العثور عليه في الشريحة رقم #${search1[0].chunkIndex} (الأسطر ${search1[0].rowStart}-${search1[0].rowEnd})`);

  const search2 = chunkingService.searchChunks(result.fileHash, 'SUP-789', 1);
  assert.ok(search2.length > 0);
  assert.ok(search2[0].csv.includes('SUP-789'));
  console.log(`    - استرجاع مورد SUP-789: تم العثور عليه في الشريحة رقم #${search2[0].chunkIndex} (الأسطر ${search2[0].rowStart}-${search2[0].rowEnd})`);

  // 5. Test Prompt Assembly with DeepSeek-R1
  console.log('\n[*] اختبار تجميع وتأطير السياق للنموذج (Prompt Composition & Context Guard)...');
  const userMessages = [
    {
      role: 'user',
      content: `يرجى تقديم تقرير تدقيق إداري ومحاسبي شامل حول أداء الجودة والموردين، وتدقيق فحص QC-2026-2850.\n\n[محتوى الملف المرفق: ${result.filename}]\n\`\`\`\n${result.text}\n\`\`\``
    }
  ];

  const applied = await promptService.applyTo(userMessages, {
    user: { id: 1, username: 'admin', role: 'superadmin' },
    classification: 'official',
    model: 'deepseek-r1-distill-qwen-32b'
  });

  const estimatedTokens = estimateMessagesTokens(applied.messages);
  console.log(`    - إجمالي عدد التوكنز في السياق: ${estimatedTokens} توكن`);
  console.log(`    - هل السياق ضمن الميزانية الآمنة (< 26,000 توكن): ${estimatedTokens < 26000 ? '✓ نعم' : '✗ لا'}`);
  assert.ok(estimatedTokens < 26000);

  const finalPromptText = applied.messages[0].content;
  assert.ok(finalPromptText.includes('إرشادات التدقيق والتحليل المالي والحسابي الصارم'));
  assert.ok(finalPromptText.includes('الملف الإحصائي الشامل للبيانات'));
  assert.ok(finalPromptText.includes('QC-2026-2850'), 'Targeted chunk record must be present in prompt');

  console.log('\n======================================================================');
  console.log('  جميع الاختبارات نجحت بنسبة 100%! المنظومة جاهزة للنشر والتشغيل الفعلي.');
  console.log('======================================================================\n');
}

testFullSpectrumExcel().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
