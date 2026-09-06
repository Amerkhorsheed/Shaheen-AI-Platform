'use strict';

const { escapeHtml } = require('../lib/html');

/** Minimal standalone page for an export that could not be produced. */
function renderNotice(title, message) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #F7F5EF; color: #14201C;
           display: flex; align-items: center; justify-content: center; height: 100vh;
           margin: 0; direction: rtl; }
    .card { background: #fff; border: 1px solid #DDD8CA; border-radius: 12px; padding: 36px 44px;
            max-width: 520px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,.06); }
    h1 { color: #8A1B1B; font-size: 19px; margin: 0 0 12px; }
    p  { color: #5E6B64; font-size: 14px; line-height: 1.8; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

module.exports = { renderNotice };
