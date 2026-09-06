/**
 * User & Cadre Administration Service
 *
 * Provides CRUD operations for user accounts, credentials, and institutional cadre metrics.
 */

import { http } from './core/httpClient.js';

export const usersService = {
  /**
   * Retrieve all registered users and their permission tiers.
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async getUsers() {
    return http.get('/users');
  },

  /**
   * Retrieve institutional cadre statistics and user breakdowns.
   * @returns {Promise<Record<string, unknown>>}
   */
  async getUserStats() {
    return http.get('/users/stats');
  },

  /**
   * Create a new user account.
   * @param {Record<string, unknown>} userData
   * @returns {Promise<Record<string, unknown>>}
   */
  async createUser(userData) {
    return http.post('/users', userData);
  },

  /**
   * Update an existing user's details or credentials.
   * @param {string|number} userId
   * @param {Record<string, unknown>} userData
   * @returns {Promise<Record<string, unknown>>}
   */
  async updateUser(userId, userData) {
    return http.put(`/users/${userId}`, userData);
  },

  /**
   * Remove a user account.
   * @param {string|number} userId
   * @returns {Promise<Record<string, unknown>>}
   */
  async deleteUser(userId) {
    return http.delete(`/users/${userId}`);
  }
};
