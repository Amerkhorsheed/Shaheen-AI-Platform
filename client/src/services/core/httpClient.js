/**
 * Low-Level HTTP Client
 *
 * Provides resilient HTTP transport, uniform header management,
 * token injection, and centralized error and authentication interception.
 */

import { storage } from './storage.js';
import { announceSessionEnded, announcePasswordChangeRequired } from './events.js';
import { ApiError } from './errors.js';

export const API_BASE = '/api';

export class HttpClient {
  /**
   * @param {string} [baseUrl] - Base path for API endpoints (defaults to '/api')
   */
  constructor(baseUrl = API_BASE) {
    this.baseUrl = baseUrl;
  }

  /**
   * Construct headers with optional JSON Content-Type and Bearer authorization.
   * @param {RequestInit} [options]
   * @param {boolean} [isJson=true]
   * @returns {HeadersInit}
   */
  getHeaders(options = {}, isJson = true) {
    const headers = { ...(options.headers || {}) };
    if (isJson && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const token = storage.getToken();
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Inspect a failed HTTP response, trigger system-level notifications, and return a structured ApiError.
   * @param {Response} res
   * @param {string} [path='']
   * @returns {Promise<ApiError>}
   */
  async handleFailure(res, path = '') {
    let data = {};
    try {
      data = await res.json();
    } catch {
      // Body may be plain text, HTML, or empty
    }

    if (res.status === 401) {
      storage.clearSession();
      // Only announce session termination for active sessions, not credential rejection during login
      if (!path.includes('/auth/login')) {
        announceSessionEnded(data.error);
      }
    } else if (res.status === 403 && data.code === 'PASSWORD_CHANGE_REQUIRED') {
      announcePasswordChangeRequired(data.error);
    }

    const message = data.error || ApiError.getDefaultMessage(res.status);
    return new ApiError(message, res.status, data.code, data);
  }

  /**
   * Execute a fetch request against the configured base URL with error interception.
   * @param {string} path
   * @param {RequestInit} [options]
   * @returns {Promise<Response>}
   */
  async request(path, options = {}) {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url, options);

    if (!res.ok) {
      const error = await this.handleFailure(res, path);
      throw error;
    }

    return res;
  }

  /**
   * Perform an authorized GET request returning JSON.
   * @template T
   * @param {string} path
   * @param {RequestInit} [options]
   * @returns {Promise<T>}
   */
  async get(path, options = {}) {
    const headers = this.getHeaders(options, false);
    const res = await this.request(path, { ...options, method: 'GET', headers });
    return res.json();
  }

  /**
   * Perform an authorized POST request returning JSON.
   * @template T
   * @param {string} path
   * @param {unknown} [body]
   * @param {RequestInit} [options]
   * @returns {Promise<T>}
   */
  async post(path, body, options = {}) {
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers = this.getHeaders(options, !isFormData);
    const res = await this.request(path, {
      ...options,
      method: 'POST',
      headers,
      body: isFormData ? body : (body !== undefined ? JSON.stringify(body) : undefined)
    });
    return res.json().catch(() => ({}));
  }

  /**
   * Perform an authorized PUT request returning JSON.
   * @template T
   * @param {string} path
   * @param {unknown} [body]
   * @param {RequestInit} [options]
   * @returns {Promise<T>}
   */
  async put(path, body, options = {}) {
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers = this.getHeaders(options, !isFormData);
    const res = await this.request(path, {
      ...options,
      method: 'PUT',
      headers,
      body: isFormData ? body : (body !== undefined ? JSON.stringify(body) : undefined)
    });
    return res.json().catch(() => ({}));
  }

  /**
   * Perform an authorized DELETE request returning JSON.
   * @template T
   * @param {string} path
   * @param {RequestInit} [options]
   * @returns {Promise<T>}
   */
  async delete(path, options = {}) {
    const headers = this.getHeaders(options, false);
    const res = await this.request(path, { ...options, method: 'DELETE', headers });
    return res.json().catch(() => ({}));
  }

  /**
   * Upload binary files or FormData.
   * @template T
   * @param {string} path
   * @param {FormData} formData
   * @param {RequestInit} [options]
   * @returns {Promise<T>}
   */
  async upload(path, formData, options = {}) {
    const headers = this.getHeaders(options, false);
    const res = await this.request(path, {
      ...options,
      method: 'POST',
      headers,
      body: formData
    });
    return res.json();
  }

  /**
   * Execute an authorized request and return the raw Response object (e.g. for streams).
   * @param {string} path
   * @param {RequestInit} [options]
   * @returns {Promise<Response>}
   */
  async raw(path, options = {}) {
    const headers = this.getHeaders(options, false);
    return this.request(path, { ...options, headers });
  }
}

export const http = new HttpClient();
