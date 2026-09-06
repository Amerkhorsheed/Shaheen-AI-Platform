'use strict';

/**
 * Document and dataset export, with real provenance.
 *
 * Every export is recorded in `document_registry` with a sequential reference
 * number and the SHA-256 of the exact body that was rendered, and can be
 * checked afterwards through `verify()`. The previous implementation printed
 * `Math.random()` values as a "الرقم الإشاري" and a "HASH" on a state seal:
 * numbers that referred to nothing, could collide, and asserted an
 * authenticity the system could not demonstrate.
 */

const crypto = require('node:crypto');
const ExcelJS = require('exceljs');

const documentRegistryRepository = require('../repositories/documentRegistryRepository');
const auditService = require('./auditService');
const { renderMarkdown, createNonce, documentCsp } = require('../lib/html');
const { parseCsv, contentDisposition } = require('../lib/csv');
const { renderDocument } = require('../templates/documentTemplate');
const { renderDataset } = require('../templates/datasetTemplate');
const { formatArabicDate } = require('../templates/classifications');
const { BadRequestError, NotFoundError } = require('../lib/errors');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/**
 * Record a document and reserve its reference number.
 * The digest covers exactly what the reader sees, not the input that produced it.
 */
function register({ content, title, classification, kind, user, model }) {
  return documentRegistryRepository.insert({
    year: new Date().getFullYear(),
    prefix: kind === 'dataset' ? 'SY-DATA' : 'SY-GOV',
    contentSha256: sha256(content),
    title: title ?? null,
    classification: classification ?? null,
    kind,
    issuedBy: user.id,
    issuedByName: user.display_name || user.username,
    model: model ?? null
  });
}

/**
 * Build a printable official document.
 * @returns {Promise<{html: string, nonce: string, csp: string, ref: string}>}
 */
async function buildDocument({ title, content, metadata, user, ipAddress }) {
  const bodyHtml = renderMarkdown(content);

  const record = await register({
    content: bodyHtml,
    title,
    classification: metadata.classification || 'official',
    kind: 'document',
    user,
    model: metadata.model || null
  });

  await auditService.record({
    userId: user.id,
    action: auditService.ACTIONS.EXPORT_DOCUMENT,
    details: {
      ref: record.ref,
      classification: metadata.classification || 'official',
      title: String(title).slice(0, 120)
    },
    ipAddress
  });

  const nonce = createNonce();
  return {
    ref: record.ref,
    nonce,
    csp: documentCsp(nonce),
    html: renderDocument({
      title,
      bodyHtml,
      ref: record.ref,
      contentSha256: record.content_sha256,
      classification: metadata.classification,
      issuedBy: user.display_name || user.username,
      model: metadata.model,
      nonce
    })
  };
}

/**
 * Build the table inspection portal.
 * @returns {Promise<{html: string, nonce: string, csp: string, ref: string}>}
 */
async function buildDatasetPortal({ csvData, tableTitle, filename, user, ipAddress, issueNestedTicket }) {
  const matrix = parseCsv(csvData);

  const record = await register({
    content: csvData,
    title: tableTitle,
    classification: 'official',
    kind: 'dataset',
    user,
    model: null
  });

  await auditService.record({
    userId: user.id,
    action: auditService.ACTIONS.EXPORT_DATASET,
    details: { ref: record.ref, rows: Math.max(matrix.length - 1, 0), format: 'preview' },
    ipAddress
  });

  const nonce = createNonce();
  return {
    ref: record.ref,
    nonce,
    csp: documentCsp(nonce),
    html: renderDataset({
      matrix,
      csvData,
      tableTitle,
      filename,
      ref: record.ref,
      issuedBy: user.display_name || user.username,
      nestedTicket: issueNestedTicket(),
      nonce
    })
  };
}

const HEADER_ROWS = 4;

/**
 * Produce a formatted .xlsx workbook.
 * @returns {Promise<{buffer: Buffer, filename: string, disposition: string, ref: string}>}
 */
async function buildSpreadsheet({ csvData, filename, title, user, ipAddress }) {
  const matrix = parseCsv(csvData);
  if (matrix.length === 0) {
    throw new BadRequestError('لم يتم العثور على جدول بيانات صالح للتصدير.');
  }

  const record = await register({
    content: csvData,
    title,
    classification: 'official',
    kind: 'dataset',
    user,
    model: null
  });

  await auditService.record({
    userId: user.id,
    action: auditService.ACTIONS.EXPORT_DATASET,
    details: { ref: record.ref, rows: matrix.length, format: 'xlsx' },
    ipAddress
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'منظومة OSS للذكاء الاصطناعي';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('البيانات', { views: [{ rightToLeft: true }] });
  const issuer = user.display_name || user.username;

  sheet.addRow(['الجمهورية العربية السورية — منظومة OSS للذكاء الاصطناعي']);
  sheet.addRow([title]);
  sheet.addRow([`الرقم الإشاري: ${record.ref}  |  تاريخ الإصدار: ${formatArabicDate()}  |  أصدرها: ${issuer}`]);
  sheet.addRow(['مسودة آلية — تخضع للمراجعة والاعتماد من الجهة المختصة قبل أي استخدام رسمي.']);
  sheet.addRow([]);

  for (let i = 1; i <= HEADER_ROWS; i++) {
    sheet.getRow(i).font = {
      bold: i <= 2,
      size: i === 1 ? 13 : 11,
      color: { argb: 'FF02443A' }
    };
  }

  const headerRowNumber = sheet.rowCount + 1;
  matrix.forEach((row) => sheet.addRow(row));

  const headerRow = sheet.getRow(headerRowNumber);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF02443A' } };
  headerRow.alignment = { horizontal: 'right', vertical: 'middle' };

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < headerRowNumber) return;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFDDD8CA' } },
        left: { style: 'thin', color: { argb: 'FFDDD8CA' } },
        bottom: { style: 'thin', color: { argb: 'FFDDD8CA' } },
        right: { style: 'thin', color: { argb: 'FFDDD8CA' } }
      };
    });
  });

  const columnCount = Math.max(...matrix.map((r) => r.length), 1);
  for (let column = 1; column <= columnCount; column++) {
    let widest = 12;
    matrix.forEach((row) => {
      const length = row[column - 1] ? String(row[column - 1]).length : 0;
      widest = Math.max(widest, Math.min(length + 4, 48));
    });
    sheet.getColumn(column).width = widest;
  }

  const finalName = `${filename.replace(/\.(csv|xlsx)$/i, '')}.xlsx`;

  return {
    ref: record.ref,
    filename: finalName,
    disposition: contentDisposition(finalName),
    buffer: Buffer.from(await workbook.xlsx.writeBuffer())
  };
}

/** Confirm a reference number printed on an exported document. */
async function verify(ref) {
  const record = await documentRegistryRepository.findByRef(ref);
  if (!record) {
    throw new NotFoundError('لا يوجد قيد بهذا الرقم الإشاري في سجل المنظومة');
  }
  return { verified: true, record };
}

module.exports = {
  buildDocument,
  buildDatasetPortal,
  buildSpreadsheet,
  verify,
  sha256
};
