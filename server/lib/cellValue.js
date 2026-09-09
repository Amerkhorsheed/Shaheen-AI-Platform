'use strict';

/**
 * Turning one spreadsheet cell into the text the model will read.
 *
 * A cell arrives from ExcelJS as one of a dozen shapes: a primitive, a Date, a
 * rich-text run split across formatting boundaries, a formula carrying its last
 * computed result, a hyperlink, or an error object. Only the primitives survive
 * `String(...)`; everything else becomes the string `[object Object]`.
 *
 * That mattered more than it sounds. A bold word inside a column heading — the
 * single most common piece of formatting in a real spreadsheet — made the
 * heading unreadable, so the model was asked to analyse a table whose columns
 * had no names. In the retrieval index the same cells were tokenised as
 * `[object Object]`, which meant a row could not be found by the text a person
 * could plainly see in it.
 *
 * So this conversion is shared rather than reimplemented: the extractor, the
 * chunk index and the profiler must agree exactly on what a cell says, or the
 * model is shown one thing and the search index holds another.
 */

/**
 * @param {*} value A cell value as produced by ExcelJS (or already a string).
 * @returns {string} The cell's text. Never `[object Object]`, never `undefined`.
 */
function cellToString(value) {
  if (value === null || value === undefined) return '';

  // ISO dates rather than the locale/timezone form `String(date)` produces:
  // stable across machines, and far cheaper in tokens.
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);

  if (typeof value === 'object') {
    // Rich text: the runs are formatting boundaries, not separate values.
    if (Array.isArray(value.richText)) {
      return value.richText.map((run) => (run && run.text ? run.text : '')).join('');
    }

    if (value.error !== undefined) return String(value.error);

    // A formula cell. Prefer its last computed result — that is the value a
    // reader sees in the sheet — and fall back to the expression only when the
    // workbook was saved uncalculated.
    if (value.result !== undefined) {
      const result = value.result;
      if (result === null) return '';
      if (result instanceof Date) return Number.isNaN(result.getTime()) ? '' : result.toISOString().slice(0, 10);
      if (typeof result === 'object') {
        if (result.error !== undefined) return String(result.error);
        if (Array.isArray(result.richText)) {
          return result.richText.map((run) => (run && run.text ? run.text : '')).join('');
        }
        return '';
      }
      return String(result);
    }

    if (value.text !== undefined) return String(value.text);
    if (value.hyperlink !== undefined) return String(value.hyperlink);
    if (value.formula !== undefined) return `=${value.formula}`;
    return '';
  }

  return String(value);
}

module.exports = { cellToString };
