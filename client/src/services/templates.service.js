/**
 * Government Correspondence Templates Service
 *
 * Provides repository management for official correspondence, administrative templates,
 * and circular drafts.
 */

import { http } from './core/httpClient.js';

export const templatesService = {
  /**
   * Fetch all official government correspondence templates.
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async getTemplates() {
    return http.get('/templates');
  },

  /**
   * Create a new administrative correspondence template.
   * @param {Record<string, unknown>} templateData
   * @returns {Promise<Record<string, unknown>>}
   */
  async createTemplate(templateData) {
    return http.post('/templates', templateData);
  },

  /**
   * Update an existing administrative correspondence template.
   * @param {string|number} id
   * @param {Record<string, unknown>} templateData
   * @returns {Promise<Record<string, unknown>>}
   */
  async updateTemplate(id, templateData) {
    return http.put(`/templates/${id}`, templateData);
  },

  /**
   * Delete an administrative template.
   * @param {string|number} id
   * @returns {Promise<Record<string, unknown>>}
   */
  async deleteTemplate(id) {
    return http.delete(`/templates/${id}`);
  }
};
