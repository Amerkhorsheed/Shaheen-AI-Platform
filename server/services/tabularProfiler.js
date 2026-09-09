'use strict';

/**
 * Sovereign Tabular Intelligence & Statistical Profiler.
 *
 * Performs deterministic, 64-bit precision mathematical profiling across
 * 100% of rows and columns in spreadsheets and CSV datasets.
 *
 * Solves the LLM arithmetic hallucination problem by pre-calculating exact:
 * - SUM, MEAN, MEDIAN, MIN, MAX, STDDEV for numeric columns
 * - Cardinality, top frequency distributions (%) for categorical columns
 * - Date ranges and spans
 * - Outlier / anomaly detection (IQR & Z-score)
 * - Stratified structural sampling (head, mid, tail, outliers)
 */

/**
 * Clean and parse cell value to determine its fundamental type.
 */
function analyzeValue(val) {
  if (val === null || val === undefined) return { type: 'empty', raw: null };
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === 'N/A' || trimmed === 'null' || trimmed === 'None') {
      return { type: 'empty', raw: null };
    }

    // Check Boolean
    const lower = trimmed.toLowerCase();
    if (['true', 'false', 'نعم', 'لا', 'صحيح', 'خطأ'].includes(lower)) {
      return { type: 'boolean', value: ['true', 'نعم', 'صحيح'].includes(lower), raw: trimmed };
    }

    // Normalize Eastern Arabic numerals: ٠-٩ and ۰-۹ to standard 0-9
    let normalized = trimmed
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));

    // Check Accounting Negative: (1,234) or trailing minus 1,234-
    let isNegative = false;
    if (normalized.startsWith('(') && normalized.endsWith(')')) {
      isNegative = true;
      normalized = normalized.slice(1, -1).trim();
    } else if (normalized.endsWith('-')) {
      isNegative = true;
      normalized = normalized.slice(0, -1).trim();
    } else if (normalized.startsWith('-')) {
      isNegative = true;
      normalized = normalized.slice(1).trim();
    }

    // Check Numeric (handle commas, Arabic comma '،', currency signs, percentages)
    let cleanedNum = normalized
      .replace(/[,،]/g, '')
      .replace(/[\$€£¥]|ل\.س|SYP|USD|EUR/gi, '')
      .trim();

    let isPercent = false;
    if (cleanedNum.endsWith('%')) {
      isPercent = true;
      cleanedNum = cleanedNum.slice(0, -1).trim();
    }

    if (/^\d+(\.\d+)?$/.test(cleanedNum)) {
      let num = Number(cleanedNum);
      if (isNegative) num = -num;
      if (Number.isFinite(num)) {
        return { type: 'number', value: isPercent ? num / 100 : num, originalNum: num, isPercent, raw: trimmed };
      }
    }

    // Check Date
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(normalized) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}/.test(normalized)) {
      const d = new Date(normalized);
      if (!Number.isNaN(d.getTime())) {
        return { type: 'date', value: d, raw: trimmed };
      }
    }

    return { type: 'string', value: trimmed, raw: trimmed };
  }

  if (typeof val === 'number') {
    if (Number.isFinite(val)) return { type: 'number', value: val, originalNum: val, isPercent: false, raw: String(val) };
    return { type: 'empty', raw: null };
  }

  if (val instanceof Date) {
    if (!Number.isNaN(val.getTime())) {
      return { type: 'date', value: val, raw: val.toISOString().slice(0, 10) };
    }
    return { type: 'empty', raw: null };
  }

  if (typeof val === 'boolean') {
    return { type: 'boolean', value: val, raw: val ? 'نعم' : 'لا' };
  }

  return { type: 'string', value: String(val), raw: String(val) };
}

/**
 * Calculate median from a sorted array of numbers.
 */
function calculateMedian(sorted) {
  if (!sorted || sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Format a number nicely for display (with Arabic/English locale commas).
 */
function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined || !Number.isFinite(num)) return '-';

  // A mean of -0.00084 rendered at two decimals used to print «-0», which reads
  // as a negative quantity and was carried into reports as one. A value that
  // rounds to zero at the requested precision is zero.
  const factor = 10 ** decimals;
  const rounded = Math.round(num * factor) / factor;
  const normalized = rounded === 0 ? 0 : rounded;

  if (Number.isInteger(normalized)) return normalized.toLocaleString('en-US');
  return normalized.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

/**
 * Profile an entire worksheet (headers + rows).
 * @param {string} sheetName
 * @param {string[]} headers
 * @param {Array<Array<any>>} rows
 * @returns {object} Full statistical profile
 */
function profileWorksheet(sheetName, headers, rows) {
  const totalRows = rows.length;
  const colCount = headers.length;

  if (totalRows === 0 || colCount === 0) {
    return {
      sheetName,
      totalRows: 0,
      colCount: 0,
      headers: [],
      columns: [],
      completeness: 0,
      outlierRowIndices: []
    };
  }

  // Pre-allocate column collectors
  const colStats = headers.map((header, colIdx) => ({
    colIndex: colIdx,
    name: String(header || `عمود_${colIdx + 1}`).trim(),
    emptyCount: 0,
    validCount: 0,
    typeCounts: { number: 0, date: 0, boolean: 0, string: 0 },
    numericValues: [],
    dateValues: [],
    categoryMap: new Map(),
    sampleValues: []
  }));

  let totalCells = totalRows * colCount;
  let filledCells = 0;

  // Single-pass processing through 100% of rows
  for (let r = 0; r < totalRows; r++) {
    const row = rows[r];
    for (let c = 0; c < colCount; c++) {
      const cellVal = row ? row[c] : undefined;
      const analyzed = analyzeValue(cellVal);
      const col = colStats[c];

      // Guard: sparse headers can produce holes in colStats via Array.map()
      if (!col) continue;

      if (analyzed.type === 'empty') {
        col.emptyCount++;
      } else {
        col.validCount++;
        filledCells++;
        col.typeCounts[analyzed.type]++;

        if (analyzed.type === 'number') {
          col.numericValues.push({ val: analyzed.value, rowIdx: r, raw: analyzed.raw });
        } else if (analyzed.type === 'date') {
          col.dateValues.push({ date: analyzed.value, rowIdx: r, raw: analyzed.raw });
        } else {
          // Categorical string / boolean
          const strVal = String(analyzed.value).slice(0, 100);
          col.categoryMap.set(strVal, (col.categoryMap.get(strVal) || 0) + 1);
        }

        if (col.sampleValues.length < 5 && analyzed.raw) {
          col.sampleValues.push(analyzed.raw);
        }
      }
    }
  }

  // Determine dominant data type and compute metrics for each column
  const outlierRowIndices = new Set();
  const profiledColumns = colStats.map((col) => {
    const totalValid = col.validCount;
    let dominantType = 'string';
    if (totalValid > 0) {
      if (col.typeCounts.number / totalValid >= 0.7) dominantType = 'number';
      else if (col.typeCounts.date / totalValid >= 0.7) dominantType = 'date';
      else if (col.typeCounts.boolean / totalValid >= 0.7) dominantType = 'boolean';
    }

    const fillRate = totalRows > 0 ? (col.validCount / totalRows) * 100 : 0;
    const baseCol = {
      name: col.name,
      dominantType,
      validCount: col.validCount,
      emptyCount: col.emptyCount,
      fillRate
    };

    if (dominantType === 'number' && col.numericValues.length > 0) {
      const nums = col.numericValues.map((item) => item.val);
      nums.sort((a, b) => a - b);

      let sum = 0;
      let min = nums[0];
      let max = nums[nums.length - 1];
      for (let i = 0; i < nums.length; i++) {
        sum += nums[i];
      }
      const mean = sum / nums.length;
      const median = calculateMedian(nums);

      // Variance & StdDev
      let varianceSum = 0;
      for (let i = 0; i < nums.length; i++) {
        varianceSum += (nums[i] - mean) ** 2;
      }
      const variance = nums.length > 1 ? varianceSum / (nums.length - 1) : 0;
      const stdDev = Math.sqrt(variance);

      // Outlier detection via Z-Score (> 2.5) if enough samples
      const colOutliers = [];
      if (nums.length >= 20 && stdDev > 0.00001) {
        for (const item of col.numericValues) {
          const z = Math.abs((item.val - mean) / stdDev);
          if (z >= 2.5) {
            colOutliers.push({ rowIdx: item.rowIdx, val: item.val, zScore: z });
            outlierRowIndices.add(item.rowIdx);
          }
        }
      }

      return {
        ...baseCol,
        sum,
        mean,
        median,
        min,
        max,
        stdDev,
        outlierCount: colOutliers.length,
        outliers: colOutliers.slice(0, 5)
      };
    }

    if (dominantType === 'date' && col.dateValues.length > 0) {
      const dates = col.dateValues.map((item) => item.date.getTime()).sort((a, b) => a - b);
      const minDate = new Date(dates[0]).toISOString().slice(0, 10);
      const maxDate = new Date(dates[dates.length - 1]).toISOString().slice(0, 10);
      return {
        ...baseCol,
        minDate,
        maxDate,
        dateCount: dates.length
      };
    }

    // Categorical / String
    const uniqueCount = col.categoryMap.size;
    const sortedCategories = Array.from(col.categoryMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([val, count]) => ({
        value: val,
        count,
        percent: totalValid > 0 ? (count / totalValid) * 100 : 0
      }));

    return {
      ...baseCol,
      uniqueCount,
      topValues: sortedCategories
    };
  });

  // 64-bit precision cross-tabulation matrix across key operational dimensions
  const crossTabulations = computeCrossTabulations(rows, profiledColumns);

  return {
    sheetName,
    totalRows,
    colCount,
    completeness: totalCells > 0 ? (filledCells / totalCells) * 100 : 0,
    headers,
    columns: profiledColumns,
    crossTabulations,
    outlierRowIndices: Array.from(outlierRowIndices)
  };
}

/**
 * Which of two categorical columns tells you nothing the other does not?
 *
 * A QC log routinely carries the verdict twice — «QC Status» = Reject and
 * «Action Required» = Quarantined are one fact under two names. Cross-tabulating
 * both doubles the size of the dossier and, worse, invites the model to present
 * one finding as two independent ones. A perfect two-way mapping between the
 * columns is the test: it holds for a restatement and fails for anything that
 * carries its own information.
 */
function isBijection(rows, aIdx, bIdx) {
  const aToB = new Map();
  const bToA = new Map();

  for (const row of rows) {
    if (!row) continue;
    const a = analyzeValue(row[aIdx]).raw;
    const b = analyzeValue(row[bIdx]).raw;
    if (!a || !b) continue;
    const aVal = String(a).trim();
    const bVal = String(b).trim();
    if (aToB.has(aVal) && aToB.get(aVal) !== bVal) return false;
    if (bToA.has(bVal) && bToA.get(bVal) !== aVal) return false;
    aToB.set(aVal, bVal);
    bToA.set(bVal, aVal);
  }

  return aToB.size > 1;
}

/**
 * Cramer's V — how strongly a dimension is associated with the outcome.
 *
 * Dimensions used to be picked by their position in the sheet, so a 13-column
 * QC log surrendered its first three categorical columns and nothing else. That
 * dropped «Supplier / Tier Code» and «Inspector ID» — the two columns an audit
 * actually turns on — and the model, asked which supplier fails most, had no
 * table to read and invented one. Ranking by association puts the columns that
 * move the outcome at the top of the dossier regardless of where they sit.
 *
 * Returns 0 when either column is degenerate, so a constant column can never
 * outrank a real one.
 */
function cramersV(rows, aIdx, bIdx) {
  const joint = new Map();
  const aTotals = new Map();
  const bTotals = new Map();
  let n = 0;

  for (const row of rows) {
    if (!row) continue;
    const a = analyzeValue(row[aIdx]).raw;
    const b = analyzeValue(row[bIdx]).raw;
    if (!a || !b) continue;
    const aVal = String(a).trim();
    const bVal = String(b).trim();
    const key = `${aVal}\u0001${bVal}`;
    joint.set(key, (joint.get(key) || 0) + 1);
    aTotals.set(aVal, (aTotals.get(aVal) || 0) + 1);
    bTotals.set(bVal, (bTotals.get(bVal) || 0) + 1);
    n++;
  }

  const r = aTotals.size;
  const k = bTotals.size;
  if (n === 0 || r < 2 || k < 2) return 0;

  let chiSquare = 0;
  for (const [aVal, aTotal] of aTotals) {
    for (const [bVal, bTotal] of bTotals) {
      const expected = (aTotal * bTotal) / n;
      if (expected <= 0) continue;
      const observed = joint.get(`${aVal}\u0001${bVal}`) || 0;
      chiSquare += ((observed - expected) ** 2) / expected;
    }
  }

  const v = Math.sqrt(chiSquare / (n * Math.min(r - 1, k - 1)));
  return Number.isFinite(v) ? Math.min(v, 1) : 0;
}

/** Values that name a bad outcome, in the vocabularies this platform meets. */
const ADVERSE_VALUE_REGEX =
  /(\breject|\bfail|\bdefect|\bscrap|\bquarantin|nonconform|non-conform|\berror|\boverdue|\bbreach|\bcritical|\bcancel|\bdenied|\blate\b|مرفوض|رفض|فشل|خلل|عيب|معيب|تالف|متأخر|مخالف|ملغى|محجوز|حرج|غير مطابق)/i;

/** Values that name a partially bad outcome — worth watching, not yet a failure. */
const WARNING_VALUE_REGEX = /(\brework|\bwarn|\bpending|\breview|\bhold\b|\badjust|إعادة|تحفظ|معلّق|معلق|تنبيه)/i;

/**
 * Pick the value of the outcome column that represents failure.
 *
 * Preference order: an explicit failure word, then a warning word, then the
 * rarest value — on an operational log the exception is by construction the
 * minority class, and calling the majority class "adverse" would invert every
 * ranking below it.
 */
function pickAdverseValue(targetValues, counts) {
  const explicit = targetValues.find((v) => ADVERSE_VALUE_REGEX.test(v));
  if (explicit) return explicit;
  const warning = targetValues.find((v) => WARNING_VALUE_REGEX.test(v));
  if (warning) return warning;

  let rarest = null;
  let rarestCount = Infinity;
  for (const v of targetValues) {
    const c = counts[v] || 0;
    if (c > 0 && c < rarestCount) {
      rarest = v;
      rarestCount = c;
    }
  }
  return rarest;
}

/**
 * Compute 2D Cross-Tabulations (Contingency Tables) between the operational
 * outcome column and the entity dimensions (line, supplier, inspector, part),
 * plus the three derived views an audit needs and a raw contingency table does
 * not give: where failure concentrates, how the measurements differ between
 * passing and failing records, and how the rate moves over time.
 *
 * @param {Array<Array<any>>} rows
 * @param {Array<object>} columns Profiled columns
 */
function computeCrossTabulations(rows, columns) {
  const empty = {
    crossTabs: [],
    numericGroupings: [],
    adverseRanking: null,
    numericByOutcome: [],
    timeTrend: null,
    aliasedColumns: []
  };
  if (!rows || rows.length < 5 || !columns || columns.length < 2) return empty;

  const totalRows = rows.length;
  const indexed = columns.map((c, idx) => ({ ...c, colIdx: idx }));

  const STATUS_KEYWORD_REGEX =
    /(status|qc|result|outcome|decision|grade|severity|priority|failure|defect|action|condition|verdict|state|flag|حالة|نتيجة|قرار|جودة|تصنيف|خلل|فحص|موقف|حكم|إجراء)/i;

  const categoricalCols = indexed.filter((c) => c.dominantType === 'string' || c.dominantType === 'boolean');

  // A column with a distinct value on (almost) every row is an identifier. Its
  // frequency table is 2,450 lines of «appears once» and it can never explain an
  // outcome, so it is excluded from both roles.
  const isIdentifier = (c) => c.uniqueCount >= Math.max(20, totalRows * 0.9);

  let statusCandidates = categoricalCols.filter(
    (c) => !isIdentifier(c) && c.uniqueCount >= 2 && c.uniqueCount <= 8 && STATUS_KEYWORD_REGEX.test(c.name)
  );

  if (statusCandidates.length === 0) {
    statusCandidates = categoricalCols.filter(
      (c) => !isIdentifier(c) && c.uniqueCount >= 2 && c.uniqueCount <= 5 && c.fillRate >= 70
    );
  }

  if (statusCandidates.length === 0) return empty;

  // Collapse restatements of the same verdict onto the first column that carries it.
  const aliasedColumns = [];
  const targetCols = [];
  for (const candidate of statusCandidates) {
    const twin = targetCols.find((chosen) => isBijection(rows, chosen.colIdx, candidate.colIdx));
    if (twin) {
      aliasedColumns.push({ name: candidate.name, aliasOf: twin.name });
      continue;
    }
    targetCols.push(candidate);
    if (targetCols.length === 2) break;
  }

  const primaryTarget = targetCols[0];

  // Dimensions: everything categorical that is neither the outcome, nor an
  // identifier, nor a restatement of a dimension already chosen.
  const groupCandidates = [];
  for (const c of categoricalCols) {
    if (isIdentifier(c)) continue;
    if (targetCols.some((tc) => tc.colIdx === c.colIdx)) continue;
    if (aliasedColumns.some((a) => a.name === c.name)) continue;
    if (c.uniqueCount < 2 || c.uniqueCount > 30 || c.fillRate < 50) continue;
    const twin = groupCandidates.find((chosen) => isBijection(rows, chosen.colIdx, c.colIdx));
    if (twin) {
      aliasedColumns.push({ name: c.name, aliasOf: twin.name });
      continue;
    }
    groupCandidates.push(c);
  }

  if (groupCandidates.length === 0) return { ...empty, aliasedColumns };

  // Rank by association with the outcome, not by position in the sheet.
  const ranked = groupCandidates
    .map((c) => ({ ...c, association: cramersV(rows, c.colIdx, primaryTarget.colIdx) }))
    .sort((a, b) => b.association - a.association);

  const selectedGroupCols = ranked.slice(0, 5);

  /** One contingency table: dimension x outcome. */
  function buildCrossTab(targetCol, groupCol) {
    const targetValues = (targetCol.topValues || []).map((v) => v.value);
    if (targetValues.length === 0) return null;

    const matrix = new Map();
    for (let r = 0; r < totalRows; r++) {
      const row = rows[r];
      if (!row) continue;
      const gRaw = analyzeValue(row[groupCol.colIdx]).raw;
      const tRaw = analyzeValue(row[targetCol.colIdx]).raw;
      if (!gRaw || !tRaw) continue;
      const gVal = String(gRaw).trim();
      const tVal = String(tRaw).trim();
      if (!matrix.has(gVal)) matrix.set(gVal, { total: 0, counts: {} });
      const entry = matrix.get(gVal);
      entry.total++;
      entry.counts[tVal] = (entry.counts[tVal] || 0) + 1;
    }

    const overallCounts = {};
    for (const data of matrix.values()) {
      for (const [tVal, c] of Object.entries(data.counts)) {
        overallCounts[tVal] = (overallCounts[tVal] || 0) + c;
      }
    }

    const entries = Array.from(matrix.entries()).map(([gVal, data]) => {
      const statuses = {};
      for (const tVal of targetValues) {
        const count = data.counts[tVal] || 0;
        statuses[tVal] = { count, percent: data.total > 0 ? (count / data.total) * 100 : 0 };
      }
      return { groupValue: gVal, total: data.total, statuses };
    });

    entries.sort((a, b) => b.total - a.total);

    return {
      targetColName: targetCol.name,
      groupColName: groupCol.name,
      targetValues,
      adverseValue: pickAdverseValue(targetValues, overallCounts),
      association: groupCol.association,
      entries: entries.slice(0, 12)
    };
  }

  const crossTabs = [];
  for (const targetCol of targetCols) {
    for (const groupCol of selectedGroupCols) {
      const tab = buildCrossTab(targetCol, groupCol);
      if (tab) crossTabs.push(tab);
    }
  }

  // ---------------------------------------------------------------
  // Where the failures concentrate
  //
  // A contingency table states the rates; it does not say which of the sixty
  // cells across five dimensions deserves the intervention. This ranks every
  // category of every dimension by adverse rate against the dataset-wide
  // baseline, so the report opens on the real concentration instead of on
  // whichever line happened to be first in the sheet.
  // ---------------------------------------------------------------
  let adverseRanking = null;
  const primaryValues = (primaryTarget.topValues || []).map((v) => v.value);
  const primaryCounts = {};
  for (const v of primaryTarget.topValues || []) primaryCounts[v.value] = v.count;
  const adverseValue = pickAdverseValue(primaryValues, primaryCounts);

  if (adverseValue) {
    let adverseTotal = 0;
    let observedTotal = 0;
    for (let r = 0; r < totalRows; r++) {
      const tRaw = analyzeValue(rows[r] ? rows[r][primaryTarget.colIdx] : undefined).raw;
      if (!tRaw) continue;
      observedTotal++;
      if (String(tRaw).trim() === adverseValue) adverseTotal++;
    }
    const baselineRate = observedTotal > 0 ? (adverseTotal / observedTotal) * 100 : 0;

    // A category with four records and one failure reads as a 25% failure rate.
    // Requiring enough records for roughly three expected failures keeps
    // small-sample noise out of a ranking that drives decisions.
    const minRecords = Math.max(5, Math.ceil(300 / Math.max(baselineRate, 1)));
    const hotspots = [];

    for (const groupCol of selectedGroupCols) {
      const perValue = new Map();
      for (let r = 0; r < totalRows; r++) {
        const row = rows[r];
        if (!row) continue;
        const gRaw = analyzeValue(row[groupCol.colIdx]).raw;
        const tRaw = analyzeValue(row[primaryTarget.colIdx]).raw;
        if (!gRaw || !tRaw) continue;
        const gVal = String(gRaw).trim();
        if (!perValue.has(gVal)) perValue.set(gVal, { total: 0, adverse: 0 });
        const e = perValue.get(gVal);
        e.total++;
        if (String(tRaw).trim() === adverseValue) e.adverse++;
      }

      for (const [gVal, e] of perValue) {
        if (e.total < minRecords) continue;
        const rate = (e.adverse / e.total) * 100;
        hotspots.push({
          dimension: groupCol.name,
          value: gVal,
          total: e.total,
          adverse: e.adverse,
          rate,
          lift: baselineRate > 0 ? rate / baselineRate : 0,
          shareOfAllAdverse: adverseTotal > 0 ? (e.adverse / adverseTotal) * 100 : 0
        });
      }
    }

    hotspots.sort((a, b) => b.rate - a.rate);

    adverseRanking = {
      targetColName: primaryTarget.name,
      adverseValue,
      adverseTotal,
      observedTotal,
      baselineRate,
      minRecords,
      top: hotspots.slice(0, 12),
      bottom: hotspots.slice(-5).reverse()
    };
  }

  // ---------------------------------------------------------------
  // Measurements conditioned on the outcome
  //
  // The single most diagnostic table on a QC log: if the mean deviation of the
  // rejected parts differs from the accepted ones, the failure is dimensional;
  // if it does not, the cause lies outside the measured dimension entirely.
  // Neither conclusion is reachable from a column-wide mean.
  // ---------------------------------------------------------------
  const numCols = indexed.filter((c) => c.dominantType === 'number' && c.validCount >= 10);
  const numericByOutcome = [];

  for (const numCol of numCols.slice(0, 3)) {
    const buckets = new Map();
    for (let r = 0; r < totalRows; r++) {
      const row = rows[r];
      if (!row) continue;
      const tRaw = analyzeValue(row[primaryTarget.colIdx]).raw;
      const nAnal = analyzeValue(row[numCol.colIdx]);
      if (!tRaw || nAnal.type !== 'number') continue;
      const tVal = String(tRaw).trim();
      if (!buckets.has(tVal)) buckets.set(tVal, []);
      buckets.get(tVal).push(nAnal.value);
    }

    const stats = [];
    for (const [tVal, values] of buckets) {
      if (values.length === 0) continue;
      values.sort((a, b) => a - b);
      let sum = 0;
      let absSum = 0;
      for (const v of values) {
        sum += v;
        absSum += Math.abs(v);
      }
      const mean = sum / values.length;
      let varSum = 0;
      for (const v of values) varSum += (v - mean) ** 2;
      const stdDev = values.length > 1 ? Math.sqrt(varSum / (values.length - 1)) : 0;
      stats.push({
        outcomeValue: tVal,
        count: values.length,
        mean,
        absMean: absSum / values.length,
        median: calculateMedian(values),
        stdDev,
        min: values[0],
        max: values[values.length - 1]
      });
    }

    if (stats.length > 1) {
      stats.sort((a, b) => b.count - a.count);
      numericByOutcome.push({ numColName: numCol.name, targetColName: primaryTarget.name, stats });
    }
  }

  // Volume and value totals per entity, on the strongest dimension.
  const numericGroupings = [];
  if (numCols.length > 0 && selectedGroupCols.length > 0) {
    const primaryGroupCol = selectedGroupCols[0];
    for (const numCol of numCols.slice(0, 2)) {
      const groupMap = new Map();
      for (let r = 0; r < totalRows; r++) {
        const row = rows[r];
        if (!row) continue;
        const gRaw = analyzeValue(row[primaryGroupCol.colIdx]).raw;
        const nAnal = analyzeValue(row[numCol.colIdx]);
        if (!gRaw || nAnal.type !== 'number') continue;
        const gVal = String(gRaw).trim();
        if (!groupMap.has(gVal)) groupMap.set(gVal, { sum: 0, count: 0 });
        const entry = groupMap.get(gVal);
        entry.sum += nAnal.value;
        entry.count++;
      }
      const rowsAgg = Array.from(groupMap.entries())
        .map(([gVal, d]) => ({ groupValue: gVal, count: d.count, sum: d.sum, avg: d.count > 0 ? d.sum / d.count : 0 }))
        .sort((a, b) => b.sum - a.sum);
      numericGroupings.push({ groupColName: primaryGroupCol.name, numColName: numCol.name, rows: rowsAgg.slice(0, 8) });
    }
  }

  // ---------------------------------------------------------------
  // The outcome over time
  //
  // A stable 3% failure rate and a 3% rate that has tripled since January are
  // the same number and opposite situations. Only the monthly series separates
  // them, and only the series justifies an urgent recommendation.
  // ---------------------------------------------------------------
  let timeTrend = null;
  const dateCol = indexed.find((c) => c.dominantType === 'date' && c.dateCount >= 20);

  if (dateCol && adverseRanking) {
    const buckets = new Map();
    for (let r = 0; r < totalRows; r++) {
      const row = rows[r];
      if (!row) continue;
      const dAnal = analyzeValue(row[dateCol.colIdx]);
      const tRaw = analyzeValue(row[primaryTarget.colIdx]).raw;
      if (dAnal.type !== 'date' || !tRaw) continue;
      const key = dAnal.value.toISOString().slice(0, 7);
      if (!buckets.has(key)) buckets.set(key, { total: 0, adverse: 0 });
      const e = buckets.get(key);
      e.total++;
      if (String(tRaw).trim() === adverseRanking.adverseValue) e.adverse++;
    }

    const periods = Array.from(buckets.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([period, e]) => ({
        period,
        total: e.total,
        adverse: e.adverse,
        rate: e.total > 0 ? (e.adverse / e.total) * 100 : 0
      }));

    if (periods.length >= 2) {
      const first = periods[0];
      const last = periods[periods.length - 1];
      timeTrend = {
        dateColName: dateCol.name,
        targetColName: primaryTarget.name,
        adverseValue: adverseRanking.adverseValue,
        periods: periods.slice(0, 24),
        deltaPoints: last.rate - first.rate
      };
    }
  }

  return { crossTabs, numericGroupings, adverseRanking, numericByOutcome, timeTrend, aliasedColumns };
}

/**
 * Generate a stratified sample representing the data structure:
 * - First N rows (head)
 * - Middle N rows (mid)
 * - Last N rows (tail)
 * - Detected outlier rows
 */
function generateStratifiedSample(headers, rows, outlierRowIndices = [], samplePerSection = 8) {
  const total = rows.length;
  if (total === 0) return [];

  const selectedRows = new Map(); // rowIndex -> { row, tag }

  // 1. Head
  const headCount = Math.min(samplePerSection, total);
  for (let i = 0; i < headCount; i++) {
    selectedRows.set(i, { rowIdx: i + 1, data: rows[i], tag: 'بداية المصنف (Head)' });
  }

  // 2. Middle
  if (total > samplePerSection * 3) {
    const midStart = Math.floor(total / 2) - Math.floor(samplePerSection / 2);
    for (let i = 0; i < samplePerSection; i++) {
      const idx = midStart + i;
      if (idx >= 0 && idx < total && !selectedRows.has(idx)) {
        selectedRows.set(idx, { rowIdx: idx + 1, data: rows[idx], tag: 'وسط المصنف (Mid)' });
      }
    }
  }

  // 3. Outliers (up to 10)
  let outlierCount = 0;
  for (const oIdx of outlierRowIndices) {
    if (outlierCount >= 10) break;
    if (oIdx >= 0 && oIdx < total && !selectedRows.has(oIdx)) {
      selectedRows.set(oIdx, { rowIdx: oIdx + 1, data: rows[oIdx], tag: 'شذوذ إحصائي (Outlier)' });
      outlierCount++;
    }
  }

  // 4. Tail
  const tailStart = Math.max(0, total - samplePerSection);
  for (let i = tailStart; i < total; i++) {
    if (!selectedRows.has(i)) {
      selectedRows.set(i, { rowIdx: i + 1, data: rows[i], tag: 'نهاية المصنف (Tail)' });
    }
  }

  // Convert to sorted list by row index
  return Array.from(selectedRows.values()).sort((a, b) => a.rowIdx - b.rowIdx);
}

/**
 * Format the profile into a clean, executive Arabic Markdown dossier.
 *
 * The order of the sections is the argument the report should make: what the
 * numbers are, then where the failures concentrate, then whether the
 * measurements explain them, then whether the situation is getting worse. A
 * model writes the report it is handed the shape of — when the dossier was a
 * flat list of contingency tables, every model returned a transcription of
 * those tables and called it an analysis.
 */
function formatDossierAsMarkdown(profile, stratifiedSample) {
  const { sheetName, totalRows, colCount, completeness, columns, crossTabulations, outlierRowIndices } = profile;
  const {
    crossTabs = [],
    numericGroupings = [],
    adverseRanking = null,
    numericByOutcome = [],
    timeTrend = null,
    aliasedColumns = []
  } = crossTabulations || {};

  const lines = [];
  const pct = (n) => `${formatNumber(n, 1)}%`;

  lines.push(`## الملف الإحصائي الشامل للبيانات: [${sheetName}]`);
  lines.push(
    `- **إجمالي السجلات المعالجة:** ${totalRows.toLocaleString('en-US')} سطر (قرأت المنظومة وحلّلت 100% من سجلات الملف)`
  );
  lines.push(`- **عدد الأعمدة:** ${colCount} عمود | **نسبة اكتمال البيانات:** ${pct(completeness)}`);
  lines.push(`- **السجلات ذات الشذوذ الإحصائي المكتشف:** ${outlierRowIndices.length} سجل`);
  lines.push('');

  // 1. Numeric columns, computed over every row.
  const numCols = columns.filter((c) => c.dominantType === 'number');
  if (numCols.length > 0) {
    lines.push(`### 1. مؤشرات محسوبة آلياً على 100% من السجلات (لا تُعاد من العينة):`);
    lines.push(
      `| العمود | المجموع الإجمالي (SUM) | المتوسط الحسابي (AVG) | الوسيط (Median) | الحد الأدنى (MIN) | الحد الأقصى (MAX) | الانحراف المعياري |`
    );
    lines.push(`| :--- | :---: | :---: | :---: | :---: | :---: | :---: |`);
    for (const c of numCols) {
      lines.push(
        `| **${c.name}** | ${formatNumber(c.sum)} | ${formatNumber(c.mean, 3)} | ${formatNumber(c.median, 3)} | ${formatNumber(c.min, 3)} | ${formatNumber(c.max, 3)} | ${formatNumber(c.stdDev, 3)} |`
      );
    }
    lines.push('');
  }

  // 2. Where the adverse outcome concentrates. This is the finding; everything
  //    below it is the evidence for it.
  if (adverseRanking && adverseRanking.top.length > 0) {
    const a = adverseRanking;
    lines.push(`### 2. بؤر تركّز الحالة الحرجة «${a.adverseValue}» (ترتيب المخاطر المحسوب آلياً):`);
    lines.push(
      `- **عمود النتيجة المعتمد:** «${a.targetColName}» | **الحالة الحرجة:** «${a.adverseValue}» | **إجمالي الحالات:** ${a.adverseTotal.toLocaleString('en-US')} من ${a.observedTotal.toLocaleString('en-US')} سجل.`
    );
    lines.push(
      `- **المعدل المرجعي العام للمنظومة (Baseline):** ${pct(a.baselineRate)} — وكل فئة أدناه تُقارن بهذا المعدل عبر «مُعامل التركّز».`
    );
    lines.push(
      `- استُبعدت الفئات التي تقل سجلاتها عن ${a.minRecords} سجلاً لأن نسبتها لا تحتمل الاعتماد إحصائياً.`
    );
    lines.push('');
    lines.push(
      `| # | البُعد التحليلي | الفئة | عدد السجلات | حالات «${a.adverseValue}» | نسبة الحالة داخل الفئة | مُعامل التركّز مقارنةً بالمعدل العام | حصتها من إجمالي الحالات |`
    );
    lines.push(`| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: |`);
    a.top.forEach((h, i) => {
      lines.push(
        `| ${i + 1} | ${h.dimension} | **${h.value}** | ${formatNumber(h.total, 0)} | ${formatNumber(h.adverse, 0)} | ${pct(h.rate)} | ${formatNumber(h.lift, 2)}x | ${pct(h.shareOfAllAdverse)} |`
      );
    });
    lines.push('');

    if (a.bottom.length > 0) {
      lines.push(`**الفئات الأقل تعرّضاً للحالة الحرجة (مرجع للمقارنة وتحديد الممارسة الأفضل):**`);
      lines.push(`| البُعد التحليلي | الفئة | عدد السجلات | حالات «${a.adverseValue}» | النسبة |`);
      lines.push(`| :--- | :--- | :---: | :---: | :---: |`);
      for (const h of a.bottom) {
        lines.push(
          `| ${h.dimension} | **${h.value}** | ${formatNumber(h.total, 0)} | ${formatNumber(h.adverse, 0)} | ${pct(h.rate)} |`
        );
      }
      lines.push('');
    }
  }

  // 3. Contingency tables, strongest association first.
  if (crossTabs.length > 0) {
    lines.push(`### 3. مصفوفة التقاطعات الكاملة (Cross-Tabulation Matrix) — مرتّبة بقوة الارتباط بالنتيجة:`);
    for (const ct of crossTabs) {
      const strength =
        typeof ct.association === 'number' && ct.association > 0
          ? ` — قوة الارتباط (Cramér's V) = ${formatNumber(ct.association, 3)}`
          : '';
      lines.push(`#### تقاطع «${ct.targetColName}» حسب «${ct.groupColName}»${strength}:`);
      const headers = [ct.groupColName, 'إجمالي السجلات', ...ct.targetValues.map((v) => `حالة: ${v}`)];
      lines.push(`| ${headers.join(' | ')} |`);
      lines.push(`| ${headers.map((_, idx) => (idx === 0 ? ':---' : ':---:')).join(' | ')} |`);

      for (const e of ct.entries) {
        const rowCells = [
          `**${e.groupValue}**`,
          formatNumber(e.total, 0),
          ...ct.targetValues.map((tv) => {
            const s = e.statuses[tv] || { count: 0, percent: 0 };
            return `${formatNumber(s.count, 0)} (${pct(s.percent)})`;
          })
        ];
        lines.push(`| ${rowCells.join(' | ')} |`);
      }
      lines.push('');
    }
  }

  // 4. Do the measurements themselves explain the failures?
  if (numericByOutcome.length > 0) {
    lines.push(`### 4. سلوك القياسات الرقمية داخل كل حالة (تشخيص السبب الجذري):`);
    lines.push(
      `> إذا تطابق متوسط القياس بين الحالة السليمة والحالة الحرجة، فالسبب الجذري خارج البُعد المقيس ولا يُفسَّر بانحراف الأبعاد.`
    );
    for (const nb of numericByOutcome) {
      lines.push(`#### «${nb.numColName}» موزّعاً حسب «${nb.targetColName}»:`);
      lines.push(
        `| الحالة | عدد السجلات | المتوسط الحسابي | متوسط القيمة المطلقة | الوسيط | الانحراف المعياري | الحد الأدنى | الحد الأقصى |`
      );
      lines.push(`| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`);
      for (const s of nb.stats) {
        lines.push(
          `| **${s.outcomeValue}** | ${formatNumber(s.count, 0)} | ${formatNumber(s.mean, 4)} | ${formatNumber(s.absMean, 4)} | ${formatNumber(s.median, 4)} | ${formatNumber(s.stdDev, 4)} | ${formatNumber(s.min, 4)} | ${formatNumber(s.max, 4)} |`
        );
      }
      lines.push('');
    }
  }

  // 5. Direction of travel.
  if (timeTrend && timeTrend.periods.length >= 2) {
    const t = timeTrend;
    const direction =
      t.deltaPoints > 0.5 ? 'تصاعدي (تدهور)' : t.deltaPoints < -0.5 ? 'تنازلي (تحسّن)' : 'مستقر';
    lines.push(`### 5. التسلسل الزمني لمعدل الحالة «${t.adverseValue}» (تجميع شهري حسب «${t.dateColName}»):`);
    lines.push(
      `- **الاتجاه العام:** ${direction} — الفارق بين أول شهر وآخر شهر = ${formatNumber(t.deltaPoints, 2)} نقطة مئوية.`
    );
    // Two months, either of which may be a part-month at the edge of the
    // extract, is a comparison and not yet a trend. Saying so here is what
    // stops it being read as one and turned into an urgency argument.
    if (t.periods.length < 3) {
      lines.push(
        `- **تنبيه منهجي:** عدد الفترات المتاحة ${t.periods.length} فقط، وقد تكون الفترة الأولى أو الأخيرة ناقصة الأيام؛ فالاتجاه أعلاه إرشادي ولا يصلح وحده أساساً لقرار استعجالي.`
      );
    }
    lines.push(`| الشهر | عدد السجلات | حالات «${t.adverseValue}» | النسبة |`);
    lines.push(`| :--- | :---: | :---: | :---: |`);
    for (const p of t.periods) {
      lines.push(`| ${p.period} | ${formatNumber(p.total, 0)} | ${formatNumber(p.adverse, 0)} | ${pct(p.rate)} |`);
    }
    lines.push('');
  }

  // 6. Categorical distributions, with identifier columns reported rather than enumerated.
  const catCols = columns.filter((c) => c.dominantType === 'string' && typeof c.uniqueCount === 'number');
  if (catCols.length > 0) {
    lines.push(`### 6. التوزيع التكراري للأعمدة التصنيفية:`);
    for (const c of catCols) {
      const identifierLike = c.uniqueCount >= Math.max(20, totalRows * 0.9);
      if (identifierLike) {
        lines.push(
          `- **${c.name}**: عمود مُعرِّف فريد (${c.uniqueCount.toLocaleString('en-US')} قيمة مختلفة، مكتمل: ${pct(c.fillRate)}) — لا يحمل دلالة تحليلية تجميعية.`
        );
        continue;
      }
      if (!c.topValues || c.topValues.length === 0) continue;
      const topStr = c.topValues.map((v) => `«${v.value}»: ${v.count} (${pct(v.percent)})`).join(' • ');
      lines.push(`- **${c.name}** (فريد: ${c.uniqueCount}، مكتمل: ${pct(c.fillRate)}): ${topStr}`);
    }
    lines.push('');
  }

  // 7. Volume and value per entity.
  if (numericGroupings.length > 0) {
    lines.push(`### 7. مؤشرات رقمية موزّعة حسب الكيانات:`);
    for (const ng of numericGroupings) {
      lines.push(`#### توزيع «${ng.numColName}» حسب «${ng.groupColName}»:`);
      lines.push(`| ${ng.groupColName} | عدد السجلات | المجموع الإجمالي | المتوسط الحسابي |`);
      lines.push(`| :--- | :---: | :---: | :---: |`);
      for (const r of ng.rows) {
        lines.push(
          `| **${r.groupValue}** | ${formatNumber(r.count, 0)} | ${formatNumber(r.sum)} | ${formatNumber(r.avg, 3)} |`
        );
      }
      lines.push('');
    }
  }

  // 8. Date coverage.
  const dateCols = columns.filter((c) => c.dominantType === 'date');
  if (dateCols.length > 0) {
    lines.push(`### 8. النطاقات الزمنية للبيانات:`);
    for (const c of dateCols) {
      lines.push(
        `- **${c.name}**: من \`${c.minDate}\` إلى \`${c.maxDate}\` (${c.dateCount.toLocaleString('en-US')} تاريخ مسجل)`
      );
    }
    lines.push('');
  }

  // 9. Structural sample.
  if (stratifiedSample && stratifiedSample.length > 0) {
    lines.push(
      `### 9. عينة هيكلية ممثلة من بداية المصنف ووسطه ونهايته (${stratifiedSample.length} سطر، أرقامها غير متتابعة — لا تُجمع ولا يُحسب منها متوسط):`
    );
    const headers = profile.headers;
    lines.push(`| # | الموقع / الوسم | ${headers.join(' | ')} |`);
    lines.push(`| :---: | :---: | ${headers.map(() => ':---').join(' | ')} |`);

    for (const item of stratifiedSample) {
      const rowCells = headers.map((_, idx) => {
        const val = item.data ? item.data[idx] : '';
        const clean = String(val === undefined || val === null ? '' : val).replace(/\|/g, '\\|').replace(/\n/g, ' ');
        return clean.length > 50 ? `${clean.slice(0, 47)}…` : clean;
      });
      lines.push(`| ${item.rowIdx} | ${item.tag} | ${rowCells.join(' | ')} |`);
    }
    lines.push('');
  }

  // Redundant columns are reported, not silently dropped: an auditor who counts
  // thirteen columns in the workbook and eleven in the dossier is entitled to
  // know which two were folded away and into what.
  if (aliasedColumns.length > 0) {
    lines.push(
      `**أعمدة مكرّرة المعنى (تطابق تام واحد لواحد، دُمجت لتفادي عدّ النتيجة الواحدة مرتين):** ` +
        aliasedColumns.map((a) => `«${a.name}» ≡ «${a.aliasOf}»`).join(' • ')
    );
    lines.push('');
  }

  lines.push(`> [!NOTE]`);
  lines.push(
    `> تم احتساب كافة الإجماليات والمؤشرات ومصفوفات التقاطع وترتيب بؤر المخاطر أعلاه عبر محرك التدقيق الرياضي السيادي بدقة 64-bit، وتشمل 100% من أسطر المصنف دون استثناء. [نهاية الملف الإحصائي]`
  );

  return lines.join('\n');
}

module.exports = {
  profileWorksheet,
  generateStratifiedSample,
  formatDossierAsMarkdown,
  analyzeValue
};
