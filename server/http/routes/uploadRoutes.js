'use strict';

const { Router } = require('express');
const multer = require('multer');

const config = require('../../config');
const fileService = require('../../services/fileService');
const auditService = require('../../services/auditService');
const { asyncHandler, authenticate } = require('../middleware');
const { BadRequestError, PayloadTooLargeError } = require('../../lib/errors');

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.maxBytes, files: config.uploads.maxFiles, fields: 10 },
  defParamCharset: 'utf8',
  fileFilter(req, file, cb) {
    if (file.originalname) {
      file.originalname = fileService.decodeFilename(file.originalname);
    }
    const extension = fileService.extensionOf(file.originalname);
    if (!fileService.ALLOWED_EXTENSIONS.has(extension)) {
      return cb(
        new BadRequestError(
          `صيغة الملف «${extension || 'غير معروفة'}» غير مدعومة. الصيغ المقبولة: PDF, Word (DOCX), Excel (XLSX, XLS, XLSM), CSV, TXT وملفات النصوص البرمجية.`
        )
      );
    }
    cb(null, true);
  }
});

/** Translate multer's own errors into the application's error vocabulary. */
function handleUpload(req, res, next) {
  upload.array('files', config.uploads.maxFiles)(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: `حجم الملف يتجاوز الحد الأقصى (${Math.round(config.uploads.maxBytes / 1024 / 1024)} ميغابايت).`,
        LIMIT_FILE_COUNT: `لا يمكن رفع أكثر من ${config.uploads.maxFiles} ملفات في المرة الواحدة.`
      };
      return next(new PayloadTooLargeError(messages[err.code] || 'تعذّر رفع الملفات.'));
    }
    next(err);
  });
}

router.post(
  '/',
  authenticate,
  handleUpload,
  asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0) {
      throw new BadRequestError('لم يتم إرفاق أي ملفات');
    }

    req.files.forEach((f) => {
      if (f.originalname) {
        f.originalname = fileService.decodeFilename(f.originalname);
      }
    });

    const files = await fileService.extractAll(req.files);

    // Names and sizes only — extracted content is never written to the trail.
    auditService.record({
      userId: req.user.id,
      action: auditService.ACTIONS.FILES_UPLOADED,
      details: {
        count: files.length,
        files: files.map((f) => ({ name: f.filename, size: f.size, ok: f.success }))
      },
      ipAddress: req.ip
    });

    res.json({ files });
  })
);

module.exports = router;
