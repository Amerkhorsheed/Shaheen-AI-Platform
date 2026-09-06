'use strict';

/**
 * RFC 4180 CSV parsing.
 *
 * The previous implementation split on newlines first, which corrupted any
 * quoted field containing a comma, a quote or a line break — exactly the
 * fields that appear in Arabic administrative tables.
 */

/**
 * @param {string} csvText
 * @returns {string[][]} rows of trimmed cells, blank rows removed
 */
function parseCsv(csvText) {
  const text = String(csvText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.trim()) return [];

  const matrix = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n') {
      row.push(field.trim());
      field = '';
      if (row.some((cell) => cell !== '')) matrix.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell !== '')) matrix.push(row);

  return matrix;
}

/**
 * Content-Disposition that survives Arabic filenames in every browser:
 * an ASCII fallback plus the RFC 5987 encoded form.
 */
function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

module.exports = { parseCsv, contentDisposition };
