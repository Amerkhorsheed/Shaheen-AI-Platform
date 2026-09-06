'use strict';

/**
 * Printable official document.
 *
 * A pure function: it receives already-rendered, already-sanitised body HTML
 * plus registry metadata, and returns a page. It performs no I/O, holds no
 * database access, and decides nothing about authorisation — which makes the
 * markup reviewable on its own and testable without a server.
 *
 * Two things this template must never claim: that the content is approved, and
 * that its reference is anything other than a registry entry. The seal states
 * only what the registry can actually prove, and the signature block is left
 * blank for a person.
 */

const { escapeHtml } = require('../lib/html');
const { eagleEmblem } = require('./assets');
const { resolveClassification, formatArabicDate } = require('./classifications');

/**
 * @param {object} params
 * @param {string} params.title           Document title (raw, escaped here).
 * @param {string} params.bodyHtml        Sanitised HTML body.
 * @param {string} params.ref             Registry reference, e.g. SY-GOV-2026-000017.
 * @param {string} params.contentSha256   Digest of `bodyHtml`.
 * @param {string} params.classification  Classification key.
 * @param {string} params.issuedBy        Display name of the issuing user.
 * @param {string} [params.model]         Model that produced the draft.
 * @param {string} params.nonce           CSP nonce for the inline script.
 */
function renderDocument({
  title,
  bodyHtml,
  ref,
  contentSha256,
  classification,
  issuedBy,
  model,
  nonce
}) {
  const classConfig = resolveClassification(classification);
  const shortHash = contentSha256.slice(0, 16).toUpperCase();

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(title)} — الجمهورية العربية السورية</title>
  <style>
    /* Fonts are served from this host. The platform makes no external network
       requests, so the isolation it claims is actually true. */
    @font-face { font-family:'Qomariah Arabic'; src:url('/fonts/QomariahArabic-PV2Kx.ttf') format('truetype'); font-weight:100 900; font-display:swap; }
    @font-face { font-family:'Qomra'; src:url('/fonts/itfQomraArabic-Regular.otf') format('opentype'); font-weight:400; font-display:swap; }
    @font-face { font-family:'Qomra'; src:url('/fonts/itfQomraArabic-Bold.otf') format('opentype'); font-weight:700; font-display:swap; }

    :root {
      --brand:#02443A; --brand-deep:#002723; --gold:#B79E6A; --gold-dark:#7A6A45;
      --ink:#14201C; --ink-2:#5E6B64; --border:#DDD8CA;
    }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Qomra','Segoe UI',Tahoma,-apple-system,sans-serif; background:#F7F5EF;
           color:var(--ink); line-height:1.8; direction:rtl; text-align:right; padding:24px 16px; }

    .print-control-bar { max-width:900px; margin:0 auto 20px; display:flex; justify-content:space-between;
                         align-items:center; background:#fff; padding:14px 24px; border-radius:10px;
                         box-shadow:0 4px 16px rgba(0,0,0,.06); border:1px solid var(--border); }
    .btn { display:inline-flex; align-items:center; gap:8px; padding:10px 22px; border-radius:6px;
           font-family:inherit; font-weight:700; font-size:14px; cursor:pointer; border:none; transition:all .2s; }
    .btn-primary { background:var(--brand); color:#fff; } .btn-primary:hover { background:var(--brand-deep); }
    .btn-secondary { background:#F0EDE4; color:var(--brand); border:1px solid var(--border); }
    .btn-secondary:hover { background:#EBE6D9; }

    .page { max-width:900px; margin:0 auto; background:#fff; border:1px solid #D1CBBB;
            box-shadow:0 4px 24px rgba(0,0,0,.05); position:relative; padding:55px 65px; min-height:1120px; }
    .watermark { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
                 pointer-events:none; opacity:.035; font-size:42px; font-weight:900; color:var(--brand);
                 transform:rotate(-30deg); user-select:none; z-index:0; white-space:nowrap; }
    .content { position:relative; z-index:1; }

    .state-header { display:flex; justify-content:space-between; align-items:flex-start;
                    border-bottom:3px double var(--gold); padding-bottom:20px; margin-bottom:20px; }
    .header-right { width:33%; font-size:13px; line-height:1.6; color:var(--brand); font-weight:700;
                    font-family:'Qomariah Arabic','Qomra',sans-serif; }
    .header-right span { display:block; color:var(--gold-dark); font-size:11px; font-weight:600; margin-top:2px; }
    .header-center { width:34%; text-align:center; display:flex; flex-direction:column; align-items:center; }
    .header-center .platform-title { font-size:15px; font-weight:700; color:var(--brand); margin-top:6px;
                                     font-family:'Qomariah Arabic','Qomra',sans-serif; }
    .header-left { width:33%; text-align:left; font-size:11px; color:var(--ink-2); line-height:1.7; }
    .header-left strong { color:var(--brand); }

    .classification-strip { display:flex; align-items:center; justify-content:space-between; gap:12px;
                            flex-wrap:wrap; background:${classConfig.bg}; border:1px solid ${classConfig.border};
                            color:${classConfig.color}; padding:6px 16px; border-radius:4px;
                            font-size:12px; font-weight:700; margin-bottom:14px; }

    /* Every exported page states plainly that its body is machine-generated
       and carries no authority until a competent authority signs it. */
    .ai-draft-notice { border:1px solid #E3D6A8; background:#FCF9EE; color:#6B5A22; border-radius:6px;
                       padding:9px 14px; font-size:11.5px; line-height:1.7; margin-bottom:24px; }
    .ai-draft-notice strong { color:#8A6A12; }

    .doc-title { font-size:20px; font-weight:700; color:var(--brand); margin-bottom:24px;
                 padding-bottom:8px; border-bottom:1px solid #EBE6D9;
                 font-family:'Qomariah Arabic','Qomra',sans-serif; }

    .doc-body { font-size:14.5px; line-height:1.85; color:var(--ink); word-wrap:break-word; }
    .doc-body h1,.doc-body h2,.doc-body h3,.doc-body h4 { color:var(--brand); margin:22px 0 10px; font-weight:700; }
    .doc-body h1 { font-size:18px; } .doc-body h2 { font-size:16px; } .doc-body h3 { font-size:14.5px; }
    .doc-body p { margin-bottom:14px; text-align:justify; }
    .doc-body ul,.doc-body ol { margin:0 22px 14px 0; padding-right:14px; }
    .doc-body li { margin-bottom:6px; }
    .doc-body blockquote { border-right:3px solid var(--gold); background:#FBFAF6; padding:8px 16px;
                           margin:14px 0; color:#3D4A44; }
    .doc-body pre { background:#F0EDE4; border:1px solid var(--border); border-radius:6px; padding:12px 14px;
                    overflow-x:auto; direction:ltr; text-align:left; font-size:12.5px; margin-bottom:14px; }
    .doc-body code { font-family:'Courier New',monospace; font-size:12.5px; background:#F0EDE4;
                     padding:1px 5px; border-radius:3px; }
    .doc-body pre code { background:none; padding:0; }
    .doc-body table { width:100%; border-collapse:collapse; margin:22px 0; font-size:13px; border:1px solid var(--border); }
    .doc-body th { background:var(--brand); color:#fff; padding:10px 14px; font-weight:700;
                   border:1px solid var(--brand-deep); text-align:right; }
    .doc-body td { padding:9px 14px; border:1px solid var(--border); }
    .doc-body tbody tr:nth-child(even) td { background:#FBFAF6; }
    .doc-body hr { border:none; border-top:1px solid #E4E0D6; margin:20px 0; }

    .closing { margin-top:60px; padding-top:25px; border-top:2px solid #EBE6D9;
               display:flex; justify-content:space-between; align-items:flex-end; gap:24px; }
    .registry-box { border:1px solid var(--border); padding:14px 18px; border-radius:8px;
                    background:#FBFAF6; width:300px; }
    .registry-box .registry-title { font-size:11px; font-weight:700; color:var(--brand); margin-bottom:6px; }
    .registry-box .registry-line { font-family:'Courier New',monospace; font-size:10px; color:var(--gold-dark);
                                   letter-spacing:.4px; word-break:break-all; }
    .registry-box .registry-hint { font-size:9.5px; color:#7A7A7B; margin-top:6px; line-height:1.6; }

    .signature { text-align:center; width:280px; }
    .signature .sig-title { font-size:12px; font-weight:700; color:var(--brand); margin-bottom:6px; }
    .signature .sig-hint { font-size:10px; color:var(--ink-2); margin-bottom:46px; }
    .signature .sig-rule { border-top:1px solid #9A9384; padding-top:6px; font-size:10.5px; color:var(--ink-2); }

    .footer { margin-top:40px; border-top:1px solid var(--border); padding-top:12px;
              display:flex; justify-content:space-between; font-size:11px; color:var(--ink-2); }

    @media print {
      @page { size:A4; margin:12mm 15mm; }
      body { background:transparent !important; padding:0 !important; }
      .print-control-bar { display:none !important; }
      .page { border:none !important; box-shadow:none !important; padding:0 !important;
              width:100% !important; max-width:100% !important; min-height:auto !important; }
      .doc-body table, .doc-body pre, .doc-body blockquote, .closing { page-break-inside:avoid; }
    }
  </style>
</head>
<body>
  <div class="print-control-bar">
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:18px;">🏛️</span>
      <div>
        <div style="font-size:14px;font-weight:700;color:#02443A;">وثيقة جاهزة للطباعة والحفظ بصيغة PDF</div>
        <div style="font-size:11px;color:#5E6B64;">الجمهورية العربية السورية — منظومة OSS للذكاء الاصطناعي</div>
      </div>
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn btn-primary" id="printBtn">🖨️ طباعة / حفظ كـ PDF</button>
      <button class="btn btn-secondary" id="closeBtn">إغلاق النافذة</button>
    </div>
  </div>

  <div class="page">
    <div class="watermark">مسودة — تخضع للمراجعة والاعتماد</div>
    <div class="content">
      <header class="state-header">
        <div class="header-right">
          <div>الجمهورية العربية السورية</div>
          <span>الهيئة الوطنية للتحول الرقمي والذكاء الاصطناعي</span>
        </div>
        <div class="header-center">
          <div>${eagleEmblem()}</div>
          <div class="platform-title">منظومة OSS</div>
        </div>
        <div class="header-left">
          <div><strong>الرقم الإشاري:</strong> ${escapeHtml(ref)}</div>
          <div><strong>تاريخ الإصدار:</strong> ${escapeHtml(formatArabicDate())}</div>
          <div><strong>أصدرها:</strong> ${escapeHtml(issuedBy)}</div>
          <div><strong>النموذج:</strong> ${escapeHtml(model || 'غير محدد')}</div>
        </div>
      </header>

      <div class="classification-strip">
        <span>درجة السرية: [ ${escapeHtml(classConfig.label)} ]</span>
        <span>البيئة: محلية معزولة</span>
      </div>

      <div class="ai-draft-notice">
        <strong>تنويه:</strong> نصّ هذه الوثيقة <strong>مسودة</strong> أنتجها نموذج ذكاء اصطناعي بناءً على مُدخلات المستخدم،
        ولا يُعدّ وثيقة رسمية معتمدة ولا يترتب عليه أي أثر إداري أو قانوني ما لم تُراجَع بياناته وتُوقَّع من الجهة المختصة.
        يُرجى التحقق من كل رقم ومرجع وارد فيه قبل الاعتماد.
      </div>

      <h1 class="doc-title">${escapeHtml(title)}</h1>

      <main class="doc-body">${bodyHtml}</main>

      <div class="closing">
        <div class="registry-box">
          <div class="registry-title">قيد سجل المنظومة</div>
          <div class="registry-line">REF&nbsp;&nbsp;: ${escapeHtml(ref)}</div>
          <div class="registry-line">SHA256: ${escapeHtml(shortHash)}…</div>
          <div class="registry-hint">
            قيد إلكتروني يثبت زمن الإصدار ومُصدِره وبصمة المحتوى فقط.
            للتحقق: <span style="font-family:'Courier New',monospace;">/api/export/verify/${escapeHtml(ref)}</span>
          </div>
        </div>
        <div class="signature">
          <div class="sig-title">الاعتماد والتوقيع</div>
          <div class="sig-hint">لا تُعتمد الوثيقة إلا بتوقيع وخاتم الجهة المختصة</div>
          <div class="sig-rule">الاسم والصفة والتوقيع</div>
        </div>
      </div>

      <footer class="footer">
        <div>صادر عن منظومة OSS للذكاء الاصطناعي — بيئة محلية معزولة.</div>
        <div>${escapeHtml(ref)}</div>
      </footer>
    </div>
  </div>

  <script nonce="${nonce}">
    document.getElementById('printBtn').addEventListener('click', () => window.print());
    document.getElementById('closeBtn').addEventListener('click', () => window.close());
  </script>
</body>
</html>`;
}

module.exports = { renderDocument };
