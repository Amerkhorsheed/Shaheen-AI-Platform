'use strict';

/**
 * HTTP middleware.
 *
 * Route handlers stay thin: they read validated input, call one service, and
 * send the result. Authentication, authorisation, validation, throttling and
 * error translation all happen here, once, rather than being repeated — and
 * occasionally forgotten — in individual handlers.
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { ZodError } = require('zod');

const config = require('../../config');
const logger = require('../../lib/logger');
const authService = require('../../services/authService');
const auditService = require('../../services/auditService');
const exportTicketService = require('../../services/exportTicketService');
const { renderNotice } = require('../../templates/noticeTemplate');
const {
  AppError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  PayloadTooLargeError
} = require('../../lib/errors');

/**
 * Wrap an async handler so a rejected promise reaches the error handler.
 * Express 5 forwards rejections already; this keeps the intent explicit and
 * works identically if the framework version changes.
 */
function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

// Endpoints reachable while a password change is outstanding.
const PASSWORD_CHANGE_EXEMPT = new Set([
  '/me',
  '/change-password',
  '/api/auth/me',
  '/api/auth/change-password'
]);

/**
 * Verify the bearer token and load the current account state.
 *
 * The database is read on every request on purpose: a signature alone cannot
 * tell us that the account still exists, is still active, or still holds the
 * role it had when the token was issued.
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new UnauthorizedError();
  }

  const payload = authService.verifyToken(header.slice(7));
  const user = await authService.resolveSession(payload);

  const requestPath = (req.baseUrl || '') + (req.path || '');
  const isExempt =
    PASSWORD_CHANGE_EXEMPT.has(requestPath) ||
    PASSWORD_CHANGE_EXEMPT.has(req.path) ||
    PASSWORD_CHANGE_EXEMPT.has(req.originalUrl?.split('?')[0]);

  if (user.mustChangePassword && !isExempt) {
    throw new ForbiddenError('يجب تغيير كلمة المرور قبل استخدام المنظومة', {
      code: 'PASSWORD_CHANGE_REQUIRED'
    });
  }

  req.user = user;
  next();
});

/**
 * Optional authentication: attaches `req.user` when a valid token is present,
 * and continues silently otherwise. Used where a route serves both an
 * administrator and an anonymous caller.
 */
const authenticateOptional = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();

  try {
    req.user = await authService.resolveSession(authService.verifyToken(header.slice(7)));
  } catch (err) {
    // An invalid token is treated as no token here, by design.
  }
  next();
});

function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin' || req.user?.role === 'superadmin') return next();

  auditService.record({
    userId: req.user?.id ?? null,
    action: auditService.ACTIONS.FORBIDDEN_ADMIN_ATTEMPT,
    details: { path: req.originalUrl, method: req.method },
    ipAddress: req.ip
  });
  next(new ForbiddenError('عذراً، هذه العملية تتطلب صلاحيات المشرف العام'));
}

function requireSuperAdmin(req, res, next) {
  if (req.user?.role === 'superadmin') return next();

  auditService.record({
    userId: req.user?.id ?? null,
    action: auditService.ACTIONS.FORBIDDEN_ADMIN_ATTEMPT,
    details: { path: req.originalUrl, method: req.method, requiredRole: 'superadmin' },
    ipAddress: req.ip
  });
  next(new ForbiddenError('عذراً، هذه العملية تتطلب صلاحيات المدير العام الأعلى (Super Admin)'));
}

/**
 * Validate and replace part of the request from a Zod schema.
 * The handler then works with typed, trimmed, defaulted data and never has to
 * re-check anything.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @param {'body'|'query'|'params'} source
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        message: issue.message
      }));
      // The first issue is the user-facing message; the rest are structured.
      return next(new ValidationError(issues[0].message, { details: { issues } }));
    }

    // `req.query` is a getter in Express 5, so the parsed value is stored
    // alongside rather than assigned over it.
    if (source === 'query') req.validatedQuery = result.data;
    else req[source] = result.data;

    next();
  };
}

/** Consume a single-use export ticket and attach the issuing account. */
const requireExportTicket = asyncHandler(async (req, res, next) => {
  const user = await exportTicketService.consume(req.body?.ticket);

  if (!user) {
    return res
      .status(401)
      .type('html')
      .send(
        renderNotice(
          'انتهت صلاحية الجلسة',
          'تعذّر التحقق من صلاحية طلب التصدير. يرجى العودة إلى المنظومة وإعادة المحاولة.'
        )
      );
  }

  req.exportUser = user;
  next();
});

const loginLimiter = rateLimit({
  windowMs: config.security.loginRate.windowMs,
  limit: config.security.loginRate.limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Per IP *and* per targeted username, so distributed guessing against one
  // account is throttled too. ipKeyGenerator normalises IPv6 to its /64
  // prefix, so a client cannot rotate addresses within its own subnet.
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip)}|${String(req.body?.username || '').trim().toLowerCase()}`,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    auditService.record({
      userId: null,
      action: auditService.ACTIONS.LOGIN_RATE_LIMITED,
      details: { username: String(req.body?.username || '').slice(0, 64) },
      ipAddress: req.ip
    });
    res.status(429).json({
      error: 'تم تجاوز عدد محاولات الدخول المسموح بها. يرجى الانتظار 15 دقيقة قبل المحاولة مجدداً.',
      code: 'TOO_MANY_REQUESTS'
    });
  }
});

const writeLimiter = rateLimit({
  windowMs: config.security.writeRate.windowMs,
  limit: config.security.writeRate.limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'عدد كبير من الطلبات في وقت قصير. يرجى الإبطاء قليلاً.', code: 'TOO_MANY_REQUESTS' }
});

/** Unknown API routes must answer in JSON, never with the SPA shell. */
function apiNotFound(req, res, next) {
  next(new NotFoundError('المسار المطلوب غير موجود'));
}

/**
 * Single error translator.
 *
 * Declared errors carry a status and a message written for the user.
 * Everything else is an internal fault: logged in full, reported generically.
 * Stack traces, SQL and driver messages never reach a client.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err;

  if (err instanceof ZodError) {
    error = new ValidationError(err.issues[0]?.message);
  } else if (err?.type === 'entity.too.large') {
    error = new PayloadTooLargeError();
  } else if (err?.code === '23505') {
    // unique_violation surfacing from a race the service could not pre-check
    error = new AppError('تعارض مع سجل قائم', { status: 409, code: 'CONFLICT' });
  }

  const isExpected = error instanceof AppError && error.expected;
  const status = isExpected ? error.status : 500;

  if (isExpected) {
    req.log?.debug({ err: error, status }, 'Request rejected');
  } else {
    (req.log || logger).error(
      { err: error, method: req.method, url: req.originalUrl },
      'Unhandled error'
    );
  }

  // Headers already sent means a stream was in flight; nothing can be added.
  if (res.headersSent) {
    return req.socket.destroy();
  }

  res
    .status(status)
    .json(
      isExpected
        ? error.toJSON()
        : { error: 'حدث خطأ داخلي في الخادم. تمت كتابة التفاصيل في سجل الخادم.', code: 'INTERNAL_ERROR' }
    );
}

module.exports = {
  asyncHandler,
  authenticate,
  authenticateOptional,
  requireAdmin,
  requireSuperAdmin,
  validate,
  requireExportTicket,
  loginLimiter,
  writeLimiter,
  apiNotFound,
  errorHandler
};
