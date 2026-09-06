'use strict';

const { Router } = require('express');

const categoryService = require('../../services/categoryService');
const { asyncHandler, authenticate, requireAdmin, validate, writeLimiter } = require('../middleware');
const { createCategorySchema } = require('../validators');

const router = Router();

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await categoryService.list());
  })
);

router.post(
  '/',
  authenticate,
  requireAdmin,
  writeLimiter,
  validate(createCategorySchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await categoryService.create(req.body, req.user, req.ip));
  })
);

router.delete(
  '/:id',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await categoryService.remove(req.params.id, req.user, req.ip));
  })
);

module.exports = router;
