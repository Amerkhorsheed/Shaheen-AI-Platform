'use strict';

/**
 * Typed application errors.
 *
 * Services throw these; a single HTTP error handler translates them into
 * responses. That keeps status codes out of the business logic and guarantees
 * that anything *not* declared here is treated as an internal fault — logged
 * in full, reported to the client as a generic message, never as a stack trace
 * or a driver error string.
 */

class AppError extends Error {
  /**
   * @param {string} message  Message safe to show the user (Arabic, user-facing).
   * @param {object} [options]
   * @param {number} [options.status=500]   HTTP status.
   * @param {string} [options.code]         Stable machine-readable code for the client.
   * @param {object} [options.details]      Extra structured context (also safe to expose).
   * @param {Error}  [options.cause]        Underlying error, logged but never sent.
   */
  constructor(message, { status = 500, code, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
    // Marks an error as deliberate, so the handler knows the message is
    // intended for the user rather than an accidental leak.
    this.expected = true;
    Error.captureStackTrace(this, new.target);
  }

  toJSON() {
    const body = { error: this.message };
    if (this.code) body.code = this.code;
    if (this.details) body.details = this.details;
    return body;
  }
}

class BadRequestError extends AppError {
  constructor(message = 'الطلب غير صالح', options = {}) {
    super(message, { status: 400, code: 'BAD_REQUEST', ...options });
  }
}

class ValidationError extends AppError {
  constructor(message = 'البيانات المُرسلة غير صالحة', options = {}) {
    super(message, { status: 400, code: 'VALIDATION_FAILED', ...options });
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'يرجى تسجيل الدخول أولاً', options = {}) {
    super(message, { status: 401, code: 'UNAUTHORIZED', ...options });
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'غير مصرح لك بهذه العملية', options = {}) {
    super(message, { status: 403, code: 'FORBIDDEN', ...options });
  }
}

class NotFoundError extends AppError {
  constructor(message = 'العنصر المطلوب غير موجود', options = {}) {
    super(message, { status: 404, code: 'NOT_FOUND', ...options });
  }
}

class ConflictError extends AppError {
  constructor(message = 'تعارض مع بيانات قائمة', options = {}) {
    super(message, { status: 409, code: 'CONFLICT', ...options });
  }
}

class PayloadTooLargeError extends AppError {
  constructor(message = 'حجم الطلب يتجاوز الحد المسموح به', options = {}) {
    super(message, { status: 413, code: 'PAYLOAD_TOO_LARGE', ...options });
  }
}

class TooManyRequestsError extends AppError {
  constructor(message = 'عدد كبير من الطلبات، يرجى المحاولة لاحقاً', options = {}) {
    super(message, { status: 429, code: 'TOO_MANY_REQUESTS', ...options });
  }
}

/** The local inference server could not be reached at all. */
class ModelUnavailableError extends AppError {
  constructor(
    message = 'تعذّر الاتصال بخادم النموذج المحلي (LM Studio). لم يتم توليد أي رد.',
    options = {}
  ) {
    super(message, { status: 503, code: 'MODEL_UNAVAILABLE', ...options });
  }
}

/** The local inference server answered, but with an error. */
class ModelError extends AppError {
  constructor(message = 'خادم النموذج المحلي ردّ بخطأ. لم يتم توليد أي رد.', options = {}) {
    super(message, { status: 502, code: 'MODEL_ERROR', ...options });
  }
}

module.exports = {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  PayloadTooLargeError,
  TooManyRequestsError,
  ModelUnavailableError,
  ModelError
};
