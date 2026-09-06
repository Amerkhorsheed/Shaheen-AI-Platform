// Official document & dataset export service.
//
// Three guarantees this module is responsible for:
//   1. Nothing is exported without an authenticated, auditable request.
//   2. Model output is rendered as sanitised HTML — never interpolated raw.
//   3. Every reference number and hash printed on a document is real and can
//      be verified through /api/export/verify/:ref.
const crypto = require('crypto');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const ExcelJS = require('exceljs');
const { db, logAudit, registerDocument } = require('./db');

// High Definition Syrian Golden Eagle Vector with 3 Stars
const SYRIAN_EAGLE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 212.66 159.58" width="80" height="60" fill="#B79E6A">
  <path d="m 174.75,64.76 c -0.51,0.49 -1.03,0.97 -1.56,1.43 l 24.97,37.26 -9.49,-1.27 c -3.07,-0.41 -5.78,-2.23 -7.32,-4.92 l -14.9,-25.99 c -0.59,0.38 -1.19,0.75 -1.8,1.1 l 23.89,43.44 -9.5,-1.91 c -3.11,-0.63 -5.74,-2.7 -7.07,-5.58 L 157.07,76.1 c -0.65,0.27 -1.31,0.52 -1.98,0.76 l 15.62,35.35 -7.25,-1.46 c -3.41,-0.69 -6.22,-3.11 -7.4,-6.38 l -9.1,-25.26 c -0.69,0.14 -1.39,0.26 -2.08,0.37 l 10.07,29.57 -5.42,-1.09 c -3.72,-0.75 -6.68,-3.55 -7.65,-7.21 l -5.19,-19.61 v 0 c -0.67,0.18 -1.33,0.38 -1.98,0.6 l 6.01,24.45 -3.88,-0.78 C 132.81,104.6 129.7,101.4 129,97.35 l -2.15,-12.43 -3.71,8.6 c -0.41,0.96 -0.31,2.06 0.26,2.93 l 11.44,17.23 c 0.16,0.24 0.25,0.51 0.27,0.8 l 0.22,3.26 7.21,7.21 h 16.95 v 7.4 l -3.61,-3.61 h -3.98 l 3.78,3.78 -4.12,4.12 v -4.12 l -3.79,-3.78 h -3.64 l -3.79,3.78 v 3.26 l -4.4,-4.41 3.82,-3.72 -6.73,-6.73 -2.42,0.27 c -0.38,0.04 -0.77,-0.05 -1.09,-0.26 l -14.15,-9.4 10.17,13.73 16.19,21.87 h -6.83 c -3.87,0 -7.39,-2.25 -9.02,-5.76 l -5.94,-12.77 c -0.56,0.26 -1.13,0.51 -1.7,0.73 l 9.53,24.02 h -3.29 c -4.81,0 -8.93,-3.44 -9.79,-8.17 l -2.57,-14.1 c -0.56,0.1 -1.12,0.19 -1.7,0.26 l 2.15,16.84 c 0.41,3.24 -0.79,6.47 -3.21,8.66 l -3.04,2.74 -3.04,-2.74 c -2.42,-2.18 -3.62,-5.42 -3.21,-8.65 l 2.15,-16.84 c -0.57,-0.07 -1.13,-0.16 -1.7,-0.26 l -2.57,14.1 c -0.86,4.73 -4.98,8.17 -9.79,8.17 h -3.29 l 9.53,-24.02 c -0.57,-0.22 -1.14,-0.47 -1.7,-0.73 l -5.94,12.77 c -1.63,3.51 -5.15,5.76 -9.02,5.76 h -6.83 l 16.19,-21.87 10.17,-13.73 -14.15,9.4 c -0.32,0.21 -0.71,0.31 -1.09,0.26 l -2.42,-0.27 -6.73,6.73 3.82,3.72 -4.4,4.41 v -3.26 l -3.79,-3.78 h -3.64 l -3.79,3.78 v 4.12 l -4.12,-4.12 3.78,-3.78 h -3.98 l -3.61,3.61 v -7.4 H 70.1 l 7.21,-7.21 0.23,-3.26 c 0.02,-0.28 0.11,-0.56 0.27,-0.79 L 89.25,96.47 c 0.58,-0.87 0.68,-1.97 0.26,-2.93 L 85.8,84.93 v 0 l -2.15,12.43 c -0.7,4.05 -3.82,7.25 -7.85,8.06 l -3.87,0.78 6.01,-24.46 c -0.65,-0.22 -1.32,-0.41 -1.99,-0.6 l -5.18,19.62 c -0.97,3.67 -3.94,6.47 -7.66,7.21 l -5.42,1.09 10.08,-29.57 c -0.7,-0.1 -1.39,-0.23 -2.08,-0.36 l -9.1,25.27 c -1.18,3.28 -3.99,5.7 -7.4,6.38 l -7.25,1.46 15.61,-35.37 c -0.67,-0.23 -1.32,-0.49 -1.97,-0.75 l -14.9,32.21 c -1.33,2.88 -3.96,4.95 -7.07,5.58 L 24.1,115.82 48.01,72.38 C 47.4,72.03 46.8,71.66 46.21,71.27 l -14.9,26 c -1.54,2.69 -4.25,4.51 -7.32,4.92 L 14.5,103.46 39.47,66.19 C 38.94,65.73 38.42,65.25 37.9,64.76 L 23.84,84.97 c -1.73,2.49 -4.49,4.05 -7.52,4.25 L 6.99,89.84 32.21,58.5 C 31.77,57.95 31.35,57.38 30.93,56.8 L 16.94,73.58 c -1.89,2.27 -4.69,3.58 -7.64,3.58 H 0 L 44.7,30.58 c 2.41,-2.51 5.73,-3.93 9.21,-3.93 h 9.97 c 2.67,0 4.83,2.16 4.83,4.83 v 5.63 c 0,4.54 1.52,8.72 4.06,12.07 3.64,4.8 9.41,7.9 15.91,7.9 1.44,0 2.85,-0.16 4.21,-0.45 1.08,-0.23 1.96,-1.03 2.25,-2.1 l 3.54,-12.81 c 0.05,-0.23 0.06,-0.47 0.02,-0.7 -0.24,-1.55 -2.34,-2.52 -4.7,-2.16 -1.89,0.28 -3.595994,1.18797 -4.036671,2.54 0,0 -0.763329,-2.04 -0.783329,-3.56 -0.03,-1.96 0.81,-3.05 2.71,-4.01 l 3.3,-1.55 c 2.08,-1.91 5.46,-3.14 9.3,-3.14 5.9,0 10.76,2.93 11.38,6.72 l 0.06,0.46 2.39,17.98 c 0.17,1.28 1.16,2.31 2.44,2.52 1.05,0.17 2.12,0.26 3.22,0.26 6.49,0 12.26,-3.09 15.91,-7.9 2.55,-3.35 4.06,-7.53 4.06,-12.07 v -5.63 c 0,-2.67 2.16,-4.83 4.83,-4.83 h 9.97 c 3.48,0 6.8,1.42 9.21,3.93 l 44.7,46.58 h -9.28 c -2.95,0 -5.75,-1.31 -7.64,-3.58 l -14,-16.78 c -0.41,0.57 -0.83,1.14 -1.27,1.7 l 25.21,31.34 -9.34,-0.62 c -3.02,-0.2 -5.79,-1.76 -7.52,-4.25 L 174.76,64.76 Z"/>
  <polygon points="100.41 18.2 106.32 13.9 112.23 18.2 109.97 11.25 115.88 6.95 108.58 6.95 106.32 0 104.06 6.95 96.76 6.95 102.67 11.25 100.41 18.2"/>
  <polygon points="129.94 18.38 133.72 24.63 134.33 17.34 141.44 15.67 134.71 12.84 135.32 5.56 130.55 11.09 123.81 8.26 127.6 14.52 122.82 20.05 129.94 18.38"/>
  <polygon points="78.31 17.35 78.85 24.64 82.7 18.43 89.79 20.17 85.07 14.59 88.91 8.38 82.16 11.14 77.44 5.56 77.98 12.84 71.21 15.61 78.31 17.35"/>
</svg>
`;

const MAX_CONTENT_CHARS = 500000;

// -------------------------------------------------------------
// EXPORT TICKETS
// -------------------------------------------------------------
// Export targets are reached by a form navigation (so the browser can print
// the page or save the file), which cannot carry an Authorization header.
// The SPA therefore fetches a short-lived, single-use ticket first.
const tickets = new Map();
const TICKET_TTL_MS = 120000;

function issueTicket(user) {
  const ticket = crypto.randomBytes(32).toString('base64url');
  tickets.set(ticket, { userId: user.id, expiresAt: Date.now() + TICKET_TTL_MS });
  return ticket;
}

async function consumeTicket(ticket) {
  if (!ticket || typeof ticket !== 'string') return null;
  const entry = tickets.get(ticket);
  if (!entry) return null;
  tickets.delete(ticket);
  if (Date.now() > entry.expiresAt) return null;

  return await db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.job_title, u.status,
           c.clearance_level as category_clearance
    FROM users u
    LEFT JOIN categories c ON u.category_id = c.id
    WHERE u.id = ?
  `).get(entry.userId);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of tickets) {
    if (now > entry.expiresAt) tickets.delete(key);
  }
}, 60000).unref();

async function ticketMiddleware(req, res, next) {
  try {
    const user = await consumeTicket(req.body?.ticket);
    if (!user) {
      return res
        .status(401)
        .type('html')
        .send(renderNotice('انتهت صلاحية الجلسة', 'تعذّر التحقق من صلاحية طلب التصدير. يرجى العودة إلى المنظومة وإعادة المحاولة.'));
    }
    if (user.status !== 'active') {
      return res
        .status(403)
        .type('html')
        .send(renderNotice('الحساب موقوف', 'هذا الحساب موقوف إدارياً ولا يمكنه تصدير الوثائق.'));
    }
    req.exportUser = user;
    next();
  } catch (err) {
    console.error('ticketMiddleware error:', err);
    return res.status(500).type('html').send(renderNotice('خطأ داخلي', 'حدث خطأ أثناء معالجة التذكرة.'));
  }
}

// -------------------------------------------------------------
// RENDERING HELPERS
// -------------------------------------------------------------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });

const SANITIZE_OPTIONS = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'blockquote', 'pre', 'code',
    'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'sup', 'sub', 'span', 'div',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'a'
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    th: ['colspan', 'rowspan', 'align'],
    td: ['colspan', 'rowspan', 'align'],
    '*': ['dir']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // No <style>, no inline style, no event handlers, no <script>, no <img>,
  // no <iframe> — the sanitiser drops anything not listed above.
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' }
    })
  }
};

/**
 * Convert model output (Markdown) into safe HTML for the official template.
 * This is the only path by which caller-supplied text enters a rendered page.
 */
function renderMarkdown(markdown) {
  const source = String(markdown || '').slice(0, MAX_CONTENT_CHARS);
  return sanitizeHtml(marked.parse(source), SANITIZE_OPTIONS);
}

function renderNotice(title, message) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:'IBM Plex Sans Arabic','Segoe UI',sans-serif;background:#F7F5EF;color:#14201C;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0;direction:rtl}
  .card{background:#fff;border:1px solid #DDD8CA;border-radius:12px;padding:36px 44px;max-width:520px;text-align:center;
        box-shadow:0 4px 24px rgba(0,0,0,.06)}
  h1{color:#8A1B1B;font-size:19px;margin:0 0 12px}
  p{color:#5E6B64;font-size:14px;line-height:1.8;margin:0}
</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}

/**
 * Export pages are served from the application's own origin, so they get a
 * strict Content-Security-Policy of their own: no external anything, and
 * inline scripts only via a per-response nonce.
 */
function applyExportCsp(res, nonce) {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data:",
      `script-src 'nonce-${nonce}'`,
      "form-action 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'"
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

const CLASSIFICATIONS = {
  top_secret: { label: 'سري للغاية ومكتوم', color: '#8A1B1B', bg: '#FDF2F2', border: '#F8B4B4' },
  secret: { label: 'سري وخاص', color: '#8A6A12', bg: '#FCF7EA', border: '#F4D89A' },
  official: { label: 'رسمي', color: '#02443A', bg: '#E7F0EA', border: '#A6D0BA' },
  unclassified: { label: 'غير مصنف', color: '#5E6B64', bg: '#F0EDE4', border: '#DDD8CA' }
};

function resolveClassification(value) {
  return CLASSIFICATIONS[value] || CLASSIFICATIONS.official;
}

function formatDate(date = new Date()) {
  return date.toLocaleDateString('ar-SY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Build a Content-Disposition value that survives Arabic filenames.
 */
function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * RFC 4180 CSV parser. Handles quoted fields containing commas, quotes and
 * newlines — the previous line-splitting parser corrupted any of those.
 */
function parseCsvToMatrix(csvText) {
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
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') { inQuotes = true; } else if (char === ',') {
      row.push(field.trim()); field = '';
    } else if (char === '\n') {
      row.push(field.trim()); field = '';
      if (row.some((c) => c !== '')) matrix.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some((c) => c !== '')) matrix.push(row);
  return matrix;
}

// -------------------------------------------------------------
// ROUTES
// -------------------------------------------------------------
function registerExportRoutes(app, authMiddleware) {
  // Issue a single-use ticket for a form-navigated export.
  app.post('/api/export/ticket', authMiddleware, (req, res) => {
    res.json({ ticket: issueTicket(req.user), expiresInMs: TICKET_TTL_MS });
  });

  // Verify a reference number printed on an exported document.
  app.get('/api/export/verify/:ref', authMiddleware, async (req, res) => {
    const record = await db.prepare(`
      SELECT r.ref, r.content_sha256, r.title, r.classification, r.kind, r.model,
             r.issued_by_name, r.created_at
      FROM document_registry r WHERE r.ref = ?
    `).get(req.params.ref);

    if (!record) {
      return res.status(404).json({ verified: false, error: 'لا يوجد قيد بهذا الرقم الإشاري في سجل المنظومة' });
    }
    res.json({ verified: true, record });
  });

  // ---------------- 1. PRINTABLE OFFICIAL DOCUMENT ----------------
  app.post('/api/export/pdf-page', ticketMiddleware, async (req, res) => {
    const rawTitle = String(req.body.title || 'وثيقة صادرة عن المنظومة').slice(0, 300);

    let meta = req.body.metadata || {};
    if (typeof meta === 'string') {
      try { meta = JSON.parse(meta); } catch (e) { meta = {}; }
    }

    const classConfig = resolveClassification(meta.classification);
    const bodyHtml = renderMarkdown(req.body.content);

    // Register the *rendered* body, so the recorded hash matches exactly what
    // appears on the printed page.
    const { ref, contentSha256 } = await registerDocument({
      content: bodyHtml,
      title: rawTitle,
      classification: meta.classification || 'official',
      kind: 'document',
      userId: req.exportUser.id,
      userName: req.exportUser.display_name || req.exportUser.username,
      model: meta.model || null
    });

    logAudit(req.exportUser.id, 'EXPORT_DOCUMENT', {
      ref,
      classification: meta.classification || 'official',
      title: rawTitle.slice(0, 120)
    }, req.ip);

    const shortHash = contentSha256.slice(0, 16).toUpperCase();
    const nonce = crypto.randomBytes(16).toString('base64');
    applyExportCsp(res, nonce);

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(rawTitle)} — الجمهورية العربية السورية</title>
  <style>
    /* Fonts are served from this host. The platform makes no external
       network requests, so the isolation it claims is actually true. */
    @font-face { font-family:'Qomariah Arabic'; src:url('/fonts/QomariahArabic-PV2Kx.ttf') format('truetype'); font-weight:100 900; font-display:swap; }
    @font-face { font-family:'Qomra'; src:url('/fonts/itfQomraArabic-Regular.otf') format('opentype'); font-weight:400; font-display:swap; }
    @font-face { font-family:'Qomra'; src:url('/fonts/itfQomraArabic-Bold.otf') format('opentype'); font-weight:700; font-display:swap; }

    :root {
      --color-brand:#02443A; --color-brand-deep:#002723; --color-gold:#B79E6A;
      --color-gold-dark:#7A6A45; --color-ink:#14201C; --color-ink-secondary:#5E6B64; --color-border:#DDD8CA;
    }
    * { box-sizing:border-box; margin:0; padding:0; }
    body {
      font-family:'Qomra','Segoe UI',Tahoma,-apple-system,sans-serif;
      background:#F7F5EF; color:var(--color-ink); line-height:1.8;
      direction:rtl; text-align:right; padding:24px 16px;
    }
    .print-control-bar {
      max-width:900px; margin:0 auto 20px; display:flex; justify-content:space-between; align-items:center;
      background:#fff; padding:14px 24px; border-radius:10px; box-shadow:0 4px 16px rgba(0,0,0,.06);
      border:1px solid var(--color-border);
    }
    .btn { display:inline-flex; align-items:center; gap:8px; padding:10px 22px; border-radius:6px;
           font-family:inherit; font-weight:700; font-size:14px; cursor:pointer; border:none; transition:all .2s; }
    .btn-primary { background:#02443A; color:#fff; } .btn-primary:hover { background:#002723; }
    .btn-secondary { background:#F0EDE4; color:#02443A; border:1px solid var(--color-border); }
    .btn-secondary:hover { background:#EBE6D9; }

    .syrian-official-page {
      max-width:900px; margin:0 auto; background:#fff; border:1px solid #D1CBBB;
      box-shadow:0 4px 24px rgba(0,0,0,.05); position:relative; padding:55px 65px; min-height:1120px;
    }
    .watermark-overlay {
      position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
      pointer-events:none; opacity:.035; font-size:42px; font-weight:900; color:#02443A;
      transform:rotate(-30deg); user-select:none; z-index:0; white-space:nowrap;
    }
    .content-wrapper { position:relative; z-index:1; }

    .state-header { display:flex; justify-content:space-between; align-items:flex-start;
                    border-bottom:3px double #B79E6A; padding-bottom:20px; margin-bottom:20px; }
    .header-right { width:33%; font-size:13px; line-height:1.6; color:#02443A; font-weight:700;
                    font-family:'Qomariah Arabic','Qomra',sans-serif; }
    .header-right span { display:block; color:var(--color-gold-dark); font-size:11px; font-weight:600; margin-top:2px; }
    .header-center { width:34%; text-align:center; display:flex; flex-direction:column; align-items:center; }
    .header-center .platform-title { font-size:15px; font-weight:700; color:#02443A; margin-top:6px;
                                     font-family:'Qomariah Arabic','Qomra',sans-serif; }
    .header-left { width:33%; text-align:left; font-size:11px; color:var(--color-ink-secondary); line-height:1.7; }
    .header-left strong { color:#02443A; }

    .classification-strip {
      display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;
      background:${classConfig.bg}; border:1px solid ${classConfig.border}; color:${classConfig.color};
      padding:6px 16px; border-radius:4px; font-size:12px; font-weight:700; margin-bottom:14px;
    }

    /* Every exported page states plainly that its body is machine-generated
       and carries no approval until a competent authority signs it. */
    .ai-draft-notice {
      border:1px solid #E3D6A8; background:#FCF9EE; color:#6B5A22;
      border-radius:6px; padding:9px 14px; font-size:11.5px; line-height:1.7; margin-bottom:24px;
    }
    .ai-draft-notice strong { color:#8A6A12; }

    .doc-main-title { font-size:20px; font-weight:700; color:#02443A; margin-bottom:24px;
                      padding-bottom:8px; border-bottom:1px solid #EBE6D9;
                      font-family:'Qomariah Arabic','Qomra',sans-serif; }

    .doc-body { font-size:14.5px; line-height:1.85; color:#14201C; word-wrap:break-word; }
    .doc-body h1,.doc-body h2,.doc-body h3,.doc-body h4 { color:#02443A; margin:22px 0 10px; font-weight:700; }
    .doc-body h1 { font-size:18px; } .doc-body h2 { font-size:16px; } .doc-body h3 { font-size:14.5px; }
    .doc-body p { margin-bottom:14px; text-align:justify; }
    .doc-body ul,.doc-body ol { margin:0 22px 14px 0; padding-right:14px; }
    .doc-body li { margin-bottom:6px; }
    .doc-body blockquote { border-right:3px solid #B79E6A; background:#FBFAF6; padding:8px 16px; margin:14px 0; color:#3D4A44; }
    .doc-body pre { background:#F0EDE4; border:1px solid #DDD8CA; border-radius:6px; padding:12px 14px;
                    overflow-x:auto; direction:ltr; text-align:left; font-size:12.5px; margin-bottom:14px; }
    .doc-body code { font-family:'Courier New',monospace; font-size:12.5px; background:#F0EDE4; padding:1px 5px; border-radius:3px; }
    .doc-body pre code { background:none; padding:0; }
    .doc-body table { width:100%; border-collapse:collapse; margin:22px 0; font-size:13px; border:1px solid #DDD8CA; }
    .doc-body th { background:#02443A; color:#fff; padding:10px 14px; font-weight:700; border:1px solid #002723; text-align:right; }
    .doc-body td { padding:9px 14px; border:1px solid #DDD8CA; }
    .doc-body tbody tr:nth-child(even) td { background:#FBFAF6; }
    .doc-body hr { border:none; border-top:1px solid #E4E0D6; margin:20px 0; }

    .official-closing { margin-top:60px; padding-top:25px; border-top:2px solid #EBE6D9;
                        display:flex; justify-content:space-between; align-items:flex-end; gap:24px; }
    .registry-box { border:1px solid #DDD8CA; padding:14px 18px; border-radius:8px; background:#FBFAF6; width:300px; }
    .registry-box .registry-title { font-size:11px; font-weight:700; color:#02443A; margin-bottom:6px; }
    .registry-box .registry-line { font-family:'Courier New',monospace; font-size:10px; color:var(--color-gold-dark);
                                   letter-spacing:.4px; word-break:break-all; }
    .registry-box .registry-hint { font-size:9.5px; color:#7A7A7B; margin-top:6px; line-height:1.6; }

    .signature-area { text-align:center; width:280px; }
    .signature-area .sig-title { font-size:12px; font-weight:700; color:#02443A; margin-bottom:6px; }
    .signature-area .sig-hint { font-size:10px; color:var(--color-ink-secondary); margin-bottom:46px; }
    .signature-area .sig-rule { border-top:1px solid #9A9384; padding-top:6px; font-size:10.5px; color:var(--color-ink-secondary); }

    .official-footer { margin-top:40px; border-top:1px solid #DDD8CA; padding-top:12px;
                       display:flex; justify-content:space-between; font-size:11px; color:var(--color-ink-secondary); }

    @media print {
      @page { size:A4; margin:12mm 15mm; }
      body { background:transparent !important; padding:0 !important; }
      .print-control-bar { display:none !important; }
      .syrian-official-page { border:none !important; box-shadow:none !important; padding:0 !important;
                              width:100% !important; max-width:100% !important; min-height:auto !important; }
      .doc-body table, .doc-body pre, .doc-body blockquote { page-break-inside:avoid; }
      .official-closing { page-break-inside:avoid; }
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

  <div class="syrian-official-page">
    <div class="watermark-overlay">مسودة — تخضع للمراجعة والاعتماد</div>
    <div class="content-wrapper">
      <header class="state-header">
        <div class="header-right">
          <div>الجمهورية العربية السورية</div>
          <span>الهيئة الوطنية للتحول الرقمي والذكاء الاصطناعي</span>
        </div>
        <div class="header-center">
          <div>${SYRIAN_EAGLE_SVG}</div>
          <div class="platform-title">منظومة OSS</div>
        </div>
        <div class="header-left">
          <div><strong>الرقم الإشاري:</strong> ${escapeHtml(ref)}</div>
          <div><strong>تاريخ الإصدار:</strong> ${escapeHtml(formatDate())}</div>
          <div><strong>أصدرها:</strong> ${escapeHtml(req.exportUser.display_name || req.exportUser.username)}</div>
          <div><strong>النموذج:</strong> ${escapeHtml(meta.model || 'غير محدد')}</div>
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

      <h1 class="doc-main-title">${escapeHtml(rawTitle)}</h1>

      <main class="doc-body">${bodyHtml}</main>

      <div class="official-closing">
        <div class="registry-box">
          <div class="registry-title">قيد سجل المنظومة</div>
          <div class="registry-line">REF&nbsp;&nbsp;: ${escapeHtml(ref)}</div>
          <div class="registry-line">SHA256: ${escapeHtml(shortHash)}…</div>
          <div class="registry-hint">
            قيد إلكتروني يثبت زمن الإصدار ومُصدِره وبصمة المحتوى فقط.
            للتحقق: <span style="font-family:'Courier New',monospace;">/api/export/verify/${escapeHtml(ref)}</span>
          </div>
        </div>
        <div class="signature-area">
          <div class="sig-title">الاعتماد والتوقيع</div>
          <div class="sig-hint">لا تُعتمد الوثيقة إلا بتوقيع وخاتم الجهة المختصة</div>
          <div class="sig-rule">الاسم والصفة والتوقيع</div>
        </div>
      </div>

      <footer class="official-footer">
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

    res.type('html').send(html);
  });

  // ---------------- 2. NATIVE EXCEL (.xlsx) DOWNLOAD ----------------
  app.post('/api/export/xlsx', ticketMiddleware, async (req, res) => {
    const csvData = String(req.body.csvData || '').slice(0, MAX_CONTENT_CHARS);
    const rawFilename = String(req.body.filename || 'shaheen_gov_data.xlsx');
    const title = String(req.body.title || 'مصفوفة البيانات وجداول المؤشرات').slice(0, 200);

    const matrix = parseCsvToMatrix(csvData);
    if (matrix.length === 0) {
      return res.status(400).type('html').send(renderNotice('لا توجد بيانات', 'لم يتم العثور على جدول بيانات صالح للتصدير.'));
    }

    const { ref } = await registerDocument({
      content: csvData,
      title,
      classification: 'official',
      kind: 'dataset',
      userId: req.exportUser.id,
      userName: req.exportUser.display_name || req.exportUser.username,
      model: null
    });

    logAudit(req.exportUser.id, 'EXPORT_DATASET', { ref, rows: matrix.length, format: 'xlsx' }, req.ip);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'منظومة OSS للذكاء الاصطناعي';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('البيانات', { views: [{ rightToLeft: true }] });

    sheet.addRow(['الجمهورية العربية السورية — منظومة OSS للذكاء الاصطناعي']);
    sheet.addRow([title]);
    sheet.addRow([`الرقم الإشاري: ${ref}  |  تاريخ الإصدار: ${formatDate()}  |  أصدرها: ${req.exportUser.display_name || req.exportUser.username}`]);
    sheet.addRow(['مسودة آلية — تخضع للمراجعة والاعتماد من الجهة المختصة قبل أي استخدام رسمي.']);
    sheet.addRow([]);

    for (let i = 1; i <= 4; i++) {
      sheet.getRow(i).font = { bold: i <= 2, size: i === 1 ? 13 : 11, color: { argb: 'FF02443A' } };
    }

    const headerRowNumber = sheet.rowCount + 1;
    matrix.forEach((row) => sheet.addRow(row));

    const headerRow = sheet.getRow(headerRowNumber);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF02443A' } };
    headerRow.alignment = { horizontal: 'right', vertical: 'middle' };

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber < headerRowNumber) return;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFDDD8CA' } },
          left: { style: 'thin', color: { argb: 'FFDDD8CA' } },
          bottom: { style: 'thin', color: { argb: 'FFDDD8CA' } },
          right: { style: 'thin', color: { argb: 'FFDDD8CA' } }
        };
      });
    });

    const columnCount = Math.max(...matrix.map((r) => r.length), 1);
    for (let c = 1; c <= columnCount; c++) {
      let widest = 12;
      matrix.forEach((row) => {
        const len = row[c - 1] ? String(row[c - 1]).length : 0;
        widest = Math.max(widest, Math.min(len + 4, 48));
      });
      sheet.getColumn(c).width = widest;
    }

    const filename = rawFilename.replace(/\.(csv|xlsx)$/i, '') + '.xlsx';
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(Buffer.from(buffer));
  });

  // ---------------- 3. TABLE INSPECTION PORTAL ----------------
  app.post('/api/export/csv-page', ticketMiddleware, async (req, res) => {
    const csvData = String(req.body.csvData || '').slice(0, MAX_CONTENT_CHARS);
    const filename = String(req.body.filename || 'shaheen_gov_table.xlsx');
    const tableTitle = String(req.body.tableTitle || 'مصفوفة البيانات وجداول المؤشرات').slice(0, 200);

    const matrix = parseCsvToMatrix(csvData);
    const headers = matrix[0] || [];
    const rows = matrix.slice(1);

    const { ref } = await registerDocument({
      content: csvData,
      title: tableTitle,
      classification: 'official',
      kind: 'dataset',
      userId: req.exportUser.id,
      userName: req.exportUser.display_name || req.exportUser.username,
      model: null
    });

    logAudit(req.exportUser.id, 'EXPORT_DATASET', { ref, rows: rows.length, format: 'preview' }, req.ip);

    // A fresh ticket for the nested "download .xlsx" form on this page.
    const nestedTicket = issueTicket(req.exportUser);
    const nonce = crypto.randomBytes(16).toString('base64');
    applyExportCsp(res, nonce);

    const html = `<!DOCTYPE html>
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
    body { font-family:'Qomra','Segoe UI',Tahoma,sans-serif; background:#F7F5EF; color:#14201C; direction:rtl; padding:30px 20px; }
    .portal-container { max-width:1100px; margin:0 auto; background:#fff; border:1px solid #D1CBBB;
                        border-radius:14px; box-shadow:0 4px 24px rgba(0,0,0,.06); overflow:hidden; }
    .state-banner { background:linear-gradient(135deg,#02443A,#0A241C); color:#fff; padding:24px 32px;
                    display:flex; justify-content:space-between; align-items:center; gap:20px;
                    border-bottom:3px solid #B79E6A; flex-wrap:wrap; }
    .brand-group { display:flex; align-items:center; gap:16px; }
    .banner-text h1 { font-size:19px; font-weight:700; color:#E8D9A8; font-family:'Qomariah Arabic','Qomra',sans-serif; margin-bottom:4px; }
    .banner-text p { font-size:12px; color:#CFC49E; }
    .meta-group { text-align:left; font-size:12px; color:#E8D9A8; line-height:1.6; }

    .draft-strip { background:#FCF9EE; border-bottom:1px solid #E3D6A8; color:#6B5A22;
                   padding:9px 32px; font-size:11.5px; line-height:1.7; }
    .draft-strip strong { color:#8A6A12; }

    .action-panel { background:#FBFAF6; border-bottom:1px solid #E4E0D6; padding:16px 32px;
                    display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:12px; }
    .btn { display:inline-flex; align-items:center; gap:8px; padding:10px 20px; border-radius:8px;
           font-family:inherit; font-weight:700; font-size:13px; cursor:pointer; border:none; transition:all .2s; }
    .btn-excel { background:#107C41; color:#fff; box-shadow:0 2px 8px rgba(16,124,65,.25); } .btn-excel:hover { background:#0c5c30; }
    .btn-csv { background:#02443A; color:#E8D9A8; } .btn-csv:hover { background:#002723; }
    .btn-print { background:#F0EDE4; color:#02443A; border:1px solid #DDD8CA; } .btn-print:hover { background:#EBE6D9; }

    .table-wrapper { padding:24px 32px; }
    .table-header-info { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px; }
    .badge-status { display:inline-block; padding:4px 12px; background:#E7F0EA; color:#2E6B4F;
                    border-radius:20px; font-weight:700; font-size:12px; border:1px solid #A6D0BA; }
    .search-box { width:260px; padding:8px 14px; border:1px solid #DDD8CA; border-radius:8px;
                  font-family:inherit; font-size:12px; background:#FBFAF6; }
    .search-box:focus { outline:none; border-color:#B79E6A; }

    table.gov-table { width:100%; border-collapse:collapse; border:1px solid #DDD8CA; font-size:13.5px; }
    table.gov-table th { background:#02443A; color:#fff; padding:12px 16px; font-weight:700;
                         text-align:right; border:1px solid #002723; font-family:'Qomariah Arabic','Qomra',sans-serif; }
    table.gov-table td { padding:11px 16px; border:1px solid #E4E0D6; }
    table.gov-table tbody tr:nth-child(even) { background:#FBFAF6; }
    table.gov-table tbody tr:hover { background:#F0EDE4; }

    .portal-footer { background:#FBFAF6; border-top:1px solid #E4E0D6; padding:14px 32px;
                     display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#5E6B64; gap:12px; flex-wrap:wrap; }
    @media print { .action-panel,.search-box,.btn { display:none !important; } body { padding:0; } }
  </style>
</head>
<body>
  <div class="portal-container">
    <header class="state-banner">
      <div class="brand-group">
        <div style="background:rgba(255,255,255,.08);padding:8px;border-radius:10px;border:1px solid rgba(183,158,106,.4);">
          ${SYRIAN_EAGLE_SVG.replace('width="80" height="60"', 'width="60" height="44"')}
        </div>
        <div class="banner-text">
          <h1>بوابة تصدير وتحليل البيانات</h1>
          <p>الجمهورية العربية السورية — منظومة OSS للذكاء الاصطناعي</p>
        </div>
      </div>
      <div class="meta-group">
        <div><strong>الرقم الإشاري:</strong> ${escapeHtml(ref)}</div>
        <div><strong>التاريخ:</strong> ${escapeHtml(formatDate())}</div>
        <div><strong>أصدرها:</strong> ${escapeHtml(req.exportUser.display_name || req.exportUser.username)}</div>
      </div>
    </header>

    <div class="draft-strip">
      <strong>تنويه:</strong> هذه البيانات مستخرجة من مسودة أنتجها نموذج ذكاء اصطناعي.
      يجب التحقق من كل قيمة من مصدرها الأصلي قبل اعتمادها في أي تقرير أو قرار رسمي.
    </div>

    <div class="action-panel">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="font-weight:700;font-size:13px;color:#02443A;">خيارات التصدير:</span>
        <button class="btn btn-excel" id="downloadXlsxBtn">📗 تحميل مصنّف Excel (.xlsx)</button>
        <button class="btn btn-csv" id="downloadCsvBtn">📄 تحميل ملف CSV (UTF-8 مع BOM)</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn btn-print" id="printBtn">🖨️ طباعة الجدول</button>
        <button class="btn btn-print" id="closeBtn">إغلاق</button>
      </div>
    </div>

    <main class="table-wrapper">
      <div class="table-header-info">
        <span class="badge-status">إجمالي السجلات: ${rows.length} صف | ${headers.length} أعمدة</span>
        <input type="text" id="tableSearch" class="search-box" placeholder="تصفية وبحث في الجدول...">
      </div>
      <div style="overflow-x:auto;">
        <table class="gov-table" id="dataTable">
          <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    </main>

    <footer class="portal-footer">
      <div>ملف CSV بترميز UTF-8 مع BOM — متوافق مع Microsoft Excel واللغة العربية.</div>
      <div>${escapeHtml(ref)}</div>
    </footer>
  </div>

  <form id="xlsxForm" method="POST" action="/api/export/xlsx" style="display:none;">
    <input type="hidden" name="ticket" value="${escapeHtml(nestedTicket)}">
    <input type="hidden" name="csvData" value="${escapeHtml(csvData)}">
    <input type="hidden" name="filename" value="${escapeHtml(filename.replace(/\.csv$/i, '.xlsx'))}">
    <input type="hidden" name="title" value="${escapeHtml(tableTitle)}">
  </form>

  <script nonce="${nonce}">
    document.getElementById('printBtn').addEventListener('click', () => window.print());
    document.getElementById('closeBtn').addEventListener('click', () => window.close());

    const rawCsv = ${JSON.stringify(csvData)};
    const csvFilename = ${JSON.stringify(filename.replace(/\.xlsx$/i, '.csv'))};

    document.getElementById('downloadCsvBtn').addEventListener('click', () => {
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
    document.getElementById('downloadXlsxBtn').addEventListener('click', function () {
      document.getElementById('xlsxForm').submit();
      this.disabled = true;
      this.textContent = '📗 تم إرسال طلب التحميل';
    });

    document.getElementById('tableSearch').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('#dataTable tbody tr').forEach((tr) => {
        tr.style.display = tr.innerText.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  </script>
</body>
</html>`;

    res.type('html').send(html);
  });
}

module.exports = {
  registerExportRoutes,
  parseCsvToMatrix,
  renderMarkdown,
  escapeHtml,
  SYRIAN_EAGLE_SVG
};
