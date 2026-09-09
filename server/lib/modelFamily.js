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
 * Reasoning models (DeepSeek-R1, its distillations, and QwQ) are documented to
 * perform worse when instructions arrive in a system role: the
 * reinforcement-trained reasoning loop expects the task in the user turn.
 *
 * Matching is on the model name because that is all LM Studio exposes about a
 * loaded model. It is deliberately broad — a false positive costs a different
 * prompt delivery, while a false negative costs the degradation the vendor
 * warns about.
 *
 * @param {string} model The model identifier as reported by LM Studio.
 * @returns {boolean}
 */
function isReasoningModel(model) {
  const name = (model || '').toLowerCase();
  return name.includes('deepseek') || name.includes('r1') || name.includes('qwq');
}

module.exports = { isReasoningModel };
