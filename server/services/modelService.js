'use strict';

/**
 * Local inference engine (LM Studio).
 *
 * This module proxies the local model and does nothing else. It never
 * synthesises content: if the model is unreachable or returns an error, the
 * caller gets an error. An earlier version generated official-looking
 * documents with invented statistics whenever the model was down, and streamed
 * them with a simulated typing delay so they were indistinguishable from a
 * real answer. Nothing of that kind may be reintroduced here.
 */

const config = require('../config');
const settingsRepository = require('../repositories/settingsRepository');
const logger = require('../lib/logger');
const { BadRequestError, ModelUnavailableError, ModelError } = require('../lib/errors');

const DEFAULT_URL = 'http://127.0.0.1:1234/v1';

/**
 * Validate an inference endpoint before it is used.
 *
 * The value is operator-configurable, so without this the server would be a
 * general-purpose proxy: an administrator (or anyone who could write the
 * setting) could point it at cloud metadata endpoints or internal services.
 * Only loopback and private ranges are accepted, which is also exactly what
 * the air-gapped deployment model requires.
 *
 * @throws {BadRequestError}
 */
function assertSafeModelUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (err) {
    throw new BadRequestError(`عنوان خادم النموذج غير صالح: ${raw}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BadRequestError('عنوان خادم النموذج يجب أن يبدأ بـ http:// أو https://');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  const isLoopback = host === 'localhost' || host === '::1' || /^127\./.test(host);
  const isPrivate =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    // Docker Desktop's host alias, used by the shipped compose file.
    host === 'host.docker.internal';

  if (!isLoopback && !isPrivate) {
    throw new BadRequestError(
      'لأسباب أمنية، يُسمح فقط بعناوين محلية أو داخل الشبكة الخاصة لخادم النموذج'
    );
  }

  return parsed.toString().replace(/\/+$/, '');
}

/** Environment wins over the stored setting, so a container can pin it. */
async function resolveBaseUrl() {
  const configured = config.model.url || (await settingsRepository.getValue('lm_studio_url')) || DEFAULT_URL;
  return assertSafeModelUrl(configured);
}

const SMART_ROUTER_MODEL = {
  id: 'auto',
  label: '🤖 التوجيه الذكي التلقائي (Auto Router)',
  description: 'يكتشف طبيعة الاستفسار تلقائياً ويوجّهه للمحرك المتخصص مع منع التبديل غير اللازم',
  role: 'smart',
  source: 'Platform'
};

let lastKnownLoadedModel = null;
let lastKnownLoadedTime = 0;

async function getCurrentlyLoadedModel() {
  const now = Date.now();
  if (lastKnownLoadedModel && now - lastKnownLoadedTime < 3000) {
    return lastKnownLoadedModel;
  }

  try {
    const baseUrl = await resolveBaseUrl();
    const res = await fetch(`${baseUrl.replace(/\/v1\/?$/, '')}/api/v0/models`, {
      signal: AbortSignal.timeout(2000)
    });
    if (res.ok) {
      const data = await res.json();
      const loaded = (data.data || []).find((m) => m.state === 'loaded');
      if (loaded?.id) {
        lastKnownLoadedModel = loaded.id;
        lastKnownLoadedTime = now;
        return loaded.id;
      }
    }
  } catch (e) {
    // If endpoint fails, fallback to last known
  }

  // «Nothing is loaded» is reported as nothing, not as a guess. Naming a model
  // here made the guess self-fulfilling: on the first request after the engine
  // restarts, the router probes the model it was told was resident, the engine
  // loads that model to answer the probe, and it is then the resident one for
  // every request that follows — whichever model the operator had actually
  // configured. The caller substitutes its own default, which is the model the
  // platform is meant to run on.
  return lastKnownLoadedModel || null;
}

const contextWindowCache = new Map();
const CONTEXT_CACHE_TTL_MS = 30_000;

let loadedIdsCache = { value: null, at: 0 };

/**
 * Every model currently resident in VRAM.
 *
 * The router needs this to know whether a swap is free or ruinous. On the
 * reference deployment two of the three installed models are 16 GB and 20 GB
 * against a 32 GB card: asking the engine for the one that is not loaded makes
 * it load that one *alongside* the resident model rather than in place of it,
 * the pair overflows the card, and the layers that no longer fit are computed
 * on the CPU. Generation then takes eleven minutes instead of twenty seconds —
 * which reads to the user as a hang, not as a routing decision.
 *
 * @returns {Promise<string[]>} Loaded model ids; empty when unknown.
 */
async function getLoadedModelIds() {
  const now = Date.now();
  if (loadedIdsCache.value && now - loadedIdsCache.at < 3000) return loadedIdsCache.value;

  try {
    const baseUrl = await resolveBaseUrl();
    const res = await fetch(`${baseUrl.replace(/\/v1\/?$/, '')}/api/v0/models`, {
      signal: AbortSignal.timeout(2000)
    });
    if (res.ok) {
      const data = await res.json();
      const ids = (data.data || []).filter((m) => m.state === 'loaded').map((m) => m.id);
      loadedIdsCache = { value: ids, at: now };
      return ids;
    }
  } catch (_) {
    // Not LM Studio, or unreachable: the caller treats an empty list as
    // "unknown" and leaves routing exactly as it was.
  }

  return [];
}

/**
 * How many tokens the engine will actually accept for this model.
 *
 * The prompt budget used to be the constant 26,000 — a number chosen for a
 * 32K deployment and then left in place while the operator loaded a model at
 * 38,912 and another capable of 262,144. Under-reading the window is not free:
 * it truncates the dossier the analysis depends on, on a machine with the room
 * to hold it several times over.
 *
 * Only `loaded_context_length` is trusted. A model that is not resident reports
 * the ceiling of the architecture, not the size LM Studio will choose when it
 * loads it on demand, and sizing a prompt to that ceiling would overflow the
 * engine on the first request.
 *
 * @returns {Promise<number|null>} Tokens, or null when the model is not loaded.
 */
async function getLoadedContextLength(modelId) {
  if (!modelId) return null;

  const cached = contextWindowCache.get(modelId);
  if (cached && Date.now() - cached.at < CONTEXT_CACHE_TTL_MS) return cached.value;

  try {
    const baseUrl = await resolveBaseUrl();
    const res = await fetch(`${baseUrl.replace(/\/v1\/?$/, '')}/api/v0/models`, {
      signal: AbortSignal.timeout(2000)
    });
    if (res.ok) {
      const data = await res.json();
      const entry = (data.data || []).find((m) => m.id === modelId);
      const value =
        entry && entry.state === 'loaded' && Number(entry.loaded_context_length) > 0
          ? Number(entry.loaded_context_length)
          : null;
      contextWindowCache.set(modelId, { value, at: Date.now() });
      return value;
    }
  } catch (_) {
    // The endpoint is LM Studio-specific; any other engine simply falls back.
  }

  return null;
}

/**
 * Report the real state of the local engine.
 * There is no substitute engine, so "not connected" means no models.
 */
async function listModels() {
  const baseUrl = await resolveBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.model.listTimeoutMs)
    });

    if (!response.ok) {
      return {
        connected: false,
        baseUrl,
        models: [],
        error: `خادم النموذج المحلي ردّ بالحالة ${response.status}. تحقق من تشغيل LM Studio وتحميل نموذج.`
      };
    }

    const payload = await response.json();
    const models = (payload.data || [])
      .filter((m) => {
        const id = (m.id || '').toLowerCase();
        return !id.includes('embed') && !id.includes('embedding') && !id.includes('bge-') && !id.includes('nomic');
      })
      .map((m) => {
        const id = m.id;
        let role = 'general';
        let label = id;
        let description = 'نموذج محلي معتمد';

        if (id.toLowerCase().includes('deepseek') || id.toLowerCase().includes('r1')) {
          role = 'finance';
          label = 'DeepSeek-R1 (المحاسبة والتدقيق المالي)';
          description = 'متخصص في العمليات الحسابية وتدقيق الموازنات والنسب المالية';
        } else if (id.toLowerCase().includes('qwen')) {
          role = 'administrative';
          label = 'Qwen 3.8 (المراسلات والتقارير الإدارية)';
          description = 'متخصص في صياغة الكتب الرسمية وإعداد التقارير الإدارية';
        }

        return {
          id: m.id,
          object: m.object,
          label,
          description,
          role,
          source: 'LM Studio'
        };
      });

    if (models.length === 0) {
      return {
        connected: false,
        baseUrl,
        models: [],
        error: 'خادم LM Studio يعمل لكن لا يوجد نموذج محمّل. يرجى تحميل نموذج من واجهة LM Studio.'
      };
    }

    return { connected: true, baseUrl, models: [SMART_ROUTER_MODEL, ...models] };
  } catch (err) {
    logger.debug({ err: err.message, baseUrl }, 'Model server unreachable');
    return {
      connected: false,
      baseUrl,
      models: [],
      error:
        'تعذّر الاتصال بخادم النموذج المحلي (LM Studio). يرجى تشغيل Local Server من داخل LM Studio ثم إعادة المحاولة.'
    };
  }
}

/**
 * Open a streaming completion against the local model.
 *
 * Returns the upstream response so the route can pipe it; throws a typed error
 * when the engine is unreachable or unhappy. The caller owns the abort signal
 * so the upstream request is cancelled when the browser goes away.
 *
 * @returns {Promise<Response>}
 */
async function openChatStream({ model, messages, temperature, maxTokens, signal }) {
  const baseUrl = await resolveBaseUrl();
  const effectiveTemp = clampTemperature(temperature, model);
  const body = {
    model: model || 'default',
    // `messages` already carries the composed system prompt: assembling it is
    // promptService's responsibility, not this transport's.
    messages,
    temperature: effectiveTemp,
    max_tokens: maxTokens,
    stream: true,
    // Instructs LM Studio / llama.cpp to preserve the prefix KV cache across turns
    cache_prompt: true,
    // Modern dynamic truncation (Min-P) cuts off low-probability noise without harming high-temperature reasoning or Arabic vocabulary
    min_p: 0.05,
    repeat_penalty: 1.05
  };

  let upstream;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });
  } catch (err) {
    logger.warn({ err: err.message, baseUrl }, 'Model connection failed');
    throw new ModelUnavailableError(
      'تعذّر الاتصال بخادم النموذج المحلي (LM Studio). لم يتم توليد أي رد. يرجى تشغيل Local Server ثم إعادة إرسال الطلب.',
      { cause: err }
    );
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    logger.warn({ status: upstream.status, detail: detail.slice(0, 500) }, 'Model returned an error');
    let userMsg = `خادم النموذج المحلي ردّ بخطأ (${upstream.status}). لم يتم توليد أي رد.`;
    if (upstream.status === 400 && (detail.toLowerCase().includes('context') || detail.toLowerCase().includes('too long') || detail.toLowerCase().includes('maximum') || detail.toLowerCase().includes('token'))) {
      userMsg = 'حجم البيانات والمستند المرفق يتجاوز السعة الاستيعابية لنافذة سياق النموذج (Context Limit). تم تفعيل الاقتطاع الذكي، يرجى إعادة إرسال السؤال.';
    }
    throw new ModelError(userMsg);
  }

  return upstream;
}

function clampTemperature(value, model = '') {
  const isDeepSeek = (model || '').toLowerCase().includes('deepseek') || (model || '').toLowerCase().includes('r1');
  const isQwen = !isDeepSeek && (model || '').toLowerCase().includes('qwen');

  const n = Number(value);
  if (!Number.isFinite(n)) {
    if (isDeepSeek) return 0.6;
    if (isQwen) return 0.45;
    return 0.7;
  }

  // When caller passes schema default 0.7 without explicit customization, adapt to optimal model temperature
  if (n === 0.7) {
    if (isDeepSeek) return 0.6;
    if (isQwen) return 0.45;
  }

  return Math.min(Math.max(n, 0), 2);
}

function clampMaxTokens(value, model = '') {
  const n = Number.parseInt(value, 10);
  const isThinkingModel = (model || '').toLowerCase().includes('deepseek') || (model || '').toLowerCase().includes('r1') || (model || '').toLowerCase().includes('qwen');

  // Thinking models generate reasoning_content first; allocate 8192 tokens so thinking + content never get truncated
  if (!Number.isFinite(n) || n <= 4096) {
    // A floor of 1 is what keeps a caller-supplied 0 from asking the engine for
    // an empty completion. The per-model allowance above it is unchanged.
    return isThinkingModel ? 8192 : (Number.isFinite(n) ? Math.max(n, 1) : 4096);
  }
  return Math.min(Math.max(n, 1), 131072);
}

module.exports = {
  assertSafeModelUrl,
  resolveBaseUrl,
  listModels,
  openChatStream,
  clampTemperature,
  clampMaxTokens,
  getCurrentlyLoadedModel,
  getLoadedContextLength,
  getLoadedModelIds
};
