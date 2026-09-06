'use strict';

const { Router } = require('express');

const documentService = require('../../services/documentService');
const exportTicketService = require('../../services/exportTicketService');
const {
  asyncHandler,
  authenticate,
  validate,
  requireExportTicket,
  writeLimiter
} = require('../middleware');
const { exportDocumentSchema, exportDatasetSchema } = require('../validators');

const router = Router();

/** Short-lived, single-use credential for a form-navigated export. */
router.post(
  '/ticket',
  authenticate,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json({
      ticket: exportTicketService.issue(req.user),
      expiresInMs: exportTicketService.ttlMs
    });
  })
);

/** Confirm a reference number printed on an exported document. */
router.get(
  '/verify/:ref',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await documentService.verify(req.params.ref));
  })
);

router.post(
  '/pdf-page',
  // The ticket is the credential, so it is checked before the body schema:
  // a missing ticket must be answered as "not authorised", not "invalid input".
  requireExportTicket,
  validate(exportDocumentSchema),
  asyncHandler(async (req, res) => {
    const { html, csp } = await documentService.buildDocument({
      title: req.body.title,
      content: req.body.content,
      metadata: req.body.metadata,
      user: req.exportUser,
      ipAddress: req.ip
    });

    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.type('html').send(html);
  })
);

router.post(
  '/csv-page',
  requireExportTicket,
  validate(exportDatasetSchema),
  asyncHandler(async (req, res) => {
    const { html, csp } = await documentService.buildDatasetPortal({
      csvData: req.body.csvData,
      tableTitle: req.body.tableTitle,
      filename: req.body.filename,
      user: req.exportUser,
      ipAddress: req.ip,
      // The nested download form needs its own single-use ticket.
      issueNestedTicket: () => exportTicketService.issue(req.exportUser)
    });

    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.type('html').send(html);
  })
);

router.post(
  '/xlsx',
  requireExportTicket,
  validate(exportDatasetSchema),
  asyncHandler(async (req, res) => {
    const { buffer, disposition } = await documentService.buildSpreadsheet({
      csvData: req.body.csvData,
      filename: req.body.filename,
      title: req.body.title || req.body.tableTitle,
      user: req.exportUser,
      ipAddress: req.ip
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', disposition);
    res.send(buffer);
  })
);

module.exports = router;
