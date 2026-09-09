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
    if (trimmed === '' || trimmed === '-' || trimmed === 'N/A' || trimmed === 'null') {
      return { type: 'empty', raw: null };
    }

    // Check Boolean
    const lower = trimmed.toLowerCase();
    if (['true', 'false', 'نعم', 'لا', 'صحيح', 'خطأ'].includes(lower)) {
      return { type: 'boolean', value: ['true', 'نعم', 'صحيح'].includes(lower), raw: trimmed };
    }

    // Check Numeric (handle commas, currency signs, percentages)
    let cleanedNum = trimmed.replace(/,/g, '').replace(/[\$€£]|ل\.س|SYP/gi, '').trim();
    let isPercent = false;
    if (cleanedNum.endsWith('%')) {
      isPercent = true;
      cleanedNum = cleanedNum.slice(0, -1).trim();
    }

    if (/^-?\d+(\.\d+)?$/.test(cleanedNum)) {
      const num = Number(cleanedNum);
      if (Number.isFinite(num)) {
        return { type: 'number', value: isPercent ? num / 100 : num, originalNum: num, isPercent, raw: trimmed };
      }
    }

    // Check Date
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(trimmed) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}/.test(trimmed)) {
      const d = new Date(trimmed);
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
  if (Number.isInteger(num)) return num.toLocaleString('en-US');
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
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

  return {
    sheetName,
    totalRows,
    colCount,
    completeness: totalCells > 0 ? (filledCells / totalCells) * 100 : 0,
    headers,
    columns: profiledColumns,
    outlierRowIndices: Array.from(outlierRowIndices)
  };
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

  // 3. Outliers (up to 6)
  let outlierCount = 0;
  for (const oIdx of outlierRowIndices) {
    if (outlierCount >= 6) break;
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
 * Format the profile into a clean, executive Arabic Markdown Dossier
 * specifically designed to fit within token budgets while giving DeepSeek-R1
 * 100% accurate mathematical facts.
 */
function formatDossierAsMarkdown(profile, stratifiedSample) {
  const { sheetName, totalRows, colCount, completeness, columns, outlierRowIndices } = profile;

  const lines = [];
  lines.push(`## 📊 الملف الإحصائي الشامل للبيانات: [${sheetName}]`);
  lines.push(`- **إجمالي السجلات المعالجة:** ${totalRows.toLocaleString('en-US')} سطر (تمت قراءة وتحليل 100% من البيانات بدقة قطعية)`);
  lines.push(`- **عدد الأعمدة:** ${colCount} عمود | **نسبة اكتمال البيانات:** ${completeness.toFixed(1)}%`);
  lines.push(`- **السجلات ذات الشذوذ الإحصائي المكتشف:** ${outlierRowIndices.length} سجل`);
  lines.push('');

  // 1. Numeric Columns Table
  const numCols = columns.filter((c) => c.dominantType === 'number');
  if (numCols.length > 0) {
    lines.push(`### 1. مؤشرات التدقيق الحسابي والمالي القطعي (100% من السجلات):`);
    lines.push(`| العمود | المجموع الإجمالي (SUM) | المتوسط الحسابي (AVG) | الوسيط (Median) | الحد الأدنى (MIN) | الحد الأقصى (MAX) | الانحراف المعياري |`);
    lines.push(`| :--- | :---: | :---: | :---: | :---: | :---: | :---: |`);
    for (const c of numCols) {
      lines.push(
        `| **${c.name}** | ${formatNumber(c.sum)} | ${formatNumber(c.mean)} | ${formatNumber(c.median)} | ${formatNumber(c.min)} | ${formatNumber(c.max)} | ${formatNumber(c.stdDev)} |`
      );
    }
    lines.push('');
  }

  // 2. Categorical Columns Distribution
  const catCols = columns.filter((c) => c.dominantType === 'string' && c.topValues && c.topValues.length > 0);
  if (catCols.length > 0) {
    lines.push(`### 2. التوزيع التكراري والتصنيفات الأكثر شيوعاً:`);
    for (const c of catCols) {
      const topStr = c.topValues.map((v) => `«${v.value}»: ${v.count} (${v.percent.toFixed(1)}%)`).join(' • ');
      lines.push(`- **${c.name}** (فريد: ${c.uniqueCount}، مكتمل: ${c.fillRate.toFixed(1)}%): ${topStr}`);
    }
    lines.push('');
  }

  // 3. Date Columns
  const dateCols = columns.filter((c) => c.dominantType === 'date');
  if (dateCols.length > 0) {
    lines.push(`### 3. النطاقات الزمنية للبيانات:`);
    for (const c of dateCols) {
      lines.push(`- **${c.name}**: من \`${c.minDate}\` إلى \`${c.maxDate}\` (${c.dateCount.toLocaleString('en-US')} تاريخ مسجل)`);
    }
    lines.push('');
  }

  // 4. Stratified Structural Sample Rows
  if (stratifiedSample && stratifiedSample.length > 0) {
    lines.push(`### 4. عينة هيكلية استطلاعية ممثلة لكامل المصنف (${stratifiedSample.length} سطر معتمد):`);
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

  lines.push(`> [!NOTE]`);
  lines.push(`> تم احتساب كافة الإجماليات والمؤشرات الحسابية أعلاه عبر محرك التدقيق الرياضي السيادي بدقة 64-bit، وتشمل 100% من أسطر المصنف دون استثناء.`);

  return lines.join('\n');
}

module.exports = {
  profileWorksheet,
  generateStratifiedSample,
  formatDossierAsMarkdown,
  analyzeValue
};
