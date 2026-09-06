const { db, logAudit } = require('./db');

const MODELS_TIMEOUT_MS = 4000;
const CHAT_CONNECT_TIMEOUT_MS = 120000;

/**
 * Resolve the local inference endpoint.
 *
 * The value is operator-configurable, so it is validated before use: the
 * server must never be turned into a proxy that fetches arbitrary URLs on
 * behalf of a caller. Only http/https on a loopback or private address is
 * accepted, which matches the air-gapped deployment model.
 */
function assertSafeLmStudioUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (e) {
    throw new Error(`عنوان خادم النموذج غير صالح: ${raw}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('عنوان خادم النموذج يجب أن يبدأ بـ http:// أو https://');
  }

  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    /^127\./.test(host);
  const isPrivate =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    // Docker Desktop's host alias, used by the shipped compose file.
    host === 'host.docker.internal';

  if (!isLoopback && !isPrivate) {
    throw new Error('لأسباب أمنية، يُسمح فقط بعناوين محلية أو داخل الشبكة الخاصة لخادم النموذج');
  }

  return parsed.toString().replace(/\/+$/, '');
}

// The data layer is PostgreSQL-backed and asynchronous, so the settings
// lookup must be awaited — reading it synchronously yields a Promise and
// silently discards an operator-configured endpoint.
async function getLmStudioBaseUrl() {
  if (process.env.LM_STUDIO_URL) {
    return assertSafeLmStudioUrl(process.env.LM_STUDIO_URL);
  }
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'lm_studio_url'").get();
  return assertSafeLmStudioUrl(row?.value || 'http://127.0.0.1:1234/v1');
}

/**
 * Prepend the caller's institutional context to the system prompt.
 * The category data already came from the database in authMiddleware.
 */
function withInstitutionalContext(messages, user) {
  if (!user?.categoryPromptContext) return messages;

  const context = [
    '[المحددات المؤسسية للمستخدم]:',
    `- المسمى الوظيفي: ${user.jobTitle || 'مستشار'}`,
    `- الإدارة / التصنيف: ${user.categoryName || 'غير محدد'}`,
    `- التوجيه التخصصي: ${user.categoryPromptContext}`
  ].join('\n');

  const enriched = [...messages];
  const sysIndex = enriched.findIndex((m) => m.role === 'system');

  if (sysIndex >= 0) {
    enriched[sysIndex] = {
      ...enriched[sysIndex],
      content: `${enriched[sysIndex].content}\n\n${context}`
    };
  } else {
    enriched.unshift({ role: 'system', content: context });
  }
  return enriched;
}

function sendSseError(res, message) {
  // Delivered on the same channel the client is already reading, so a failure
  // that happens mid-answer is surfaced instead of silently truncating.
  res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function registerLmStudioRoutes(app, authMiddleware) {
  // ---------------- MODEL DISCOVERY ----------------
  //
  // Reports the real state of the local inference server. When LM Studio is
  // not reachable the answer is "not connected, no models" — the platform has
  // no substitute engine and must not imply that it has one.
  app.get(['/api/llm/models', '/api/lmstudio/models'], authMiddleware, async (req, res) => {
    let baseUrl;
    try {
      baseUrl = await getLmStudioBaseUrl();
    } catch (err) {
      return res.status(500).json({ connected: false, models: [], error: err.message });
    }

    try {
      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(MODELS_TIMEOUT_MS)
      });

      if (!response.ok) {
        return res.json({
          connected: false,
          baseUrl,
          models: [],
          error: `خادم النموذج المحلي ردّ بالحالة ${response.status}. تحقق من تشغيل LM Studio وتحميل نموذج.`
        });
      }

      const data = await response.json();
      const models = (data.data || []).map((m) => ({ id: m.id, object: m.object, source: 'LM Studio' }));

      if (models.length === 0) {
        return res.json({
          connected: false,
          baseUrl,
          models: [],
          error: 'خادم LM Studio يعمل لكن لا يوجد نموذج محمّل. يرجى تحميل نموذج من واجهة LM Studio.'
        });
      }

      return res.json({ connected: true, baseUrl, models });
    } catch (err) {
      return res.json({
        connected: false,
        baseUrl,
        models: [],
        error: 'تعذّر الاتصال بخادم النموذج المحلي (LM Studio). يرجى تشغيل Local Server من داخل LM Studio ثم إعادة المحاولة.'
      });
    }
  });

  // ---------------- CHAT COMPLETION (streaming) ----------------
  //
  // Proxies the local model and nothing else. If the model is unavailable the
  // request fails with an explicit error; no content is ever synthesised on
  // the model's behalf.
  app.post(['/api/llm/chat', '/api/lmstudio/chat/completions'], authMiddleware, async (req, res) => {
    const { model, messages, temperature, max_tokens } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'قائمة الرسائل غير صالحة' });
    }
    const shapeOk = messages.every(
      (m) => m && typeof m.content === 'string' && ['system', 'user', 'assistant'].includes(m.role)
    );
    if (!shapeOk) {
      return res.status(400).json({ error: 'بنية الرسائل غير صالحة' });
    }

    let baseUrl;
    try {
      baseUrl = await getLmStudioBaseUrl();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    const enrichedMessages = withInstitutionalContext(messages, req.user);
    const safeTemperature = Math.min(Math.max(Number(temperature) || 0.7, 0), 2);
    const safeMaxTokens = Math.min(Math.max(parseInt(max_tokens, 10) || 4096, 1), 32768);

    // Content is deliberately not recorded: the audit trail must not become a
    // second copy of classified conversations.
    logAudit(req.user.id, 'CHAT_QUERY', {
      messageCount: messages.length,
      requestedModel: model || null,
      userCategory: req.user.categoryName || null
    }, req.ip);

    // Abort the upstream request if the browser goes away mid-generation.
    const controller = new AbortController();
    const onClientClose = () => controller.abort();
    req.on('close', onClientClose);

    const connectTimeout = setTimeout(() => controller.abort(), CHAT_CONNECT_TIMEOUT_MS);

    let upstream;
    try {
      upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'default',
          messages: enrichedMessages,
          temperature: safeTemperature,
          max_tokens: safeMaxTokens,
          stream: true
        }),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(connectTimeout);
      req.off('close', onClientClose);
      if (controller.signal.aborted && res.writableEnded) return;

      console.error('LM Studio connection failed:', err.message);
      return res.status(503).json({
        code: 'MODEL_UNAVAILABLE',
        error: 'تعذّر الاتصال بخادم النموذج المحلي (LM Studio). لم يتم توليد أي رد. يرجى تشغيل Local Server ثم إعادة إرسال الطلب.'
      });
    }
    clearTimeout(connectTimeout);

    if (!upstream.ok) {
      req.off('close', onClientClose);
      const detail = await upstream.text().catch(() => '');
      console.error(`LM Studio returned ${upstream.status}: ${detail.slice(0, 500)}`);
      return res.status(502).json({
        code: 'MODEL_ERROR',
        error: `خادم النموذج المحلي ردّ بخطأ (${upstream.status}). لم يتم توليد أي رد.`
      });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder('utf-8');

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
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
      console.error('LM Studio stream interrupted:', err.message);
      // Headers are already sent, so the failure is reported inside the stream
      // rather than by attempting a status code that can no longer be set.
      if (!res.writableEnded) {
        sendSseError(res, 'انقطع الاتصال بخادم النموذج أثناء التوليد. الرد أعلاه غير مكتمل ولا يُعتد به.');
      }
    } finally {
      req.off('close', onClientClose);
      reader.cancel().catch(() => {});
    }
  });
}

module.exports = {
  registerLmStudioRoutes,
  getLmStudioBaseUrl,
  assertSafeLmStudioUrl
};
