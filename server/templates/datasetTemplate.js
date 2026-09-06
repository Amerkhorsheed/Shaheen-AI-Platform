'use strict';

/**
 * Table inspection and export portal.
 *
 * Like the document template this is a pure function. Cell values are escaped
 * individually; nothing from the dataset reaches the page as markup.
 */

const { escapeHtml } = require('../lib/html');
const { eagleEmblem } = require('./assets');
const { formatArabicDate } = require('./classifications');

/**
 * @param {object} params
 * @param {string[][]} params.matrix   Parsed CSV, first row treated as headers.
 * @param {string} params.csvData      Original CSV, embedded for client-side download.
 * @param {string} params.tableTitle
 * @param {string} params.filename
 * @param {string} params.ref          Registry reference.
 * @param {string} params.issuedBy
 * @param {string} params.nestedTicket Single-use ticket for the .xlsx form.
 * @param {string} params.nonce        CSP nonce.
 */
function renderDataset({ matrix, csvData, tableTitle, filename, ref, issuedBy, nestedTicket, nonce }) {
  const headers = matrix[0] || [];
  const rows = matrix.slice(1);

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>بوابة تصدير البيانات — ${escapeHtml(tableTitle)}</title>
  <style>
    @font-face { font-family:'Qomariah Arabic'; src:url('/fonts/QomariahArabic-PV2Kx.ttf') format('truetype'); font-weight:100 900; font-display:swap; }
    @font-face { font-family:'Qomra'; src:url('/fonts/itfQomraArabic-Regular.otf') format('opentype'); font-weight:400; font-display:swap; }
    @font-face { font-family:'Qomra'; src:url('/fonts/itfQomraArabic-Bold.otf') format('opentype'); font-weight:700; font-display:swap; }

    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Qomra','Segoe UI',Tahoma,sans-serif; background:#F7F5EF; color:#14201C;
           direction:rtl; padding:30px 20px; }
    .portal { max-width:1100px; margin:0 auto; background:#fff; border:1px solid #D1CBBB;
              border-radius:14px; box-shadow:0 4px 24px rgba(0,0,0,.06); overflow:hidden; }

    .banner { background:linear-gradient(135deg,#02443A,#0A241C); color:#fff; padding:24px 32px;
              display:flex; justify-content:space-between; align-items:center; gap:20px;
              border-bottom:3px solid #B79E6A; flex-wrap:wrap; }
    .brand { display:flex; align-items:center; gap:16px; }
    .brand h1 { font-size:19px; font-weight:700; color:#E8D9A8;
                font-family:'Qomariah Arabic','Qomra',sans-serif; margin-bottom:4px; }
    .brand p { font-size:12px; color:#CFC49E; }
    .meta { text-align:left; font-size:12px; color:#E8D9A8; line-height:1.6; }

    .draft-strip { background:#FCF9EE; border-bottom:1px solid #E3D6A8; color:#6B5A22;
                   padding:9px 32px; font-size:11.5px; line-height:1.7; }
    .draft-strip strong { color:#8A6A12; }

    .actions { background:#FBFAF6; border-bottom:1px solid #E4E0D6; padding:16px 32px;
               display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:12px; }
    .btn { display:inline-flex; align-items:center; gap:8px; padding:10px 20px; border-radius:8px;
           font-family:inherit; font-weight:700; font-size:13px; cursor:pointer; border:none; transition:all .2s; }
    .btn:disabled { opacity:.6; cursor:default; }
    .btn-excel { background:#107C41; color:#fff; box-shadow:0 2px 8px rgba(16,124,65,.25); }
    .btn-excel:hover:enabled { background:#0c5c30; }
    .btn-csv { background:#02443A; color:#E8D9A8; } .btn-csv:hover { background:#002723; }
    .btn-plain { background:#F0EDE4; color:#02443A; border:1px solid #DDD8CA; }
    .btn-plain:hover { background:#EBE6D9; }

    .table-wrap { padding:24px 32px; }
    .table-head { display:flex; justify-content:space-between; align-items:center;
                  margin-bottom:16px; flex-wrap:wrap; gap:12px; }
    .badge { display:inline-block; padding:4px 12px; background:#E7F0EA; color:#2E6B4F;
             border-radius:20px; font-weight:700; font-size:12px; border:1px solid #A6D0BA; }
    .search { width:260px; padding:8px 14px; border:1px solid #DDD8CA; border-radius:8px;
              font-family:inherit; font-size:12px; background:#FBFAF6; }
    .search:focus { outline:none; border-color:#B79E6A; }

    table.gov { width:100%; border-collapse:collapse; border:1px solid #DDD8CA; font-size:13.5px; }
    table.gov th { background:#02443A; color:#fff; padding:12px 16px; font-weight:700; text-align:right;
                   border:1px solid #002723; font-family:'Qomariah Arabic','Qomra',sans-serif; }
    table.gov td { padding:11px 16px; border:1px solid #E4E0D6; }
    table.gov tbody tr:nth-child(even) { background:#FBFAF6; }
    table.gov tbody tr:hover { background:#F0EDE4; }

    .footer { background:#FBFAF6; border-top:1px solid #E4E0D6; padding:14px 32px;
              display:flex; justify-content:space-between; align-items:center;
              font-size:11px; color:#5E6B64; gap:12px; flex-wrap:wrap; }

    @media print { .actions,.search,.btn { display:none !important; } body { padding:0; } }
  </style>
</head>
<body>
  <div class="portal">
    <header class="banner">
      <div class="brand">
        <div style="background:rgba(255,255,255,.08);padding:8px;border-radius:10px;border:1px solid rgba(183,158,106,.4);">
          ${eagleEmblem({ width: 60, height: 44 })}
        </div>
        <div>
          <h1>بوابة تصدير وتحليل البيانات</h1>
          <p>الجمهورية العربية السورية — منظومة OSS للذكاء الاصطناعي</p>
        </div>
      </div>
      <div class="meta">
        <div><strong>الرقم الإشاري:</strong> ${escapeHtml(ref)}</div>
        <div><strong>التاريخ:</strong> ${escapeHtml(formatArabicDate())}</div>
        <div><strong>أصدرها:</strong> ${escapeHtml(issuedBy)}</div>
      </div>
    </header>

    <div class="draft-strip">
      <strong>تنويه:</strong> هذه البيانات مستخرجة من مسودة أنتجها نموذج ذكاء اصطناعي.
      يجب التحقق من كل قيمة من مصدرها الأصلي قبل اعتمادها في أي تقرير أو قرار رسمي.
    </div>

    <div class="actions">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="font-weight:700;font-size:13px;color:#02443A;">خيارات التصدير:</span>
        <button class="btn btn-excel" id="xlsxBtn">📗 تحميل مصنّف Excel (.xlsx)</button>
        <button class="btn btn-csv" id="csvBtn">📄 تحميل ملف CSV (UTF-8 مع BOM)</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn btn-plain" id="printBtn">🖨️ طباعة الجدول</button>
        <button class="btn btn-plain" id="closeBtn">إغلاق</button>
      </div>
    </div>

    <main class="table-wrap">
      <div class="table-head">
        <span class="badge">إجمالي السجلات: ${rows.length} صف | ${headers.length} أعمدة</span>
        <input type="text" id="search" class="search" placeholder="تصفية وبحث في الجدول...">
      </div>
      <div style="overflow-x:auto;">
        <table class="gov" id="dataTable">
          <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    </main>

    <footer class="footer">
      <div>ملف CSV بترميز UTF-8 مع BOM — متوافق مع Microsoft Excel واللغة العربية.</div>
      <div>${escapeHtml(ref)}</div>
    </footer>
  </div>

  <form id="xlsxForm" method="POST" action="/api/export/xlsx" style="display:none;">
    <input type="hidden" name="ticket"   value="${escapeHtml(nestedTicket)}">
    <input type="hidden" name="csvData"  value="${escapeHtml(csvData)}">
    <input type="hidden" name="filename" value="${escapeHtml(filename.replace(/\.csv$/i, '.xlsx'))}">
    <input type="hidden" name="title"    value="${escapeHtml(tableTitle)}">
  </form>

  <script nonce="${nonce}">
    const rawCsv = ${JSON.stringify(csvData)};
    const csvFilename = ${JSON.stringify(filename.replace(/\.xlsx$/i, '.csv'))};

    document.getElementById('printBtn').addEventListener('click', () => window.print());
    document.getElementById('closeBtn').addEventListener('click', () => window.close());

    document.getElementById('csvBtn').addEventListener('click', () => {
      const blob = new Blob(['\\uFEFF' + rawCsv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = csvFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });

    // The .xlsx ticket is single-use, so the download is triggered on demand
    // rather than automatically on page load.
    document.getElementById('xlsxBtn').addEventListener('click', function () {
      document.getElementById('xlsxForm').submit();
      this.disabled = true;
      this.textContent = '📗 تم إرسال طلب التحميل';
    });

    document.getElementById('search').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('#dataTable tbody tr').forEach((tr) => {
        tr.style.display = tr.innerText.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  </script>
</body>
</html>`;
}

module.exports = { renderDataset };
