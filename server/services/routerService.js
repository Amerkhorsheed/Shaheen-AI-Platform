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

const MODEL_ADMINISTRATIVE = 'qwen3.8-27b';
const MODEL_FINANCIAL = 'deepseek-r1-distill-qwen-32b';

// Fast bypass triggers for trivial conversational turns
const TRIVIAL_GREETINGS = new Set([
  'مرحبا', 'مرحباً', 'أهلا', 'أهلاً', 'السلام عليكم', 'صباح الخير', 'مساء الخير',
  'شكرا', 'شكراً', 'يعطيك العافية', 'تمام', 'أكمل', 'تابع', 'استمر', 'نعم', 'لا'
]);

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
 * Ask the model currently resident in VRAM to classify the intent
 */
async function queryResidentLLMArbiter({ promptText, activeModel }) {
  const systemDirective = `أنت محرك التوجيه السيادي الذكي لمنظومة OSS السورية للذكاء الاصطناعي.
مهمتك: قراءة استفسار المستخدم وتحديد النموذج التخصصي الأنسب لمعالجته بأعلى دقة واحترافية:
1. "ADMIN" (النموذج: Qwen-27B): للمراسلات الإدارية، إعداد وتدبيج الكتب الرسمية، التعاميم، القرارات الوزارية، التلخيص، والصياغة اللغوية والقانونية.
2. "FINANCE" (النموذج: DeepSeek-R1-32B): للتدقيق المحاسبي، القيود والترحيل، الموازنات، احتساب الضرائب والنسب المالية، التحليل الحسابي والرياضي المعقد، وعمليات الجدوى.

قواعد تحكيم جوهرية:
- ورود أرقام تواريخ أو أرقام مراسيم (مثل: "المرسوم 15 لعام 2026") أو مخاطبة "وزير المالية" في كتاب رسمي لا يجعل الطلب مالياً، بل العبرة بجوهر ومقصد الطلب.
- إذا كان الطلب يتطلب تفكيراً حسابياً أو تدقيق جداول أرقام ونسب، اختر FINANCE فوراً.
- إذا كان صياغة إدارية أو بياناً لغوياً أو استفساراً عاماً، اختر ADMIN.

أجب حصراً بكائن JSON سليم بالصيغة:
{"decision": "ADMIN" | "FINANCE", "confidence": 0.0-1.0, "reason": "سبب موجز يوضح جوهر الطلب ودقة الاختيار"}`;

  const baseUrl = await modelService.resolveBaseUrl();
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const fetchImpl = globalThis.fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7500);

  try {
    const isR1 = (activeModel || '').toLowerCase().includes('r1') || (activeModel || '').toLowerCase().includes('deepseek');
    
    // For R1, pass directive in user prompt to preserve RL reasoning loop
    const messages = isR1
      ? [{ role: 'user', content: `${systemDirective}\n\nطلب المستخدم للتحكيم:\n"${promptText}"` }]
      : [
          { role: 'system', content: systemDirective },
          { role: 'user', content: promptText }
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
  const normalized = text.toLowerCase();
  const isFinance = /(?:ميزانية|موازنة|ضريبة|ضرائب|محاسب|أرباح|خسائر|سيولة|قيد محاسبي|فوائد|تدقيق مالي|\d+\s*[\*×xX\/÷\+\-%]\s*\d+)/i.test(normalized);
  return {
    decision: isFinance ? 'FINANCE' : 'ADMIN',
    confidence: 0.75,
    reason: isFinance ? 'تحكيم احتياطي: رصد مؤشرات مالية/حسابية' : 'تحكيم احتياطي: رصد سياق إداري/عام'
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

  // 2. Active LLM Arbitration: Ask the resident model in VRAM to decide
  const llmDecision = await queryResidentLLMArbiter({
    promptText,
    activeModel: activeResident
  });

  const decisionObj = llmDecision || emergencyHeuristicFallback(promptText);
  const decision = (decisionObj.decision || 'ADMIN').toUpperCase();
  const confidence = Number(decisionObj.confidence) || 0.85;
  const reason = decisionObj.reason || (decision === 'FINANCE' ? 'اختصاص مالي وحسابي' : 'اختصاص إداري وصياغي');
  const domain = decision === 'FINANCE' ? 'مالي ومحاسبي' : 'إداري ومراسلات';

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
  queryResidentLLMArbiter,
  MODEL_ADMINISTRATIVE,
  MODEL_FINANCIAL
};
