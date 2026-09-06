/**
 * Institutional Prompt Library & System Prompts Service
 *
 * Manages the multi-layer composable prompt architecture:
 *   Layer 1: System Charter (الميثاق)
 *   Layer 2: Reusable Prompt Modules (الوحدات المشتركة)
 *   Layer 3: Department Specialist Directives (التوجيه التخصصي)
 *   Layer 4: Runtime Context & Session Guidance (سياق التشغيل)
 */

import { http } from './core/httpClient.js';

export const promptsService = {
  /**
   * Fetch the active system charter (Layer 1).
   * @returns {Promise<{ charter: string }>}
   */
  async getCharter() {
    return http.get('/prompts/charter');
  },

  /**
   * Fetch all reusable prompt modules with category reference counts.
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async getModules() {
    return http.get('/prompts/modules');
  },

  /**
   * Fetch a single prompt module by ID.
   * @param {string} moduleId
   * @returns {Promise<Record<string, unknown>>}
   */
  async getModule(moduleId) {
    return http.get(`/prompts/modules/${moduleId}`);
  },

  /**
   * Create a new custom prompt module (admin only).
   * @param {{ name: string, description?: string, content: string }} data
   * @returns {Promise<Record<string, unknown>>}
   */
  async createModule(data) {
    return http.post('/prompts/modules', data);
  },

  /**
   * Update an existing prompt module (admin only).
   * @param {string} moduleId
   * @param {{ name?: string, description?: string, content?: string }} data
   * @returns {Promise<Record<string, unknown>>}
   */
  async updateModule(moduleId, data) {
    return http.put(`/prompts/modules/${moduleId}`, data);
  },

  /**
   * Delete a non-system prompt module (admin only).
   * @param {string} moduleId
   * @returns {Promise<{ message: string }>}
   */
  async deleteModule(moduleId) {
    return http.delete(`/prompts/modules/${moduleId}`);
  },

  /**
   * Fetch modules attached to a specific category in assembly order.
   * @param {string} categoryId
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async getCategoryModules(categoryId) {
    return http.get(`/prompts/categories/${categoryId}/modules`);
  },

  /**
   * Set and reorder prompt modules for a category (admin only).
   * @param {string} categoryId
   * @param {Array<string>} moduleIds
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async setCategoryModules(categoryId, moduleIds) {
    return http.put(`/prompts/categories/${categoryId}/modules`, { moduleIds });
  },

  /**
   * Preview the fully assembled 4-layer prompt for a category.
   * @param {string} categoryId
   * @param {string} [classification='official']
   * @returns {Promise<{ category: { id: string, name: string }, prompt: string, layers: Record<string, unknown> }>}
   */
  async preview(categoryId, classification = 'official') {
    return http.get(`/prompts/preview/${categoryId}?classification=${encodeURIComponent(classification)}`);
  },

  /**
   * Get the effective system prompt for the calling authenticated user.
   * @param {string} [classification='official']
   * @returns {Promise<{ prompt: string, layers: Record<string, unknown> }>}
   */
  async getEffective(classification = 'official') {
    return http.get(`/prompts/effective?classification=${encodeURIComponent(classification)}`);
  }
};
