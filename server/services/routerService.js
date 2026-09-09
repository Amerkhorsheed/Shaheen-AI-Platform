'use strict';

/**
 * Sovereign AI-Driven Semantic Query Router (LLM-Arbiter).
 *
 * Rather than relying on rigid static regex or brittle keyword matching, this
 * service employs the Foundation Model currently resident in VRAM as an
 * autonomous, intelligent Arbiter.
 *
 * Dynamic Multi-Stage Flow:
 * 1. Fast-Path Bypass: Trivial greetings & continuations (e.g. "مرحبا", "شكراً")
 *    bypass evaluation to ensure 0ms latency.
 * 2. Active-Model Zero-Shot Arbitration: The resident model in VRAM (Qwen or DeepSeek)
 *    evaluates the prompt's deep semantic intent, recognizing context, legal
 *    citations, decree numbers, and financial/administrative substance.
 * 3. Sticky Hysteresis (Anti-Thrashing): Requires high confidence (>=75%) to trigger
 *    an 11-second VRAM model swap, eliminating ping-pong latency on follow-ups.
 * 4. Fault-Tolerant Fallback: If the LLM probe times out or fails, an emergency
 *    heuristic guarantees zero downtime.
 */

const logger = require('../lib/logger');
const modelService = require('./modelService');
const { isReasoningModel } = require('../lib/modelFamily');
const { ROUTING_ARBITER_DIRECTIVE, buildArbiterRequestBlock } = require('../db/promptLibrary');

const MODEL_ADMINISTRATIVE = 'qwen3.8-27b';
const MODEL_FINANCIAL = 'deepseek-r1-distill-qwen-32b';

// Fast bypass triggers for trivial conversational turns
const TRIVIAL_GREETINGS = new Set([
  'مرحبا', 'مرحباً', 'أهلا', 'أهلاً', 'السلام عليكم', 'صباح الخير', 'مساء الخير',
  'شكرا', 'شكراً', 'يعطيك العافية', 'تمام', 'أكمل', 'تابع', 'استمر', 'نعم', 'لا'
]);

// High-Performance In-Memory Semantic Route Cache (System RAM Cache)
// Caches LLM arbitration results in physical RAM to provide 0.01ms resolution on repeated/similar queries
const ROUTE_CACHE = new Map();
const ROUTE_CACHE_MAX_ENTRIES = 1000;
const ROUTE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL

function normalizeCacheKey(text) {
  return (text || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 300);
}

/**
 * Check if the input is a trivial greeting or continuation
 */
function isTrivialInput(text) {
  const trimmed = (text || '').trim();
  const words = trimmed.split(/\s+/);
  if (words.length <= 3 && TRIVIAL_GREETINGS.has(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Extract clean JSON from LLM output (handles markdown code fences and reasoning traces)
 */
function extractJson(text) {
  if (!text) return null;

  // 1. Try markdown code fence: ```json { ... } ```
  const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // continue to fallback
    }
  }

  // 2. Try raw JSON object pattern: { ... }
  const objectMatch = text.match(/\{[\s\S]*?\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // continue
    }
  }

  return null;
}

/**
 * Distills user prompt and attached files into a concise intent summary (<300 tokens)
 * so the resident LLM arbiter responds in milliseconds without context saturation or timeout.
 */
function extractArbiterIntent(fullPromptText) {
  if (!fullPromptText) return '';
  const marker = '[محتوى الملف المرفق:';
  const markerIndex = fullPromptText.indexOf(marker);
  if (markerIndex === -1) {
    return fullPromptText.slice(0, 1200).trim();
  }

  const userQuery = fullPromptText.slice(0, markerIndex).trim();
  const attachmentPart = fullPromptText.slice(markerIndex);

  // Extract attachment name
  const nameMatch = attachmentPart.match(/\[محتوى الملف المرفق:\s*([^\]]+)\]/);
  const fileName = nameMatch ? nameMatch[1].trim() : 'ملف مرفق';

  // Extract preview of file content (first 500 chars)
  const codeBlockIndex = attachmentPart.indexOf('```');
  let snippet = '';
  if (codeBlockIndex !== -1) {
    snippet = attachmentPart.slice(codeBlockIndex + 3, codeBlockIndex + 600).replace(/```/g, '').trim();
  } else {
    snippet = attachmentPart.slice(0, 600).trim();
  }

  return `طلب المستخدم: ${userQuery || 'تحليل وتدقيق المستند المرفق'}\nالملف المرفق: ${fileName}\nمقتطف من محتوى الملف:\n${snippet}`;
}

/**
 * Ask the model currently resident in VRAM to classify the intent
 */
async function queryResidentLLMArbiter({ promptText, activeModel }) {
  const baseUrl = await modelService.resolveBaseUrl();
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const fetchImpl = globalThis.fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    // The same delivery rule the prompt composer applies: reasoning models take
    // their instructions in the user turn, everything else in a system message.
    const requestBlock = buildArbiterRequestBlock(promptText);

    const messages = isReasoningModel(activeModel)
      ? [
          {
            role: 'user',
            content: `${ROUTING_ARBITER_DIRECTIVE}\n\n${requestBlock}\n\nأجب الآن بكائن JSON وحده.`
          }
        ]
      : [
          { role: 'system', content: ROUTING_ARBITER_DIRECTIVE },
          { role: 'user', content: requestBlock }
        ];

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: activeModel || MODEL_ADMINISTRATIVE,
        messages,
        temperature: 0.1,
        max_tokens: 350
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`LM Studio returned status ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const reasoning = data.choices?.[0]?.message?.reasoning_content || '';

    // Attempt JSON extraction from content first, then reasoning
    let parsed = extractJson(content) || extractJson(reasoning);

    if (!parsed) {
      // Robust regex for structured decision keywords
      if (/"decision"\s*:\s*"?FINANCE"?/i.test(content) || /"decision"\s*:\s*"?FINANCE"?/i.test(reasoning)) {
        parsed = { decision: 'FINANCE', confidence: 0.95, reason: 'تحكيم الذكاء الاصطناعي: اختصاص مالي ومحاسبي' };
      } else if (/"decision"\s*:\s*"?ADMIN"?/i.test(content) || /"decision"\s*:\s*"?ADMIN"?/i.test(reasoning)) {
        parsed = { decision: 'ADMIN', confidence: 0.95, reason: 'تحكيم الذكاء الاصطناعي: اختصاص مراسلات وصياغة إدارية' };
      }
    }

    logger.info(
      {
        hasParsed: Boolean(parsed),
        decision: parsed?.decision,
        confidence: parsed?.confidence,
        contentPreview: content.slice(0, 100),
        reasoningPreview: reasoning.slice(0, 100)
      },
      'LLM Arbiter probe completed'
    );

    return parsed;
  } catch (err) {
    logger.warn({ err: err.message }, 'LLM Arbiter probe failed or timed out, falling back to heuristic');
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Emergency heuristic fallback when LLM probe is unavailable
 */
function emergencyHeuristicFallback(text) {
  const normalized = (text || '').toLowerCase();

  // 1. Administrative, organisational or educational context.
  //
  // The vocabulary is deliberately generic. An earlier revision listed the
  // exact phrases of one test document ('فصل صيفي', 'مشروع المادة', 'امتحان
  // عملي'), which routed that document correctly and its neighbours by luck.
  const isAdministrative =
    /(?:مراسلة رسمية|كتاب رسمي|تعميم|قرار وزاري|مذكرة|ديوان|شؤون إدارية|توصيف وظيفي|ملاك عددي)/i.test(normalized) ||
    /(?:خطة دراسية|مقرر|منهاج|محاضرة|كلية|جامعة|معهد|مدرسة|طلاب|تدريس)/i.test(normalized) ||
    /(?:تقرير (?:ال)?إنجاز|تقرير (?:ال)?متابعة|نسبة (?:ال)?إنجاز|متابعة (?:ال)?تنفيذ|دوام|حضور وغياب|سير العمل)/i.test(normalized);

  if (isAdministrative) {
    return {
      decision: 'ADMIN',
      confidence: 0.95,
      reason: 'تحكيم احتياطي: رصد سياق إداري أو تنظيمي أو تعليمي'
    };
  }

  // 2. Strict financial keywords (accounting, tax, budget, fiscal procurement, calculation queries)
  const isFinance = /(?:ميزانية|موازنة|ضريبة|ضرائب|محاسب|أرباح|خسائر|سيولة|قيد محاسبي|فوائد بنكية|تدقيق مالي|تدقيق محاسبي|عقود مشتريات|حساب المجموع|فاتورة|فواتير|سعر الوحدة|إجمالي التكلفة|ل\.س|ليرة سورية|دولار|\$|syp|توازن مالي|تسوية بنكية)/i.test(normalized);

  return {
    decision: isFinance ? 'FINANCE' : 'ADMIN',
    confidence: isFinance ? 0.85 : 0.75,
    reason: isFinance ? 'تحكيم احتياطي: رصد مؤشرات مالية/محاسبية صريحة' : 'تحكيم احتياطي: رصد سياق إداري/عام'
  };
}

/**
 * Resolve the optimal target model using autonomous LLM arbitration.
 *
 * @param {Object} options
 * @param {Array} options.messages - The conversation messages
 * @param {string} [options.currentModel] - The model currently in VRAM
 * @param {Object} [options.user] - Authenticated user context
 * @returns {Promise<Object>} Routing metadata
 */
async function resolveRoute({ messages, currentModel, user }) {
  const activeResident = (currentModel && currentModel !== 'auto' && currentModel !== 'default')
    ? currentModel
    : MODEL_ADMINISTRATIVE;

  const isCurrentDeepSeek = activeResident.toLowerCase().includes('deepseek') || activeResident.toLowerCase().includes('r1');
  const isCurrentQwen = !isCurrentDeepSeek && activeResident.toLowerCase().includes('qwen');

  // Extract the latest user query
  const userMessages = (messages || []).filter((m) => m.role === 'user');
  const lastUserMessage = userMessages[userMessages.length - 1];
  const promptText = (lastUserMessage?.content || '').trim();
  const distilledIntent = extractArbiterIntent(promptText);

  // 1. Fast-Path: Trivial inputs do not incur LLM evaluation latency
  if (isTrivialInput(promptText)) {
    return {
      model: activeResident,
      swapped: false,
      reason: 'حوار افتتاحي / متابعة سياقية سريعة دون الحاجة لتحكيم مكثف',
      confidence: 1.0,
      domain: isCurrentDeepSeek ? 'مالي (افتراضي)' : 'إداري (افتراضي)',
      arbiter: 'fast_bypass'
    };
  }

  // 2. RAM Semantic Route Cache: Instant 0.01ms resolution if previously evaluated
  const cacheKey = normalizeCacheKey(distilledIntent);
  if (ROUTE_CACHE.has(cacheKey)) {
    const cached = ROUTE_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < ROUTE_CACHE_TTL_MS) {
      const cachedDecision = cached.decision;
      let targetModel = activeResident;
      let swapped = false;

      if (cachedDecision === 'FINANCE') {
        if (!isCurrentDeepSeek && cached.confidence >= 0.75) {
          targetModel = MODEL_FINANCIAL;
          swapped = true;
        }
      } else {
        if (!isCurrentQwen && cached.confidence >= 0.80) {
          targetModel = MODEL_ADMINISTRATIVE;
          swapped = true;
        }
      }

      logger.debug({ cacheKey, targetModel, swapped }, 'RAM Semantic Route Cache HIT');
      return {
        model: targetModel,
        swapped,
        reason: cached.reason + ' [ذاكرة RAM فائقة السرعة]',
        confidence: cached.confidence,
        domain: cached.domain,
        arbiter: 'ذاكرة النظام السريعة (RAM Semantic Cache)'
      };
    }
    ROUTE_CACHE.delete(cacheKey);
  }

  // 3. Active LLM Arbitration: Ask the resident model in VRAM to decide using distilled intent
  const llmDecision = await queryResidentLLMArbiter({
    promptText: distilledIntent,
    activeModel: activeResident
  });

  const decisionObj = llmDecision || emergencyHeuristicFallback(distilledIntent);
  const decision = (decisionObj.decision || 'ADMIN').toUpperCase();
  const confidence = Number(decisionObj.confidence) || 0.85;
  const reason = decisionObj.reason || (decision === 'FINANCE' ? 'اختصاص مالي وحسابي' : 'اختصاص إداري وصياغي');
  const domain = decision === 'FINANCE' ? 'مالي ومحاسبي' : 'إداري ومراسلات';

  // Save to RAM Semantic Cache
  ROUTE_CACHE.set(cacheKey, {
    decision,
    confidence,
    reason,
    domain,
    timestamp: Date.now()
  });
  if (ROUTE_CACHE.size > ROUTE_CACHE_MAX_ENTRIES) {
    const oldestKey = ROUTE_CACHE.keys().next().value;
    ROUTE_CACHE.delete(oldestKey);
  }

  let selectedModel = activeResident;
  let swapped = false;

  // 3. Sticky Hysteresis: Only swap models if confidence exceeds high threshold
  if (decision === 'FINANCE') {
    if (isCurrentDeepSeek) {
      // Already on DeepSeek-R1, zero swap time!
      selectedModel = activeResident;
      swapped = false;
    } else {
      // Currently on Qwen, swap to DeepSeek if confidence >= 0.75
      if (confidence >= 0.75) {
        selectedModel = MODEL_FINANCIAL;
        swapped = true;
      } else {
        selectedModel = activeResident;
        swapped = false;
      }
    }
  } else {
    // Decision is ADMIN
    if (isCurrentQwen) {
      // Already on Qwen, zero swap time!
      selectedModel = activeResident;
      swapped = false;
    } else {
      // Currently on DeepSeek, swap to Qwen if confidence >= 0.80
      if (confidence >= 0.80) {
        selectedModel = MODEL_ADMINISTRATIVE;
        swapped = true;
      } else {
        selectedModel = activeResident;
        swapped = false;
      }
    }
  }

  logger.info(
    {
      residentModel: activeResident,
      selectedModel,
      swapped,
      decision,
      confidence,
      reason,
      arbiter: llmDecision ? 'resident_llm' : 'fallback_heuristic'
    },
    'LLM Sovereign Semantic Route resolved'
  );

  return {
    model: selectedModel,
    swapped,
    reason,
    confidence,
    domain,
    arbiter: llmDecision ? 'ذكاء اصطناعي سيادي (LLM Arbiter)' : 'تحكيم احتياطي (Heuristic Fallback)'
  };
}

module.exports = {
  resolveRoute,
  isTrivialInput,
  emergencyHeuristicFallback,
  queryResidentLLMArbiter,
  MODEL_ADMINISTRATIVE,
  MODEL_FINANCIAL
};
