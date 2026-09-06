'use strict';

/**
 * System settings.
 *
 * Reads and writes are restricted to an explicit allowlist. The JWT signing
 * key and other internal values live in the same table, and must never be
 * readable or writable through the API — an allowlist fails closed, whereas a
 * denylist silently exposes anything added later.
 */

const { transaction } = require('../db/pool');
const settingsRepository = require('../repositories/settingsRepository');
const auditService = require('./auditService');
const { assertSafeModelUrl } = require('./modelService');
const { BadRequestError, ForbiddenError } = require('../lib/errors');

const EDITABLE_KEYS = Object.freeze([
  'lm_studio_url',
  'system_name',
  'organization_name',
  'default_system_prompt',
  'allow_user_registration',
  'enforce_audit_logging'
]);

/**
 * Per-key validation applied before anything is written, so a rejected update
 * leaves every key untouched.
 */
const VALIDATORS = Object.freeze({
  lm_studio_url: (value) => {
    // Throws with an explanatory message when the URL is not local/private.
    assertSafeModelUrl(String(value));
  },
  allow_user_registration: (value) => {
    if (!['true', 'false'].includes(String(value))) {
      throw new BadRequestError('قيمة السماح بالتسجيل الذاتي يجب أن تكون true أو false');
    }
  }
});

function getPublicSettings() {
  return settingsRepository.getMany([...EDITABLE_KEYS]);
}

async function update(updates, actor, ipAddress) {
  const keys = Object.keys(updates);

  const unknown = keys.filter((key) => !EDITABLE_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new BadRequestError(`إعدادات غير معروفة: ${unknown.join(', ')}`);
  }

  if (keys.includes('lm_studio_url') && actor.role !== 'superadmin') {
    throw new ForbiddenError('تعديل إعدادات خادم النماذج (LM Studio) مقتصر على المدير العام الأعلى (Super Admin)');
  }

  for (const key of keys) {
    VALIDATORS[key]?.(updates[key]);
  }

  await transaction(async () => {
    for (const key of keys) {
      await settingsRepository.set(key, updates[key]);
    }
  });

  await auditService.record({
    userId: actor.id,
    action: auditService.ACTIONS.SETTINGS_UPDATED,
    details: { keys },
    ipAddress
  });

  return { message: 'تم حفظ الإعدادات بنجاح' };
}

module.exports = { getPublicSettings, update, EDITABLE_KEYS };
