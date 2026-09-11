'use strict';

/**
 * Does a follow-up question get its own answer, or the previous one again?
 *
 * Reproduces the two turns a user actually sent — «حلل هذا لي» with a QC
 * workbook attached, then «قدم نصيحة لي» — assembling the second request the way
 * the browser assembles it, and measuring how much of the first answer comes
 * back in the second. The platform used to return its whole previous report, and
 * intermittently enough that a single clean run means nothing: run several.
 *
 * The engine has to be reachable and a model resident, so this is a live check,
 * not part of `npm run test:unit`. The deterministic half of the same guarantee
 * — that the previous report is not in the prompt at all — is a unit test.
 *
 *   node test/test_followup_not_reprinted.js [runs]
 *
 * Exits non-zero if any run reprints a substantive line of its own last answer.
 */

const ExcelJS = require('exceljs');
const pool = require('../server/db/pool');
const authService = require('../server/services/authService');

const BASE_URL = process.env.PROBE_URL || 'http://127.0.0.1:3001';
const MODEL = process.env.PROBE_MODEL || 'qwen3.8-27b';
const RUNS = Number(process.argv[2] || 1);

const LINES = ['Line 1 - Body Weld', 'Line 2 - Paint Shop', 'Line 3 - Powertrain Sub-assembly'];
const SUPPLIERS = ['SUP-CATL-01', 'SUP-BOSCH-02', 'SUP-DENSO-03', 'SUP-MAGNA-04', 'SUP-VALEO-05'];
const COMPONENTS = [
  'CAB-DASH-MOD',
  'BRK-CAL-4P-F',
  'SUSP-DAMPER-RR',
  'BAT-HV-PACK',
  'ENG-BLOCK-V6',
  'TRN-GBX-8AT'
];
const INSPECTORS = ['INSP-114', 'INSP-227', 'INSP-330', 'INSP-441'];
const PLANTS = ['Plant A - Damascus', 'Plant B - Aleppo'];
const SHIFTS = ['Shift A', 'Shift B', 'Shift C'];
const MODELS = ['MDL-SEDAN-C', 'MDL-SUV-D', 'MDL-VAN-E', 'MDL-EV-F'];

/** A deterministic pseudo-random source, so two runs analyse the same workbook. */
function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

async function buildWorkbook() {
  const random = makeRandom(20260910);
  const wb = new ExcelJS.Workbook();
  // The banner lives on its own sheet, as it does in the workbook this
  // reproduces: the profiler takes row one of a sheet as its header row, so a
  // banner above the header would collapse the log to two columns.
  const cover = wb.addWorksheet('Cover');
  cover.addRow(['AUTOMOTIVE & MANUFACTURING ASSEMBLY QC LOG']);
  cover.addRow(['Commercial Assembly Line & Component Inspection Register']);
  cover.addRow(['Reporting period', 'January – February 2026']);

  const ws = wb.addWorksheet('QC Inspection Log');
  ws.addRow([
    'Inspection ID',
    'Inspection Date',
    'Plant',
    'Shift',
    'Assembly Line',
    'Vehicle Model',
    'Supplier Code',
    'Component Code',
    'Batch No',
    'Inspector ID',
    'Tolerance Deviation (mm)',
    'Torque (Nm)',
    'Surface Finish (Ra)',
    'QC Status'
  ]);

  for (let i = 1; i <= 2450; i += 1) {
    const component = COMPONENTS[Math.floor(random() * COMPONENTS.length)];
    // One component is genuinely worse than the rest; everything else is noise.
    const rejectRate = component === 'CAB-DASH-MOD' ? 0.06 : 0.027;
    const roll = random();
    const status = roll < rejectRate ? 'Reject' : roll < rejectRate + 0.068 ? 'Rework' : 'Pass';
    const deviation =
      status === 'Reject' ? 0.24 + random() * 0.1 : status === 'Rework' ? 0.08 + random() * 0.05 : random() * 0.04;

    const day = 1 + Math.floor(random() * 28);
    const month = i % 2 === 0 ? 1 : 2;
    ws.addRow([
      `QC-2026-${String(i).padStart(5, '0')}`,
      new Date(2026, month - 1, day),
      PLANTS[Math.floor(random() * PLANTS.length)],
      SHIFTS[Math.floor(random() * SHIFTS.length)],
      LINES[Math.floor(random() * LINES.length)],
      MODELS[Math.floor(random() * MODELS.length)],
      SUPPLIERS[Math.floor(random() * SUPPLIERS.length)],
      component,
      `LOT-${2600 + (i % 90)}-${100 + (i % 400)}`,
      INSPECTORS[Math.floor(random() * INSPECTORS.length)],
      Number(deviation.toFixed(4)),
      Number((85 + random() * 12).toFixed(2)),
      Number((0.4 + random() * 1.8).toFixed(3)),
      status
    ]);
  }

  const plan = wb.addWorksheet('Quality Plan');
  plan.addRow(['Component Family', 'Planned Volume', 'Target Compliance %']);
  plan.addRow(['Cabin & Dashboard', 900, 99.0]);
  plan.addRow(['Brake Systems', 850, 99.2]);
  plan.addRow(['Suspension', 800, 98.5]);
  plan.addRow(['Battery Pack & High Voltage', 950, 99.5]);
  plan.addRow(['Engine Assembly', 850, 98.8]);
  plan.addRow(['Transmission', 850, 99.0]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function streamChat(token, messages) {
  const res = await fetch(`${BASE_URL}/api/llm/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.7, max_tokens: 4096 })
  });
  if (!res.ok) throw new Error(`chat failed: ${res.status} ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        content += parsed.choices?.[0]?.delta?.content || '';
      } catch (_) {
        /* keep-alive or partial frame */
      }
    }
  }

  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** Substantive lines: long enough that repeating one is a decision, not a coincidence. */
function substantiveLines(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/^[\s*#>|-]+/, '').trim())
    .filter((l) => l.length >= 40);
}

function reprintRatio(first, second) {
  const lines = substantiveLines(first);
  const copied = lines.filter((line) => second.includes(line));
  return { total: lines.length, copied: copied.length, samples: copied.slice(0, 3) };
}

async function main() {
  const admin = (await pool.query("SELECT * FROM users WHERE role = 'superadmin' LIMIT 1")).rows[0];
  const token = authService.issueToken(admin);

  const fileBuf = await buildWorkbook();
  const form = new FormData();
  form.append('files', new Blob([fileBuf]), 'Automotive_QC_Inspection_Log_200KB.xlsx');
  const uploadRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  if (!uploadRes.ok) throw new Error(`upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  const uploaded = (await uploadRes.json()).files[0];
  const dossier = uploaded.text;
  console.log(`[i] الملف مرفوع: ${(fileBuf.length / 1024).toFixed(0)} KB — الملف الإحصائي ${dossier.length} حرفاً`);
  console.log(`[i] هل يحمل الملف الإحصائي علامة النهاية: ${dossier.includes('[نهاية الملف الإحصائي]') ? 'نعم' : 'لا'}`);

  const fileBlock = `\n\n[محتوى الملف المرفق: ${uploaded.filename}]\n\`\`\`\n${dossier}\n\`\`\``;
  let failures = 0;

  for (let run = 1; run <= RUNS; run += 1) {
    console.log(`\n================ الجولة ${run} من ${RUNS} ================`);

    const t0 = Date.now();
    const first = await streamChat(token, [{ role: 'user', content: `حلل هذا لي${fileBlock}` }]);
    console.log(`[1] التحليل: ${first.length} حرفاً في ${((Date.now() - t0) / 1000).toFixed(0)} ث`);

    // The browser caps the answer it is following up on at 4,000 characters.
    const carried = first.length > 4000 ? `${first.slice(0, 4000)}\n\n... [تم اختصار الرد السابق للحفاظ على سياق الجلسة]` : first;

    const t1 = Date.now();
    const second = await streamChat(token, [
      { role: 'user', content: `حلل هذا لي${fileBlock}` },
      { role: 'assistant', content: carried },
      { role: 'user', content: 'قدم نصيحة لي' }
    ]);
    console.log(`[2] المتابعة: ${second.length} حرفاً في ${((Date.now() - t1) / 1000).toFixed(0)} ث`);

    const ANALYTICAL_SECTIONS = [
      'الحكم التنفيذي',
      'الخلاصة التنفيذية',
      'بؤر تركّز',
      'تشخيص السبب',
      'الاتجاه الزمني',
      'حدود المعطيات',
      'الإنذار المبكر'
    ];
    const repeated = ANALYTICAL_SECTIONS.filter((h) => second.includes(h));
    console.log(`[=] أقسام تحليلية أُعيدت في المتابعة: ${repeated.length ? repeated.join(' / ') : 'لا شيء'}`);

    const { total, copied, samples } = reprintRatio(first, second);
    const pct = total ? ((copied / total) * 100).toFixed(0) : '0';
    console.log(`[=] أسطر مُعادة حرفياً: ${copied} من ${total} (${pct}%)`);
    for (const s of samples) console.log(`    ↳ ${s.slice(0, 90)}`);

    // Grounding: every part code the follow-up names must exist in the dossier.
    const codes = [...new Set((second.match(/\b[A-Z]{2,6}-[A-Z0-9-]{2,}\b/g) || []))];
    const invented = codes.filter((c) => !dossier.includes(c));
    console.log(`[=] رموز مذكورة: ${codes.length} — غير واردة في الملف: ${invented.length ? invented.join(', ') : 'لا شيء'}`);
    const hasOwner = /\[[^\]]+\]/.test(second);
    console.log(`[=] الخطة تحمل جهة ومهلة بين معقوفتين: ${hasOwner ? 'نعم' : 'لا'}`);
    console.log(`--- نص المتابعة (أول 600 حرف) ---\n${second.slice(0, 600)}`);

    if (copied > 0) failures += 1;
    if (invented.length > 0) failures += 1;
  }

  if (failures > 0) {
    console.error(`\n[✗] فشل الفحص: ${failures} مخالفة عبر ${RUNS} جولة.`);
    process.exit(1);
  }

  console.log(`\n[✓] ${RUNS} جولة بلا إعادة إنتاج للرد السابق وبلا كيان غير وارد في الملف.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
