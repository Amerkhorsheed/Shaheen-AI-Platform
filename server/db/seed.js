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
  SUPERSEDED_CHARTERS,
  SUPERSEDED_MODULE_CONTENTS,
  SUPERSEDED_DIRECTIVES,
  SUPERSEDED_CATEGORY_MODULE_MAPS,
  SUPERSEDED_TEMPLATE_PROMPTS,
  isUpgradableShippedValue
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
 * Bring the charter, the shared modules, the category directives and the
 * category→module mapping up to the current edition.
 *
 * One rule governs all four, and it is the reason none of this is destructive:
 * a stored value is replaced only when it still matches, character for
 * character, something this platform itself shipped. Every such value is
 * recorded in promptLibrary.legacy.json. The moment an administrator edits a
 * charter, a module or a directive, it stops matching and is never touched
 * again — an institution's own wording outranks ours.
 *
 * Matching on content rather than on a version flag is what makes this safe
 * across the upgrade paths we cannot see: a database restored from a backup,
 * a partially upgraded installation, or a downgrade and re-upgrade.
 */
async function upgradeInstitutionalPrompts() {
  const storedCharter = await settingsRepository.getValue('default_system_prompt');

  if (isUpgradableShippedValue(storedCharter, SYSTEM_CHARTER, SUPERSEDED_CHARTERS)) {
    await settingsRepository.set('default_system_prompt', SYSTEM_CHARTER);
    logger.info('Replaced the superseded system charter with the current edition');
  }

  for (const [categoryId, directive] of Object.entries(CATEGORY_DIRECTIVES)) {
    const category = await categoryRepository.findById(categoryId);
    if (!category) continue;

    if (isUpgradableShippedValue(category.prompt_context, directive, SUPERSEDED_DIRECTIVES[categoryId])) {
      await categoryRepository.updateDirective(categoryId, directive);
      logger.info({ categoryId }, 'Upgraded the category directive to the current edition');
    }
  }

  for (const module of PROMPT_MODULES) {
    const existing = await promptRepository.findModule(module.id);
    if (!existing || !existing.is_system) continue;

    if (isUpgradableShippedValue(existing.content, module.content, SUPERSEDED_MODULE_CONTENTS[module.id])) {
      await promptRepository.updateModule(module.id, {
        name: module.name,
        description: module.description,
        content: module.content
      });
      logger.info({ moduleId: module.id }, 'Upgraded the prompt module to the current edition');
    }
  }

  await upgradeCategoryModuleMap();
}

/**
 * Re-attach the shipped module set where — and only where — the category still
 * carries a set this platform assigned.
 *
 * Without this, a module added in a later release reaches new installations
 * only: `seedPromptLibrary` skips any category that already has assignments,
 * which is every category on an upgraded system. Comparing against the mappings
 * we have shipped keeps a deliberate change by an administrator — an added
 * module, a removed one, a reordering — from being undone on the next boot.
 */
async function upgradeCategoryModuleMap() {
  const assignments = await promptRepository.listAllAssignments();

  const current = {};
  for (const row of assignments) {
    (current[row.category_id] ||= []).push(row.module_id);
  }

  const matchesShippedMap = (categoryId) =>
    SUPERSEDED_CATEGORY_MODULE_MAPS.some(
      (map) =>
        Array.isArray(map[categoryId]) &&
        map[categoryId].length === (current[categoryId] || []).length &&
        map[categoryId].every((moduleId, index) => current[categoryId][index] === moduleId)
    );

  for (const [categoryId, moduleIds] of Object.entries(CATEGORY_MODULE_MAP)) {
    if (!(await categoryRepository.findById(categoryId))) continue;
    if (!current[categoryId] || current[categoryId].length === 0) continue;

    const alreadyCurrent =
      current[categoryId].length === moduleIds.length &&
      moduleIds.every((moduleId, index) => current[categoryId][index] === moduleId);
    if (alreadyCurrent || !matchesShippedMap(categoryId)) continue;

    await promptRepository.clearCategoryModules(categoryId);
    for (const [index, moduleId] of moduleIds.entries()) {
      await promptRepository.attachModule(categoryId, moduleId, (index + 1) * 10);
    }
    logger.info({ categoryId, modules: moduleIds.length }, 'Upgraded the category module set to the current edition');
  }
}

/**
 * Seed the official templates, and bring shipped ones up to the current text.
 *
 * Two things make this more than an insert.
 *
 * A template added in a later release has to reach systems that are already
 * running, where the table is not empty. But an administrator may delete a
 * system template deliberately, and re-inserting it on the next boot would
 * override that decision silently. So the ids this platform has already
 * planted are recorded in a settings ledger: each shipped template is planted
 * once, ever, and a deletion afterwards stands.
 *
 * The rewrite of an existing template follows the charter's rule — replace it
 * only while it still matches, word for word, something this platform shipped.
 */
const SETTING_SEEDED_TEMPLATES = 'seeded_template_ids';

async function seedTemplates() {
  const planted = new Set(
    ((await settingsRepository.getValue(SETTING_SEEDED_TEMPLATES)) || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );

  // A system seeded before this ledger existed has its templates in place
  // already; record them so none is treated as never-planted and re-inserted.
  if (planted.size === 0 && (await templateRepository.count()) > 0) {
    for (const template of DEFAULT_TEMPLATES) {
      if (await templateRepository.findRawById(template.id)) planted.add(template.id);
    }
  }

  let added = 0;
  for (const template of DEFAULT_TEMPLATES) {
    if (planted.has(template.id)) continue;
    await templateRepository.insertSeed(template);
    planted.add(template.id);
    added += 1;
  }

  if (added > 0) {
    await settingsRepository.set(SETTING_SEEDED_TEMPLATES, [...planted].join(','));
    logger.info({ count: added }, 'Seeded official correspondence templates');
  } else if (planted.size > 0) {
    await settingsRepository.setIfAbsent(SETTING_SEEDED_TEMPLATES, [...planted].join(','));
  }

  for (const template of DEFAULT_TEMPLATES) {
    const stored = await templateRepository.findRawById(template.id);
    if (!stored || !stored.is_system) continue;

    if (isUpgradableShippedValue(stored.prompt, template.prompt, SUPERSEDED_TEMPLATE_PROMPTS[template.id])) {
      await templateRepository.update(template.id, {
        title: template.title,
        category: template.category,
        description: template.description,
        prompt: template.prompt,
        icon: template.icon
      });
      logger.info({ templateId: template.id }, 'Upgraded the official template to the current edition');
    }
  }
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
