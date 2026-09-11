'use strict';

/**
 * Which row of a sheet names its columns?
 *
 * Every reader in the platform used to take the first non-empty row, and for a
 * log exported straight from a system that is right. For a workbook a person
 * prepared it usually is not: the sheet opens with a banner — «AUTOMOTIVE &
 * MANUFACTURING ASSEMBLY QC LOG» — a subtitle, a blank line, and only then the
 * column names. Taking the banner as the header made a fourteen-column log of
 * 2,450 inspections into a two-column file. The dossier said so — «عدد الأعمدة:
 * 2» — and then had nothing to cross-tabulate, no concentrations, no numeric
 * behaviour, and gave no sign that twelve columns had been set aside.
 *
 * The rule is deliberately narrow, because a wrong header is worse than a
 * missing one. The first row is kept, exactly as before, unless it is plainly a
 * banner: at most a third as wide as the table under it. Only then are the next
 * few rows examined, and the first that spans the table, reads as labels rather
 * than values, names each column once, and whose names do not recur in the rows
 * beneath it is taken. When none qualifies, the first row is kept after all.
 *
 * The rows above the header are returned rather than dropped. They are the
 * sheet's own title, and a reader is entitled to see it.
 */

const SCAN_ROWS = 10;
const WIDTH_SAMPLE_ROWS = 50;

function filledCells(row) {
  return (row || [])
    .map((c) => String(c === undefined || c === null ? '' : c).trim())
    .filter((c) => c !== '');
}

/** A cell that is a quantity, a percentage or a date is a value, not a label. */
function isValueLike(cell) {
  return /^[-+]?[\d.,%\s]+$/.test(cell) || /^\d{4}-\d{2}-\d{2}/.test(cell) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(cell);
}

function looksLikeHeader(cells, width) {
  if (cells.length < Math.max(2, Math.ceil(width * 0.8))) return false;
  const labels = cells.filter((c) => !isValueLike(c));
  if (labels.length / cells.length < 0.7) return false;
  return new Set(cells).size >= cells.length * 0.9;
}

/**
 * Do this row's cells recur in their own columns below it?
 *
 * A column's name does not appear again underneath itself; a category value
 * does, over and over. It is what separates a header from the first record of a
 * table of codes and names, which otherwise looks just like one.
 */
function valuesRecurBelow(matrix, index) {
  const row = matrix[index] || [];
  const below = matrix.slice(index + 1, index + 21);
  let recurring = 0;
  let filled = 0;
  row.forEach((raw, col) => {
    const cell = String(raw === undefined || raw === null ? '' : raw).trim();
    if (!cell) return;
    filled += 1;
    if (below.some((r) => String((r || [])[col] === undefined ? '' : r[col]).trim() === cell)) recurring += 1;
  });
  return filled > 0 && recurring / filled > 0.2;
}

/**
 * @param {Array<Array<*>>} matrix  The sheet's non-empty rows, in order.
 * @returns {{index: number, preamble: string[]}}
 */
function locateHeaderRow(matrix) {
  const none = { index: 0, preamble: [] };
  if (!Array.isArray(matrix) || matrix.length < 2) return none;

  const width = Math.max(...matrix.slice(0, WIDTH_SAMPLE_ROWS).map((r) => filledCells(r).length));
  if (width < 2) return none;

  // An ordinary first row is left alone: this only ever corrects a banner, and a
  // banner is a line of title across a table, not a narrow header above it.
  if (filledCells(matrix[0]).length > Math.max(1, width / 3)) return none;

  const limit = Math.min(SCAN_ROWS, matrix.length - 1);
  for (let i = 1; i < limit; i++) {
    if (!looksLikeHeader(filledCells(matrix[i]), width)) continue;
    if (valuesRecurBelow(matrix, i)) continue;
    // A header is followed by the table it names.
    if (filledCells(matrix[i + 1]).length < Math.ceil(width * 0.5)) continue;

    const preamble = matrix
      .slice(0, i)
      .map((r) => filledCells(r).join(' — '))
      .filter(Boolean);
    return { index: i, preamble };
  }

  return none;
}

module.exports = { locateHeaderRow };
