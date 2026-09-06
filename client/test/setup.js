/**
 * Test Environment Mocking Helper
 * Provides in-memory implementations of browser-specific globals (localStorage, window, document, URL).
 */

export function setupMockBrowser() {
  const store = new Map();
  const listeners = new Map();
  const appendedElements = [];
  const revokedUrls = [];

  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocalStorage = globalThis.localStorage;
  const originalCreateObjectURL = globalThis.URL?.createObjectURL;
  const originalRevokeObjectURL = globalThis.URL?.revokeObjectURL;

  const mockLocalStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    _store: store
  };

  const mockWindow = {
    dispatchEvent: (event) => {
      const list = listeners.get(event.type) || [];
      for (const handler of list) {
        handler(event);
      }
      return true;
    },
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener: (type, handler) => {
      if (listeners.has(type)) {
        listeners.set(type, listeners.get(type).filter((h) => h !== handler));
      }
    },
    _listeners: listeners
  };

  const mockDocument = {
    body: {
      appendChild: (el) => {
        appendedElements.push(el);
      },
      removeChild: (el) => {
        const idx = appendedElements.indexOf(el);
        if (idx !== -1) appendedElements.splice(idx, 1);
      },
      _appended: appendedElements
    },
    createElement: (tagName) => {
      const el = {
        tagName: tagName.toUpperCase(),
        children: [],
        appendChild: (child) => el.children.push(child),
        submit: () => {
          el.submitted = true;
        },
        click: () => {
          el.clicked = true;
        }
      };
      return el;
    }
  };

  globalThis.window = mockWindow;
  globalThis.document = mockDocument;
  globalThis.localStorage = mockLocalStorage;

  if (globalThis.URL) {
    globalThis.URL.createObjectURL = (blob) => `blob:mock-url-${Math.random()}`;
    globalThis.URL.revokeObjectURL = (url) => {
      revokedUrls.push(url);
    };
  }

  return {
    store,
    listeners,
    appendedElements,
    revokedUrls,
    cleanup() {
      globalThis.window = originalWindow;
      globalThis.document = originalDocument;
      globalThis.localStorage = originalLocalStorage;
      if (originalCreateObjectURL) {
        globalThis.URL.createObjectURL = originalCreateObjectURL;
      }
      if (originalRevokeObjectURL) {
        globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
      }
    }
  };
}
