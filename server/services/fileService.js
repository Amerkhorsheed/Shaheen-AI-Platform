'use strict';

/**
 * Document text extraction.
 *
 * Only formats the platform can actually parse are accepted, and each is
 * checked against its container signature before reaching a parser — a
 * renamed binary previously reached the UTF-8 decoder and was fed to the model
 * as noise. Files are parsed one at a time: ten concurrent PDF or spreadsheet
 * parses is an easy way to exhaust memory on a shared server.
 */

const path = require('node:path');
const crypto = require('node:crypto');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');

const config = require('../config');
const logger = require('../lib/logger');

// Content-addressed cache for extracted document text (SHA-256 of file buffer)
const extractionCache = new Map();
const MAX_CACHE_ENTRIES = 100;

function getCachedExtraction(hash) {
  if (!hash) return null;
  const entry = extractionCache.get(hash);
  if (entry) {
    extractionCache.delete(hash);
    extractionCache.set(hash, entry);
    return entry;
  }
  return null;
}

function setCachedExtraction(hash, result) {
  if (!hash || !result || !result.success) return;
  if (extractionCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = extractionCache.keys().next().value;
    extractionCache.delete(oldestKey);
  }
  extractionCache.set(hash, result);
}

const TEXT_EXTENSIONS = new Set([
  'csv', 'tsv', 'txt', 'md', 'json', 'xml', 'log',
  'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs',
  'sql', 'sh', 'yml', 'yaml', 'html', 'css'
]);

const BINARY_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx']);

const ALLOWED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS]);

const SIGNATURES = {
  pdf: Buffer.from('%PDF-'),
  // DOCX and XLSX are ZIP containers.
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04])
};

/**
 * Fix filenames that may have been decoded as Latin-1 / Windows-1252 instead of UTF-8.
 * Preserves normal UTF-8 Arabic text, ASCII, and legitimately accented text.
 */
function decodeFilename(name) {
  if (!name || typeof name !== 'string') return '';
  if (/[\u00C0-\u00FF]/.test(name)) {
    try {
      const decoded = Buffer.from(name, 'latin1').toString('utf8');
      if (!decoded.includes('\uFFFD') && decoded !== name) {
        return decoded;
      }
    } catch (_) {}
  }
  return name;
}

function extensionOf(filename) {
  return path.extname(String(filename || '')).replace('.', '').toLowerCase();
}

function hasSignature(buffer, signature) {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

function truncate(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  const limit = config.uploads.maxExtractedChars;

  if (clean.length <= limit) return { text: clean, truncated: false };
  return {
    text: `${clean.slice(0, limit)}\n\n[تم اقتطاع بقية المستند لتجاوزه الحد الأقصى للمعالجة]`,
    truncated: true
  };
}

function cellToString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    if (value.formula !== undefined) return `=${value.formula}`;
    return '';
  }
  return String(value);
}

function toCsvField(value) {
  const s = cellToString(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function extractPdf(buffer) {
  if (!hasSignature(buffer, SIGNATURES.pdf)) throw new Error('الملف ليس مستند PDF صالحاً');
  const { text } = await pdfParse(buffer);
  if (!text.trim()) {
    const error = new Error(
      'لم يُعثر على نص قابل للاستخراج في هذا الملف. قد يكون صورة ممسوحة ضوئياً تتطلب معالجة OCR.'
    );
    error.userFacing = true;
    throw error;
  }
  return text;
}

async function extractDocx(buffer) {
  if (!hasSignature(buffer, SIGNATURES.zip)) throw new Error('الملف ليس مستند Word (DOCX) صالحاً');
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

async function extractXlsx(buffer) {
  if (!hasSignature(buffer, SIGNATURES.zip)) throw new Error('الملف ليس مصنّف Excel (XLSX) صالحاً');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets = [];
  workbook.eachSheet((sheet) => {
    const lines = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      const line = values.map(toCsvField).join(',');
      if (line.replace(/,/g, '').trim()) lines.push(line);
    });
    if (lines.length > 0) sheets.push(`### ورقة العمل: ${sheet.name}\n\n${lines.join('\n')}`);
  });

  if (sheets.length === 0) {
    const error = new Error('المصنّف لا يحتوي على أي بيانات قابلة للقراءة.');
    error.userFacing = true;
    throw error;
  }
  return sheets.join('\n\n---\n\n');
}

function extractText(buffer) {
  const text = buffer.toString('utf-8');
  // A high share of replacement characters means this was not really text.
  const replacements = (text.match(/�/g) || []).length;

  if (replacements > Math.max(20, text.length * 0.01)) {
    const error = new Error('تعذّر قراءة الملف كنص بترميز UTF-8. يرجى التأكد من صيغة الملف.');
    error.userFacing = true;
    throw error;
  }
  return text;
}

/**
 * @returns {Promise<{filename: string, size: number, success: boolean,
 *                    text?: string, preview?: string, truncated?: boolean, error?: string}>}
 */
async function extract(file) {
  const cleanFilename = decodeFilename(file.originalname);
  const extension = extensionOf(cleanFilename);
  const base = { filename: cleanFilename, size: file.size, mimeType: file.mimetype };

  // Check cache by buffer hash to avoid re-parsing identical documents
  const bufferHash = file.buffer ? crypto.createHash('sha256').update(file.buffer).digest('hex') : null;
  if (bufferHash) {
    const cached = getCachedExtraction(bufferHash);
    if (cached) {
      return { ...base, ...cached, filename: cleanFilename };
    }
  }

  try {
    let raw;
    if (extension === 'pdf') raw = await extractPdf(file.buffer);
    else if (extension === 'docx') raw = await extractDocx(file.buffer);
    else if (extension === 'xlsx') raw = await extractXlsx(file.buffer);
    else if (TEXT_EXTENSIONS.has(extension)) raw = extractText(file.buffer);
    else return { ...base, success: false, error: 'صيغة الملف غير مدعومة.' };

    const { text, truncated } = truncate(raw);
    const result = {
      ...base,
      success: true,
      text,
      truncated,
      preview: text.slice(0, 300) + (text.length > 300 ? '…' : '')
    };

    if (bufferHash) {
      setCachedExtraction(bufferHash, {
        success: true,
        text: result.text,
        truncated: result.truncated,
        preview: result.preview
      });
    }

    return result;
  } catch (err) {
    logger.warn({ err: err.message, filename: cleanFilename }, 'File extraction failed');
    return {
      ...base,
      success: false,
      error: err.userFacing ? err.message : `تعذّر استخراج النص من هذا الملف: ${err.message}`
    };
  }
}

/** Sequential on purpose — see the module comment. */
async function extractAll(files) {
  const results = [];
  for (const file of files) {
    results.push(await extract(file));
  }
  return results;
}

module.exports = { extract, extractAll, ALLOWED_EXTENSIONS, extensionOf, decodeFilename };
