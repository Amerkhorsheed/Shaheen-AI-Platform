// Syrian Sovereign Government Export Service (PDF Print & Native Excel .xlsx / CSV Auto-Save)
const XLSX = require('xlsx');

// High Definition Syrian Golden Eagle Vector with 3 Stars
const SYRIAN_EAGLE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 212.66 159.58" width="80" height="60" fill="#B79E6A">
  <path d="m 174.75,64.76 c -0.51,0.49 -1.03,0.97 -1.56,1.43 l 24.97,37.26 -9.49,-1.27 c -3.07,-0.41 -5.78,-2.23 -7.32,-4.92 l -14.9,-25.99 c -0.59,0.38 -1.19,0.75 -1.8,1.1 l 23.89,43.44 -9.5,-1.91 c -3.11,-0.63 -5.74,-2.7 -7.07,-5.58 L 157.07,76.1 c -0.65,0.27 -1.31,0.52 -1.98,0.76 l 15.62,35.35 -7.25,-1.46 c -3.41,-0.69 -6.22,-3.11 -7.4,-6.38 l -9.1,-25.26 c -0.69,0.14 -1.39,0.26 -2.08,0.37 l 10.07,29.57 -5.42,-1.09 c -3.72,-0.75 -6.68,-3.55 -7.65,-7.21 l -5.19,-19.61 v 0 c -0.67,0.18 -1.33,0.38 -1.98,0.6 l 6.01,24.45 -3.88,-0.78 C 132.81,104.6 129.7,101.4 129,97.35 l -2.15,-12.43 -3.71,8.6 c -0.41,0.96 -0.31,2.06 0.26,2.93 l 11.44,17.23 c 0.16,0.24 0.25,0.51 0.27,0.8 l 0.22,3.26 7.21,7.21 h 16.95 v 7.4 l -3.61,-3.61 h -3.98 l 3.78,3.78 -4.12,4.12 v -4.12 l -3.79,-3.78 h -3.64 l -3.79,3.78 v 3.26 l -4.4,-4.41 3.82,-3.72 -6.73,-6.73 -2.42,0.27 c -0.38,0.04 -0.77,-0.05 -1.09,-0.26 l -14.15,-9.4 10.17,13.73 16.19,21.87 h -6.83 c -3.87,0 -7.39,-2.25 -9.02,-5.76 l -5.94,-12.77 c -0.56,0.26 -1.13,0.51 -1.7,0.73 l 9.53,24.02 h -3.29 c -4.81,0 -8.93,-3.44 -9.79,-8.17 l -2.57,-14.1 c -0.56,0.1 -1.12,0.19 -1.7,0.26 l 2.15,16.84 c 0.41,3.24 -0.79,6.47 -3.21,8.66 l -3.04,2.74 -3.04,-2.74 c -2.42,-2.18 -3.62,-5.42 -3.21,-8.65 l 2.15,-16.84 c -0.57,-0.07 -1.13,-0.16 -1.7,-0.26 l -2.57,14.1 c -0.86,4.73 -4.98,8.17 -9.79,8.17 h -3.29 l 9.53,-24.02 c -0.57,-0.22 -1.14,-0.47 -1.7,-0.73 l -5.94,12.77 c -1.63,3.51 -5.15,5.76 -9.02,5.76 h -6.83 l 16.19,-21.87 10.17,-13.73 -14.15,9.4 c -0.32,0.21 -0.71,0.31 -1.09,0.26 l -2.42,-0.27 -6.73,6.73 3.82,3.72 -4.4,4.41 v -3.26 l -3.79,-3.78 h -3.64 l -3.79,3.78 v 4.12 l -4.12,-4.12 3.78,-3.78 h -3.98 l -3.61,3.61 v -7.4 H 70.1 l 7.21,-7.21 0.23,-3.26 c 0.02,-0.28 0.11,-0.56 0.27,-0.79 L 89.25,96.47 c 0.58,-0.87 0.68,-1.97 0.26,-2.93 L 85.8,84.93 v 0 l -2.15,12.43 c -0.7,4.05 -3.82,7.25 -7.85,8.06 l -3.87,0.78 6.01,-24.46 c -0.65,-0.22 -1.32,-0.41 -1.99,-0.6 l -5.18,19.62 c -0.97,3.67 -3.94,6.47 -7.66,7.21 l -5.42,1.09 10.08,-29.57 c -0.7,-0.1 -1.39,-0.23 -2.08,-0.36 l -9.1,25.27 c -1.18,3.28 -3.99,5.7 -7.4,6.38 l -7.25,1.46 15.61,-35.37 c -0.67,-0.23 -1.32,-0.49 -1.97,-0.75 l -14.9,32.21 c -1.33,2.88 -3.96,4.95 -7.07,5.58 L 24.1,115.82 48.01,72.38 C 47.4,72.03 46.8,71.66 46.21,71.27 l -14.9,26 c -1.54,2.69 -4.25,4.51 -7.32,4.92 L 14.5,103.46 39.47,66.19 C 38.94,65.73 38.42,65.25 37.9,64.76 L 23.84,84.97 c -1.73,2.49 -4.49,4.05 -7.52,4.25 L 6.99,89.84 32.21,58.5 C 31.77,57.95 31.35,57.38 30.93,56.8 L 16.94,73.58 c -1.89,2.27 -4.69,3.58 -7.64,3.58 H 0 L 44.7,30.58 c 2.41,-2.51 5.73,-3.93 9.21,-3.93 h 9.97 c 2.67,0 4.83,2.16 4.83,4.83 v 5.63 c 0,4.54 1.52,8.72 4.06,12.07 3.64,4.8 9.41,7.9 15.91,7.9 1.44,0 2.85,-0.16 4.21,-0.45 1.08,-0.23 1.96,-1.03 2.25,-2.1 l 3.54,-12.81 c 0.05,-0.23 0.06,-0.47 0.02,-0.7 -0.24,-1.55 -2.34,-2.52 -4.7,-2.16 -1.89,0.28 -3.595994,1.18797 -4.036671,2.54 0,0 -0.763329,-2.04 -0.783329,-3.56 -0.03,-1.96 0.81,-3.05 2.71,-4.01 l 3.3,-1.55 c 2.08,-1.91 5.46,-3.14 9.3,-3.14 5.9,0 10.76,2.93 11.38,6.72 l 0.06,0.46 2.39,17.98 c 0.17,1.28 1.16,2.31 2.44,2.52 1.05,0.17 2.12,0.26 3.22,0.26 6.49,0 12.26,-3.09 15.91,-7.9 2.55,-3.35 4.06,-7.53 4.06,-12.07 v -5.63 c 0,-2.67 2.16,-4.83 4.83,-4.83 h 9.97 c 3.48,0 6.8,1.42 9.21,3.93 l 44.7,46.58 h -9.28 c -2.95,0 -5.75,-1.31 -7.64,-3.58 l -14,-16.78 c -0.41,0.57 -0.83,1.14 -1.27,1.7 l 25.21,31.34 -9.34,-0.62 c -3.02,-0.2 -5.79,-1.76 -7.52,-4.25 L 174.76,64.76 Z"/>
  <polygon points="100.41 18.2 106.32 13.9 112.23 18.2 109.97 11.25 115.88 6.95 108.58 6.95 106.32 0 104.06 6.95 96.76 6.95 102.67 11.25 100.41 18.2"/>
  <polygon points="129.94 18.38 133.72 24.63 134.33 17.34 141.44 15.67 134.71 12.84 135.32 5.56 130.55 11.09 123.81 8.26 127.6 14.52 122.82 20.05 129.94 18.38"/>
  <polygon points="78.31 17.35 78.85 24.64 82.7 18.43 89.79 20.17 85.07 14.59 88.91 8.38 82.16 11.14 77.44 5.56 77.98 12.84 71.21 15.61 78.31 17.35"/>
</svg>
`;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Parse CSV text into array of rows and cells
function parseCsvToMatrix(csvText) {
  if (!csvText) return [];
  const lines = csvText.split(/\r\n|\n|\r/);
  const matrix = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    // Simple CSV parser handling quotes
    const row = [];
    let inQuotes = false;
    let currentVal = '';

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          currentVal += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(currentVal.trim());
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
    row.push(currentVal.trim());
    matrix.push(row);
  }
  return matrix;
}

function registerExportRoutes(app) {
  // 1. Official Syrian State PDF Decree / Document Print Template
  app.post('/api/export/pdf-page', (req, res) => {
    const { 
      title = 'وثيقة ومذكرة رسمية صادرة عن المنظومة', 
      content = '', 
      metadata = {} 
    } = req.body;

    let meta = metadata;
    if (typeof metadata === 'string') {
      try { meta = JSON.parse(metadata); } catch (e) { meta = {}; }
    }

    const classification = meta.classification || 'official';
    
    const classConfig = {
      top_secret: { label: 'سري للغاية ومكتوم', color: '#8A1B1B', bg: '#FDF2F2', border: '#F8B4B4' },
      secret: { label: 'سري وخاص', color: '#8A6A12', bg: '#FCF7EA', border: '#F4D89A' },
      official: { label: 'رسمي وموثق', color: '#02443A', bg: '#E7F0EA', border: '#A6D0BA' },
      unclassified: { label: 'غير مصنف', color: '#5E6B64', bg: '#F0EDE4', border: '#DDD8CA' }
    }[classification] || { label: 'رسمي وموثق', color: '#02443A', bg: '#E7F0EA', border: '#A6D0BA' };

    const now = new Date();
    const gregorianDate = now.toLocaleDateString('ar-SY', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const docRef = meta.docRef || `SY-GOV-${now.getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const securityHash = 'SHN-' + Math.random().toString(36).substring(2, 10).toUpperCase();

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — الجمهورية العربية السورية</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @font-face {
      font-family: 'Qomariah Arabic';
      src: url('/fonts/QomariahArabic-PV2Kx.ttf') format('truetype');
      font-weight: 100 900;
      font-style: normal;
    }
    @font-face {
      font-family: 'Qomra';
      src: url('/fonts/itfQomraArabic-Bold.otf') format('opentype');
      font-weight: 700;
      font-style: normal;
    }

    :root {
      --color-brand: #02443A;
      --color-brand-deep: #002723;
      --color-gold: #B79E6A;
      --color-gold-dark: #7A6A45;
      --color-canvas: #F7F5EF;
      --color-ink: #14201C;
      --color-ink-secondary: #5E6B64;
      --color-border: #DDD8CA;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'IBM Plex Sans Arabic', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #F7F5EF;
      color: var(--color-ink);
      line-height: 1.8;
      direction: rtl;
      text-align: right;
      padding: 24px 16px;
    }

    .print-control-bar {
      max-width: 900px;
      margin: 0 auto 20px auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #FFFFFF;
      padding: 14px 24px;
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.06);
      border: 1px solid var(--color-border);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 22px;
      border-radius: 6px;
      font-family: inherit;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .btn-primary { background: #02443A; color: #FFFFFF; }
    .btn-primary:hover { background: #002723; }
    .btn-secondary { background: #F0EDE4; color: #02443A; border: 1px solid var(--color-border); }
    .btn-secondary:hover { background: #EBE6D9; }

    .syrian-official-page {
      max-width: 900px;
      margin: 0 auto;
      background: #FFFFFF;
      border: 1px solid #D1CBBB;
      box-shadow: 0 4px 24px rgba(0,0,0,0.05);
      position: relative;
      padding: 55px 65px;
      min-height: 1120px;
    }

    .watermark-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      opacity: 0.035;
      font-size: 42px;
      font-weight: 900;
      color: #02443A;
      transform: rotate(-30deg);
      user-select: none;
      z-index: 0;
      white-space: nowrap;
    }

    .content-wrapper { position: relative; z-index: 1; }

    .state-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px double #B79E6A;
      padding-bottom: 20px;
      margin-bottom: 25px;
    }

    .header-right {
      width: 33%;
      font-size: 13px;
      line-height: 1.6;
      color: #02443A;
      font-weight: 700;
      font-family: 'Qomariah Arabic', 'Qomra', 'IBM Plex Sans Arabic', sans-serif;
    }
    .header-right span { display: block; color: var(--color-gold-dark); font-size: 11px; font-weight: 600; margin-top: 2px; }

    .header-center { width: 34%; text-align: center; display: flex; flex-direction: column; align-items: center; }
    .header-center .eagle-emblem { margin-bottom: 6px; }
    .header-center .platform-title {
      font-size: 15px;
      font-weight: 700;
      color: #02443A;
      letter-spacing: -0.2px;
      font-family: 'Qomariah Arabic', 'Qomra', 'IBM Plex Sans Arabic', sans-serif;
    }

    .header-left { width: 33%; text-align: left; font-size: 11px; color: var(--color-ink-secondary); line-height: 1.7; }
    .header-left strong { color: #02443A; }

    .classification-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: ${classConfig.bg};
      border: 1px solid ${classConfig.border};
      color: ${classConfig.color};
      padding: 6px 16px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 25px;
    }

    .doc-main-title {
      font-size: 20px;
      font-weight: 700;
      color: #02443A;
      margin-bottom: 24px;
      padding-bottom: 8px;
      border-bottom: 1px solid #EBE6D9;
      letter-spacing: -0.3px;
      font-family: 'Qomariah Arabic', 'Qomra', 'IBM Plex Sans Arabic', sans-serif;
    }

    .doc-body { font-size: 14.5px; line-height: 1.85; color: #14201C; white-space: pre-wrap; word-break: break-word; }
    .doc-body h1, .doc-body h2, .doc-body h3 { color: #02443A; margin: 22px 0 10px 0; font-weight: 700; }
    .doc-body h1 { font-size: 18px; }
    .doc-body h2 { font-size: 16px; }
    .doc-body h3 { font-size: 14.5px; }
    .doc-body p { margin-bottom: 14px; text-align: justify; }

    .doc-body table { width: 100%; border-collapse: collapse; margin: 22px 0; font-size: 13px; border: 1px solid #DDD8CA; }
    .doc-body th { background-color: #02443A; color: #FFFFFF; padding: 10px 14px; font-weight: 700; border: 1px solid #002723; text-align: right; }
    .doc-body td { padding: 9px 14px; border: 1px solid #DDD8CA; }
    .doc-body tr:nth-child(even) td { background-color: #FBFAF6; }

    .official-closing { margin-top: 60px; padding-top: 25px; border-top: 2px solid #EBE6D9; display: flex; justify-content: space-between; align-items: flex-end; }
    .seal-box { border: 2px dashed #B79E6A; padding: 14px 20px; border-radius: 8px; text-align: center; background: #FBFAF6; width: 250px; }
    .seal-box .seal-title { font-size: 11px; font-weight: 700; color: #02443A; margin-bottom: 4px; }
    .seal-box .seal-hash { font-family: monospace; font-size: 10px; color: var(--color-gold-dark); letter-spacing: 1px; }

    .signature-area { text-align: center; width: 250px; }
    .signature-area .sig-title { font-size: 13px; font-weight: 700; color: #02443A; margin-bottom: 40px; }
    .signature-area .sig-name { font-size: 12px; color: var(--color-ink-secondary); border-top: 1px solid #DDD8CA; padding-top: 6px; }

    .official-footer { margin-top: 40px; border-top: 1px solid #DDD8CA; padding-top: 12px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--color-ink-secondary); }

    @media print {
      @page { size: A4; margin: 12mm 15mm; }
      body { background: transparent !important; padding: 0 !important; }
      .print-control-bar { display: none !important; }
      .syrian-official-page { border: none !important; box-shadow: none !important; padding: 0 !important; width: 100% !important; max-width: 100% !important; min-height: auto !important; }
    }
  </style>
</head>
<body>
  <div class="print-control-bar">
    <div style="display: flex; align-items: center; gap: 10px;">
      <span style="font-size: 18px;">🏛️</span>
      <div>
        <div style="font-size: 14px; font-weight: 700; color: #02443A; font-family: 'Qomariah Arabic', sans-serif;">
          وثيقة رسمية جاهزة للطباعة والحفظ بصيغة PDF
        </div>
        <div style="font-size: 11px; color: #5E6B64;">
          الجمهورية العربية السورية — منظومة OSS للذكاء الاصطناعي
        </div>
      </div>
    </div>
    <div style="display: flex; gap: 10px;">
      <button class="btn btn-primary" onclick="window.print()">
        <span>🖨️</span>
        <span>طباعة / حفظ كـ PDF</span>
      </button>
      <button class="btn btn-secondary" onclick="window.close()">إغلاق النافذة</button>
    </div>
  </div>

  <div class="syrian-official-page">
    <div class="watermark-overlay">الجمهورية العربية السورية — وثيقة رسمية</div>
    <div class="content-wrapper">
      <header class="state-header">
        <div class="header-right">
          <div>الجمهورية العربية السورية</div>
          <div>رئاسة مجلس الوزراء</div>
          <span>الهيئة الوطنية للتحول الرقمي والذكاء الاصطناعي</span>
          <span>الإدارة العامة للدراسات والاستراتيجيات</span>
        </div>
        <div class="header-center">
          <div class="eagle-emblem">${SYRIAN_EAGLE_SVG}</div>
          <div class="platform-title">منظومة OSS</div>
        </div>
        <div class="header-left">
          <div><strong>الرقم الإشاري:</strong> ${docRef}</div>
          <div><strong>التاريخ:</strong> ${gregorianDate}</div>
          <div><strong>المرفقات:</strong> محضر تحليل ومخرجات إلكترونية</div>
          <div><strong>النموذج:</strong> ${escapeHtml(meta.model || 'النموذج المحلي المعتمد')}</div>
        </div>
      </header>

      <div class="classification-strip">
        <span>درجة السرية والتصنيف: [ ${classConfig.label} ]</span>
        <span>الرمز الأمني: ${securityHash}</span>
        <span>البيئة: محلية معزولة 100%</span>
      </div>

      <h1 class="doc-main-title">${escapeHtml(title)}</h1>

      <main class="doc-body">${content}</main>

      <div class="official-closing">
        <div class="seal-box">
          <div style="margin-bottom: 6px;">${SYRIAN_EAGLE_SVG.replace('width="80" height="60"', 'width="44" height="32"')}</div>
          <div class="seal-title">خاتم الاعتماد والتوثيق الإلكتروني</div>
          <div class="seal-hash">HASH: ${securityHash}</div>
          <div style="font-size: 9px; color: #7A7A7B; margin-top: 4px;">وثيقة معتمدة ومحفوظة بالسجل المحلي الموحد</div>
        </div>
        <div class="signature-area">
          <div class="sig-title">المستشار / رئيس وحدة التحليل والبيانات</div>
          <div class="sig-name">معتمد وموثق رقمياً عبر منظومة OSS</div>
        </div>
      </div>

      <footer class="official-footer">
        <div>الجمهورية العربية السورية — وثيقة رسمية إلكترونية صادرة عن المنظومة المعزولة.</div>
        <div>صفحة 1 من 1</div>
      </footer>
    </div>
  </div>

  <script>
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => { window.print(); }, 700);
    });
  </script>
</body>
</html>`;

    res.send(html);
  });

  // 2. Direct Formatted Native Microsoft Excel (.xlsx) Binary Download
  app.post('/api/export/xlsx', (req, res) => {
    const { 
      csvData = '', 
      filename = 'shaheen_gov_data.xlsx', 
      title = 'مصفوفة البيانات وجداول المؤشرات الرسمية' 
    } = req.body;

    const matrix = parseCsvToMatrix(csvData);
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-SY', { year: 'numeric', month: 'long', day: 'numeric' });
    const docRef = `SY-GOV-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Build Institutional Sheet with Official Syrian Header Rows
    const sheetData = [
      ['الجمهورية العربية السورية — رئاسة مجلس الوزراء'],
      ['منظومة OSS للذكاء الاصطناعي — جدول بيانات رسمي'],
      [`الرقم الإشاري: ${docRef} | تاريخ الإصدار: ${dateStr} | التصنيف: رسمي وموثق`],
      [], // blank separator
      ...matrix
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Set Sheet View to RTL (Right-To-Left for Arabic Excel)
    ws['!views'] = [{ rightToLeft: true }];

    // Auto-calculate column widths based on max content
    const colWidths = [];
    sheetData.forEach(row => {
      row.forEach((cell, colIdx) => {
        const len = cell ? String(cell).length : 10;
        colWidths[colIdx] = Math.max(colWidths[colIdx] || 12, Math.min(len + 4, 45));
      });
    });
    ws['!cols'] = colWidths.map(w => ({ wch: w }));

    XLSX.utils.book_append_sheet(wb, ws, 'البيانات الرسمية');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const safeFilename = filename.endsWith('.xlsx') ? filename : `${filename.replace(/\.csv$/, '')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    res.send(buffer);
  });

  // 3. Official Syrian Government Table Inspection & Excel Export Portal
  app.post('/api/export/csv-page', (req, res) => {
    const { 
      csvData = '', 
      filename = 'shaheen_gov_table.csv', 
      tableTitle = 'مصفوفة البيانات وجداول المؤشرات الرسمية' 
    } = req.body;

    const matrix = parseCsvToMatrix(csvData);
    const headers = matrix.length > 0 ? matrix[0] : [];
    const rows = matrix.length > 1 ? matrix.slice(1) : [];

    const now = new Date();
    const gregorianDate = now.toLocaleDateString('ar-SY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const docRef = `SY-DATA-${now.getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>بوابة تصدير وتحليل جداول البيانات — ${escapeHtml(tableTitle)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @font-face {
      font-family: 'Qomariah Arabic';
      src: url('/fonts/QomariahArabic-PV2Kx.ttf') format('truetype');
      font-weight: 100 900;
      font-style: normal;
    }

    :root {
      --color-brand: #02443A;
      --color-brand-deep: #002723;
      --color-gold: #B79E6A;
      --color-canvas: #F7F5EF;
      --color-ink: #14201C;
      --color-border: #DDD8CA;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'IBM Plex Sans Arabic', sans-serif;
      background-color: #F7F5EF;
      color: #14201C;
      direction: rtl;
      padding: 30px 20px;
    }

    .portal-container {
      max-width: 1100px;
      margin: 0 auto;
      background: #FFFFFF;
      border: 1px solid #D1CBBB;
      border-radius: 14px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.06);
      overflow: hidden;
    }

    .state-banner {
      background: linear-gradient(135deg, #02443A, #0A241C);
      color: #FFFFFF;
      padding: 24px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid #B79E6A;
    }

    .brand-group {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .banner-text h1 {
      font-size: 19px;
      font-weight: 700;
      color: #E8D9A8;
      font-family: 'Qomariah Arabic', sans-serif;
      margin-bottom: 4px;
    }

    .banner-text p {
      font-size: 12px;
      color: #CFC49E;
    }

    .meta-group {
      text-align: left;
      font-size: 12px;
      color: #E8D9A8;
      line-height: 1.6;
    }

    .action-panel {
      background: #FBFAF6;
      border-bottom: 1px solid #E4E0D6;
      padding: 16px 32px;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 8px;
      font-family: inherit;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
      text-decoration: none;
    }

    .btn-excel {
      background: #107C41;
      color: #FFFFFF;
      box-shadow: 0 2px 8px rgba(16, 124, 65, 0.25);
    }
    .btn-excel:hover { background: #0c5c30; }

    .btn-csv {
      background: #02443A;
      color: #E8D9A8;
    }
    .btn-csv:hover { background: #002723; }

    .btn-print {
      background: #F0EDE4;
      color: #02443A;
      border: 1px solid #DDD8CA;
    }
    .btn-print:hover { background: #EBE6D9; }

    .table-wrapper {
      padding: 24px 32px;
    }

    .table-header-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .badge-status {
      display: inline-block;
      padding: 4px 12px;
      background: #E7F0EA;
      color: #2E6B4F;
      border-radius: 20px;
      font-weight: 700;
      font-size: 12px;
      border: 1px solid #A6D0BA;
    }

    .search-box {
      width: 260px;
      padding: 8px 14px;
      border: 1px solid #DDD8CA;
      border-radius: 8px;
      font-family: inherit;
      font-size: 12px;
      background: #FBFAF6;
    }
    .search-box:focus { outline: none; border-color: #B79E6A; }

    table.gov-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #DDD8CA;
      font-size: 13.5px;
      border-radius: 8px;
      overflow: hidden;
    }

    table.gov-table th {
      background: #02443A;
      color: #FFFFFF;
      padding: 12px 16px;
      font-weight: 700;
      text-align: right;
      border: 1px solid #002723;
      font-family: 'Qomariah Arabic', sans-serif;
    }

    table.gov-table td {
      padding: 11px 16px;
      border: 1px solid #E4E0D6;
    }

    table.gov-table tbody tr:nth-child(even) { background-color: #FBFAF6; }
    table.gov-table tbody tr:hover { background-color: #F0EDE4; }

    .portal-footer {
      background: #FBFAF6;
      border-top: 1px solid #E4E0D6;
      padding: 14px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #5E6B64;
    }
  </style>
</head>
<body>
  <div class="portal-container">
    <!-- State Top Banner -->
    <header class="state-banner">
      <div class="brand-group">
        <div style="background: rgba(255,255,255,0.08); padding: 8px; border-radius: 10px; border: 1px solid rgba(183,158,106,0.4);">
          ${SYRIAN_EAGLE_SVG.replace('width="80" height="60"', 'width="60" height="44"')}
        </div>
        <div class="banner-text">
          <h1>بوابة تصدير وتحليل البيانات الحكومية</h1>
          <p>الجمهورية العربية السورية — منظومة OSS للذكاء الاصطناعي</p>
        </div>
      </div>
      <div class="meta-group">
        <div><strong>الرقم الإشاري:</strong> ${docRef}</div>
        <div><strong>التاريخ:</strong> ${gregorianDate}</div>
        <div><strong>الحالة:</strong> بيانات مدققة وموثقة</div>
      </div>
    </header>

    <!-- High-End Action Panel with Genuine Excel (.xlsx) and CSV -->
    <div class="action-panel">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-weight: 700; font-size: 13px; color: #02443A;">خيارات التصدير المباشر:</span>
        <button class="btn btn-excel" id="downloadXlsxBtn">
          <span>📗</span>
          <span>تحميل مصنّف Excel رسمي (.xlsx)</span>
        </button>
        <button class="btn btn-csv" id="downloadCsvBtn">
          <span>📄</span>
          <span>تحميل ملف CSV (ترميز UTF-8 مع BOM)</span>
        </button>
      </div>

      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="btn btn-print" onclick="window.print()">
          <span>🖨️</span>
          <span>طباعة الجدول</span>
        </button>
        <button class="btn btn-print" onclick="window.close()">إغلاق</button>
      </div>
    </div>

    <!-- Main Table View -->
    <main class="table-wrapper">
      <div class="table-header-info">
        <div>
          <span class="badge-status">إجمالي السجلات: ${rows.length} صف | ${headers.length} أعمدة</span>
        </div>
        <div>
          <input type="text" id="tableSearch" class="search-box" placeholder="تصفية وبحث في الجدول...">
        </div>
      </div>

      <div style="overflow-x: auto;">
        <table class="gov-table" id="dataTable">
          <thead>
            <tr>
              ${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                ${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </main>

    <!-- Footer -->
    <footer class="portal-footer">
      <div>وثيقة بيانات رسمية صادرة محلياً — متوافقة كلياً مع Microsoft Excel والأنظمة الإحصائية المؤسسية.</div>
      <div>الجمهورية العربية السورية</div>
    </footer>
  </div>

  <!-- Hidden Form for XLSX download -->
  <form id="xlsxForm" method="POST" action="/api/export/xlsx" style="display:none;">
    <input type="hidden" name="csvData" value="${escapeHtml(csvData)}">
    <input type="hidden" name="filename" value="${escapeHtml(filename.replace(/\.csv$/, '.xlsx'))}">
    <input type="hidden" name="title" value="${escapeHtml(tableTitle)}">
  </form>

  <script>
    const rawCsv = ${JSON.stringify(csvData)};
    const downloadCsvFilename = ${JSON.stringify(filename)};

    // 1. Download CSV with UTF-8 BOM
    function downloadCsv() {
      const bom = '\\uFEFF';
      const blob = new Blob([bom + rawCsv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', downloadCsvFilename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    // 2. Download Native XLSX
    function downloadXlsx() {
      document.getElementById('xlsxForm').submit();
    }

    document.getElementById('downloadCsvBtn').addEventListener('click', downloadCsv);
    document.getElementById('downloadXlsxBtn').addEventListener('click', downloadXlsx);

    // 3. Search / Filter table
    document.getElementById('tableSearch').addEventListener('input', function(e) {
      const q = e.target.value.toLowerCase();
      const trs = document.querySelectorAll('#dataTable tbody tr');
      trs.forEach(tr => {
        const text = tr.innerText.toLowerCase();
        tr.style.display = text.includes(q) ? '' : 'none';
      });
    });

    // Auto-download XLSX immediately after opening
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        downloadXlsx();
      }, 500);
    });
  </script>
</body>
</html>`;

    res.send(html);
  });
}

module.exports = {
  registerExportRoutes,
  SYRIAN_EAGLE_SVG
};
