'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

require('dotenv').config();

const config = require('../server/config');
const fileService = require('../server/services/fileService');

test('Config: verifies elevated upload and extraction limits', () => {
  // The extraction ceiling was raised to 2,000,000 and then deliberately
  // brought back to 80,000 (ffdd11a): two million characters of raw text is
  // several times the model's context window, and a request that overflows the
  // window fails outright. A large spreadsheet does not need the raw text —
  // it is profiled over every row into a dossier — so this ceiling governs
  // prose documents, where 80,000 characters is what the window can carry.
  assert.equal(
    config.uploads.maxExtractedChars,
    80000,
    'maxExtractedChars is held at 80,000 to keep a document inside the context window'
  );
  assert.equal(
    config.uploads.maxBytes,
    50 * 1024 * 1024,
    'maxBytes should be elevated to 50MB (52,428,800 bytes)'
  );
  assert.equal(
    config.uploads.maxFiles,
    20,
    'maxFiles should be elevated to 20 files'
  );
  assert.equal(
    config.http.bodyLimit,
    '50mb',
    'HTTP bodyLimit should be elevated to 50mb'
  );
  assert.equal(
    config.exports.maxDocumentChars,
    2000000,
    'maxDocumentChars should be elevated to 2,000,000'
  );
});

test('fileService: a document within the extraction limit is extracted whole', async () => {
  const limit = config.uploads.maxExtractedChars;
  const sampleSentence = 'تقرير رسمي تفصيلي للمنظومة المؤسسية للجمهورية العربية السورية. ';
  const length = limit - 1000;
  const content = sampleSentence.repeat(Math.ceil(length / sampleSentence.length)).slice(0, length);

  const file = {
    originalname: 'long_document.txt',
    size: Buffer.byteLength(content, 'utf8'),
    mimetype: 'text/plain',
    buffer: Buffer.from(content, 'utf8')
  };

  const result = await fileService.extract(file);

  assert.equal(result.success, true);
  assert.equal(result.truncated, false, 'a document under the limit must not be truncated');
  assert.equal(result.text.length, length, 'every character under the limit is extracted');
});

test('fileService: processes multi-sheet Excel file and extracts ALL sheets', async () => {
  const workbook = new ExcelJS.Workbook();

  // Create 3 sheets with unique rows and headers
  const sheetNames = ['الموازنة_العامة', 'المشاريع_الاستثمارية', 'المؤشرات_الاحصائية'];

  for (let s = 0; s < sheetNames.length; s++) {
    const ws = workbook.addWorksheet(sheetNames[s]);
    ws.addRow(['المعرف', 'البيان', 'القيمة_المقدرة', 'تاريخ_الاعتماد']);
    for (let r = 1; r <= 20; r++) {
      ws.addRow([
        `${s + 1}-${r}`,
        `بند استثماري رقم ${r} في قسم ${sheetNames[s]}`,
        r * 150000,
        '2026-09-06'
      ]);
    }
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const file = {
    originalname: 'بيانات_الموازنة_2026.xlsx',
    size: buffer.length,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer
  };

  const result = await fileService.extract(file);

  assert.equal(result.success, true);
  assert.equal(result.truncated, false);
  assert.equal(result.filename, 'بيانات_الموازنة_2026.xlsx');

  // Verify ALL sheets are included in the extracted text
  for (const sheetName of sheetNames) {
    assert.ok(
      result.text.includes(`### ورقة العمل: ${sheetName}`),
      `Extracted text must contain sheet: ${sheetName}`
    );
  }

  // Verify data from each sheet was extracted
  assert.ok(result.text.includes('بند استثماري رقم 1 في قسم الموازنة_العامة'));
  assert.ok(result.text.includes('بند استثماري رقم 20 في قسم المشاريع_الاستثمارية'));
  assert.ok(result.text.includes('بند استثماري رقم 15 في قسم المؤشرات_الاحصائية'));
});

test('fileService: a document over the extraction limit is cut at the limit and says so', async () => {
  const limit = config.uploads.maxExtractedChars;
  const chunk = 'أبجد هوز حطي كلمن سعفص قرشت ثخذ ضظغ. ';
  const length = limit + 50000;
  const oversizedContent = chunk.repeat(Math.ceil(length / chunk.length)).slice(0, length);

  const file = {
    originalname: 'oversized_document.txt',
    size: Buffer.byteLength(oversizedContent, 'utf8'),
    mimetype: 'text/plain',
    buffer: Buffer.from(oversizedContent, 'utf8')
  };

  const result = await fileService.extract(file);

  assert.equal(result.success, true);
  assert.equal(result.truncated, true, 'a document over the limit must be marked as truncated');
  // Exactly the first `limit` characters, then the notice — nothing silently lost.
  const notice = result.text.indexOf('\n\n[ملاحظة المنظومة:');
  assert.equal(notice, limit, 'the text before the notice is exactly the limit');
  assert.equal(result.text.slice(0, limit), oversizedContent.slice(0, limit));
  assert.match(result.text, new RegExp(`تم استخراج أول ${limit.toLocaleString('en-US')} حرفاً`));
});

function createMinimalPdf(pages) {
  let body = '%PDF-1.4\n';
  const offsets = [];

  function addObj(content) {
    offsets.push(body.length);
    body += content + '\n';
  }

  // 1: Catalog
  addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  // 2: Pages
  const kids = pages.map((_, i) => `${3 + i} 0 R`).join(' ');
  addObj(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj`);

  const fontObjIndex = 3 + pages.length * 2;
  pages.forEach((_, i) => {
    const pageObjIndex = 3 + i;
    const contentObjIndex = 3 + pages.length + i;
    addObj(
      `${pageObjIndex} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjIndex} 0 R /Resources << /Font << /F1 ${fontObjIndex} 0 R >> >> >>\nendobj`
    );
  });

  pages.forEach((pageText, i) => {
    const contentObjIndex = 3 + pages.length + i;
    const stream = `BT\n/F1 12 Tf\n100 700 Td\n(${pageText}) Tj\nET`;
    addObj(
      `${contentObjIndex} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj`
    );
  });

  addObj(`${fontObjIndex} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`);

  const startxref = body.length;
  body += `xref\n0 ${fontObjIndex + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += String(offset).padStart(10, '0') + ' 00000 n \n';
  }
  body += `trailer\n<< /Size ${fontObjIndex + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;

  return Buffer.from(body, 'latin1');
}

test('fileService: processes multi-page PDF file and extracts text from ALL pages', async () => {
  const buffer = createMinimalPdf([
    'OfficialPage1_Content',
    'OfficialPage2_Content',
    'OfficialPage3_Content'
  ]);

  const file = {
    originalname: 'document_three_pages.pdf',
    size: buffer.length,
    mimetype: 'application/pdf',
    buffer
  };

  const result = await fileService.extract(file);

  assert.equal(result.success, true);
  assert.equal(result.truncated, false);
  assert.ok(result.text.includes('OfficialPage1_Content'), 'Must extract text from Page 1');
  assert.ok(result.text.includes('OfficialPage2_Content'), 'Must extract text from Page 2');
  assert.ok(result.text.includes('OfficialPage3_Content'), 'Must extract text from Page 3');
});


