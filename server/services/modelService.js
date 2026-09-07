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

    return { connected: true, baseUrl, models };
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
  const body = {
    model: model || 'default',
    // `messages` already carries the composed system prompt: assembling it is
    // promptService's responsibility, not this transport's.
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
    // Instructs LM Studio / llama.cpp to preserve the prefix KV cache across turns
    cache_prompt: true
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
    logger.warn({ status: upstream.status, detail: detail.slice(0, 300) }, 'Model returned an error');
    throw new ModelError(`خادم النموذج المحلي ردّ بخطأ (${upstream.status}). لم يتم توليد أي رد.`);
  }

  return upstream;
}

function clampTemperature(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 2) : 0.7;
}

function clampMaxTokens(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 32768) : 4096;
}

module.exports = {
  assertSafeModelUrl,
  resolveBaseUrl,
  listModels,
  openChatStream,
  clampTemperature,
  clampMaxTokens
};
