/**
 * Application Lifecycle & Event Bus
 *
 * Provides decoupled signaling for system-wide lifecycle events such as
 * forced session invalidation, token expiry, and mandatory password changes.
 */

export const SESSION_ENDED_EVENT = 'shaheen:session-ended';
export const PASSWORD_CHANGE_EVENT = 'shaheen:password-change-required';

/**
 * Dispatch an application event on the global window object.
 * @param {string} eventName
 * @param {Record<string, unknown>} [detail]
 */
export function announce(eventName, detail = {}) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

/**
 * Announce that the current authenticated session has ended.
 * @param {string} [reason]
 */
export function announceSessionEnded(reason) {
  announce(SESSION_ENDED_EVENT, { reason });
}

/**
 * Announce that a password change is required for the current user.
 * @param {string} [reason]
 */
export function announcePasswordChangeRequired(reason) {
  announce(PASSWORD_CHANGE_EVENT, { reason });
}

/**
 * Subscribe to an application event with automatic cleanup support.
 * @param {string} eventName
 * @param {(detail: unknown) => void} handler
 * @returns {() => void} Unsubscribe callback
 */
export function subscribe(eventName, handler) {
  if (typeof window === 'undefined') return () => {};

  const listener = (event) => handler(event.detail);
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
