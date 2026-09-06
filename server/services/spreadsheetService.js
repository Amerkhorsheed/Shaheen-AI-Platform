'use strict';

/**
 * Sovereign High-Grade Excel (.xlsx) Spreadsheet Generation Service.
 *
 * Produces executive-level, publication-ready Excel workbooks complete with:
 * - High-resolution Syrian State Emblem / Shaheen AI Platform Logo
 * - Official Republic Letterhead & sequential registry reference
 * - KPI & Data Integrity Ribbon (records, columns, classification, SHA-256)
 * - Right-To-Left (RTL) Arabic layout with visible gridlines
 * - Frozen header row (Freeze Panes) & Auto-Filter on all columns
 * - Smart data typing & accounting number formats (#,##0, #,##0.00, percentages)
 * - Alternating zebra striping with soft luxury palette
 * - Summary / Totals row with live Excel SUM formulas
 * - Official legal disclaimer footer
 * - Dedicated Sheet 2: Audit & Provenance Certificate (بطاقة الوثيقة وسجل التدقيق)
 */

const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { formatArabicDate } = require('../templates/classifications');

// Cache logo buffer
let cachedLogoBuffer = null;

function getLogoBuffer() {
  if (cachedLogoBuffer) return cachedLogoBuffer;
  const candidates = [
    path.join(__dirname, '../assets/eagle-logo.png'),
    path.join(__dirname, '../../client/src/assets/eagle-logo.png'),
    path.join(__dirname, '../../client/dist/assets/eagle-logo.png')
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cachedLogoBuffer = fs.readFileSync(candidate);
        break;
      }
    } catch (_) {}
  }
  return cachedLogoBuffer;
}

// Visual Theme Palette
const PALETTE = {
  BRAND_EMERALD: 'FF02443A',
  BRAND_DARK: 'FF002723',
  BRAND_GOLD: 'FFB79E6A',
  BRAND_GOLD_DARK: 'FF7A6A45',
  TEXT_MAIN: 'FF14201C',
  TEXT_MUTED: 'FF5E6B64',
  TEXT_WHITE: 'FFFFFFFF',
  BG_ZEBRA_EVEN: 'FFFFFFFF',
  BG_ZEBRA_ODD: 'FFF9F8F5',
  BG_TOTALS: 'FFF5EFE1',
  BG_RIBBON: 'FFEAF2EC',
  BG_CARD: 'FFFBFAF6',
  BORDER_SOFT: 'FFE5E0D5',
  BORDER_CARD: 'FFA6D0BA',
  BORDER_HEADER: 'FF002723'
};

/** Convert 1-based column number to Excel column letter (1 -> A, 27 -> AA) */
function colToLetter(colNumber) {
  let temp;
  let letter = '';
  let col = colNumber;
  while (col > 0) {
    temp = (col - 1) % 26;
    letter = String.fromCharCode(65 + temp) + letter;
    col = Math.floor((col - temp) / 26);
  }
  return letter;
}

/** Check if a column header looks like a non-summable identifier */
function isIdColumn(header) {
  if (!header) return false;
  const h = String(header).trim().toLowerCase();
  return (
    h === 'id' ||
    h === 'م' ||
    h === 'ت' ||
    h === 'كود' ||
    h === 'رمز' ||
    h === 'معرف' ||
    h.includes('معرف') ||
    h.includes('الرقم الإشاري') ||
    h.includes('رقم الهوية') ||
    h.includes('رقم الهاتف') ||
    h.includes('الرمز البريدي') ||
    h.includes('تاريخ') ||
    h.includes('date') ||
    h.includes('year') ||
    h.includes('سنة') ||
    h.includes('عام')
  );
}

/** Check if a column header implies monetary or numeric metrics */
function isMeasureColumn(header) {
  if (!header) return false;
  const h = String(header).trim().toLowerCase();
  return (
    h.includes('مبلغ') ||
    h.includes('سعر') ||
    h.includes('تكلفة') ||
    h.includes('قيمة') ||
    h.includes('إجمالي') ||
    h.includes('مجموع') ||
    h.includes('كمية') ||
    h.includes('عدد') ||
    h.includes('رصيد') ||
    h.includes('نسبة') ||
    h.includes('أرباح') ||
    h.includes('إيراد') ||
    h.includes('مصروف') ||
    h.includes('نفقات') ||
    h.includes('ميزانية') ||
    h.includes('total') ||
    h.includes('price') ||
    h.includes('amount') ||
    h.includes('cost') ||
    h.includes('qty') ||
    h.includes('quantity')
  );
}

/** Parse raw string into typed value + format hint */
function parseCellValue(raw) {
  if (raw === null || raw === undefined) {
    return { value: '', type: 'empty' };
  }
  const str = String(raw).trim();
  if (str === '') {
    return { value: '', type: 'empty' };
  }

  // 1. Percentage (e.g. "25.5%", "15%")
  const percentMatch = str.match(/^([+-]?\d+(?:\.\d+)?)\s*%$/);
  if (percentMatch) {
    const num = parseFloat(percentMatch[1]);
    if (!isNaN(num)) {
      return {
        value: num / 100,
        type: 'percentage',
        numFmt: percentMatch[1].includes('.') ? '0.0%' : '0%'
      };
    }
  }

  // 2. Pure or formatted numbers (e.g. "1,250,000", "450.75", "-120", "(300)")
  let cleanNumber = str.replace(/,/g, '');
  if (/^\([0-9.]+\)$/.test(cleanNumber)) {
    cleanNumber = '-' + cleanNumber.slice(1, -1);
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleanNumber)) {
    const num = Number(cleanNumber);
    if (!isNaN(num)) {
      const isDecimal = cleanNumber.includes('.');
      return {
        value: num,
        type: isDecimal ? 'decimal' : 'integer',
        numFmt: isDecimal ? '#,##0.00' : '#,##0'
      };
    }
  }

  // 3. Date pattern YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return { value: str, type: 'date' };
  }

  return { value: str, type: 'text' };
}

/**
 * Generate the high-grade official Excel workbook.
 *
 * @param {object} options
 * @param {string[][]} options.matrix        Parsed table matrix (headers + data rows).
 * @param {string} options.title             Document / table title.
 * @param {object} options.record            Registered record ({ ref, content_sha256, ... }).
 * @param {object} options.user              Issuing user.
 * @param {string} [options.classification]  Security classification.
 * @param {string} [options.ipAddress]       Caller IP address.
 * @returns {Promise<Buffer>}
 */
async function generateHighGradeWorkbook({
  matrix,
  title,
  record,
  user,
  classification = 'official',
  ipAddress = '127.0.0.1 (محلي معزول)'
}) {
  const workbook = new ExcelJS.Workbook();
  const issuer = user.display_name || user.username || 'مستخدم معتمد';
  const role = user.role || 'مسؤول النظام';
  const shortHash = (record.content_sha256 || '').slice(0, 16).toUpperCase();
  const fullHash = record.content_sha256 || 'غير محدد';
  const currentDateFormatted = formatArabicDate();
  const currentTimeFormatted = new Date().toLocaleTimeString('ar-SY', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  workbook.creator = 'منظومة شاهين للذكاء الاصطناعي';
  workbook.lastModifiedBy = issuer;
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.title = title || 'مصفوفة البيانات الرسمية';
  workbook.subject = 'مصفوفة بيانات رسمية معتمدة — الجمهورية العربية السورية';

  const headers = matrix[0] || [];
  const dataRows = matrix.slice(1);
  const columnCount = Math.max(headers.length, 1);
  const totalCols = Math.max(columnCount, 6);

  // Analyze columns for widths and sum suitability
  const columnStats = [];
  for (let c = 0; c < columnCount; c++) {
    const headerName = headers[c] || `عمود ${c + 1}`;
    let numericCount = 0;
    let maxCharLen = headerName.length;

    dataRows.forEach((row) => {
      const cellVal = row[c] || '';
      const parsed = parseCellValue(cellVal);
      if (parsed.type === 'integer' || parsed.type === 'decimal' || parsed.type === 'percentage') {
        numericCount++;
      }
      maxCharLen = Math.max(maxCharLen, String(cellVal).length);
    });

    const isNumeric = dataRows.length > 0 && numericCount / dataRows.length >= 0.7;
    const isId = isIdColumn(headerName);
    const isMeasure = isMeasureColumn(headerName);
    const shouldSum = isNumeric && !isId && (isMeasure || numericCount === dataRows.length);

    columnStats.push({
      header: headerName,
      isNumeric,
      isId,
      shouldSum,
      width: Math.min(Math.max(maxCharLen + 6, 15), 55)
    });
  }

  // =========================================================================
  // SHEET 1: مصفوفة البيانات الرسمية (Main Data Sheet)
  // =========================================================================
  const sheet = workbook.addWorksheet('مصفوفة البيانات الرسمية', {
    views: [{ rightToLeft: true, showGridLines: true, state: 'frozen', ySplit: 8 }]
  });

  // Set column widths
  for (let c = 1; c <= totalCols; c++) {
    const stat = columnStats[c - 1];
    sheet.getColumn(c).width = stat ? stat.width : 16;
  }

  // 1. Row 1: Top Sovereign Gold Accent Bar
  sheet.getRow(1).height = 6;
  for (let c = 1; c <= totalCols; c++) {
    sheet.getCell(1, c).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: PALETTE.BRAND_GOLD }
    };
  }

  // 2. Rows 2-4: Executive Official Header Banner
  sheet.getRow(2).height = 28;
  sheet.getRow(3).height = 24;
  sheet.getRow(4).height = 22;

  // Space for Logo in Column 1 (Rows 2-4)
  sheet.mergeCells(2, 1, 4, 1);
  const logoBuf = getLogoBuffer();
  if (logoBuf) {
    try {
      const logoId = workbook.addImage({ buffer: logoBuf, extension: 'png' });
      sheet.addImage(logoId, {
        tl: { col: 0.12, row: 1.15 },
        ext: { width: 72, height: 58 },
        editAs: 'oneCell'
      });
    } catch (_) {
      sheet.getCell(2, 1).value = '🦅 منظومة شاهين';
      sheet.getCell(2, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    }
  } else {
    sheet.getCell(2, 1).value = '🦅 منظومة شاهين';
    sheet.getCell(2, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  }

  // Central Title & Institutional Identity (Columns 2 to mid)
  const midColEnd = Math.max(2, Math.floor(totalCols * 0.65));
  sheet.mergeCells(2, 2, 2, midColEnd);
  sheet.getCell(2, 2).value = 'الجمهورية العربية السورية — الشركة السورية القابضة';
  sheet.getCell(2, 2).font = { name: 'Calibri', size: 13.5, bold: true, color: { argb: PALETTE.BRAND_EMERALD } };
  sheet.getCell(2, 2).alignment = { horizontal: 'right', vertical: 'middle' };

  sheet.mergeCells(3, 2, 3, midColEnd);
  sheet.getCell(3, 2).value = `منظومة شاهين للذكاء الاصطناعي — ${title || 'مصفوفة البيانات وجداول المؤشرات الرسمية'}`;
  sheet.getCell(3, 2).font = { name: 'Calibri', size: 12, bold: true, color: { argb: PALETTE.BRAND_GOLD_DARK } };
  sheet.getCell(3, 2).alignment = { horizontal: 'right', vertical: 'middle' };

  sheet.mergeCells(4, 2, 4, midColEnd);
  sheet.getCell(4, 2).value = 'وثيقة ومصفوفة بيانات رسمية صادرة آلياً — تخضع للمراجعة والتدقيق الإداري';
  sheet.getCell(4, 2).font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: PALETTE.TEXT_MUTED } };
  sheet.getCell(4, 2).alignment = { horizontal: 'right', vertical: 'middle' };

  // Metadata Block on Left (Columns mid+1 to totalCols)
  const metaColStart = midColEnd + 1;
  sheet.mergeCells(2, metaColStart, 2, totalCols);
  sheet.getCell(2, metaColStart).value = `الرقم الإشاري: ${record.ref}`;
  sheet.getCell(2, metaColStart).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: PALETTE.BRAND_EMERALD } };
  sheet.getCell(2, metaColStart).alignment = { horizontal: 'left', vertical: 'middle' };

  sheet.mergeCells(3, metaColStart, 3, totalCols);
  sheet.getCell(3, metaColStart).value = `تاريخ وتوقيت الإصدار: ${currentDateFormatted} (${currentTimeFormatted})`;
  sheet.getCell(3, metaColStart).font = { name: 'Calibri', size: 9.5, color: { argb: PALETTE.TEXT_MUTED } };
  sheet.getCell(3, metaColStart).alignment = { horizontal: 'left', vertical: 'middle' };

  sheet.mergeCells(4, metaColStart, 4, totalCols);
  sheet.getCell(4, metaColStart).value = `المستخدم المصرّح: ${issuer} (${role})`;
  sheet.getCell(4, metaColStart).font = { name: 'Calibri', size: 9.5, color: { argb: PALETTE.TEXT_MUTED } };
  sheet.getCell(4, metaColStart).alignment = { horizontal: 'left', vertical: 'middle' };

  // 3. Row 5: Separator line
  sheet.getRow(5).height = 4;
  for (let c = 1; c <= totalCols; c++) {
    sheet.getCell(5, c).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: PALETTE.BORDER_SOFT }
    };
  }

  // 4. Row 6: KPI & Integrity Ribbon
  sheet.getRow(6).height = 26;
  sheet.mergeCells(6, 1, 6, totalCols);
  const kpiCell = sheet.getCell(6, 1);
  const classLabel = classification === 'secret' ? 'سري للغاية' : classification === 'internal' ? 'للاستخدام الداخلي' : 'رسمي / للاستخدام المؤسسي';
  kpiCell.value = `📊 إجمالي السجلات: ${dataRows.length} صف  |  📋 عدد المؤشرات: ${columnCount} أعمدة  |  🛡️ درجة السرية: ${classLabel}  |  🔒 رمز البصمة الرقمية (SHA-256): ${shortHash}`;
  kpiCell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: PALETTE.BRAND_EMERALD } };
  kpiCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.BG_RIBBON } };
  kpiCell.alignment = { horizontal: 'center', vertical: 'middle' };
  kpiCell.border = {
    top: { style: 'thin', color: { argb: PALETTE.BORDER_CARD } },
    bottom: { style: 'thin', color: { argb: PALETTE.BORDER_CARD } }
  };

  // 5. Row 7: Blank spacer row
  sheet.getRow(7).height = 10;

  // 6. Row 8: Table Column Headers
  sheet.getRow(8).height = 32;
  for (let c = 1; c <= columnCount; c++) {
    const cell = sheet.getCell(8, c);
    cell.value = headers[c - 1] || `عمود ${c}`;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: PALETTE.TEXT_WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.BRAND_EMERALD } };
    cell.alignment = {
      horizontal: columnStats[c - 1]?.isNumeric ? 'center' : 'right',
      vertical: 'middle',
      wrapText: true
    };
    cell.border = {
      top: { style: 'medium', color: { argb: PALETTE.BRAND_DARK } },
      bottom: { style: 'medium', color: { argb: PALETTE.BRAND_GOLD } },
      left: { style: 'thin', color: { argb: PALETTE.BORDER_HEADER } },
      right: { style: 'thin', color: { argb: PALETTE.BORDER_HEADER } }
    };
  }

  // Activate Auto-Filter on header row
  sheet.autoFilter = {
    from: { row: 8, column: 1 },
    to: { row: 8, column: columnCount }
  };

  // 7. Rows 9 to (8 + dataRows.length): Data Rows
  let hasAnySum = false;
  dataRows.forEach((row, rowIndex) => {
    const rowNum = 9 + rowIndex;
    const excelRow = sheet.getRow(rowNum);
    excelRow.height = 23;
    const isEven = rowIndex % 2 === 0;
    const rowBg = isEven ? PALETTE.BG_ZEBRA_EVEN : PALETTE.BG_ZEBRA_ODD;

    for (let c = 1; c <= columnCount; c++) {
      const cell = sheet.getCell(rowNum, c);
      const rawVal = row[c - 1];
      const parsed = parseCellValue(rawVal);

      cell.value = parsed.value;
      cell.font = { name: 'Calibri', size: 10.5, color: { argb: PALETTE.TEXT_MAIN } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
      cell.border = {
        top: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } },
        bottom: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } },
        left: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } },
        right: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } }
      };

      if (parsed.numFmt) {
        cell.numFmt = parsed.numFmt;
      }

      if (parsed.type === 'integer' || parsed.type === 'decimal' || parsed.type === 'percentage') {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else if (parsed.type === 'date' || columnStats[c - 1]?.isId) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
      }
    }
  });

  // Check if any column is eligible for sum
  hasAnySum = columnStats.some((st) => st.shouldSum);

  let nextRow = 9 + dataRows.length;

  // 8. Totals / Summary Row (if numeric columns exist and rows > 0)
  if (hasAnySum && dataRows.length > 0) {
    const totalRow = sheet.getRow(nextRow);
    totalRow.height = 27;

    for (let c = 1; c <= columnCount; c++) {
      const cell = sheet.getCell(nextRow, c);
      const stat = columnStats[c - 1];
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: PALETTE.BRAND_EMERALD } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.BG_TOTALS } };
      cell.border = {
        top: { style: 'thin', color: { argb: PALETTE.BRAND_GOLD } },
        bottom: { style: 'double', color: { argb: PALETTE.BRAND_EMERALD } },
        left: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } },
        right: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } }
      };

      if (c === 1) {
        cell.value = stat.shouldSum ? { formula: `SUM(A9:A${nextRow - 1})` } : 'الإجمالي العام / المجموع';
        cell.alignment = { horizontal: stat.shouldSum ? 'right' : 'center', vertical: 'middle' };
        if (stat.shouldSum) cell.numFmt = '#,##0.00';
      } else if (stat.shouldSum) {
        const colLetter = colToLetter(c);
        cell.value = { formula: `SUM(${colLetter}9:${colLetter}${nextRow - 1})` };
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        cell.value = '';
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    }
    nextRow++;
  }

  // 9. Spacer row
  sheet.getRow(nextRow).height = 12;
  nextRow++;

  // 10. Official Sovereignty & Provenance Disclaimer Footer Box
  sheet.getRow(nextRow).height = 38;
  sheet.mergeCells(nextRow, 1, nextRow, totalCols);
  const footerCell = sheet.getCell(nextRow, 1);
  footerCell.value =
    `تنبيه سيادي وإداري: تم إنشاء هذه المصفوفة آلياً بواسطة منظومة شاهين للذكاء الاصطناعي (Shaheen AI Platform). تعد هذه الوثيقة مادة عمل استرشادية رسمية خاضعة للمراجعة والتدقيق، ولا يعتد بها أمام أي جهة قضائية أو إدارية إلا بعد التوقيع والختم الرسمي من المرجع المختص.  |  الرقم الإشاري المعتمد: ${record.ref}  |  البصمة الرقمية: ${shortHash}`;
  footerCell.font = { name: 'Calibri', size: 9, color: { argb: PALETTE.TEXT_MUTED } };
  footerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.BG_CARD } };
  footerCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  footerCell.border = {
    top: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } },
    bottom: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } },
    left: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } },
    right: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } }
  };

  // =========================================================================
  // SHEET 2: بطاقة الوثيقة وسجل التدقيق (Audit & Provenance Certificate)
  // =========================================================================
  const auditSheet = workbook.addWorksheet('بطاقة الوثيقة وسجل التدقيق', {
    views: [{ rightToLeft: true, showGridLines: true }]
  });

  auditSheet.getColumn(1).width = 8;
  auditSheet.getColumn(2).width = 28;
  auditSheet.getColumn(3).width = 65;
  auditSheet.getColumn(4).width = 8;

  // Gold accent bar
  auditSheet.getRow(1).height = 6;
  for (let c = 1; c <= 4; c++) {
    auditSheet.getCell(1, c).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: PALETTE.BRAND_GOLD }
    };
  }

  // Certificate Header
  auditSheet.getRow(2).height = 30;
  auditSheet.mergeCells(2, 2, 2, 3);
  const certHead1 = auditSheet.getCell(2, 2);
  certHead1.value = 'الجمهورية العربية السورية — منظومة شاهين للذكاء الاصطناعي';
  certHead1.font = { name: 'Calibri', size: 14, bold: true, color: { argb: PALETTE.BRAND_EMERALD } };
  certHead1.alignment = { horizontal: 'center', vertical: 'middle' };

  auditSheet.getRow(3).height = 24;
  auditSheet.mergeCells(3, 2, 3, 3);
  const certHead2 = auditSheet.getCell(3, 2);
  certHead2.value = 'بطاقة إثبات القيد في السجل الرقمي المركزي ومطابقة النزاهة الإلكترونية';
  certHead2.font = { name: 'Calibri', size: 11.5, bold: true, color: { argb: PALETTE.BRAND_GOLD_DARK } };
  certHead2.alignment = { horizontal: 'center', vertical: 'middle' };

  auditSheet.getRow(4).height = 12;

  // Audit Table Data
  const auditItems = [
    { label: 'الرقم الإشاري المعتمد (Reference)', value: record.ref, isBold: true, isEmerald: true },
    { label: 'عنوان المصفوفة والبيانات', value: title || 'مصفوفة بيانات رسمية' },
    { label: 'المستخدم المصرّح بالتصدير', value: `${issuer} (${user.username || 'user'})` },
    { label: 'الدور والصفة الإدارية', value: role },
    { label: 'عنوان بروتوكول الإنترنت (IP)', value: ipAddress },
    { label: 'تاريخ ووقت الإصدار المحلي', value: `${currentDateFormatted} في تمام الساعة ${currentTimeFormatted}` },
    { label: 'التوقيت الزمني القياسي الموحد (UTC)', value: new Date().toISOString() },
    { label: 'درجة السرية والتصنيف الأمني', value: classLabel, isBold: true },
    { label: 'حالة القيد في سجل الوثائق', value: '✅ مسجل ومحفوظ نظامياً في قاعدة البيانات السيادية (document_registry)' },
    { label: 'البصمة الرقمية للبيانات (SHA-256 Checksum)', value: fullHash, isCode: true },
    { label: 'إجمالي عدد السجلات (الصفوف)', value: `${dataRows.length} سجل` },
    { label: 'إجمالي عدد الحقول (الأعمدة)', value: `${columnCount} حقل / مؤشر` },
    { label: 'مسار التحقق الإلكتروني المعتمد', value: `/api/export/verify/${record.ref}` },
    { label: 'مستوى العزل والسيادة الوطنية', value: 'معزول محلياً بنسبة 100% — خالٍ من أي اتصالات خارجية أو استدعاءات عبر الإنترنت' },
    { label: 'الأثر القانوني والصفة الرسمية', value: 'مسودة عمل صادرة آلياً — لا تكتسب قوتها التنفيذية إلا بعد توقيعها واعتمادها أصولاً' }
  ];

  let certRow = 5;
  auditItems.forEach((item) => {
    auditSheet.getRow(certRow).height = 24;

    const labelCell = auditSheet.getCell(certRow, 2);
    labelCell.value = item.label;
    labelCell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: PALETTE.BRAND_EMERALD } };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.BG_RIBBON } };
    labelCell.alignment = { horizontal: 'right', vertical: 'middle' };
    labelCell.border = {
      top: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } },
      bottom: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } },
      left: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } },
      right: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } }
    };

    const valCell = auditSheet.getCell(certRow, 3);
    valCell.value = item.value;
    valCell.font = {
      name: item.isCode ? 'Consolas' : 'Calibri',
      size: item.isCode ? 9.5 : 10.5,
      bold: Boolean(item.isBold),
      color: { argb: item.isEmerald ? PALETTE.BRAND_EMERALD : PALETTE.TEXT_MAIN }
    };
    valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.BG_ZEBRA_EVEN } };
    valCell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    valCell.border = {
      top: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } },
      bottom: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } },
      left: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } },
      right: { style: 'thin', color: { argb: PALETTE.BORDER_SOFT } }
    };

    certRow++;
  });

  // Official Seal & Signature Placeholder Box
  certRow++;
  auditSheet.getRow(certRow).height = 14;
  certRow++;

  auditSheet.mergeCells(certRow, 2, certRow + 3, 2);
  const stampCell = auditSheet.getCell(certRow, 2);
  stampCell.value = 'خاتم الجهة المختصة\n(Official Seal)';
  stampCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: PALETTE.TEXT_MUTED } };
  stampCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  stampCell.border = {
    top: { style: 'dashed', color: { argb: PALETTE.BRAND_GOLD } },
    bottom: { style: 'dashed', color: { argb: PALETTE.BRAND_GOLD } },
    left: { style: 'dashed', color: { argb: PALETTE.BRAND_GOLD } },
    right: { style: 'dashed', color: { argb: PALETTE.BRAND_GOLD } }
  };

  auditSheet.mergeCells(certRow, 3, certRow + 3, 3);
  const signCell = auditSheet.getCell(certRow, 3);
  signCell.value = 'تأشير وتوقيع المرجع الإداري المختص للاعتماد:\n\nالاسم والصفة: ...........................................................   التاريخ: .... / .... / 2026';
  signCell.font = { name: 'Calibri', size: 10, color: { argb: PALETTE.TEXT_MAIN } };
  signCell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  signCell.border = {
    top: { style: 'dashed', color: { argb: PALETTE.BRAND_GOLD } },
    bottom: { style: 'dashed', color: { argb: PALETTE.BRAND_GOLD } },
    left: { style: 'dashed', color: { argb: PALETTE.BRAND_GOLD } },
    right: { style: 'dashed', color: { argb: PALETTE.BRAND_GOLD } }
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = {
  generateHighGradeWorkbook,
  parseCellValue,
  colToLetter
};
