/**
 * Session & Token Storage Manager
 *
 * Encapsulates all browser persistence logic for tokens and authenticated user profiles,
 * safeguarding against JSON parse errors and restricted storage contexts.
 */

const TOKEN_KEY = 'shaheen_token';
const USER_KEY = 'shaheen_user';

export const storage = {
  /**
   * Retrieve the current authorization JWT token.
   * @returns {string|null}
   */
  getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },

  /**
   * Store the authorization JWT token.
   * @param {string} token
   */
  setToken(token) {
    try {
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch (e) {
      console.warn('Failed to save token to localStorage', e);
    }
  },

  /**
   * Remove the authorization token.
   */
  removeToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Ignore storage errors on cleanup
    }
  },

  /**
   * Retrieve the stored user object.
   * @returns {Record<string, unknown>|null}
   */
  getUser() {
    try {
      const user = localStorage.getItem(USER_KEY);
      return user ? JSON.parse(user) : null;
    } catch {
      return null;
    }
  },

  /**
   * Store the user profile.
   * @param {Record<string, unknown>} user
   */
  setUser(user) {
    try {
      if (user) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(USER_KEY);
      }
    } catch (e) {
      console.warn('Failed to save user to localStorage', e);
    }
  },

  /**
   * Remove the user profile.
   */
  removeUser() {
    try {
      localStorage.removeItem(USER_KEY);
    } catch {
      // Ignore storage errors on cleanup
    }
  },

  /**
   * Clear both token and user profile upon logout or session invalidation.
   */
  clearSession() {
    this.removeToken();
    this.removeUser();
  }
};
