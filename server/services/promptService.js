'use strict';

/**
 * System-prompt composition.
 *
 * The prompt sent to the model is assembled here, on the server, from four
 * layers. It is never taken from the client: a system prompt supplied by the
 * browser can be edited in the developer console, and the charter — which is
 * what stops the model inventing official figures — would be the first thing
 * removed.
 *
 *   1. الميثاق          the charter, from settings; binding on every request
 *   2. الوحدات المشتركة  modules the caller's category references
 *   3. التوجيه التخصصي   the category's own directive
 *   4. سياق التشغيل      job title, department, session classification
 *
 * Assembly is deterministic: the same account and classification always
 * produce byte-identical instructions, which is what makes a response
 * reproducible and the configuration auditable.
 */

const { transaction } = require('../db/pool');
const promptRepository = require('../repositories/promptRepository');
const categoryRepository = require('../repositories/categoryRepository');
const settingsRepository = require('../repositories/settingsRepository');
const auditService = require('./auditService');
const { SYSTEM_CHARTER } = require('../db/promptLibrary');
const { resolveClassification } = require('../templates/classifications');
const { NotFoundError, ConflictError, ForbiddenError, BadRequestError } = require('../lib/errors');

const SETTING_CHARTER = 'default_system_prompt';

const SEPARATOR = '\n\n──────────────────────────────────\n';

/** Extra emphasis on restraint as the session classification rises. */
const CLASSIFICATION_GUIDANCE = {
  top_secret:
    'درجة تصنيف هذه الجلسة «سري للغاية». التزم أقصى درجات الإيجاز، واقتصر حرفياً على المطلوب، ولا تستطرد ولا تقترح ما لم يُطلب.',
  secret:
    'درجة تصنيف هذه الجلسة «سري». اقتصر على ما يخدم الغرض مباشرة، وتجنّب التوسع غير اللازم.',
  official: null,
  unclassified: null
};

/** The charter as stored, falling back to the shipped text if it was cleared. */
async function getCharter() {
  const stored = await settingsRepository.getValue(SETTING_CHARTER);
  return stored && stored.trim() ? stored : SYSTEM_CHARTER;
}

/**
 * Compose the authoritative system prompt for one request.
 *
 * @param {object} params
 * @param {object} params.user           The authenticated caller.
 * @param {string} [params.classification] Session classification.
 * @param {string} [params.sessionNote]  Optional per-chat guidance. Additive
 *                                       only — it can extend the charter but
 *                                       never contradict or replace it.
 * @returns {Promise<{prompt: string, layers: object}>}
 */
async function compose({ user, classification = 'official', sessionNote = '' }) {
  const [charter, modules] = await Promise.all([
    getCharter(),
    user?.categoryId ? promptRepository.listModulesForCategory(user.categoryId) : []
  ]);

  const sections = [charter];

  if (modules.length > 0) {
    sections.push(
      ['التعليمات التخصصية المشتركة', ...modules.map((m) => m.content)].join('\n\n')
    );
  }

  if (user?.categoryPromptContext) {
    sections.push(`التوجيه التخصصي لإدارتك\n${user.categoryPromptContext}`);
  }

  const runtime = [
    'سياق التشغيل الحالي',
    `- المسمى الوظيفي للمستخدم: ${user?.jobTitle || 'غير محدد'}`,
    `- الإدارة / التصنيف المؤسسي: ${user?.categoryName || 'غير محدد'}`,
    `- درجة تصنيف الجلسة: ${resolveClassification(classification).label}`
  ];

  const classificationNote = CLASSIFICATION_GUIDANCE[classification];
  if (classificationNote) runtime.push(`- ${classificationNote}`);

  sections.push(runtime.join('\n'));

  if (sessionNote && sessionNote.trim()) {
    sections.push(
      'توجيه إضافي خاص بهذه الجلسة (لا يلغي أياً من القواعد أعلاه)\n' + sessionNote.trim()
    );
  }

  return {
    prompt: sections.join(SEPARATOR),
    layers: {
      charterChars: charter.length,
      modules: modules.map((m) => ({ id: m.id, name: m.name })),
      hasCategoryDirective: Boolean(user?.categoryPromptContext),
      classification,
      hasSessionNote: Boolean(sessionNote && sessionNote.trim())
    }
  };
}

/**
 * Replace whatever the client sent with the composed prompt.
 *
 * Client-supplied `system` messages are discarded rather than merged: keeping
 * them would let a browser weaken the charter, and merging two system prompts
 * produces contradictory instructions.
 */
async function applyTo(messages, { user, classification, sessionNote }) {
  const { prompt, layers } = await compose({ user, classification, sessionNote });
  const conversation = messages.filter((message) => message.role !== 'system');
  return { messages: [{ role: 'system', content: prompt }, ...conversation], layers };
}

// ---------------------------------------------------------------
// Administration
// ---------------------------------------------------------------
function listModules() {
  return promptRepository.listModules();
}

/** Modules attached to one category, in assembly order. */
async function listModulesForCategory(categoryId) {
  const category = await categoryRepository.findById(categoryId);
  if (!category) throw new NotFoundError('التصنيف المؤسسي غير موجود');
  return promptRepository.listModulesForCategory(categoryId);
}

async function getModule(id) {
  const module = await promptRepository.findModule(id);
  if (!module) throw new NotFoundError('وحدة التعليمات غير موجودة');
  return module;
}

async function createModule(input, actor, ipAddress) {
  const id = `mod_${input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) || Date.now().toString(36)}`;

  if (await promptRepository.findModule(id)) {
    throw new ConflictError('توجد وحدة تعليمات بهذا الاسم مسبقاً');
  }

  await promptRepository.insertModule({
    id,
    name: input.name.trim(),
    description: input.description?.trim() || '',
    content: input.content.trim(),
    isSystem: false,
    createdBy: actor.id
  });

  await auditService.record({
    userId: actor.id,
    action: 'PROMPT_MODULE_CREATED',
    details: { moduleId: id, name: input.name.trim() },
    ipAddress
  });

  return promptRepository.findModule(id);
}

async function updateModule(id, input, actor, ipAddress) {
  const existing = await getModule(id);

  await promptRepository.updateModule(id, {
    name: input.name !== undefined ? input.name.trim() : existing.name,
    description: input.description !== undefined ? input.description.trim() : existing.description,
    content: input.content !== undefined ? input.content.trim() : existing.content
  });

  // Editing a shared module changes the behaviour of every department that
  // references it, so the count is recorded with the change.
  await auditService.record({
    userId: actor.id,
    action: 'PROMPT_MODULE_UPDATED',
    details: { moduleId: id, affectedCategories: existing.category_count },
    ipAddress
  });

  return promptRepository.findModule(id);
}

async function deleteModule(id, actor, ipAddress) {
  const existing = await getModule(id);

  if (existing.is_system === 1) {
    throw new ForbiddenError('لا يمكن حذف وحدات التعليمات الأساسية المعتمدة؛ يمكن تعديل محتواها فقط');
  }
  if (existing.category_count > 0) {
    throw new BadRequestError(
      `لا يمكن حذف هذه الوحدة لارتباطها بـ ${existing.category_count} تصنيف. يرجى فكّ ارتباطها أولاً.`
    );
  }

  await promptRepository.removeModule(id);
  await auditService.record({
    userId: actor.id,
    action: 'PROMPT_MODULE_DELETED',
    details: { moduleId: id, name: existing.name },
    ipAddress
  });

  return { message: 'تم حذف وحدة التعليمات بنجاح' };
}

/** Replace a category's module set, in the order given. */
async function setCategoryModules(categoryId, moduleIds, actor, ipAddress) {
  const category = await categoryRepository.findById(categoryId);
  if (!category) throw new NotFoundError('التصنيف المؤسسي غير موجود');

  for (const moduleId of moduleIds) {
    if (!(await promptRepository.findModule(moduleId))) {
      throw new BadRequestError(`وحدة التعليمات «${moduleId}» غير موجودة`);
    }
  }

  await transaction(async () => {
    await promptRepository.clearCategoryModules(categoryId);
    for (const [index, moduleId] of moduleIds.entries()) {
      await promptRepository.attachModule(categoryId, moduleId, (index + 1) * 10);
    }
  });

  await auditService.record({
    userId: actor.id,
    action: 'CATEGORY_PROMPT_MODULES_SET',
    details: { categoryId, moduleIds },
    ipAddress
  });

  return promptRepository.listModulesForCategory(categoryId);
}

/**
 * Render the exact prompt a given category produces.
 * Lets an administrator read what the model will actually be told before
 * anyone relies on it — the prompt stops being invisible configuration.
 */
async function preview(categoryId, classification = 'official') {
  const category = await categoryRepository.findById(categoryId);
  if (!category) throw new NotFoundError('التصنيف المؤسسي غير موجود');

  const { prompt, layers } = await compose({
    user: {
      categoryId: category.id,
      categoryName: category.name,
      categoryPromptContext: category.prompt_context,
      jobTitle: 'مستخدم نموذجي'
    },
    classification
  });

  return { category: { id: category.id, name: category.name }, prompt, layers };
}

module.exports = {
  compose,
  applyTo,
  getCharter,
  listModules,
  listModulesForCategory,
  getModule,
  createModule,
  updateModule,
  deleteModule,
  setCategoryModules,
  preview,
  SETTING_CHARTER
};
