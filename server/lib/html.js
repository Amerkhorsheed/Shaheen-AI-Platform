'use strict';

/**
 * HTML rendering primitives for the document templates.
 *
 * `renderMarkdown` is the only path by which caller-supplied text enters a
 * rendered page. It converts Markdown and then strips everything not on the
 * allowlist — a previous version interpolated the raw value straight into the
 * template, which made every export a stored-XSS vector on the application's
 * own origin.
 */

const crypto = require('node:crypto');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

const config = require('../config');

marked.setOptions({ gfm: true, breaks: true });

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
    // target/rel must be listed here or the allowlist strips what
    // transformTags adds below, leaving links without noopener.
    a: ['href', 'title', 'target', 'rel'],
    th: ['colspan', 'rowspan', 'align'],
    td: ['colspan', 'rowspan', 'align'],
    '*': ['dir']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Anything not listed is discarded: no <script>, no <style>, no inline
  // style, no event handlers, no <img>, no <iframe>.
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' }
    })
  }
};

/** Escape a value for interpolation into markup as text. */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Markdown → sanitised HTML, capped at the configured document size. */
function renderMarkdown(markdown) {
  const source = String(markdown || '').slice(0, config.exports.maxDocumentChars);
  return sanitizeHtml(marked.parse(source), SANITIZE_OPTIONS);
}

function createNonce() {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * Content-Security-Policy for a rendered document page.
 *
 * These pages are served from the application's own origin, so they get a
 * policy of their own: no external anything, and inline script only through a
 * per-response nonce.
 */
function documentCsp(nonce) {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    `script-src 'nonce-${nonce}'`,
    "form-action 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'"
  ].join('; ');
}

module.exports = { escapeHtml, renderMarkdown, createNonce, documentCsp };
