'use strict';

/**
 * Seed data for a fresh installation.
 *
 * Pure data, kept apart from the code that applies it, so the institutional
 * content can be reviewed or translated without touching database logic.
 *
 * Seeding is idempotent and never overwrites an existing row. The previous
 * implementation re-applied the system name and the default prompt on every
 * boot, silently discarding any change an administrator made through the
 * settings panel.
 */

const { SYSTEM_CHARTER, CATEGORY_DIRECTIVES } = require('./promptLibrary');

// The charter is the seeded value of the `default_system_prompt` setting.
// It lives in promptLibrary.js so the operating rules are written once.
const BASE_SYSTEM_PROMPT = SYSTEM_CHARTER;

const DEFAULT_CATEGORIES = [
  {
    id: 'cat_exec',
    name: 'القيادة والإدارة العليا',
    code: 'EXEC',
    clearance_level: 'top_secret',
    icon: 'ShieldAlert',
    color: '#B79E6A',
    description: 'اتخاذ القرارات الاستراتيجية والسيادية، الإشراف العام، واعتماد السياسات والمراسيم العليا.',
    prompt_context: 'أنت تقدم المشورة للقيادة والإدارة العليا. اعتمد الأسلوب التنفيذي الموجز والحاسم، مع إبراز المؤشرات الاستراتيجية والمخاطر والتوصيات المباشرة لدعم القرار السليم.'
  },
  {
    id: 'cat_strategy',
    name: 'التحليل والدراسات الاستراتيجية',
    code: 'STRAT',
    clearance_level: 'secret',
    icon: 'TrendingUp',
    color: '#02443A',
    description: 'إعداد البحوث والدراسات المقارنة، استشراف السيناريوهات، وتحليل الأبعاد المؤسسية.',
    prompt_context: 'أنت مستشار شعبة التحليل والدراسات الاستراتيجية. قدّم تحليلات معمقة وممنهجة مع مصفوفات مقارنة واستشراف للآفاق المستقبلية.'
  },
  {
    id: 'cat_legal',
    name: 'الشؤون القانونية والمراسلات الرسمية',
    code: 'LEGAL',
    clearance_level: 'official',
    icon: 'Scale',
    color: '#2E6B4F',
    description: 'صياغة وتدقيق مشاريع القرارات، المذكرات، الاتفاقيات، ومطابقة النصوص مع التشريعات السارية.',
    prompt_context: 'أنت المستشار القانوني للمنظومة. ركّز على الدقة التشريعية المطلقة، الصياغات القانونية المحكمة، والمصطلحات الإدارية الرسمية المعتمدة في الدولة.'
  },
  {
    id: 'cat_finance',
    name: 'المالية والموازنات العامة',
    code: 'FIN',
    clearance_level: 'secret',
    icon: 'DollarSign',
    color: '#8B6F3E',
    description: 'التخطيط المالي، دراسات الموازنات، مراجعة جداول النفقات، وتحليل المؤشرات المالية.',
    prompt_context: 'أنت خبير التحليل المالي والموازنات. احرص على تقديم جداول رقمية واضحة ونسب مئوية ومصفوفات قابلة للتصدير بصيغة CSV. لا تفترض أي رقم غير وارد في مُدخلات المستخدم.'
  },
  {
    id: 'cat_tech',
    name: 'التحول الرقمي وتكنولوجيا المعلومات',
    code: 'TECH',
    clearance_level: 'official',
    icon: 'Cpu',
    color: '#1E40AF',
    description: 'أتمتة العمليات الحكومية، البنية التحتية، الأمان والسيادة الرقمية، وهندسة البرمجيات.',
    prompt_context: 'أنت خبير التحول الرقمي وهندسة النظم. ركّز على الأمان السيبراني، معمارية الأنظمة، كفاءة الأداء، والسيادة الرقمية المحلية.'
  },
  {
    id: 'cat_audit',
    name: 'التدقيق الداخلي والرقابة والمتابعة',
    code: 'AUDIT',
    clearance_level: 'official',
    icon: 'ClipboardCheck',
    color: '#475569',
    description: 'متابعة الالتزام بالأنظمة، تدقيق الإجراءات والمعاملات، ومراقبة جودة الأداء المؤسسي.',
    prompt_context: 'أنت مدقق المنظومة الداخلي. تحرّ الدقة الصارمة، الشفافية، ومطابقة المعاملات للمعايير واللوائح التنظيمية.'
  },
  {
    id: 'cat_hr',
    name: 'الموارد البشرية والشؤون الإدارية',
    code: 'HR',
    clearance_level: 'official',
    icon: 'Users',
    color: '#6B21A8',
    description: 'تنظيم الهيكل الإداري، تدريب الكوادر، متابعة المهام الوظيفية والخدمات الإدارية.',
    prompt_context: 'أنت مستشار الموارد البشرية والشؤون الإدارية. ركّز على كفاءة الكوادر، التوصيف الوظيفي، وتطوير الآليات المؤسسية.'
  }
];

const DEFAULT_TEMPLATES = [
  {
    id: 'official-letter',
    title: 'صياغة كتاب رسمي إداري',
    category: 'المراسلات الإدارية',
    description: 'صياغة مراسلة رسمية موجهة لجهة حكومية وفق الأصول والأساليب الإدارية المعتمدة.',
    icon: 'FileText',
    prompt: `المطلوب صياغة مسودة **كتاب رسمي إداري** موجه إلى: [اسم الجهة أو الإدارة المعنية].
**موضوع الكتاب:** [أدخل الموضوع باختصار].
**المعطيات والأسباب الموجبة:**
- [أدخل النقطة الأولى].
- [أدخل النقطة الثانية].
يرجى اعتماد الصياغة القانونية والإدارية الرسمية، والاقتصار على المعطيات الواردة أعلاه دون إضافة أرقام أو مراجع غير مذكورة.`
  },
  {
    id: 'ministerial-circular',
    title: 'صياغة تعميم وزاري تنظيمي',
    category: 'التعاميم والتعليمات',
    description: 'صياغة تعميم موحد صادر عن الإدارة العامة يُعمم على كافة الجهات التابعة للالتزام بتعليمات معينة.',
    icon: 'Send',
    prompt: `المطلوب صياغة **تعميم وزاري تنفيذي** بشأن: [موضوع التعميم].
**الجهات الموجه إليها التعميم:** كافة الإدارات والمديريات العامة والجهات التابعة.
**الأهداف التنظيمية:**
1. [الهدف أو التوجيه الأول].
2. [الهدف أو التوجيه الثاني].
يرجى صياغة بنود التعميم بشكل مرقم وواضح. اترك تاريخ السريان ورقم التعميم فارغين لتعبئتهما من الجهة المختصة.`
  },
  {
    id: 'executive-memo',
    title: 'مذكرة عرض ومقترح قرار',
    category: 'القرارات والمذكرات',
    description: 'مذكرة إحالة رسمية تتضمن عرض الواقع والمبررات الفنية والمالية ومقترح القرار المطلوب اعتماده.',
    icon: 'Scale',
    prompt: `المطلوب إعداد **مذكرة عرض ومقترح قرار** للعرض على أصحاب القرار بخصوص: [الموضوع المقترح].
**عناصر المذكرة المطلوبة:**
1. عرض الواقع الحالي والتحديات القائمة.
2. المبررات والأسانيد الإدارية والفنية.
3. المقترح الإجرائي والتوصيات التنفيذية.
4. مشروع القرار المقترح لإصداره.
اقتصر على المعطيات التي أزودك بها، وصرّح بما ينقصك من بيانات بدل افتراضه.`
  },
  {
    id: 'contract-audit',
    title: 'تدقيق عقد أو اتفاقية قانونية',
    category: 'التدقيق والامتثال',
    description: 'مراجعة مسودة اتفاقية أو شروط مناقصة، واستخراج البنود الحرجة والشروط الجزائية وملاحظات الحوكمة.',
    icon: 'CheckSquare',
    prompt: `المطلوب إجراء **تدقيق ومراجعة للعقد/الاتفاقية المرفقة**:
1. رصد التزامات الطرفين والحقوق المتبادلة كما وردت حرفياً في النص.
2. تدقيق الشروط الجزائية، غرامات التأخير، وبنود الفسخ.
3. إبراز المخاطر القانونية والمالية وتقديم التوصيات.
اذكر رقم البند ونصه عند كل ملاحظة. إن لم يرد بند ما في المستند فصرّح بغيابه بدل استنتاجه.`
  },
  {
    id: 'budget-table-analysis',
    title: 'تحليل موازنة وجدول مؤشرات (CSV)',
    category: 'البيانات المالية والإحصائية',
    description: 'تحليل مصفوفة أرقام أو بيانات مالية واستخراج الجداول التفصيلية ونسب التنفيذ بصيغة جاهزة للتصدير.',
    icon: 'FileSpreadsheet',
    prompt: `المطلوب **تحليل البيانات المالية المرفقة** وإخراج النتائج في **جدول مقارن**:
- استخراج نسب التنفيذ الفعلية مقارنة بالمخطط، محسوبة من الأرقام المرفقة حصراً.
- إبراز بنود الوفر والانحراف.
- أعمدة الجدول: (المعرف، البند، المخصص، الفعلي، نسبة الإنجاز، الملاحظة).
اكتب «غير متوفر» في أي خانة لا يوجد لها رقم في المرفق، ولا تقدّر أي قيمة.`
  },
  {
    id: 'strategic-summary',
    title: 'تلخيص تقرير استراتيجي ومحضر اجتماع',
    category: 'الدراسات والتقارير',
    description: 'تلخيص الوثائق الطويلة واستخراج مصفوفة القرارات، التوصيات، وتوزيع المهام والمسؤوليات.',
    icon: 'BookOpen',
    prompt: `المطلوب تلخيص **التقرير / محضر الاجتماع المرفق** بأسلوب تنفيذي موجز:
1. ملخص تنفيذي للمحاور الرئيسية.
2. جدول التكليفات: (المهمة، الجهة أو المسؤول، الإطار الزمني).
3. أبرز التوصيات والقرارات الواجب متابعتها.
اقتصر على ما ورد في المحضر، ولا تضف مهاماً أو مسؤولين غير مذكورين فيه.`
  }
];

const DEFAULT_SETTINGS = [
  ['lm_studio_url', 'http://127.0.0.1:1234/v1'],
  ['system_name', 'منظومة OSS للذكاء الاصطناعي'],
  ['organization_name', 'الجمهورية العربية السورية — الهيئة الوطنية للتحول الرقمي'],
  ['default_system_prompt', BASE_SYSTEM_PROMPT],
  // Closed by default: accounts are created by an administrator.
  ['allow_user_registration', 'false'],
  ['enforce_audit_logging', 'true']
];

// Apply the library's specialist directives over the seed definitions, so a
// department's own guidance is written in exactly one place.
for (const category of DEFAULT_CATEGORIES) {
  if (CATEGORY_DIRECTIVES[category.id]) {
    category.prompt_context = CATEGORY_DIRECTIVES[category.id];
  }
}

module.exports = {
  BASE_SYSTEM_PROMPT,
  DEFAULT_CATEGORIES,
  DEFAULT_TEMPLATES,
  DEFAULT_SETTINGS
};
