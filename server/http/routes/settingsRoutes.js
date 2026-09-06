'use strict';

const { Router } = require('express');

const settingsService = require('../../services/settingsService');
const { asyncHandler, authenticate, requireAdmin, validate, writeLimiter } = require('../middleware');
const { updateSettingsSchema } = require('../validators');

const router = Router();

// Settings describe how the deployment is configured, including whether
// self-registration is open. That is not public information.
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await settingsService.getPublicSettings());
  })
);

router.put(
  '/',
  authenticate,
  requireAdmin,
  writeLimiter,
  validate(updateSettingsSchema),
  asyncHandler(async (req, res) => {
    res.json(await settingsService.update(req.body, req.user, req.ip));
  })
);

module.exports = router;
