'use strict';

const { Router } = require('express');

const userService = require('../../services/userService');
const auditService = require('../../services/auditService');
const {
  asyncHandler,
  authenticate,
  authenticateOptional,
  requireAdmin,
  validate,
  writeLimiter
} = require('../middleware');
const {
  createUserSchema,
  updateUserSchema,
  userIdParam,
  paginationSchema
} = require('../validators');

const router = Router();

router.get(
  '/users',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await userService.list());
  })
);

router.get(
  '/users/stats',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await userService.statistics());
  })
);

// Creation is administrative. Self-registration is reachable only when an
// administrator has enabled it, and the service decides what it may grant.
router.post(
  '/users',
  writeLimiter,
  authenticateOptional,
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const result = await userService.create(req.body, req.user ?? null, req.ip);
    res.status(201).json(result);
  })
);

router.put(
  '/users/:id',
  authenticate,
  requireAdmin,
  writeLimiter,
  validate(userIdParam, 'params'),
  validate(updateUserSchema),
  asyncHandler(async (req, res) => {
    res.json(await userService.update(req.params.id, req.body, req.user, req.ip));
  })
);

router.delete(
  '/users/:id',
  authenticate,
  requireAdmin,
  validate(userIdParam, 'params'),
  asyncHandler(async (req, res) => {
    res.json(await userService.remove(req.params.id, req.user, req.ip));
  })
);

router.get(
  '/audit-logs',
  authenticate,
  requireAdmin,
  validate(paginationSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await auditService.list(req.validatedQuery));
  })
);

module.exports = router;
