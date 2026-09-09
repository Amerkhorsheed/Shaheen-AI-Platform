'use strict';

/**
 * Which family a loaded model belongs to.
 *
 * Two services need this answer and must not disagree about it: the prompt
 * composer, which decides whether the institutional layers travel as a system
 * message or prefixed to the user turn, and the router, which shapes its
 * arbitration probe the same way. When each carried its own copy of the test,
 * they drifted apart.
 *
 * It lives in `lib` rather than in either service because the router must not
 * have to pull in the prompt composer — and with it the database pool and the
 * repositories — merely to ask what kind of model is loaded.
 */

/**
 * Reasoning models (pure DeepSeek-R1-Zero, QwQ) that perform worse or fail when instructions arrive in a system role.
 *
 * All LM Studio models (including DeepSeek-R1-Distill-Qwen and Qwen 2.5/3.8) use ChatML
 * and natively support the system role via their Jinja templates.
 *
 * @param {string} model The model identifier as reported by LM Studio.
 * @returns {boolean}
 */
function isReasoningModel(model) {
  const name = (model || '').toLowerCase();
  return name.includes('deepseek-r1-zero') || name.includes('qwq');
}

module.exports = { isReasoningModel };

