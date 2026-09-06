import { useState, useEffect } from 'react';
import { authService } from '../services/auth.service.js';
import {
  SESSION_ENDED_EVENT,
  PASSWORD_CHANGE_EVENT,
  subscribe
} from '../services/core/events.js';

/**
 * Custom Hook: Authentication & Session Lifecycle
 *
 * Encapsulates authenticated identity, token eviction,
 * forced password change checks, and system event subscriptions.
 *
 * @param {Object} options
 * @param {(freshUser: Record<string, unknown>) => void} [options.onSessionVerified]
 * @param {() => void} [options.onSessionEnded]
 * @param {(err: Error) => void} [options.onSessionFailed]
 */
export function useAuth({ onSessionVerified, onSessionEnded, onSessionFailed } = {}) {
  const [currentUser, setCurrentUser] = useState(authService.getStoredUser());
  const [sessionNotice, setSessionNotice] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(false);

  // 1. Validate session against the server on initial load or user change
  useEffect(() => {
    if (!currentUser?.id) return;
    let cancelled = false;

    (async () => {
      try {
        const fresh = await authService.getMe();
        if (cancelled) return;
        setCurrentUser(fresh);
        setMustChangePassword(!!fresh.mustChangePassword);

        if (!fresh.mustChangePassword && onSessionVerified) {
          onSessionVerified(fresh);
        }
      } catch (err) {
        if (cancelled) return;
        if (err.code === 'PASSWORD_CHANGE_REQUIRED') {
          setMustChangePassword(true);
        } else if (err.status !== 401) {
          console.error('Session verification failed:', err);
        }
        if (onSessionFailed) {
          onSessionFailed(err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // 2. React to decoupled session signals from the event bus
  useEffect(() => {
    const unsubSession = subscribe(SESSION_ENDED_EVENT, (detail) => {
      setCurrentUser(null);
      setSessionNotice(detail?.reason || 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.');
      if (onSessionEnded) onSessionEnded();
    });

    const unsubPassword = subscribe(PASSWORD_CHANGE_EVENT, () => {
      setMustChangePassword(true);
    });

    return () => {
      unsubSession();
      unsubPassword();
    };
  }, [onSessionEnded]);

  const handleLoginSuccess = (user) => {
    setSessionNotice('');
    setCurrentUser(user);
    setMustChangePassword(!!user.mustChangePassword);
  };

  const handleLogout = () => {
    authService.logout();
    setCurrentUser(null);
    setMustChangePassword(false);
    setSessionNotice('');
    if (onSessionEnded) onSessionEnded();
  };

  const handlePasswordChanged = (user) => {
    setMustChangePassword(false);
    setCurrentUser(user);
  };

  return {
    currentUser,
    setCurrentUser,
    sessionNotice,
    setSessionNotice,
    mustChangePassword,
    setMustChangePassword,
    handleLoginSuccess,
    handleLogout,
    handlePasswordChanged
  };
}
