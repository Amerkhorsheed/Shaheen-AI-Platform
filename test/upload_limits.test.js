'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

require('dotenv').config();

const config = require('../server/config');
const fileService = require('../server/services/fileService');

test('Config: verifies elevated upload and extraction limits', () => {
  assert.equal(
    config.uploads.maxExtractedChars,
    2000000,
    'maxExtractedChars should be elevated to 2,000,000'
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

test('fileService: processes text files larger than old limit (400,000 chars) without truncation', async () => {
  // Create a large text buffer of 600,000 characters
  // Under the old 400,000 limit, this would be truncated.
  const sampleSentence = 'تقرير رسمي تفصيلي للمنظومة المؤسسية للجمهورية العربية السورية. ';
  const repeatCount = Math.ceil(600000 / sampleSentence.length);
  const largeContent = sampleSentence.repeat(repeatCount).slice(0, 600000);

  const file = {
    originalname: 'large_document.txt',
    size: Buffer.byteLength(largeContent, 'utf8'),
    mimetype: 'text/plain',
    buffer: Buffer.from(largeContent, 'utf8')
  };

  const result = await fileService.extract(file);

  assert.equal(result.success, true);
  assert.equal(result.truncated, false, 'A 600,000-char document must NOT be truncated under new limits');
  assert.equal(result.text.length, 600000, 'All 600,000 characters must be fully extracted');
  assert.ok(!result.text.includes('[تم اقتطاع بقية المستند لتجاوزه الحد الأقصى للمعالجة]'));
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

test('fileService: truncates only when exceeding the new 2,000,000 character limit', async () => {
  // Create content exceeding 2,000,000 chars (2,050,000 chars)
  const chunk = 'أبجد هوز حطي كلمن سعفص قرشت ثخذ ضظغ. ';
  const repeatCount = Math.ceil(2050000 / chunk.length);
  const oversizedContent = chunk.repeat(repeatCount).slice(0, 2050000);

  const file = {
    originalname: 'oversized_document.txt',
    size: Buffer.byteLength(oversizedContent, 'utf8'),
    mimetype: 'text/plain',
    buffer: Buffer.from(oversizedContent, 'utf8')
  };

  const result = await fileService.extract(file);

  assert.equal(result.success, true);
  assert.equal(result.truncated, true, 'Documents exceeding 2,000,000 characters must be marked as truncated');
  assert.ok(result.text.includes('[تم اقتطاع بقية المستند لتجاوزه الحد الأقصى للمعالجة]'));
  // Text before the notice should be exactly 2,000,000 chars
  assert.equal(result.text.indexOf('\n\n[تم اقتطاع بقية المستند لتجاوزه الحد الأقصى للمعالجة]'), 2000000);
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


