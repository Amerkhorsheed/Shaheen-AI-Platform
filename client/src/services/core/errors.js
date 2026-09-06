/**
 * Standardized API Error Class
 *
 * Enriches JavaScript Error objects with HTTP status, machine error codes,
 * and contextual response data from the Shaheen backend.
 */

export class ApiError extends Error {
  /**
   * @param {string} message - User-facing error message
   * @param {number} [status] - HTTP status code
   * @param {string} [code] - Internal error code (e.g., 'PASSWORD_CHANGE_REQUIRED')
   * @param {Record<string, unknown>} [data] - Parsed server response body
   */
  constructor(message, status = 500, code = null, data = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  /**
   * Resolve a friendly Arabic description based on status code if no message is provided.
   * @param {number} status
   * @returns {string}
   */
  static getDefaultMessage(status) {
    switch (status) {
      case 400:
        return 'الطلب غير صالح أو تنقصه بيانات لازمة';
      case 401:
        return 'انتهت الجلسة، يرجى تسجيل الدخول مجدداً';
      case 403:
        return 'ليس لديك الصلاحيات الكافية لتنفيذ هذا الإجراء';
      case 404:
        return 'العنصر المطلوب غير موجود';
      case 409:
        return 'تعارض في البيانات، العنصر موجود بالفعل';
      case 413:
        return 'حجم الملف يتجاوز الحد المسموح به';
      case 429:
        return 'تم تجاوز الحد المسموح من الطلبات، يرجى الانتظار قليلاً';
      case 500:
      case 502:
      case 503:
      case 504:
        return 'حدث خطأ في الخادم، يرجى المحاولة لاحقاً';
      default:
        return `خطأ من الخادم (${status})`;
    }
  }
}
