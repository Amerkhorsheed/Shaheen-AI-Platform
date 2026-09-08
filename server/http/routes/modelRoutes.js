'use strict';

/**
 * Local inference engine endpoints.
 *
 * The streaming handler owns the response socket, so it does its own error
 * reporting: once headers are sent a status code can no longer be set, and a
 * failure has to be delivered inside the stream instead. A truncated answer
 * with no explanation would be indistinguishable from a complete one.
 */

const { Router } = require('express');

const config = require('../../config');
const modelService = require('../../services/modelService');
const promptService = require('../../services/promptService');
const routerService = require('../../services/routerService');
const chatService = require('../../services/chatService');
const auditService = require('../../services/auditService');
const logger = require('../../lib/logger');
const { estimateMessagesTokens } = require('../../lib/tokenEstimator');
const { asyncHandler, authenticate, validate } = require('../middleware');
const { chatCompletionSchema } = require('../validators');

const router = Router();

// Authentication is attached per route rather than with `router.use`: this
// router is mounted at the API root, so a blanket middleware here would run
// for every unmatched /api path and answer 401 where a 404 is correct.
router.get(
  ['/llm/models', '/lmstudio/models'],
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await modelService.listModels());
  })
);

router.post(
  ['/llm/chat', '/lmstudio/chat/completions'],
  authenticate,
  validate(chatCompletionSchema),
  asyncHandler(async (req, res) => {
    const { model, messages, temperature, max_tokens: maxTokens, chatId } = req.body;

    // A chat may carry its own classification and an additional session note.
    // Loading it through the service keeps the ownership check in place.
    let classification = 'official';
    let sessionNote = '';
    if (chatId) {
      const chat = await chatService.requireOwned(chatId, req.user.id);
      classification = chat.classification || 'official';
      sessionNote = chat.system_prompt || '';
    }

    let targetModel = model;
    let routingMeta = null;

    if (!targetModel || targetModel === 'auto' || targetModel === 'default') {
      const currentLoaded = await modelService.getCurrentlyLoadedModel();
      routingMeta = await routerService.resolveRoute({
        messages,
        currentModel: currentLoaded,
        user: req.user
      });
      targetModel = routingMeta.model;
    }

    // The system prompt is composed here and replaces anything the client
    // sent. A browser must not be able to weaken the charter.
    const { messages: prepared, layers } = await promptService.applyTo(messages, {
      user: req.user,
      classification,
      sessionNote,
      model: targetModel
    });

    // Content is deliberately not recorded: the audit trail must not become a
    // second, less protected copy of classified conversations.
    auditService.record({
      userId: req.user.id,
      action: auditService.ACTIONS.CHAT_QUERY,
      details: {
        messageCount: messages.length,
        estimatedPromptTokens: estimateMessagesTokens(prepared),
        requestedModel: model || null,
        resolvedModel: targetModel,
        routingReason: routingMeta?.reason || 'تحديد يدوي من المستخدم',
        routingConfidence: routingMeta?.confidence || 1.0,
        swapped: routingMeta?.swapped || false,
        userCategory: req.user.categoryName || null,
        classification,
        promptModules: (layers.modules || []).map((m) => m.id)
      },
      ipAddress: req.ip
    });

    const controller = new AbortController();
    const abortUpstream = () => controller.abort();
    // Stop generating as soon as the browser goes away.
    req.on('close', abortUpstream);

    const connectTimeout = setTimeout(abortUpstream, config.model.connectTimeoutMs);

    let upstream;
    try {
      upstream = await modelService.openChatStream({
        model: targetModel,
        messages: prepared,
        temperature: modelService.clampTemperature(temperature, targetModel),
        maxTokens: modelService.clampMaxTokens(maxTokens),
        signal: controller.signal
      });
    } finally {
      clearTimeout(connectTimeout);
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (routingMeta) {
      res.setHeader('X-Resolved-Model', targetModel);
    }
    res.flushHeaders?.();
    res.write(': connected\n\n');
    if (routingMeta) {
      res.write(`data: ${JSON.stringify({
        choices: [{ delta: { routing: routingMeta } }]
      })}\n\n`);
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder('utf-8');

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        // Respect backpressure rather than buffering the whole answer.
        if (!res.write(decoder.decode(value, { stream: true }))) {
          await new Promise((resolve) => res.once('drain', resolve));
        }
      }
      res.end();
    } catch (err) {
      if (controller.signal.aborted) {
        // Client navigated away; nothing to report.
        return res.end();
      }

      logger.warn({ err: err.message }, 'Model stream interrupted');
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({
            error: 'انقطع الاتصال بخادم النموذج أثناء التوليد. الرد أعلاه غير مكتمل ولا يُعتد به.'
          })}\n\n`
        );
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } finally {
      req.off('close', abortUpstream);
      reader.cancel().catch(() => {});
    }
  })
);

module.exports = router;
