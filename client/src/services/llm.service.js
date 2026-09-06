/**
 * LLM & Inference Streaming Service
 *
 * Coordinates LM Studio model discovery and Server-Sent Events (SSE) chat stream consumption.
 */

import { http } from './core/httpClient.js';

export const llmService = {
  /**
   * Check connection with LM Studio and list currently loaded models.
   * @returns {Promise<Record<string, unknown>>}
   */
  async getModels() {
    return http.get('/llm/models');
  },

  /**
   * Stream a chat completion response over SSE.
   * @param {Object} options
   * @param {string} options.model
   * @param {Array<Record<string, unknown>>} options.messages
   * @param {number} [options.temperature=0.7]
   * @param {number} [options.max_tokens=4096]
   * @param {string} [options.chatId] - Active chat ID for server-side classification and prompt composition
   * @param {AbortSignal} [options.signal]
   * @param {(chunk: string) => void} [options.onChunk]
   * @param {(chunk: string) => void} [options.onReasoningChunk]
   * @param {() => void} [options.onDone]
   * @param {(error: Error) => void} [options.onError]
   */
  async streamChat({
    model,
    messages,
    temperature = 0.7,
    max_tokens = 4096,
    chatId,
    signal,
    onChunk,
    onReasoningChunk,
    onDone,
    onError
  }) {
    try {
      const headers = http.getHeaders();
      const payload = { model, messages, temperature, max_tokens };
      if (chatId) payload.chatId = chatId;
      const res = await http.request('/llm/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal
      });

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('الاستجابة لا تدعم التدفق (ReadableStream غير متوفر)');
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep partial line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const dataStr = trimmed.replace(/^data:\s*/, '');
          if (dataStr === '[DONE]') {
            if (onDone) onDone();
            return;
          }

          let parsed;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            // Ignore non-JSON comments or partial lines
            continue;
          }

          if (parsed?.error) {
            throw new Error(parsed.error);
          }

          const reasoning = parsed?.choices?.[0]?.delta?.reasoning_content || '';
          if (reasoning && onReasoningChunk) {
            onReasoningChunk(reasoning);
          }

          const delta = parsed?.choices?.[0]?.delta?.content || '';
          if (delta && onChunk) {
            onChunk(delta);
          }
        }
      }

      if (onDone) onDone();
    } catch (err) {
      if (err.name === 'AbortError') {
        if (onDone) onDone();
        return;
      }
      if (onError) onError(err);
      else throw err;
    }
  }
};
