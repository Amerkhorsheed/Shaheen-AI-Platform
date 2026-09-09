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
const { profileWorksheet, generateStratifiedSample, formatDossierAsMarkdown } = require('./tabularProfiler');
const { cellToString } = require('../lib/cellValue');
const { chunkTable, clearChunks } = require('./chunkingService');
const { parseCsv } = require('../lib/csv');

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

function toCsvField(value) {
  const s = cellToString(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header vocabulary of a planned figure, in the languages this platform meets. */
const TARGET_HEADER_REGEX =
  /(target|goal|planned|budget|threshold|limit|sla|kpi|benchmark|allowed|acceptable|مستهدف|المستهدف|المخطط|الخطة|الحد الأقصى|الحد الأدنى|السقف|المسموح|المعياري|المرجعي)/i;

/**
 * Does this small sheet state what the operation was supposed to achieve?
 *
 * A workbook's cover sheet is where the planned figures live, and the gap
 * between a plan and the outcome is usually the finding — «90.2% accepted» is a
 * number, «90.2% against a 99.0% target» is a decision. But the cover sheet
 * arrives as fifteen anonymous lines of CSV among twenty thousand characters of
 * computed tables, and whether the model notices what it is varies from run to
 * run. Naming it costs one line and makes the comparison reliable.
 */
function describesTargets(headers, rows) {
  if (Array.isArray(headers) && headers.some((h) => TARGET_HEADER_REGEX.test(String(h || '')))) return true;
  return (rows || []).some((row) => (row || []).some((cell) => TARGET_HEADER_REGEX.test(cellToString(cell))));
}

/**
 * Render a parsed sheet as CSV, header row included.
 *
 * A workbook's cover sheet is usually far too short to profile, so it is passed
 * through verbatim instead. Both call sites used to read a `rawCsv` property
 * that no parser ever set, so every such sheet reached the model as the literal
 * text `undefined` — on the QC workbook that silently deleted the entire
 * executive summary before the model ever saw the file.
 */
function renderSheetCsv(headers, rows) {
  const lines = [];
  if (Array.isArray(headers) && headers.length > 0) {
    lines.push(headers.map(toCsvField).join(','));
  }
  for (const row of rows || []) {
    lines.push((row || []).map(toCsvField).join(','));
  }
  return lines.join('\n');
}

function getRowValues(row) {
  let raw;
  if (Array.isArray(row.values)) {
    raw = row.values.slice(1);
  } else if (row.values && typeof row.values === 'object') {
    const keys = Object.keys(row.values).map(Number).filter((n) => !isNaN(n) && n > 0);
    if (keys.length > 0) {
      const maxCol = Math.max(...keys);
      raw = [];
      for (let i = 1; i <= maxCol; i++) {
        raw.push(row.values[i] !== undefined ? row.values[i] : '');
      }
    }
  }
  if (!raw) {
    raw = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      raw[colNumber - 1] = cell.value;
    });
  }
  // Always return a dense array — sparse holes cause Array.map() to skip
  // entries, which produces sparse colStats in the profiler and crashes.
  return Array.from({ length: raw.length }, (_, i) => raw[i] !== undefined ? raw[i] : '');
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

function extractLegacyXls(buffer, bufferHash = null) {
  try {
    const workbook = readXls(buffer);
    const parsedSheets = [];
    let totalRowsAllSheets = 0;
    let maxCols = 0;

    for (const sheet of (workbook.sheets || [])) {
      const csv = sheetToCsv(sheet);
      if (csv && csv.trim()) {
        const matrix = parseCsv(csv);
        if (matrix.length > 0) {
          const headers = matrix[0] || [];
          const rows = matrix.slice(1);
          maxCols = Math.max(maxCols, headers.length);
          totalRowsAllSheets += rows.length;
          parsedSheets.push({ name: sheet.name || 'ورقة_عمل', headers, rows, rawCsv: csv.trim() });
        }
      }
    }

    if (parsedSheets.length > 0) {
      if (totalRowsAllSheets < 500) {
        return {
          text: parsedSheets.map((s) => `### ورقة العمل: ${s.name}\n\n${renderSheetCsv(s.headers, s.rows)}`).join('\n\n---\n\n'),
          isProfiled: false,
          totalRows: totalRowsAllSheets,
          totalColumns: maxCols,
          totalChunks: 1
        };
      }

      // Large dataset >= 500 rows: profile and chunk
      clearChunks(bufferHash);
      const dossiers = [];
      let lastManifest = null;
      for (const s of parsedSheets) {
        if (s.rows.length <= 25) {
          const targetsNote = describesTargets(s.headers, s.rows)
          ? '\n\n> [!IMPORTANT]\n> تتضمن هذه الورقة قيماً مستهدفة أو حدوداً مخططة. قابِل الأداء الفعلي المحسوب في الملف الإحصائي أدناه بهذه المستهدفات صراحةً، وقابِل كل مستهدف بنظيره تماماً (مستهدف نسبة القبول يُقابَل بنسبة حالة القبول لا بمكمّل نسبة الرفض)، وأثبِت أي تعارض بين أعدادها والأعداد المحسوبة من السجلات.'
          : '';
        dossiers.push(
          `## 📋 ورقة العمل: [${s.name}] (بيانات مباشرة ومكتملة — ${s.rows.length} سطر)\n\n\`\`\`csv\n${renderSheetCsv(s.headers, s.rows)}\n\`\`\`${targetsNote}`
        );
        } else {
          const profile = profileWorksheet(s.name, s.headers, s.rows);
          const sample = generateStratifiedSample(s.headers, s.rows, profile.outlierRowIndices, 8);
          dossiers.push(formatDossierAsMarkdown(profile, sample));
          lastManifest = chunkTable(bufferHash, s.name, s.headers, s.rows, 100);
        }
      }
      const totalChunksCount = lastManifest ? lastManifest.totalChunks : 0;
      return {
        text: dossiers.join('\n\n---\n\n'),
        isProfiled: true,
        totalRows: totalRowsAllSheets,
        totalColumns: maxCols,
        totalChunks: totalChunksCount,
        fileHash: bufferHash
      };
    }
  } catch (_) {}

  // Fallback: check if it was an HTML or XML table
  const decoded = decodeHtmlBuffer(buffer);
  const parsed = parseHtmlOrXmlTable(decoded);
  if (parsed) return { text: parsed, isProfiled: false };

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

/**
 * Convert HTML table elements into Markdown tables, preserving 2D structure.
 * Non-table content (paragraphs, headings, lists) is kept as plain text.
 *
 * This is critical: mammoth.extractRawText strips all table markup, flattening
 * a 9-column academic table into a vertical word list. The LLM then cannot
 * distinguish which column a value belongs to and reports "unlinked columns".
 */
function htmlToStructuredText(html) {
  if (!html || !html.trim()) return '';

  const parts = [];
  let cursor = 0;

  // Find all <table>...</table> blocks
  const tableRx = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tableRx.exec(html)) !== null) {
    // Process any non-table HTML before this table
    if (tableMatch.index > cursor) {
      const before = html.slice(cursor, tableMatch.index);
      const text = before
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (text) parts.push(text);
    }

    // Convert this <table> to Markdown
    const tableHtml = tableMatch[0];
    const mdTable = convertOneHtmlTableToMarkdown(tableHtml);
    if (mdTable) parts.push(mdTable);

    cursor = tableMatch.index + tableMatch[0].length;
  }

  // Process any remaining non-table HTML after the last table
  if (cursor < html.length) {
    const after = html.slice(cursor);
    const text = after
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (text) parts.push(text);
  }

  return parts.join('\n\n');
}

/** Convert a single <table> HTML string into a Markdown table. */
function convertOneHtmlTableToMarkdown(tableHtml) {
  const rows = [];
  const trRx = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;

  while ((trMatch = trRx.exec(tableHtml)) !== null) {
    const cells = [];
    const cellRx = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cellMatch;

    while ((cellMatch = cellRx.exec(trMatch[1])) !== null) {
      let cellText = cellMatch[1]
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\|/g, '∣')  // Escape pipe chars inside cells
        .replace(/\s+/g, ' ')
        .trim();
      cells.push(cellText || ' ');
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) return null;

  // Normalize column count across all rows
  const maxCols = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) => {
    while (r.length < maxCols) r.push(' ');
    return r;
  });

  // Build Markdown table: first row is header, add separator, then data rows
  const lines = [];
  lines.push('| ' + normalized[0].join(' | ') + ' |');
  lines.push('| ' + normalized[0].map(() => '---').join(' | ') + ' |');
  for (let i = 1; i < normalized.length; i++) {
    lines.push('| ' + normalized[i].join(' | ') + ' |');
  }

  return lines.join('\n');
}

async function extractDocx(buffer) {
  if (!hasSignature(buffer, SIGNATURES.zip)) throw new Error('الملف ليس مستند Word (DOCX) صالحاً');

  // Use convertToHtml to preserve table structure, then convert to Markdown tables
  const { value: html } = await mammoth.convertToHtml({ buffer });

  // If the HTML has tables, convert them to structured Markdown tables
  if (/<table/i.test(html)) {
    const structured = htmlToStructuredText(html);
    if (structured && structured.trim()) return structured;
  }

  // Fallback: if no tables found or conversion produced nothing, use raw text
  const { value: rawText } = await mammoth.extractRawText({ buffer });
  return rawText;
}

async function extractXlsx(buffer, bufferHash = null) {
  if (hasSignature(buffer, SIGNATURES.ole2)) {
    return extractLegacyXls(buffer, bufferHash);
  }

  if (!hasSignature(buffer, SIGNATURES.zip)) {
    const decoded = decodeHtmlBuffer(buffer);
    const parsed = parseHtmlOrXmlTable(decoded);
    if (parsed) return { text: parsed, isProfiled: false };
    throw new Error('الملف ليس مصنّف Excel (XLSX) صالحاً');
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const parsedSheets = [];
    let totalRowsAllSheets = 0;
    let maxColumns = 0;

    workbook.eachSheet((sheet) => {
      const rows = [];
      let headers = [];
      let rowIdx = 0;

      sheet.eachRow({ includeEmpty: false }, (row) => {
        // Normalise here, once, so every consumer downstream — the CSV writer,
        // the chunk index and the profiler — reads the same text for a cell.
        // They used to receive raw ExcelJS objects and each stringify them
        // itself, which is how a formatted heading reached the model as
        // `[object Object]` and a formula's value was excluded from the sums.
        const values = getRowValues(row).map(cellToString);

        if (rowIdx === 0) {
          headers = values.map((v) => v.trim());
        } else if (values.some((v) => v !== '')) {
          rows.push(values);
        }
        rowIdx++;
      });

      if (headers.length === 0 && rows.length > 0) {
        headers = rows[0].map((_, i) => `عمود_${i + 1}`);
      }

      if (headers.length > 0) {
        maxColumns = Math.max(maxColumns, headers.length);
        totalRowsAllSheets += rows.length;
        parsedSheets.push({ name: sheet.name, headers, rows });
      }
    });

    if (parsedSheets.length === 0) {
      const decoded = decodeHtmlBuffer(buffer);
      const parsed = parseHtmlOrXmlTable(decoded);
      if (parsed) return { text: parsed, isProfiled: false };
      const error = new Error('المصنّف لا يحتوي على أي بيانات قابلة للقراءة.');
      error.userFacing = true;
      throw error;
    }

    // Small dataset (< 500 rows total): Full raw CSV representation
    if (totalRowsAllSheets < 500) {
      const sheetTexts = [];
      for (const s of parsedSheets) {
        const lines = [s.headers.map(toCsvField).join(',')];
        for (const r of s.rows) {
          lines.push(r.map(toCsvField).join(','));
        }
        sheetTexts.push(`### ورقة العمل: ${s.name}\n\n${lines.join('\n')}`);
      }
      return {
        text: sheetTexts.join('\n\n---\n\n'),
        isProfiled: false,
        totalRows: totalRowsAllSheets,
        totalColumns: maxColumns,
        totalChunks: 1
      };
    }

    // Large dataset (>= 500 rows): 100% Deterministic Tabular Profiling + Chunking
    clearChunks(bufferHash);
    const dossiers = [];
    let lastManifest = null;

    for (const s of parsedSheets) {
      if (s.rows.length <= 25) {
        const targetsNote = describesTargets(s.headers, s.rows)
          ? '\n\n> [!IMPORTANT]\n> تتضمن هذه الورقة قيماً مستهدفة أو حدوداً مخططة. قابِل الأداء الفعلي المحسوب في الملف الإحصائي أدناه بهذه المستهدفات صراحةً، وقابِل كل مستهدف بنظيره تماماً (مستهدف نسبة القبول يُقابَل بنسبة حالة القبول لا بمكمّل نسبة الرفض)، وأثبِت أي تعارض بين أعدادها والأعداد المحسوبة من السجلات.'
          : '';
        dossiers.push(
          `## 📋 ورقة العمل: [${s.name}] (بيانات مباشرة ومكتملة — ${s.rows.length} سطر)\n\n\`\`\`csv\n${renderSheetCsv(s.headers, s.rows)}\n\`\`\`${targetsNote}`
        );
      } else {
        const profile = profileWorksheet(s.name, s.headers, s.rows);
        const sample = generateStratifiedSample(s.headers, s.rows, profile.outlierRowIndices, 8);
        const dossierMd = formatDossierAsMarkdown(profile, sample);
        dossiers.push(dossierMd);
        lastManifest = chunkTable(bufferHash, s.name, s.headers, s.rows, 100);
      }
    }
    const totalChunksCount = lastManifest ? lastManifest.totalChunks : 0;

    // Append Chunk Manifest info
    dossiers.push(
      `### 📑 كشف شرائح البيانات المفهرسة للتدقيق (Indexed Data Chunks):\n` +
      `- إجمالي السجلات المعالجة: **${totalRowsAllSheets.toLocaleString('en-US')}** سطر عبر **${parsedSheets.length}** ورقة عمل.\n` +
      `- تم تجزئة وفهرسة البيانات إلى **${totalChunksCount}** شريحة في الذاكرة (100 سطر/شريحة) للتدقيق والاسترجاع الفوري.\n` +
      `- كافة الإجماليات والمؤشرات الحسابية أعلاه تشمل 100% من السجلات بدقة قطعية.`
    );

    return {
      text: dossiers.join('\n\n---\n\n'),
      isProfiled: true,
      totalRows: totalRowsAllSheets,
      totalColumns: maxColumns,
      totalChunks: totalChunksCount,
      fileHash: bufferHash
    };
  } catch (err) {
    const decoded = decodeHtmlBuffer(buffer);
    const parsed = parseHtmlOrXmlTable(decoded);
    if (parsed) return { text: parsed, isProfiled: false };
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
    else if (extension === 'xlsx' || extension === 'xlsm' || extension === 'xlsb') {
      raw = await extractXlsx(file.buffer, bufferHash);
    } else if (extension === 'xls') {
      if (hasSignature(file.buffer, SIGNATURES.zip)) {
        raw = await extractXlsx(file.buffer, bufferHash);
      } else {
        raw = extractLegacyXls(file.buffer, bufferHash);
      }
    } else if (extension === 'csv') {
      const rawText = extractText(file.buffer);
      const matrix = parseCsv(rawText);
      if (matrix.length >= 500) {
        const headers = matrix[0] || [];
        const rows = matrix.slice(1);
        const profile = profileWorksheet('ملف_CSV', headers, rows);
        const sample = generateStratifiedSample(headers, rows, profile.outlierRowIndices, 8);
        const dossierMd = formatDossierAsMarkdown(profile, sample);
        const manifest = chunkTable(bufferHash, 'ملف_CSV', headers, rows, 100);

        raw = {
          text: `${dossierMd}\n\n---\n\n### 📑 كشف شرائح البيانات المفهرسة للتدقيق (Indexed Data Chunks):\n- إجمالي السجلات المعالجة: **${rows.length.toLocaleString('en-US')}** سطر.\n- تم تجزئة وفهرسة البيانات إلى **${manifest.totalChunks}** شريحة في الذاكرة (100 سطر/شريحة) للتدقيق والاسترجاع الفوري.\n- كافة الإجماليات والمؤشرات الحسابية أعلاه تشمل 100% من السجلات بدقة قطعية.`,
          isProfiled: true,
          totalRows: rows.length,
          totalColumns: headers.length,
          totalChunks: manifest.totalChunks,
          fileHash: bufferHash
        };
      } else {
        raw = rawText;
      }
    } else if (TEXT_EXTENSIONS.has(extension)) {
      raw = extractText(file.buffer);
    } else {
      return { ...base, success: false, error: 'صيغة الملف غير مدعومة.' };
    }

    let result;
    if (raw && typeof raw === 'object' && raw.isProfiled) {
      result = {
        ...base,
        success: true,
        text: raw.text,
        preview: raw.text.slice(0, 350) + (raw.text.length > 350 ? '…' : ''),
        truncated: false,
        isProfiled: true,
        totalRows: raw.totalRows,
        totalColumns: raw.totalColumns,
        totalChunks: raw.totalChunks,
        fileHash: raw.fileHash || bufferHash
      };
    } else {
      const textVal = typeof raw === 'object' && raw.text ? raw.text : (typeof raw === 'string' ? raw : '');
      const { text, truncated } = truncate(textVal);
      result = {
        ...base,
        success: true,
        text,
        truncated,
        isProfiled: false,
        preview: text.slice(0, 300) + (text.length > 300 ? '…' : '')
      };
    }

    if (bufferHash) {
      setCachedExtraction(bufferHash, {
        success: true,
        text: result.text,
        truncated: result.truncated,
        preview: result.preview,
        isProfiled: result.isProfiled || false,
        totalRows: result.totalRows,
        totalColumns: result.totalColumns,
        totalChunks: result.totalChunks,
        fileHash: result.fileHash
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
