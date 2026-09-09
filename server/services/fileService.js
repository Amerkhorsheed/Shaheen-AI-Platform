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
const { readXls, sheetToCsv } = require('xls-reader');

const config = require('../config');
const logger = require('../lib/logger');

// Content-addressed cache for extracted document text (SHA-256 of file buffer)
const extractionCache = new Map();
const MAX_CACHE_ENTRIES = 2000; // Expanded to leverage 96GB RAM for instant document retrieval

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

const BINARY_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'xls', 'xlsm', 'xlsb']);

const ALLOWED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS]);

const SIGNATURES = {
  pdf: Buffer.from('%PDF-'),
  // DOCX and XLSX/XLSM are ZIP containers.
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  // Legacy Excel BIFF8 OLE2 Compound Document Header: \xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1
  ole2: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
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
  const limit = config.uploads.maxExtractedChars || 80000;

  if (clean.length <= limit) return { text: clean, truncated: false };
  return {
    text: `${clean.slice(0, limit)}\n\n[ملاحظة المنظومة: تم استخراج أول ${limit.toLocaleString('en-US')} حرفاً من بيانات وجداول الملف بنجاح. تم اقتطاع باقي الأسطر تلقائياً لضمان بقاء المستند ضمن نافذة سياق النموذج (Context Window) وتفادي أي خطأ في التوليد]`,
    truncated: true
  };
}

function cellToString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((r) => (r && r.text ? r.text : '')).join('');
    if (value.error !== undefined) return String(value.error);
    if (value.result !== undefined) {
      if (typeof value.result === 'object' && value.result !== null) {
        if (value.result.error) return String(value.result.error);
        if (Array.isArray(value.result.richText)) {
          return value.result.richText.map((r) => (r && r.text ? r.text : '')).join('');
        }
        return '';
      }
      return String(value.result);
    }
    if (value.text !== undefined) return String(value.text);
    if (value.hyperlink !== undefined) return String(value.text || value.hyperlink);
    if (value.formula !== undefined) return `=${value.formula}`;
    return '';
  }
  return String(value);
}

function toCsvField(value) {
  const s = cellToString(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function getRowValues(row) {
  if (Array.isArray(row.values)) {
    return row.values.slice(1);
  }
  if (row.values && typeof row.values === 'object') {
    const keys = Object.keys(row.values).map(Number).filter((n) => !isNaN(n) && n > 0);
    if (keys.length > 0) {
      const maxCol = Math.max(...keys);
      const arr = [];
      for (let i = 1; i <= maxCol; i++) {
        arr.push(row.values[i] !== undefined ? row.values[i] : '');
      }
      return arr;
    }
  }
  const cells = [];
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cells[colNumber - 1] = cell.value;
  });
  return cells;
}

function decodeHtmlBuffer(buffer) {
  if (!buffer || buffer.length === 0) return '';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  let startIdx = 0;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    startIdx = 3;
  }
  const probe = buffer.subarray(startIdx, Math.min(buffer.length, startIdx + 1024)).toString('ascii').toLowerCase();
  const charsetMatch = probe.match(/charset=["']?([a-zA-Z0-9_-]+)/);
  const charset = charsetMatch ? charsetMatch[1].toLowerCase() : null;
  if (charset === 'windows-1256' || charset === 'cp1256') {
    try {
      return new TextDecoder('windows-1256').decode(buffer.subarray(startIdx));
    } catch (_) {}
  }
  const utf8Text = buffer.subarray(startIdx).toString('utf-8');
  const replacements = (utf8Text.match(/\uFFFD/g) || []).length;
  if (replacements > 5) {
    try {
      const winText = new TextDecoder('windows-1256').decode(buffer.subarray(startIdx));
      const winReplacements = (winText.match(/\uFFFD/g) || []).length;
      if (winReplacements < replacements) return winText;
    } catch (_) {}
  }
  return utf8Text;
}

function parseHtmlOrXmlTable(text) {
  if (!text || typeof text !== 'string') return null;

  const isXmlSpreadsheet =
    /xmlns(?::\w+)?="urn:schemas-microsoft-com:office:spreadsheet"/i.test(text) ||
    /<ss:Workbook|<Workbook/i.test(text);

  if (isXmlSpreadsheet) {
    const sheets = [];
    const worksheetMatches = text.matchAll(/<(?:ss:)?Worksheet[^>]*ss:Name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:ss:)?Worksheet>/gi);
    for (const ws of worksheetMatches) {
      const sheetName = ws[1];
      const sheetBody = ws[2];
      const lines = [];
      const rowMatches = sheetBody.matchAll(/<(?:ss:)?Row[^>]*>([\s\S]*?)<\/(?:ss:)?Row>/gi);
      for (const row of rowMatches) {
        const cells = [];
        const cellMatches = row[1].matchAll(/<(?:ss:)?Data[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/gi);
        for (const cell of cellMatches) {
          const val = cell[1].replace(/<[^>]+>/g, '').trim();
          cells.push(val);
        }
        if (cells.some((c) => c.length > 0)) {
          lines.push(cells.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','));
        }
      }
      if (lines.length > 0) {
        sheets.push(`### ورقة العمل: ${sheetName}\n\n${lines.join('\n')}`);
      }
    }
    if (sheets.length > 0) return sheets.join('\n\n---\n\n');
  }

  const lines = [];
  const trMatches = text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const tr of trMatches) {
    const cells = [];
    const cellMatches = tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi);
    for (const td of cellMatches) {
      let cellText = td[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .trim();
      cells.push(cellText);
    }
    if (cells.some((c) => c.length > 0)) {
      lines.push(cells.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','));
    }
  }

  if (lines.length > 0) {
    return lines.join('\n');
  }
  return null;
}

function extractLegacyXls(buffer) {
  try {
    const workbook = readXls(buffer);
    const sheets = [];
    for (const sheet of (workbook.sheets || [])) {
      const csv = sheetToCsv(sheet);
      if (csv && csv.trim()) {
        sheets.push(`### ورقة العمل: ${sheet.name || 'ورقة'}\n\n${csv.trim()}`);
      }
    }
    if (sheets.length > 0) {
      return sheets.join('\n\n---\n\n');
    }
  } catch (_) {}

  // Fallback: check if it was an HTML or XML table
  const decoded = decodeHtmlBuffer(buffer);
  const parsed = parseHtmlOrXmlTable(decoded);
  if (parsed) return parsed;

  const error = new Error('المصنّف لا يحتوي على أي بيانات قابلة للقراءة أو ليس ملف Excel صالحاً.');
  error.userFacing = true;
  throw error;
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
  if (hasSignature(buffer, SIGNATURES.ole2)) {
    return extractLegacyXls(buffer);
  }

  if (!hasSignature(buffer, SIGNATURES.zip)) {
    const decoded = decodeHtmlBuffer(buffer);
    const parsed = parseHtmlOrXmlTable(decoded);
    if (parsed) return parsed;
    throw new Error('الملف ليس مصنّف Excel (XLSX) صالحاً');
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheets = [];
    let charCount = 0;
    const charLimit = (config.uploads.maxExtractedChars || 80000) * 1.2;
    workbook.eachSheet((sheet) => {
      const lines = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        if (charCount > charLimit) return;
        const values = getRowValues(row);
        const line = values.map(toCsvField).join(',');
        if (line.replace(/,/g, '').trim()) {
          lines.push(line);
          charCount += line.length + 1;
        }
      });
      if (lines.length > 0) sheets.push(`### ورقة العمل: ${sheet.name}\n\n${lines.join('\n')}`);
    });

    if (sheets.length === 0) {
      const decoded = decodeHtmlBuffer(buffer);
      const parsed = parseHtmlOrXmlTable(decoded);
      if (parsed) return parsed;
      const error = new Error('المصنّف لا يحتوي على أي بيانات قابلة للقراءة.');
      error.userFacing = true;
      throw error;
    }
    return sheets.join('\n\n---\n\n');
  } catch (err) {
    const decoded = decodeHtmlBuffer(buffer);
    const parsed = parseHtmlOrXmlTable(decoded);
    if (parsed) return parsed;
    throw err;
  }
}

function extractText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  let startIdx = 0;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    startIdx = 3;
  }

  const utf8Text = buffer.subarray(startIdx).toString('utf-8');
  const replacements = (utf8Text.match(/\uFFFD/g) || []).length;

  if (replacements > Math.max(20, utf8Text.length * 0.01)) {
    try {
      const winText = new TextDecoder('windows-1256').decode(buffer.subarray(startIdx));
      const winReplacements = (winText.match(/\uFFFD/g) || []).length;
      if (winReplacements === 0 || winReplacements < replacements / 2) {
        return winText;
      }
    } catch (_) {}

    const error = new Error('تعذّر قراءة الملف كنص بترميز UTF-8 أو Windows-1256. يرجى التأكد من صيغة الملف.');
    error.userFacing = true;
    throw error;
  }
  return utf8Text;
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
    else if (extension === 'xlsx' || extension === 'xlsm' || extension === 'xlsb') raw = await extractXlsx(file.buffer);
    else if (extension === 'xls') {
      if (hasSignature(file.buffer, SIGNATURES.zip)) {
        raw = await extractXlsx(file.buffer);
      } else {
        raw = extractLegacyXls(file.buffer);
      }
    } else if (TEXT_EXTENSIONS.has(extension)) {
      raw = extractText(file.buffer);
    } else {
      return { ...base, success: false, error: 'صيغة الملف غير مدعومة.' };
    }

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
