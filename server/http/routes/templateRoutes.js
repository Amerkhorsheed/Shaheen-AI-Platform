'use strict';

const { Router } = require('express');

const templateService = require('../../services/templateService');
const { asyncHandler, authenticate, validate, writeLimiter } = require('../middleware');
const { createTemplateSchema, updateTemplateSchema } = require('../validators');

const router = Router();

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await templateService.list());
  })
);

router.post(
  '/',
  writeLimiter,
  validate(createTemplateSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await templateService.create(req.body, req.user, req.ip));
  })
);

router.put(
  '/:id',
  writeLimiter,
  validate(updateTemplateSchema),
  asyncHandler(async (req, res) => {
    res.json(await templateService.update(req.params.id, req.body, req.user, req.ip));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await templateService.remove(req.params.id, req.user, req.ip));
  })
);

module.exports = router;
