'use strict';

/**
 * Token Estimator & Context Window Budgeting.
 *
 * Provides high-precision token estimation for Arabic, English, tabular data,
 * and code, tailored for Byte-Pair Encoding (BPE) tokenizers used in models
 * like Llama 3, Qwen 2.5, and Mistral.
 *
 * In BPE tokenizers:
 * - Arabic words typically take 1.3 - 2.2 tokens depending on diacritics and morphology.
 * - English words average ~1.3 tokens (~4 characters per token).
 * - Numbers and CSV separators are token-dense (frequently 1 token per 1-2 characters).
 * - Chat formatting introduces ~4 tokens of framing per message turn.
 */

const ARABIC_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const LATIN_WORD_REGEX = /[a-zA-Z0-9_]+/g;

/**
 * Estimate the token count for a text string.
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;

  const len = text.length;
  if (len === 0) return 0;

  // Count Arabic characters
  const arabicMatches = text.match(ARABIC_REGEX);
  const arabicCharCount = arabicMatches ? arabicMatches.length : 0;
  const nonArabicCharCount = len - arabicCharCount;

  // Heuristic:
  // Arabic text in modern BPE (Qwen 2.5 / Llama 3) averages ~2.6 characters per token.
  const arabicTokens = Math.ceil(arabicCharCount / 2.6);

  // English / code / symbols average ~3.8 characters per token.
  const nonArabicTokens = Math.ceil(nonArabicCharCount / 3.8);

  return Math.max(1, arabicTokens + nonArabicTokens);
}

/**
 * Estimate total prompt tokens for an array of chat messages, including framing overhead.
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} [systemPrompt='']
 * @returns {number}
 */
function estimateMessagesTokens(messages, systemPrompt = '') {
  let total = 0;

  if (systemPrompt && typeof systemPrompt === 'string') {
    total += estimateTokens(systemPrompt) + 4;
  }

  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      const contentTokens = estimateTokens(msg.content || '');
      // 4 tokens overhead per message turn (<|im_start|>role \n content <|im_end|>)
      total += contentTokens + 4;
    }
  }

  // 3 tokens overhead for assistant generation priming
  return total + 3;
}

/**
 * Evaluate the context budget against the model's context window limit (n_ctx).
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} [options={}]
 * @param {number} [options.contextLimit=8192] Total context window size
 * @param {number} [options.reservedOutputTokens=2048] Tokens reserved for completion
 * @param {string} [options.systemPrompt='']
 * @returns {{
 *   promptTokens: number,
 *   maxTokensAvailable: number,
 *   contextLimit: number,
 *   usagePercent: number,
 *   isNearLimit: boolean,
 *   recommendation: string
 * }}
 */
function evaluateContextBudget(messages, options = {}) {
  const contextLimit = Number(options.contextLimit) || 8192;
  const reservedOutput = Number(options.reservedOutputTokens) || 2048;
  const systemPrompt = options.systemPrompt || '';

  const promptTokens = estimateMessagesTokens(messages, systemPrompt);
  const maxTokensAvailable = Math.max(0, contextLimit - promptTokens);
  const usagePercent = Math.min(100, Math.round((promptTokens / contextLimit) * 100));
  const isNearLimit = usagePercent >= 75 || maxTokensAvailable < reservedOutput;

  let recommendation = 'السياق ضمن الحدود الآمنة والمثالية.';
  if (usagePercent >= 90) {
    recommendation = 'تحذير حرج: حجم السياق يقترب من الحد الأقصى للنموذج (n_ctx). يُوصى بتلخيص المحادثة أو ضغط المرفقات.';
  } else if (usagePercent >= 75) {
    recommendation = 'تنبيه: استهلاك السياق يتجاوز 75%. يُنصح بالحفاظ على استقرار البادئة وتجنب تكرار كتل البيانات غير اللازمة.';
  }

  return {
    promptTokens,
    maxTokensAvailable,
    contextLimit,
    usagePercent,
    isNearLimit,
    recommendation
  };
}

module.exports = {
  estimateTokens,
  estimateMessagesTokens,
  evaluateContextBudget
};
