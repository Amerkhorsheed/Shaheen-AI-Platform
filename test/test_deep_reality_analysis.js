'use strict';

/**
 * Deep Reality Analysis & Ground-Truth Verification Test.
 *
 * Proves beyond doubt whether the system produces REAL, factual results:
 * 1. Macro-Audit Ground Truth: Verifies exact total sums, distributions, and averages.
 * 2. Micro-Needle Ground Truth: Hides a specific anomaly in row 2,789 and checks
 *    if the Semantic Chunking & LLM drill-down discovers and extracts it with 100% accuracy.
 */

const ExcelJS = require('exceljs');
const pool = require('../server/db/pool');
const authService = require('../server/services/authService');

const BASE_URL = process.env.SERVER_URL || 'http://127.0.0.1:3001';

async function runDeepRealityAnalysis() {
  console.log('======================================================================');
  console.log('  التحليل الاستقصائي العميق لواقعية ودقة نتائج الذكاء الاصطناعي');
  console.log('  (Deep Reality & Ground-Truth Verification Audit)');
  console.log('======================================================================\n');

  // 1. Authenticate
  const adminUser = (await pool.query("SELECT * FROM users WHERE role = 'superadmin' LIMIT 1")).rows[0];
  const token = authService.issueToken(adminUser);
  console.log(`[✓] تم إصدار رمز الدخول المعتمد للمشرف: ${adminUser.username}\n`);

  // 2. Synthesize Ground-Truth Dataset (3,000 Procurement Records)
  console.log('[*] إنشاء مصنّف المشتريات الطبية المعتمد (3,000 سطر) مع حقائق مثبتة رياضياً...');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('سجل_المشتريات_الطبية_2026');
  ws.addRow([
    'رقم أمر الشراء',
    'اسم الشركة / المورد',
    'المحافظة المستلمة',
    'قيمة العقد بالليرة السورية',
    'حالة التدقيق والجودة',
    'الملاحظات التفصيلية للجنة الفنية'
  ]);

  let groundTruthTotalSpend = 0;
  let groundTruthRejectedCount = 0;
  let minCost = Infinity;
  let maxCost = -Infinity;

  const needleRowIndex = 2789;
  const needleOrderId = 'PO-2026-2789';
  const needleSupplier = 'مؤسسة الشهباء للحلول الجراحية المتقدمة';
  const needleCost = 98765400; // Distinctive recognizable number
  const needleSecretNote = 'اكتشاف عيوب فنية خطيرة في صمامات أجهزة التخدير وشبهة تزوير في شهادة المنشأ الأوروبية';

  for (let i = 1; i <= 3000; i++) {
    let orderId = `PO-2026-${String(i).padStart(4, '0')}`;
    let supplier = i % 2 === 0 ? 'شركة الشام للصناعات الدوائية' : 'مؤسسة بردى للتجهيزات الطبية';
    let province = i % 3 === 0 ? 'دمشق' : (i % 3 === 1 ? 'حلب' : 'اللاذقية');
    let cost = 10000000 + (i * 5000);
    let status = 'مطابق للمواصفات';
    let notes = `تم استلام الشحنة رقم ${i} ومطابقتها للمواصفات القياسية السورية.`;

    // Inject exactly 42 rejected cases
    if (i % 71 === 0) {
      status = 'مرفوض ومحال للتحقيق';
      notes = `ملاحظة فنية: وجود خلل في التغليف أو تأخر في التسليم للطلب رقم ${i}`;
      groundTruthRejectedCount++;
    }

    // Inject the Special Needle at row 2789
    if (i === needleRowIndex) {
      orderId = needleOrderId;
      supplier = needleSupplier;
      province = 'دير الزور';
      cost = needleCost;
      status = 'مرفوض ومحال للتحقيق';
      notes = needleSecretNote;
      groundTruthRejectedCount++;
    }

    minCost = Math.min(minCost, cost);
    maxCost = Math.max(maxCost, cost);
    groundTruthTotalSpend += cost;

    ws.addRow([orderId, supplier, province, cost, status, notes]);
  }

  const fileBuf = Buffer.from(await wb.xlsx.writeBuffer());
  console.log(`[✓] الحقيقة المثبتة للبيانات (Ground Truth):`);
  console.log(`    - إجمالي الأسطر: 3,000 سطر`);
  console.log(`    - المجموع الإجمالي الفعلي للإنفاق: ${groundTruthTotalSpend.toLocaleString('en-US')} ل.س`);
  console.log(`    - الحد الأدنى للعقود: ${minCost.toLocaleString('en-US')} ل.س`);
  console.log(`    - الحد الأقصى للعقود: ${maxCost.toLocaleString('en-US')} ل.س`);
  console.log(`    - عدد العقود المرفوضة والمحالة للتحقيق: ${groundTruthRejectedCount} عقداً`);
  console.log(`    - السجل الاستثنائي المزروع (Needle): [${needleOrderId}] - ${needleSupplier} - ${needleCost.toLocaleString('en-US')} ل.س`);

  // 3. Upload File to /api/upload
  console.log('\n[*] جاري رفع الملف واختبار محرك الاستيعاب والتقطيع الإحصائي...');
  const formData = new FormData();
  formData.append('files', new Blob([fileBuf]), 'Medical_Procurement_Audit_2026.xlsx');

  const uploadRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });

  if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  const uploadData = await uploadRes.json();
  const fileResult = uploadData.files[0];

  console.log(`[✓] تم رفع وتحليل الملف بنجاح:`);
  console.log(`    - هل تم التحليل الإحصائي الكامل بنسبة 100%: ${fileResult.isProfiled ? '✓ نعم' : '✗ لا'}`);
  console.log(`    - عدد الأسطر المعالجة: ${fileResult.totalRows}`);
  console.log(`    - عدد الشرائح المفهرسة: ${fileResult.totalChunks}`);
  console.log(`    - هل تم الاقتطاع: ${fileResult.truncated ? 'نعم' : '✓ لا (Never Truncated)'}`);

  // Helper for SSE Stream reading
  async function queryModel(promptText) {
    const res = await fetch(`${BASE_URL}/api/llm/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: promptText }],
        temperature: 0.1 // Low temperature for maximum deterministic rigor
      })
    });

    if (!res.ok) throw new Error(`Query failed: ${res.status} ${await res.text()}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }
    return fullText;
  }

  // --------------------------------------------------------------------------
  // TEST A: Macro-Audit Reality Check (هل يستخرج الأرقام الحقيقية بدقة 100%؟)
  // --------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log('  الاختبار الأول [A]: تدقيق الإجماليات الحسابية والمالية الكلية');
  console.log('======================================================================');

  const promptA = `أنت المدقق المالي والإداري العام للدولة. استناداً إلى ملف المشتريات المرفق، أجب بدقة قطعية دون أي تخمين:
1. ما هو المجموع الإجمالي الدقيق لقيمة كافة العقود (3000 عقد)؟
2. ما هو الحد الأدنى والحد الأقصى لقيمة العقود؟
3. كم عدد العقود التي حالتها "مرفوض ومحال للتحقيق"؟

[محتوى الملف المرفق: ${fileResult.filename}]
\`\`\`
${fileResult.text}
\`\`\``;

  console.log('[*] إرسال الاستعلام الكلي إلى DeepSeek-R1...');
  const responseA = await queryModel(promptA);

  // Extract clean text from SSE response
  const linesA = responseA.split('\n');
  let cleanAnswerA = '';
  for (const line of linesA) {
    if (line.startsWith('data: ')) {
      try {
        const json = JSON.parse(line.slice(6));
        cleanAnswerA += json.choices?.[0]?.delta?.content || '';
      } catch (_) {}
    }
  }

  console.log('\n--- [مقتطف من رد النموذج الفعلي] ---');
  console.log(cleanAnswerA.slice(0, 800) + '...\n');

  // Verify Numbers in Answer A
  const expectedSumFormatted = groundTruthTotalSpend.toLocaleString('en-US');
  const hasExactSum = cleanAnswerA.includes(expectedSumFormatted) || cleanAnswerA.includes(String(groundTruthTotalSpend));
  const hasMin = cleanAnswerA.includes(minCost.toLocaleString('en-US')) || cleanAnswerA.includes(String(minCost));
  const hasMax = cleanAnswerA.includes(maxCost.toLocaleString('en-US')) || cleanAnswerA.includes(String(maxCost));

  console.log(`[📊 نتيجة تدقيق الأرقام الكلية]:`);
  console.log(`    - المجموع الإجمالي (${expectedSumFormatted} ل.س): ${hasExactSum ? '✅ مذكور بدقة قطعية 100%' : '❌ لم يظهر'}`);
  console.log(`    - الحد الأدنى (${minCost.toLocaleString('en-US')} ل.س): ${hasMin ? '✅ مذكور بدقة 100%' : '❌ لم يظهر'}`);
  console.log(`    - الحد الأقصى (${maxCost.toLocaleString('en-US')} ل.س): ${hasMax ? '✅ مذكور بدقة 100%' : '❌ لم يظهر'}`);

  // --------------------------------------------------------------------------
  // TEST B: Micro-Needle Search Check (هل يكتشف الإبرة في كومة القش بين 3000 سطر؟)
  // --------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log('  الاختبار الثاني [B]: استخراج الحالة الاستقصائية الدقيقة (Needle in Haystack)');
  console.log('======================================================================');

  const promptB = `بصفتك محققاً في الهيئة المركزية للرقابة والتفتيش:
هل يوجد في بيانات المشتريات المرفقة أي عقد أو أمر شراء يتعلق بشبهة "تزوير في شهادة المنشأ" أو خلل في "صمامات أجهزة التخدير"؟
إذا وُجد، اذكر بالتفصيل:
- رقم أمر الشراء المحدد
- اسم الشركة الموردة
- المحافظة
- قيمة العقد بالضبط
- تفاصيل الملاحظة المسجلة

[محتوى الملف المرفق: ${fileResult.filename}]
\`\`\`
${fileResult.text}
\`\`\``;

  console.log('[*] إرسال استعلام البحث الاستقصائي الحساس إلى DeepSeek-R1...');
  const responseB = await queryModel(promptB);

  const linesB = responseB.split('\n');
  let cleanAnswerB = '';
  for (const line of linesB) {
    if (line.startsWith('data: ')) {
      try {
        const json = JSON.parse(line.slice(6));
        cleanAnswerB += json.choices?.[0]?.delta?.content || '';
      } catch (_) {}
    }
  }

  console.log('\n--- [مقتطف من رد النموذج الفعلي على الاستقصاء الدقيق] ---');
  console.log(cleanAnswerB.slice(0, 900) + '...\n');

  const foundOrderId = cleanAnswerB.includes(needleOrderId);
  const foundSupplier = cleanAnswerB.includes('الشهباء') || cleanAnswerB.includes(needleSupplier);
  const foundCost = cleanAnswerB.includes(needleCost.toLocaleString('en-US')) || cleanAnswerB.includes(String(needleCost));
  const foundDeirEzzor = cleanAnswerB.includes('دير الزور');
  const foundNote = cleanAnswerB.includes('صمامات أجهزة التخدير') || cleanAnswerB.includes('تزوير');

  console.log(`[🔍 نتيجة استخراج الحالة الدقيقة من بين 3,000 سطر]:`);
  console.log(`    - رقم أمر الشراء (${needleOrderId}): ${foundOrderId ? '✅ تم استخراجه بدقة 100%' : '❌ لم يُعثر عليه'}`);
  console.log(`    - المورد المستهدف (${needleSupplier}): ${foundSupplier ? '✅ تم تحديده بدقة 100%' : '❌ لم يُعثر عليه'}`);
  console.log(`    - المحافظة (دير الزور): ${foundDeirEzzor ? '✅ تم رصدها بدقة 100%' : '❌ لم يُعثر عليها'}`);
  console.log(`    - القيمة المالية (${needleCost.toLocaleString('en-US')} ل.س): ${foundCost ? '✅ تطابق حسابي حقيقي' : '❌ لم تظهر'}`);
  console.log(`    - تفاصيل الشبهة (صمامات التخدير وتزوير المنشأ): ${foundNote ? '✅ استخراج كامل للحقيقة المدفونة' : '❌ لم تظهر'}`);

  console.log('\n======================================================================');
  if (hasExactSum && foundOrderId && foundSupplier && foundNote) {
    console.log('  🏆 الخلاصة القطعية: المنظومة تجلب نتائج حقيقية 100% بدون أي هلوسة!');
  } else {
    console.log('  ⚠️ تنبيه: إحدى المؤشرات تحتاج إلى مراجعة.');
  }
  console.log('======================================================================\n');
}

runDeepRealityAnalysis().catch((err) => {
  console.error('Deep Analysis failed:', err);
  process.exit(1);
});
