/**
 * Authentication & Identity Service
 *
 * Manages user credentials, login sessions, profile hydration, and password changes.
 */

import { http } from './core/httpClient.js';
import { storage } from './core/storage.js';

export const authService = {
  /**
   * Authenticate with username and password.
   * On success, stores token and user in local storage.
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{ token: string, user: Record<string, unknown> }>}
   */
  async login(username, password) {
    const data = await http.post('/auth/login', { username, password });
    if (data.token) {
      storage.setToken(data.token);
    }
    if (data.user) {
      storage.setUser(data.user);
    }
    return data;
  },

  /**
   * Fetch current authenticated user's profile and keep storage synchronized.
   * @returns {Promise<Record<string, unknown>>}
   */
  async getMe() {
    const user = await http.get('/auth/me');
    storage.setUser(user);
    return user;
  },

  /**
   * Clear active session and cached user profile.
   */
  logout() {
    storage.clearSession();
  },

  /**
   * Retrieve cached user details from local storage without network overhead.
   * @returns {Record<string, unknown>|null}
   */
  getStoredUser() {
    return storage.getUser();
  },

  /**
   * Change password for the currently authenticated user.
   * Updates stored token and user on success.
   * @param {string} currentPassword
   * @param {string} newPassword
   * @returns {Promise<{ token: string, user: Record<string, unknown> }>}
   */
  async changePassword(currentPassword, newPassword) {
    const data = await http.post('/auth/change-password', { currentPassword, newPassword });
    if (data.token) {
      storage.setToken(data.token);
    }
    if (data.user) {
      storage.setUser(data.user);
    }
    return data;
  }
};
