/**
 * System Settings & Platform Configuration Service
 *
 * Manages institutional defaults, security policies, and connectivity configurations.
 */

import { http } from './core/httpClient.js';

export const settingsService = {
  /**
   * Retrieve platform settings and system metadata.
   * @returns {Promise<Record<string, unknown>>}
   */
  async getSettings() {
    return http.get('/settings');
  },

  /**
   * Persist updated platform settings (Admin only).
   * @param {Record<string, unknown>} settings
   * @returns {Promise<Record<string, unknown>>}
   */
  async updateSettings(settings) {
    return http.put('/settings', settings);
  }
};
