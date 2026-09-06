'use strict';

/**
 * System-prompt administration.
 *
 * Makes the instructions the model receives visible and editable, instead of
 * leaving them as invisible configuration nobody can inspect. Reading is open
 * to any authenticated user — a civil servant is entitled to know what the
 * assistant has been told; changing them is administrative.
 */

const { Router } = require('express');

const promptService = require('../../services/promptService');
const { asyncHandler, authenticate, requireAdmin, validate, writeLimiter } = require('../middleware');
const {
  createPromptModuleSchema,
  updatePromptModuleSchema,
  setCategoryModulesSchema,
  promptPreviewSchema
} = require('../validators');

const router = Router();

router.use(authenticate);

/** The charter — layer 1, binding on every request. */
router.get(
  '/charter',
  asyncHandler(async (req, res) => {
    res.json({ charter: await promptService.getCharter() });
  })
);

/** Reusable modules — layer 2 — with the number of categories using each. */
router.get(
  '/modules',
  asyncHandler(async (req, res) => {
    res.json(await promptService.listModules());
  })
);

router.get(
  '/modules/:id',
  asyncHandler(async (req, res) => {
    res.json(await promptService.getModule(req.params.id));
  })
);

router.post(
  '/modules',
  requireAdmin,
  writeLimiter,
  validate(createPromptModuleSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await promptService.createModule(req.body, req.user, req.ip));
  })
);

router.put(
  '/modules/:id',
  requireAdmin,
  writeLimiter,
  validate(updatePromptModuleSchema),
  asyncHandler(async (req, res) => {
    res.json(await promptService.updateModule(req.params.id, req.body, req.user, req.ip));
  })
);

router.delete(
  '/modules/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await promptService.deleteModule(req.params.id, req.user, req.ip));
  })
);

/** Which modules a category references, in assembly order. */
router.get(
  '/categories/:categoryId/modules',
  asyncHandler(async (req, res) => {
    res.json(await promptService.listModulesForCategory(req.params.categoryId));
  })
);

router.put(
  '/categories/:categoryId/modules',
  requireAdmin,
  writeLimiter,
  validate(setCategoryModulesSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await promptService.setCategoryModules(
        req.params.categoryId,
        req.body.moduleIds,
        req.user,
        req.ip
      )
    );
  })
);

/**
 * The exact text a category produces, fully assembled.
 * An administrator can read what the model will be told before anyone relies
 * on it.
 */
router.get(
  '/preview/:categoryId',
  validate(promptPreviewSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await promptService.preview(req.params.categoryId, req.validatedQuery.classification));
  })
);

/** What the calling user's own next request will carry. */
router.get(
  '/effective',
  asyncHandler(async (req, res) => {
    const { prompt, layers } = await promptService.compose({
      user: req.user,
      classification: req.query.classification || 'official'
    });
    res.json({ prompt, layers });
  })
);

module.exports = router;
