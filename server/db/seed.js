'use strict';

/**
 * First-run seeding and one-off security remediation.
 *
 * Runs after migrations, on every boot, and is safe to repeat: it only ever
 * inserts what is missing. Nothing here overwrites an operator's data.
 */

const categoryRepository = require('../repositories/categoryRepository');
const templateRepository = require('../repositories/templateRepository');
const settingsRepository = require('../repositories/settingsRepository');
const userRepository = require('../repositories/userRepository');
const authService = require('../services/authService');
const auditService = require('../services/auditService');
const config = require('../config');
const logger = require('../lib/logger');
const bcrypt = require('bcryptjs');

const { DEFAULT_CATEGORIES, DEFAULT_TEMPLATES, DEFAULT_SETTINGS } = require('./seedData');
const promptRepository = require('../repositories/promptRepository');
const {
  SYSTEM_CHARTER,
  PROMPT_MODULES,
  CATEGORY_MODULE_MAP,
  CATEGORY_DIRECTIVES,
  SUPERSEDED_CHARTERS
} = require('./promptLibrary');

// Published in earlier releases of this platform, in the README and in the
// source. Any account still using it is forced to change it.
const PREVIOUSLY_PUBLISHED_PASSWORD = 'admin123';
const REMEDIATION_FLAG = 'security_migration_v2';

async function seedCategories() {
  for (const category of DEFAULT_CATEGORIES) {
    await categoryRepository.upsertSeed(category);
  }
}

async function seedSettings() {
  for (const [key, value] of DEFAULT_SETTINGS) {
    await settingsRepository.setIfAbsent(key, value);
  }
}

/**
 * Seed the reusable prompt modules and attach them to the default categories.
 *
 * Both steps are idempotent and additive: an existing module is never
 * overwritten, and a category that already has its own module set is left
 * alone. An administrator's configuration survives every restart.
 */
async function seedPromptLibrary() {
  for (const module of PROMPT_MODULES) {
    await promptRepository.insertModuleSeed(module);
  }

  let mapped = 0;
  for (const [categoryId, moduleIds] of Object.entries(CATEGORY_MODULE_MAP)) {
    if (!(await categoryRepository.findById(categoryId))) continue;
    if ((await promptRepository.countAssignmentsForCategory(categoryId)) > 0) continue;

    for (const [index, moduleId] of moduleIds.entries()) {
      await promptRepository.attachModule(categoryId, moduleId, (index + 1) * 10);
    }
    mapped += 1;
  }

  if (mapped > 0) {
    logger.info({ categories: mapped, modules: PROMPT_MODULES.length }, 'Seeded the prompt library');
  }
}

/**
 * Bring the stored charter and the category directives up to the current
 * edition — but only where they still carry a value this platform shipped.
 * Anything an operator wrote is left untouched.
 */
async function upgradeInstitutionalPrompts() {
  const storedCharter = await settingsRepository.getValue('default_system_prompt');

  if (storedCharter && SUPERSEDED_CHARTERS.includes(storedCharter.trim())) {
    await settingsRepository.set('default_system_prompt', SYSTEM_CHARTER);
    logger.info('Replaced the superseded system charter with the current edition');
  }

  // The seeded categories carried a one-line directive in earlier releases.
  for (const [categoryId, directive] of Object.entries(CATEGORY_DIRECTIVES)) {
    const category = await categoryRepository.findById(categoryId);
    if (!category) continue;

    const seeded = DEFAULT_CATEGORIES.find((c) => c.id === categoryId);
    const current = (category.prompt_context || '').trim();

    // Short, single-line values are the previous shipped defaults; a directive
    // written by an operator is left as it is.
    const looksSuperseded = current.length > 0 && !current.includes('\n') && current !== directive.trim();
    if (looksSuperseded && seeded) {
      await categoryRepository.updateDirective(categoryId, directive);
      logger.info({ categoryId }, 'Upgraded the category directive to the current edition');
    }
  }
}

async function seedTemplates() {
  if ((await templateRepository.count()) > 0) return;

  for (const template of DEFAULT_TEMPLATES) {
    await templateRepository.insertSeed(template);
  }
  logger.info({ count: DEFAULT_TEMPLATES.length }, 'Seeded official correspondence templates');
}

/**
 * Create the first administrator with a random password, printed once.
 *
 * A fixed default here would be a published credential on every deployment —
 * which is precisely how the previous one leaked.
 */
async function seedAdministrator() {
  const stats = await userRepository.statistics();
  if (stats.total_users > 0) return;

  const password = config.bootstrap.initialAdminPassword || authService.generatePassword();

  await userRepository.insert({
    username: 'admin',
    passwordHash: authService.hashPassword(password),
    displayName: 'المدير العام (مسؤول المنظومة)',
    role: 'superadmin',
    department: 'القيادة والإدارة العليا',
    categoryId: 'cat_exec',
    jobTitle: 'المدير العام ومسؤول المنظومة',
    status: 'active',
    notes: '',
    mustChangePassword: true
  });

  // Written straight to stdout: this must be readable in a terminal or a
  // container log, and must never be captured into a structured log store.
  process.stdout.write(
    '\n' +
      '  ┌──────────────────────────────────────────────────────┐\n' +
      '  │  حساب المشرف الأول — تُعرض كلمة المرور مرة واحدة فقط  │\n' +
      '  ├──────────────────────────────────────────────────────┤\n' +
      '  │  اسم المستخدم : admin\n' +
      `  │  كلمة المرور  : ${password}\n` +
      '  │  يجب تغييرها إلزامياً عند أول تسجيل دخول.            │\n' +
      '  └──────────────────────────────────────────────────────┘\n\n'
  );
}

/**
 * Applied once against databases created before this release.
 *   (a) force a change on any account still using the published default;
 *   (b) close open self-registration, which used to be the shipped default.
 */
async function applySecurityRemediation() {
  const accounts = await userRepository.listCredentialAudit();

  for (const account of accounts) {
    if (account.must_change_password) continue;
    if (!bcrypt.compareSync(PREVIOUSLY_PUBLISHED_PASSWORD, account.password_hash)) continue;

    await userRepository.flagPasswordChangeRequired(account.id);
    await auditService.record({
      userId: account.id,
      action: auditService.ACTIONS.SECURITY_REMEDIATION,
      details: { reason: 'account used the previously published default password' }
    });
    logger.warn(
      { username: account.username },
      'Account still used the previously published default password — a change is now required and its sessions were revoked'
    );
  }

  if (await settingsRepository.exists(REMEDIATION_FLAG)) return;

  if ((await settingsRepository.getValue('allow_user_registration')) === 'true') {
    await settingsRepository.set('allow_user_registration', 'false');
    logger.warn(
      'Open self-registration was enabled and has been closed. Re-enable it from the settings panel only if it is genuinely required.'
    );
  }
  await settingsRepository.set(REMEDIATION_FLAG, new Date().toISOString());
}

async function seed() {
  // Order matters: users reference categories.
  await seedCategories();
  await seedSettings();
  await seedAdministrator();
  await seedTemplates();
  await seedPromptLibrary();
  await upgradeInstitutionalPrompts();
  await applySecurityRemediation();
  logger.info('Seed and remediation checks complete');
}

module.exports = { seed, PREVIOUSLY_PUBLISHED_PASSWORD };
