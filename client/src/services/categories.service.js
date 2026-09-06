/**
 * Organizational Categories & Classifications Service
 *
 * Manages institutional departments, classifications, and organizational taxonomy.
 */

import { http } from './core/httpClient.js';

export const categoriesService = {
  /**
   * Fetch all institutional categories and departments.
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async getCategories() {
    return http.get('/categories');
  },

  /**
   * Create a new institutional category.
   * @param {Record<string, unknown>} categoryData
   * @returns {Promise<Record<string, unknown>>}
   */
  async createCategory(categoryData) {
    return http.post('/categories', categoryData);
  },

  /**
   * Delete an institutional category.
   * @param {string|number} categoryId
   * @returns {Promise<Record<string, unknown>>}
   */
  async deleteCategory(categoryId) {
    return http.delete(`/categories/${categoryId}`);
  }
};
