/**
 * Chat & Dialogue History Service
 *
 * Manages conversation sessions, message exchanges, pinning, and message clearing.
 */

import { http } from './core/httpClient.js';

export const chatsService = {
  /**
   * Fetch all chats for the current user.
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async getChats() {
    return http.get('/chats');
  },

  /**
   * Retrieve full details and message history for a specific chat.
   * @param {string|number} id
   * @returns {Promise<Record<string, unknown>>}
   */
  async getChat(id) {
    return http.get(`/chats/${id}`);
  },

  /**
   * Create a new conversation session.
   * @param {Record<string, unknown>} chatData
   * @returns {Promise<Record<string, unknown>>}
   */
  async createChat(chatData) {
    return http.post('/chats', chatData);
  },

  /**
   * Update chat attributes (e.g. title, classification, pinned status).
   * @param {string|number} id
   * @param {Record<string, unknown>} updates
   * @returns {Promise<Record<string, unknown>>}
   */
  async updateChat(id, updates) {
    return http.put(`/chats/${id}`, updates);
  },

  /**
   * Delete an entire conversation session.
   * @param {string|number} id
   * @returns {Promise<Record<string, unknown>>}
   */
  async deleteChat(id) {
    return http.delete(`/chats/${id}`);
  },

  /**
   * Append and persist a single message to a chat session.
   * @param {string|number} chatId
   * @param {Record<string, unknown>} message
   * @returns {Promise<Record<string, unknown>>}
   */
  async saveMessage(chatId, message) {
    return http.post(`/chats/${chatId}/messages`, message);
  },

  /**
   * Clear all messages within a chat session.
   * @param {string|number} chatId
   * @returns {Promise<Record<string, unknown>>}
   */
  async clearChat(chatId) {
    return http.delete(`/chats/${chatId}/messages`);
  }
};
