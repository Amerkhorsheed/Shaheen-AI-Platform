import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/services/core/errors.js';

describe('errors.js service', () => {
  it('creates ApiError with default parameters', () => {
    const err = new ApiError('Default error');
    assert.equal(err.name, 'ApiError');
    assert.equal(err.message, 'Default error');
    assert.equal(err.status, 500);
    assert.equal(err.code, null);
    assert.deepEqual(err.data, {});
    assert.ok(err.stack);
  });

  it('creates ApiError with explicit parameters', () => {
    const err = new ApiError('Not found', 404, 'ERR_NOT_FOUND', { entity: 'chat', id: 10 });
    assert.equal(err.name, 'ApiError');
    assert.equal(err.message, 'Not found');
    assert.equal(err.status, 404);
    assert.equal(err.code, 'ERR_NOT_FOUND');
    assert.deepEqual(err.data, { entity: 'chat', id: 10 });
  });

  it('handles environment when Error.captureStackTrace is missing', () => {
    const origCapture = Error.captureStackTrace;
    try {
      Error.captureStackTrace = undefined;
      const err = new ApiError('Fallback stack');
      assert.equal(err.message, 'Fallback stack');
    } finally {
      Error.captureStackTrace = origCapture;
    }
  });

  it('provides localized Arabic messages for known status codes', () => {
    assert.equal(ApiError.getDefaultMessage(400), 'الطلب غير صالح أو تنقصه بيانات لازمة');
    assert.equal(ApiError.getDefaultMessage(401), 'انتهت الجلسة، يرجى تسجيل الدخول مجدداً');
    assert.equal(ApiError.getDefaultMessage(403), 'ليس لديك الصلاحيات الكافية لتنفيذ هذا الإجراء');
    assert.equal(ApiError.getDefaultMessage(404), 'العنصر المطلوب غير موجود');
    assert.equal(ApiError.getDefaultMessage(409), 'تعارض في البيانات، العنصر موجود بالفعل');
    assert.equal(ApiError.getDefaultMessage(413), 'حجم الملف يتجاوز الحد المسموح به');
    assert.equal(ApiError.getDefaultMessage(429), 'تم تجاوز الحد المسموح من الطلبات، يرجى الانتظار قليلاً');
    assert.equal(ApiError.getDefaultMessage(500), 'حدث خطأ في الخادم، يرجى المحاولة لاحقاً');
    assert.equal(ApiError.getDefaultMessage(502), 'حدث خطأ في الخادم، يرجى المحاولة لاحقاً');
    assert.equal(ApiError.getDefaultMessage(503), 'حدث خطأ في الخادم، يرجى المحاولة لاحقاً');
    assert.equal(ApiError.getDefaultMessage(504), 'حدث خطأ في الخادم، يرجى المحاولة لاحقاً');
    assert.equal(ApiError.getDefaultMessage(599), 'خطأ من الخادم (599)');
  });
});
