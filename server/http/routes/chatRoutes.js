'use strict';

const { Router } = require('express');

const chatService = require('../../services/chatService');
const { asyncHandler, authenticate, validate, writeLimiter } = require('../middleware');
const { createChatSchema, updateChatSchema, createMessageSchema } = require('../validators');

const router = Router();

// Every handler passes `req.user.id` into the service, which scopes the query
// by owner. There is no path that reaches a chat by id alone.
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await chatService.list(req.user.id));
  })
);

router.post(
  '/',
  writeLimiter,
  validate(createChatSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await chatService.create(req.body, req.user.id));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await chatService.get(req.params.id, req.user.id));
  })
);

router.put(
  '/:id',
  writeLimiter,
  validate(updateChatSchema),
  asyncHandler(async (req, res) => {
    res.json(await chatService.update(req.params.id, req.user.id, req.body));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await chatService.remove(req.params.id, req.user.id, req.ip));
  })
);

router.post(
  '/:id/messages',
  writeLimiter,
  validate(createMessageSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await chatService.addMessage(req.params.id, req.user.id, req.body));
  })
);

router.delete(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    res.json(await chatService.clearMessages(req.params.id, req.user.id, req.ip));
  })
);

module.exports = router;
