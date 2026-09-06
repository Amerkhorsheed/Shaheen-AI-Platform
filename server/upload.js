const path = require('path');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');
const { logAudit } = require('./db');

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB per file
const MAX_FILES = 10;
const MAX_EXTRACTED_CHARS = 400000; // guards the model context and the database

// Only formats the platform can actually parse are accepted. Anything else
// used to be decoded as UTF-8 and fed to the model as binary noise.
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'docx',
  'xlsx',
  'csv', 'tsv', 'txt', 'md', 'json', 'xml', 'log',
  'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'sql', 'sh', 'yml', 'yaml', 'html', 'css'
]);

const TEXT_LIKE = new Set([
  'csv', 'tsv', 'txt', 'md', 'json', 'xml', 'log',
  'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'sql', 'sh', 'yml', 'yaml', 'html', 'css'
]);

// Container signatures, checked so a renamed executable cannot reach a parser.
const MAGIC = {
  pdf: Buffer.from('%PDF-'),
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04]) // docx and xlsx are ZIP containers
};

function extensionOf(filename) {
  return path.extname(String(filename || '')).replace('.', '').toLowerCase();
}

function hasMagic(buffer, signature) {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 10 },
  fileFilter(req, file, cb) {
    const ext = extensionOf(file.originalname);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error(`صيغة الملف «${ext || 'غير معروفة'}» غير مدعومة. الصيغ المقبولة: PDF, DOCX, XLSX, CSV, TXT وملفات النصوص البرمجية.`));
    }
    cb(null, true);
  }
});

function truncate(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (clean.length <= MAX_EXTRACTED_CHARS) return { text: clean, truncated: false };
  return {
    text: clean.slice(0, MAX_EXTRACTED_CHARS) + '\n\n[تم اقتطاع بقية المستند لتجاوزه الحد الأقصى للمعالجة]',
    truncated: true
  };
}

function cellToString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    // ExcelJS rich text / formula / hyperlink cells
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    if (value.formula !== undefined) return `=${value.formula}`;
    return '';
  }
  return String(value);
}

function toCsvField(value) {
  const s = cellToString(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function extractTextFromFile(file) {
  const ext = extensionOf(file.originalname);
  const base = { filename: file.originalname, size: file.size, mimeType: file.mimetype };

  try {
    let extracted = '';

    if (ext === 'pdf') {
      if (!hasMagic(file.buffer, MAGIC.pdf)) throw new Error('الملف ليس مستند PDF صالحاً');
      extracted = (await pdfParse(file.buffer)).text;
      if (!extracted.trim()) {
        return {
          ...base,
          success: false,
          error: 'لم يُعثر على نص قابل للاستخراج في هذا الملف. قد يكون صورة ممسوحة ضوئياً تتطلب معالجة OCR.'
        };
      }
    } else if (ext === 'docx') {
      if (!hasMagic(file.buffer, MAGIC.zip)) throw new Error('الملف ليس مستند Word (DOCX) صالحاً');
      extracted = (await mammoth.extractRawText({ buffer: file.buffer })).value;
    } else if (ext === 'xlsx') {
      if (!hasMagic(file.buffer, MAGIC.zip)) throw new Error('الملف ليس مصنّف Excel (XLSX) صالحاً');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer);

      const sheets = [];
      workbook.eachSheet((sheet) => {
        const lines = [];
        sheet.eachRow({ includeEmpty: false }, (row) => {
          const values = Array.isArray(row.values) ? row.values.slice(1) : [];
          const line = values.map(toCsvField).join(',');
          if (line.replace(/,/g, '').trim()) lines.push(line);
        });
        if (lines.length) sheets.push(`### ورقة العمل: ${sheet.name}\n\n${lines.join('\n')}`);
      });

      if (sheets.length === 0) {
        return { ...base, success: false, error: 'المصنّف لا يحتوي على أي بيانات قابلة للقراءة.' };
      }
      extracted = sheets.join('\n\n---\n\n');
    } else if (TEXT_LIKE.has(ext)) {
      extracted = file.buffer.toString('utf-8');
      // A high share of replacement characters means this was not really text.
      const replacements = (extracted.match(/�/g) || []).length;
      if (replacements > Math.max(20, extracted.length * 0.01)) {
        return { ...base, success: false, error: 'تعذّر قراءة الملف كنص بترميز UTF-8. يرجى التأكد من صيغة الملف.' };
      }
    } else {
      return { ...base, success: false, error: 'صيغة الملف غير مدعومة.' };
    }

    const { text, truncated } = truncate(extracted);
    return {
      ...base,
      success: true,
      text,
      truncated,
      preview: text.slice(0, 300) + (text.length > 300 ? '…' : '')
    };
  } catch (error) {
    console.error(`Error parsing file ${file.originalname}:`, error);
    return { ...base, success: false, error: 'تعذّر استخراج النص من هذا الملف: ' + error.message };
  }
}

function registerUploadRoutes(app, authMiddleware) {
  app.post(
    '/api/upload',
    authMiddleware,
    (req, res, next) => {
      upload.array('files', MAX_FILES)(req, res, (err) => {
        if (!err) return next();

        if (err instanceof multer.MulterError) {
          const messages = {
            LIMIT_FILE_SIZE: `حجم الملف يتجاوز الحد الأقصى (${MAX_FILE_BYTES / 1024 / 1024} ميغابايت).`,
            LIMIT_FILE_COUNT: `لا يمكن رفع أكثر من ${MAX_FILES} ملفات في المرة الواحدة.`
          };
          return res.status(413).json({ error: messages[err.code] || 'تعذّر رفع الملفات.' });
        }
        return res.status(400).json({ error: err.message });
      });
    },
    async (req, res) => {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'لم يتم إرفاق أي ملفات' });
      }

      // Files are parsed one at a time: ten concurrent PDF/XLSX parses on a
      // shared server is an easy way to exhaust memory.
      const results = [];
      for (const file of req.files) {
        results.push(await extractTextFromFile(file));
      }

      logAudit(req.user.id, 'FILES_UPLOADED', {
        count: results.length,
        // Names only — the extracted content is never written to the audit log.
        files: results.map((r) => ({ name: r.filename, size: r.size, ok: r.success }))
      }, req.ip);

      res.json({ files: results });
    }
  );
}

module.exports = {
  registerUploadRoutes,
  extractTextFromFile,
  ALLOWED_EXTENSIONS
};
