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
const { SYSTEM_CHARTER, SUPERSEDED_CHARTERS } = require('../db/promptLibrary');
const { resolveClassification } = require('../templates/classifications');
const { estimateMessagesTokens } = require('../lib/tokenEstimator');
const { searchAllCachedChunks } = require('./chunkingService');
const { isReasoningModel } = require('../lib/modelFamily');
const modelService = require('./modelService');
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

/**
 * Reasoning models (DeepSeek-R1 and its distillations) are documented to
 * perform worse with a system role: their reinforcement-trained reasoning loop
 * expects the task in the user turn. They receive the same four composed
 * layers, delivered differently, plus this overlay — the only text in the
 * platform that is model-specific rather than institutional.
 */
const REASONING_MODEL_OVERLAY = `[نمط الاستدلال وصياغة المخرجات الإلزامية]
- مسار التفكير داخل <think> ... </think> يجب أن يكون فائق الإيجاز (أقل من 80 كلمة) ومخصصاً فقط لتدقيق العمليات الحسابية ومطابقة المصادر، ثم يُغلق الوسم بـ </think> فوراً.
- يُمنع الاستطراد في التفكير أو كتابة مسودات تفصيلية داخل وسم التفكير حتى لا تنفد ميزانية الرموز.
- ابدأ فور إغلاق الوسم مباشرة بكتابة التقرير النهائي الشامل بالعربية الفصحى، بادئاً بالخلاصة التنفيذية والنتائج الميدانية ومكامن الخلل والجداول المتقاطعة والقرارات العملية دون أي وصف لبنية الملف أو كيفية معالجته.`;

/** The charter as stored, falling back to the shipped text if it was cleared. */
async function getCharter() {
  const stored = await settingsRepository.getValue(SETTING_CHARTER);
  return stored && stored.trim() ? stored : SYSTEM_CHARTER;
}

/**
 * Is this session note just a copy of the charter?
 *
 * A chat is created carrying the charter as its own note, so the note is
 * routinely a copy of layer 1. Sending it twice wastes about a thousand tokens
 * of every request and — worse — repeats the binding rules under a heading
 * that says they may be overridden.
 *
 * Every charter edition counts, not only the current one: a chat created
 * before an upgrade holds the charter that was current on the day it was
 * opened, and on an installed system those chats outnumber the new ones.
 */
function isCharterCopy(note, charter) {
  if (!note) return false;
  const trimmed = note.trim();
  if (!trimmed) return false;
  if (trimmed === (charter || '').trim()) return true;
  return SUPERSEDED_CHARTERS.some((edition) => edition.trim() === trimmed);
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

  const sections = [`<system_charter title="الميثاق المؤسسي">\n${charter}\n</system_charter>`];

  if (modules.length > 0) {
    sections.push(
      `<shared_modules title="التعليمات التخصصية المشتركة">\n` +
        modules.map((m) => m.content).join('\n\n') +
        `\n</shared_modules>`
    );
  }

  if (user?.categoryPromptContext) {
    sections.push(
      `<category_directive title="التوجيه التخصصي لإدارتك">\n${user.categoryPromptContext}\n</category_directive>`
    );
  }

  const runtime = [
    `- المسمى الوظيفي للمستخدم: ${user?.jobTitle || 'غير محدد'}`,
    `- الإدارة / التصنيف المؤسسي: ${user?.categoryName || 'غير محدد'}`,
    `- درجة تصنيف الجلسة: ${resolveClassification(classification).label}`
  ];

  const classificationNote = CLASSIFICATION_GUIDANCE[classification];
  if (classificationNote) runtime.push(`- ${classificationNote}`);

  sections.push(`<runtime_context title="سياق التشغيل الحالي">\n${runtime.join('\n')}\n</runtime_context>`);

  const note = sessionNote && sessionNote.trim();
  const noteIsCharterCopy = isCharterCopy(note, charter);

  if (note && !noteIsCharterCopy) {
    sections.push(
      `<session_guidance title="توجيه إضافي خاص بهذه الجلسة (لا يلغي أياً من القواعد أعلاه)">\n${note}\n</session_guidance>`
    );
  }

  return {
    prompt: sections.join(SEPARATOR),
    layers: {
      charterChars: charter.length,
      modules: modules.map((m) => ({ id: m.id, name: m.name })),
      hasCategoryDirective: Boolean(user?.categoryPromptContext),
      classification,
      hasSessionNote: Boolean(note) && !noteIsCharterCopy
    }
  };
}

const ARABIC_MANDATE_SUFFIX = `\n\n[توجيه سيادي ملزم: صِغ التقرير بالكامل باللغة العربية الفصحى حصراً 100% شاملاً الجداول والتحليل الموضوعي والتوصيات التنفيذية وفق الميثاق المؤسسي. ادخل مباشرة في صلب النتائج التشغيلية ومكامن الخلل والقرارات العملية، وتجنّب تماماً الحديث الميتالورغي عن بنية الملف أو أوراقه أو أبعاده. يُحظر تماماً استخدام أي أحرف صينية أو مصطلحات أجنبية في متن التحليل والتوصيات، وتُعرّب كافة المفاهيم والمؤشرات الفنية تعريباً كاملاً]`;

/** The closing marker the profiler writes; its presence means the dossier arrived whole. */
const DOSSIER_END_MARKER = '[نهاية الملف الإحصائي]';

/**
 * The task specification for a request that carries a computed dossier.
 *
 * This deliberately lives in the user turn rather than in the charter. Five
 * successive revisions tried to raise the quality of dataset reports by adding
 * rules to the charter — «do not describe the file structure», «go straight to
 * the results» — and every one of them produced the same output: a faithful
 * Arabic transcription of the tables it had been handed. A prohibition tells a
 * model what not to write; it does not tell it what the analysis is. The
 * skeleton below does, and it sits next to the data it applies to, so it
 * governs only the requests that have a dataset attached and disappears from
 * every other request in the platform.
 */
const DATASET_ANALYSIS_BRIEF = `

──────────────────────────────────
[مواصفة المخرج المطلوب — تقرير تحليلي تنفيذي لا سرد لمحتويات الملف]

المعطيات أعلاه محسوبة آلياً بدقة قطعية على 100% من السجلات. هي **مصدر الحقيقة الوحيد**: لا تعِد احتسابها، ولا تشتق منها رقماً جديداً إلا بعملية صريحة تبيّنها، ولا تذكر أي جهة أو مورّد أو خط أو مكوّن أو نسبة **لم ترد حرفياً** في الجداول أعلاه. إن لم يرد في المعطيات ما يجيب على سؤال، فاكتب صراحةً: «لا يتضمن الملف هذا المعطى».

اكتب التقرير بهذا الترتيب حصراً:

1. **الحكم التنفيذي** (٣ إلى ٥ أسطر، تُكتب مرة واحدة فقط ولا تُكرَّر تحت أي عنوان آخر): ما الحالة الفعلية للمنظومة موضع التحليل، وما الرقم الواحد الأهم الذي يلخّصها، وما القرار الأعجل. وإن ورد في المعطيات جدول «مقارنة المخطط بالفعلي» فهو أساس هذه الفقرة: اذكر **أوسع فجوة بفئتها بالاسم** ومقدارها، لا مدى الفجوات مجملاً — فالمدى يُخفي الفئة الأسوأ التي هي موضع القرار. ولا تشتق فجوةً بنفسك ما دام الجدول يحملها محسوبة. ولا تصف رقماً محسوباً من البيانات نفسها بأنه «مستهدف»؛ المعدل العام المحسوب مرجعُ مقارنةٍ داخلي لا هدف معتمد. وإن حمل الجدول تحذيراً بتعارض الأحجام المخططة مع السجلات الفعلية، فأثبِته هنا بوصفه ملاحظة على جودة البيانات. بلا مقدمات ولا وصف للملف.
2. **بؤر تركّز الخلل**: اعتمد جدول «بؤر تركّز الحالة الحرجة». اذكر لكل بؤرة: العدد المطلق، والنسبة داخل الفئة، ومُعامل التركّز، وحصتها من إجمالي الحالات، **وعمود الدلالة الإحصائية حرفياً**. ميّز ثلاثة أصناف لا صنفين: فئة **دالة إحصائياً** نسبتها مرتفعة (مشكلة جودة مؤكدة تستوجب إجراءً موجّهاً)، وفئة **غير دالة** مهما بدا مُعامل تركّزها مرتفعاً (تُذكر للرصد فقط ولا يُبنى عليها إجراء يستهدفها)، وفئة تستوعب حصة كبيرة من الحالات بحكم حجمها لا بحكم رداءتها (مشكلة حجم، وعلاجها في الآلية لا في الفئة). وصرّح بعدد البؤر الدالة من إجمالي المفحوصة.
3. **تشخيص السبب الجذري ومؤشر الإنذار المبكر**: قابِل بين جدول «سلوك القياسات الرقمية داخل كل حالة» وقيم «قوة الارتباط (Cramér's V)». إن تدرّجت القياسات بين الحالة السليمة والحرجة فالسبب في المتغيّر المقيس نفسه؛ وإن كانت قوة الارتباط بالأبعاد التنظيمية ضعيفة فصرّح بأن الخلل **ليس** عائداً إلى جهة أو خط أو مشغّل بعينه، ولا تُحمّل جهة مسؤولية لا يسندها رقم. وإن ورد في المعطيات «تدرّج تصاعدي محسوب» بفئة وسطى، فأفرد لها فقرة مستقلة: عددها، وقيمة قياسها، ولماذا هي أرخص نقطة تدخّل — فالفئة الوسطى سجلات انحرفت ولم تفشل بعد، ومعالجتها تمنع تحوّلها إلى فشل. إغفال الفئة الوسطى نقص جوهري في التقرير.
4. **الاتجاه الزمني**: هل المؤشر يتدهور أم يتحسّن أم مستقر، وبكم نقطة مئوية. وإن حمل جدول التسلسل الزمني تنبيهاً منهجياً بقلة الفترات أو نقصانها، فانقله في متن التقرير ولا تبنِ عليه دعوة استعجالية؛ فرقان بين فترتين مقارنة، لا اتجاه.
5. **القرارات التنفيذية**: خمسة قرارات كحد أقصى، مرتّبة بالأولوية. لكل قرار أربعة عناصر إلزامية: الإجراء المحدد، والجهة المنفّذة [بين معقوفتين]، والمهلة [بين معقوفتين]، والمؤشر الرقمي للنجاح. ويخضع كل قرار للشروط الأربعة الآتية دون استثناء:
   - **السند**: اذكر بين قوسين السطر أو الجدول الذي يسنده من المعطيات أعلاه. قرارٌ بلا سند يُحذف ولا يُكتب.
   - **وسم الأهلية (إلزامي وظاهر)**: اختم كل قرار بوسم صريح بين قوسين: إما «(الفئة المستهدفة: دالة إحصائياً)» وإما «(إجراء موجّه إلى الآلية لا إلى كيان بعينه)». القرار بلا وسم قرارٌ ناقص.
   - **حظر استهداف غير الدال**: لا توجّه إجراءً يستهدف بالاسم أي كيان ورد في «المحظور استهدافها» بقائمة الأهلية، ولا جهةً قرّرتَ في الفقرة 3 أن ارتباطها بالنتيجة ضعيف. راجع تلك القائمة اسماً اسماً قبل كتابة كل قرار. علاج هذه الحالات يكون في الآلية أو المتغيّر المقيس، ولا يجوز أن يناقض قرارٌ تشخيصَك.
   - **قابلية القياس على المنفّذ**: يجب أن يكون المؤشر رقماً تملك الجهة المنفّذة تحريكه بذاتها — نسبة الفئة نفسها مثلاً. ويُمنع اتخاذ «حصة الفئة من إجمالي الحالات» مؤشراً للنجاح، لأن مقامها أداء الآخرين: قد ترتفع الحصة والفئة تتحسّن، وقد تنخفض والفئة على حالها.
   - **حظر مؤشرات التطابق بين الأفراد**: يُمنع منعاً باتاً أي مؤشر يقيس تقارب نسب المشغّلين أو الفاحصين بعضهم من بعض، لأنه يكافئ التستر على الخلل بدل اكتشافه.
   وليكن أحد القرارات موجّهاً إلى الفئة الوسطى (مؤشر الإنذار المبكر) متى وُجدت.
6. **حدود المعطيات**: ما الذي لا يمكن البتّ فيه بهذا الملف وحده، وما البيانات الإضافية اللازمة.

ممنوع: نسخ الجداول كما هي دون استنتاج، ووصف بنية الملف أو أوراقه أو أعمدته، والعبارات الإنشائية العامة، وأي رقم لا أصل له أعلاه، وتكرار الخلاصة التنفيذية مرتين تحت عنوانين مختلفين.`;

/**
 * The sourcing rule for a follow-up question about a dataset already in session.
 *
 * Short by design: the follow-up should be answered as a follow-up, not turned
 * back into a full report. What it restores is the one guarantee the narrow
 * turn was losing — that every entity and every figure in the answer can be
 * pointed at in the tables.
 */
const DATASET_FOLLOWUP_GROUNDING = `

──────────────────────────────────
[قاعدة الإسناد الملزمة لهذا الاستفسار]
أجب على السؤال المطروح تحديداً وباختصار، مستنداً حصراً إلى الملف الإحصائي المرفق في هذه الجلسة. كل كيان تذكره (مورّد، خط، مكوّن، مشغّل، فترة) وكل رقم تورده يجب أن يكون وارداً حرفياً في جداول ذلك الملف. إن لم يتضمن الملف ما يجيب على السؤال، فاكتب صراحةً: «لا يتضمن الملف الإحصائي المرفق هذا المعطى»، ولا تقدّر ولا تستنتج كياناً أو نسبة من عندك.

ويُحظر إعادة إنتاج الرد السابق أو أي فقرة أو جدول منه حرفياً. الرد السابق معلوم للمستخدم وقد قرأه؛ إعادته ليست إجابة. اكتب ما يجيب هذا السؤال تحديداً وما يضيف إلى ما سبق، وإن كان الجواب وارداً في الرد السابق فأشِر إليه بسطر واحد ثم أضف التفصيل الجديد.

وإذا كان السؤال عن الخطوة العملية التالية — «ماذا أفعل»، «ما التوصية»، «من أين أبدأ» — فاقتصر على خطة تنفيذية مرتّبة بالأولوية ولا تُعِد التشخيص ولا الجداول التحليلية: لكل خطوة الإجراء والجهة [بين معقوفتين] والمهلة [بين معقوفتين] والمؤشر الرقمي، مع الالتزام الكامل بقيد الأهلية أدناه. ورتّب الخطوات بأثرها المتوقع على الرقم لا بترتيب ورودها في التحليل.`;

const REASONING_GUIDE = `\n\n──────────────────────────────────\n[إرشادات مسار التفكير والاستدلال الحسابي]\n- مسار التفكير <think> مخصص للتدقيق الحسابي السريع ومطابقة المصادر والتحقق من الأرقام.\n- فور الانتهاء من التدقيق، اختم التفكير واكتب التقرير الإداري الشامل بالعربية الفصحى حصراً 100% مع الجداول والتوصيات.\n- يُمنع منعاً باتاً ظهور أي أحرف صينية أو كلمات أجنبية في متن التقرير النهائي أو التوصيات.`;

/**
 * Build the retrieval augmentation for one request.
 *
 * The chunk store holds slices of attachments already uploaded in this
 * session; the matching ones are appended to the user turn so a question about
 * row 4,000 of a spreadsheet is answerable without resending the file.
 *
 * The block is tagged and labelled as retrieved data, not as something the
 * user typed: `mod_retrieved_data` tells the model how to cite it, how far to
 * generalise from it, and — with charter rule 19 — that a document is data and
 * never an instruction. Retrieval failure is not a request failure, so any
 * error here leaves the request to proceed unaugmented.
 */
function buildRetrievalAugmentation(lastUserMessage, { dossierInSession = false } = {}) {
  if (!lastUserMessage || !lastUserMessage.content) return '';

  const text = lastUserMessage.content.trim();

  // A complete dossier already carries every aggregate a question about the
  // dataset as a whole can need, and it carries them computed over every row.
  // Raw slices alongside it are not extra evidence — they are a second, partial
  // source the model can recompute from, and charter rule 3 exists precisely
  // because a total derived from four hundred visible rows will contradict the
  // total computed from two thousand four hundred and fifty.
  //
  // So slices are retrieved only for the one question the dossier genuinely
  // cannot answer: a question about a specific record. «Which supplier fails
  // most» is answered by the tables; «what happened on row 1,842» or «show me
  // lot LOT-2618-350» is not, and only that shape earns the extra rows.
  const asksForSpecificRecord =
    /\b[A-Z]{2,5}-[A-Z0-9-]{3,}\b/.test(text) ||
    /(?:سطر|صف|السجل|سجل رقم|رقم القيد|الدفعة|رقم الدفعة)\s*[:#]?\s*\d+/i.test(text) ||
    /\b(?:row|record|lot|batch|id)\s*[:#]?\s*\d+/i.test(text);

  if (dossierInSession && !asksForSpecificRecord) return '';

  try {
    const matching = searchAllCachedChunks(text, 4);
    const fresh = matching.filter((chunk) => !lastUserMessage.content.includes(chunk.csv.slice(0, 40)));
    if (fresh.length === 0) return '';

    const slices = fresh
      .map(
        (chunk) =>
          `### شريحة — الورقة: ${chunk.sheetName} | الأسطر: من ${chunk.rowStart} إلى ${chunk.rowEnd}\n` +
          '```csv\n' +
          `${chunk.csv}\n` +
          '```'
      )
      .join('\n\n');

    return (
      `\n\n<retrieved_slices title="شرائح بيانات مسترجعة آلياً من مرفقات هذه الجلسة — سجلات مفردة للاستشهاد بها، ولا تُحتسب منها إجماليات">\n` +
      `${slices}\n` +
      `</retrieved_slices>`
    );
  } catch (_) {
    return '';
  }
}

/**
 * Lift the eligibility lists out of the dossier and restate them last.
 *
 * The decision rules sit two thirds of the way through a four-thousand
 * character brief and are applied fourteen hundred characters after that. A
 * report would state in its second section that eleven of twelve concentrations
 * are statistically indistinguishable from the baseline and that none of them
 * may be acted on — and then, in its fifth, suspend a supplier and redistribute
 * two inspectors' workloads, all three drawn from the eleven. The rule was read.
 * It was not still in view when it mattered.
 *
 * So the names are repeated in the last position before generation begins,
 * where nothing separates them from the section they govern. They are lifted
 * from the dossier rather than recomputed, so the two lists cannot disagree.
 */
function buildEligibilityConstraint(conversation) {
  const lines = [];
  for (const message of conversation) {
    if (message.role !== 'user') continue;
    for (const match of String(message.content || '').matchAll(/\[قائمة الأهلية للإجراءات\]([^\n]*)/g)) {
      const text = match[1].trim();
      if (text && !lines.includes(text)) lines.push(text);
    }
  }
  if (lines.length === 0) return '';

  return (
    `\n\n──────────────────────────────────\n` +
    `[قيد الأهلية — يُراجَع سطراً بسطر قبل كتابة كل قرار تنفيذي]\n` +
    lines.map((l) => `- ${l}`).join('\n') +
    `\nيُحظر توجيه أي إجراء تصحيحي بالاسم إلى كيان وارد في «المحظور استهدافها»، ويُحظر اتخاذ «حصة الفئة من إجمالي الحالات» أو «تقارب نسب المشغّلين» مؤشراً للنجاح. ما عدا الكيانات المؤهلة، توجَّه القرارات إلى الآلية أو المتغيّر المقيس. واختم كل قرار بوسم الأهلية.`
  );
}

/** Append text to the last user turn, leaving every other message untouched. */
function appendToLastUserMessage(conversation, addition) {
  if (!addition) return conversation;
  const index = conversation.map((message) => message.role).lastIndexOf('user');
  if (index < 0) return conversation;

  const updated = [...conversation];
  updated[index] = { ...updated[index], content: `${updated[index].content}${addition}` };
  return updated;
}

/** Prepend text to the last user turn, for models that take no system role. */
function prependToLastUserMessage(conversation, prefix) {
  const index = conversation.map((message) => message.role).lastIndexOf('user');
  if (index < 0) return [...conversation, { role: 'user', content: prefix }];

  const updated = [...conversation];
  updated[index] = { ...updated[index], content: `${prefix}${updated[index].content}` };
  return updated;
}

/**
 * Replace whatever the client sent with the composed prompt, adapted to the model.
 *
 * Client-supplied `system` messages are discarded rather than merged: keeping
 * them would let a browser weaken the charter, and merging two system prompts
 * produces contradictory instructions.
 *
 * Both model families receive the *same* four composed layers. Only the
 * delivery differs, and that difference is the whole of the adaptation:
 *
 *   Qwen and general models — the layers as a system message.
 *   Reasoning models (R1 class) — the layers prefixed to the last user turn,
 *     with no system role at all, plus a short overlay on how to use the
 *     thinking pass.
 *
 * An earlier revision instead hand-wrote a separate directive for the
 * reasoning path. It drifted: departments got no directive, the shared modules
 * were absent, the sourcing rules were absent, and an example borrowed from one
 * test document had been generalised into a rule for every ministry. Composing
 * once removes the possibility of that drift — the charter an administrator
 * edits now governs every model the platform can load.
 */
/**
 * How many tokens of prompt this request may occupy.
 *
 * Derived from what the engine reports for the resident model, less the space
 * the answer needs and a margin for the chat template's own tokens. When the
 * engine cannot be asked — it is not LM Studio, or the model is loading — the
 * conservative constant that predates this function is used, because
 * overshooting the window fails the request outright while undershooting only
 * shortens the history.
 */
const FALLBACK_PROMPT_TOKENS = 26000;
const CONTEXT_SAFETY_MARGIN_TOKENS = 1500;

async function resolvePromptBudget(model, outputTokens) {
  const contextLength = await modelService.getLoadedContextLength(model);
  if (!contextLength) return FALLBACK_PROMPT_TOKENS;

  const reserved = Math.max(Number(outputTokens) || 0, 2048) + CONTEXT_SAFETY_MARGIN_TOKENS;
  return Math.max(8000, contextLength - reserved);
}

async function applyTo(messages, { user, classification, sessionNote, model = '', maxTokens }) {
  const conversation = messages.filter((message) => message.role !== 'system');
  const lastUserMessage = conversation.slice().reverse().find((message) => message.role === 'user');

  // The analytical brief applies only where there is a computed dossier to
  // analyse. A letter or a PDF attached to the same endpoint gets the language
  // mandate and nothing else — asking for a defect-concentration section of a
  // ministerial memorandum would be worse than asking for nothing.
  //
  // And it applies in full only to the turn that opens the dataset. A follow-up
  // is a narrow question — «which supplier is worst?» — and answering it with a
  // six-part executive report would be its own kind of not answering what was
  // asked. What the follow-up needs instead is the sourcing rule, because that
  // is the turn where the model, working from a half-remembered table, used to
  // name a supplier the dataset had never contained.
  const dossierInCurrentTurn = Boolean(lastUserMessage?.content?.includes(DOSSIER_END_MARKER));
  const dossierInSession =
    dossierInCurrentTurn ||
    conversation.some((m) => m.role === 'user' && (m.content || '').includes(DOSSIER_END_MARKER));

  const augmentation = buildRetrievalAugmentation(lastUserMessage, { dossierInSession });
  const { prompt, layers } = await compose({ user, classification, sessionNote });
  let augmented = appendToLastUserMessage(conversation, augmentation);

  // If there are attachments or retrieved data slices, anchor the generation frontier with the Arabic mandate
  const hasDataOrAttachments =
    dossierInSession ||
    Boolean(augmentation) ||
    Boolean(lastUserMessage?.content?.includes('محتوى الملف المرفق')) ||
    Boolean(lastUserMessage?.content?.includes('الملف الإحصائي الشامل'));

  if (dossierInCurrentTurn) {
    augmented = appendToLastUserMessage(augmented, DATASET_ANALYSIS_BRIEF);
  } else if (dossierInSession) {
    augmented = appendToLastUserMessage(augmented, DATASET_FOLLOWUP_GROUNDING);
  }

  if (hasDataOrAttachments) {
    augmented = appendToLastUserMessage(augmented, ARABIC_MANDATE_SUFFIX);
  }

  // Last of all, so that nothing stands between the constraint and the text it
  // constrains.
  const eligibilityConstraint = dossierInSession ? buildEligibilityConstraint(conversation) : '';
  if (eligibilityConstraint) {
    augmented = appendToLastUserMessage(augmented, eligibilityConstraint);
  }

  const modelLower = (model || '').toLowerCase();
  const isThinking =
    modelLower.includes('deepseek') ||
    modelLower.includes('r1') ||
    modelLower.includes('qwq') ||
    modelLower.includes('think') ||
    modelLower.includes('qwen');
  const systemContent = isThinking ? `${prompt}${REASONING_GUIDE}` : prompt;

  const promptBudget = await resolvePromptBudget(model, maxTokens);

  let finalMessages;
  if (isReasoningModel(model)) {
    const directive = `${systemContent}${SEPARATOR}${REASONING_MODEL_OVERLAY}\n\n──────────────────────────────────\n\n`;
    const prepared = prependToLastUserMessage(augmented, directive);
    finalMessages = pruneContext(prepared, promptBudget);
  } else {
    const combined = [{ role: 'system', content: systemContent }, ...augmented];
    finalMessages = pruneContext(combined, promptBudget);
  }

  // Pre-close the thinking phase for reasoning models to prevent infinite thinking loops
  if (isThinking && finalMessages.length > 0 && finalMessages[finalMessages.length - 1]?.role === 'user') {
    const prefillContent = hasDataOrAttachments
      ? '<think>\nتم تدقيق كافة المعطيات والمؤشرات الإحصائية ومطابقتها وفق ميثاق المنظومة.\n</think>\n'
      : '<think>\nتم التدقيق والمطابقة وفق ميثاق المنظومة.\n</think>\n';
    finalMessages.push({ role: 'assistant', content: prefillContent });
  }

  return {
    messages: finalMessages,
    layers: {
      ...layers,
      delivery: isReasoningModel(model) ? 'user_prefixed' : 'system_message',
      retrievedSlices: Boolean(augmentation),
      analysisBrief: dossierInCurrentTurn,
      followupGrounding: dossierInSession && !dossierInCurrentTurn,
      eligibilityConstraint: Boolean(eligibilityConstraint),
      promptBudget
    }
  };
}

/**
 * Guards the context window against prompt explosions (huge attachments, multi-turn growth).
 * Ensures total tokens remain strictly within safe threshold (default: 26,000 tokens for 32K/38K context).
 * Strongly protects the active user message and its tabular dossier from truncation.
 */
function pruneContext(messages, maxTokens = 26000) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const result = [...messages];
  const hasSystem = result[0]?.role === 'system';
  const systemMsg = hasSystem ? result[0] : null;
  let conversation = hasSystem ? result.slice(1) : [...result];

  if (conversation.length === 0) {
    return hasSystem ? [systemMsg] : [];
  }

  // Step 1: Sanitize and clean historical messages
  // - Filter out failed attempt notices
  // - Strip any raw reasoning / thinking remnants from previous turns
  // - Cap earlier assistant responses so old history doesn't starve the current prompt
  const lastIdx = conversation.length - 1;
  const sanitized = [];

  // The turn that carries the live dossier is the evidence for every question
  // that follows it, so it is exempt from the historical-message cap. Clipping
  // it at 2,500 characters — a third of one dossier — is what left follow-up
  // answers to be improvised. If the budget genuinely cannot hold it, the loop
  // below drops whole older turns first, and only the final truncation step,
  // reached when nothing else is left to drop, will touch it.
  const dossierIndex = conversation.reduce(
    (found, m, i) => (m?.role === 'user' && (m.content || '').includes(DOSSIER_END_MARKER) ? i : found),
    -1
  );

  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    if (i === lastIdx || i === dossierIndex) {
      sanitized.push(msg);
      continue;
    }

    let content = (msg?.content || '').trim();

    // Drop failed execution notices from prompt history
    if (content.includes('تعذّر استكمال صياغة التقرير النهائي') || content.includes('استُنفدت طاقة التوليد')) {
      continue;
    }

    // Strip legacy thinking blocks from history
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    content = content.replace(/^\*\(مسار التحليل والتدقيق[\s\S]*?\)\*:\s*/gi, '').trim();

    // Cap older assistant responses to conserve context budget. The reply the
    // user is following up on is capped far more generously than the ones
    // before it: a question like «expand on the third point» is unanswerable
    // when the third point was cut away with the rest of the report.
    const assistantCap = i === lastIdx - 1 ? 4000 : 1200;
    if (msg.role === 'assistant' && content.length > assistantCap) {
      content = content.slice(0, assistantCap) + '\n\n... [تم اختصار محتوى الإجابة السابقة للحفاظ على سياق الجلسة]';
    } else if (msg.role === 'user' && content.length > 2500) {
      content = content.slice(0, 2500) + '\n\n... [تم اختصار الاستفسار السابق]';
    }

    if (content) {
      sanitized.push({ ...msg, content });
    }
  }

  conversation = sanitized;

  // Two messages are never dropped: the question being asked, and the turn that
  // carries the dataset it is asked about. Everything else is conversational
  // history and is surrendered first.
  const isProtected = (msg, index, list) =>
    index === list.length - 1 ||
    (msg?.role === 'user' && (msg.content || '').includes(DOSSIER_END_MARKER));

  /** Remove the oldest message that may be removed. Returns false when none may. */
  const dropOldestDroppable = () => {
    const index = conversation.findIndex((m, i, list) => !isProtected(m, i, list));
    if (index === -1) return false;
    conversation.splice(index, 1);
    return true;
  };

  // Step 2: Keep at most the most recent 10 turns in long multi-turn sessions
  while (conversation.length > 10) {
    if (!dropOldestDroppable()) break;
  }

  // Step 3: Check token budget
  const overBudget = () =>
    estimateMessagesTokens(hasSystem ? [systemMsg, ...conversation] : conversation) > maxTokens;

  if (!overBudget()) {
    return hasSystem ? [systemMsg, ...conversation] : conversation;
  }

  // Drop oldest historical messages first, preserving the system prompt, the
  // current user query and the dataset the query is about.
  while (conversation.length > 1 && overBudget()) {
    if (!dropOldestDroppable()) break;
  }

  // Step 4: If still over budget, only then truncate the last user message (which may have a massive attachment)
  const currentLastIdx = conversation.length - 1;
  if (currentLastIdx >= 0 && estimateMessagesTokens(hasSystem ? [systemMsg, ...conversation] : conversation) > maxTokens) {
    const lastMsg = conversation[currentLastIdx];
    const systemTokens = hasSystem ? estimateMessagesTokens([systemMsg]) : 0;
    const historyTokens = currentLastIdx > 0 ? estimateMessagesTokens(conversation.slice(0, currentLastIdx)) : 0;
    const allowedTokens = Math.max(3000, maxTokens - systemTokens - historyTokens);
    const maxChars = Math.floor(allowedTokens * 2.8);
    if (lastMsg.content.length > maxChars) {
      const notice = '\n\n[ملاحظة المنظومة: تم اقتطاع جزء من محتوى المرفق ليناسب نافذة سياق النموذج وضمان استقرار التوليد]';
      conversation[currentLastIdx] = { ...lastMsg, content: lastMsg.content.slice(0, Math.floor(maxChars * 0.9)) + notice };
    }
  }

  return hasSystem ? [systemMsg, ...conversation] : conversation;
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

  // What an R1-class user receives is the same four layers, delivered in the
  // user turn with the reasoning overlay appended. Returning it here is the
  // only way an administrator can read that form before relying on it —
  // otherwise half the platform's traffic runs on a prompt nobody can see.
  const reasoningPrompt = `${prompt}${SEPARATOR}${REASONING_MODEL_OVERLAY}`;

  return {
    category: { id: category.id, name: category.name },
    prompt,
    layers,
    deliveries: {
      system_message: { prompt, appliesTo: 'النماذج العامة (Qwen وما شابهها)' },
      user_prefixed: {
        prompt: reasoningPrompt,
        appliesTo: 'نماذج الاستدلال (DeepSeek-R1 وQwQ) — تُسبق بها رسالة المستخدم بلا رسالة نظام'
      }
    }
  };
}

module.exports = {
  compose,
  applyTo,
  isCharterCopy,
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
