import React, { useState, useEffect } from 'react';
import { 
  X, 
  FileText, 
  Send, 
  Scale, 
  FileSpreadsheet, 
  CheckSquare, 
  Sparkles, 
  BookOpen, 
  Building2, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Check, 
  ShieldCheck,
  FolderPlus
} from 'lucide-react';
import EagleEmblem from '../assets/EagleEmblem';
import { templatesService } from '../services/templates.service.js';
import { useDialog } from '../context/DialogContext.jsx';

const ICON_MAP = {
  FileText,
  Send,
  Scale,
  FileSpreadsheet,
  CheckSquare,
  Sparkles,
  BookOpen,
  Building2
};

const DEFAULT_CATEGORIES = [
  'المراسلات الإدارية',
  'التعاميم والتعليمات',
  'القرارات والمذكرات',
  'التدقيق والامتثال',
  'البيانات المالية والإحصائية',
  'الدراسات والتقارير'
];

export default function GovernmentTemplatesModal({ isOpen, onClose, onSelectTemplate, currentUser }) {
  const [templates, setTemplates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('الكل');

  // Form Mode: null (browsing) | 'create' | 'edit'
  const [formMode, setFormMode] = useState(null);
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    category: 'المراسلات الإدارية',
    customCategory: '',
    desc: '',
    prompt: '',
    icon: 'FileText'
  });
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const dialog = useDialog();

  // Load templates on modal open
  useEffect(() => {
    if (isOpen) {
      loadTemplates();
      setFormMode(null);
      setSearchQuery('');
      setSelectedCategory('الكل');
    }
  }, [isOpen]);

  const loadTemplates = async () => {
    setIsLoading(true);
    try {
      const data = await templatesService.getTemplates();
      setTemplates(data || []);
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  // Extract unique categories
  const allCategories = ['الكل', ...new Set([
    ...DEFAULT_CATEGORIES,
    ...templates.map(t => t.category).filter(Boolean)
  ])];

  // Filter templates
  const filteredTemplates = templates.filter(tmpl => {
    const matchCategory = selectedCategory === 'الكل' || tmpl.category === selectedCategory;
    const q = searchQuery.toLowerCase().trim();
    const matchSearch = !q || 
      tmpl.title.toLowerCase().includes(q) || 
      (tmpl.desc && tmpl.desc.toLowerCase().includes(q)) ||
      (tmpl.category && tmpl.category.toLowerCase().includes(q)) ||
      (tmpl.prompt && tmpl.prompt.toLowerCase().includes(q));
    return matchCategory && matchSearch;
  });

  const handleOpenCreateForm = () => {
    setFormData({
      title: '',
      category: 'المراسلات الإدارية',
      customCategory: '',
      desc: '',
      prompt: `المطلوب إعداد [نوع الوثيقة]:\n**الموضوع:** [أدخل الموضوع باختصار]\n**المعطيات:**\n1. [المعطى الأول]\n2. [المعطى الثاني]\nيرجى اعتماد الصياغة الرسمية المعتمدة وفق الأصول الإدارية.`,
      icon: 'FileText'
    });
    setFormMode('create');
    setEditingTemplateId(null);
    setErrorMessage('');
  };

  const handleOpenEditForm = (tmpl, e) => {
    e.stopPropagation();
    setFormData({
      title: tmpl.title,
      category: DEFAULT_CATEGORIES.includes(tmpl.category) ? tmpl.category : 'أخرى',
      customCategory: DEFAULT_CATEGORIES.includes(tmpl.category) ? '' : tmpl.category,
      desc: tmpl.desc || '',
      prompt: tmpl.prompt,
      icon: tmpl.icon || 'FileText'
    });
    setFormMode('edit');
    setEditingTemplateId(tmpl.id);
    setErrorMessage('');
  };

  const handleSaveForm = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!formData.title.trim()) {
      setErrorMessage('يرجى كتابة عنوان النموذج');
      return;
    }
    if (!formData.prompt.trim()) {
      setErrorMessage('يرجى كتابة نص وهيكل النموذج الإجرائي');
      return;
    }

    const finalCategory = formData.category === 'أخرى'
      ? (formData.customCategory.trim() || 'نماذج مخصصة')
      : formData.category;

    setIsSaving(true);
    try {
      const payload = {
        title: formData.title.trim(),
        category: finalCategory,
        desc: formData.desc.trim(),
        prompt: formData.prompt.trim(),
        icon: formData.icon
      };

      if (formMode === 'create') {
        const created = await templatesService.createTemplate(payload);
        setTemplates(prev => [created, ...prev]);
      } else if (formMode === 'edit') {
        const updated = await templatesService.updateTemplate(editingTemplateId, payload);
        setTemplates(prev => prev.map(t => t.id === editingTemplateId ? updated : t));
      }

      setFormMode(null);
    } catch (err) {
      setErrorMessage(err.message || 'فشل حفظ النموذج');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTemplate = async (tmpl, e) => {
    e.stopPropagation();
    const confirmed = await dialog.confirm({
      title: 'حذف النموذج الإداري',
      message: 'هل أنت متأكد من رغبتك في حذف هذا النموذج الإداري نهائياً؟',
      itemName: tmpl.title,
      description: 'لن يكون هذا النموذج متاحاً للاستخدام بعد حذفه.',
      confirmText: 'حذف النموذج',
      cancelText: 'إلغاء الأمر',
      variant: 'danger'
    });
    if (!confirmed) {
      return;
    }

    try {
      await templatesService.deleteTemplate(tmpl.id);
      setTemplates(prev => prev.filter(t => t.id !== tmpl.id));
    } catch (err) {
      await dialog.alert({
        title: 'خطأ أثناء الحذف',
        message: err.message || 'فشل حذف النموذج الإداري.',
        variant: 'danger'
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-4xl bg-white border border-[#DDD8CA] rounded-2xl shadow-2xl overflow-hidden text-right flex flex-col max-h-[92vh]">
        {/* State Sovereign Top Banner */}
        <div className="px-6 py-4 bg-[#0A241C] text-[#FBFAF6] flex items-center justify-between border-b border-[#1A4638]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#02443A] to-[#002723] p-1.5 flex items-center justify-center border border-[#B79E6A]/50 shadow-inner">
              <EagleEmblem className="w-7 h-5" fill="#B79E6A" />
            </div>
            <div>
              <h3 className="font-bold text-sm md:text-base text-[#E8D9A8] flex items-center gap-2">
                <span>مستودع القوالب والمراسلات الحكومية المعتمدة</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1A4638] text-[#B79E6A] font-semibold border border-[#B79E6A]/30">
                  ديناميكي وتفاعلي
                </span>
              </h3>
              <p className="text-[11px] text-[#A6956D]">
                نماذج صياغة إدارية معتمدة قابلة للتطبيق الفوري، التعديل، وإنشاء نماذج مؤسسية جديدة
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!formMode && (
              <button
                onClick={handleOpenCreateForm}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#02443A] hover:bg-[#1A4638] text-[#E8D9A8] text-xs font-bold transition-all border border-[#B79E6A]/40 shadow-xs"
              >
                <Plus className="w-3.5 h-3.5 text-[#B79E6A]" />
                <span>إضافة نموذج جديد</span>
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-[#A6956D] hover:text-white rounded-lg hover:bg-[#1A4638] transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* --- FORM MODE: CREATE OR EDIT TEMPLATE --- */}
        {formMode ? (
          <form onSubmit={handleSaveForm} className="p-6 overflow-y-auto flex-1 bg-[#FBFAF6] space-y-4 text-xs md:text-sm">
            <div className="flex items-center justify-between pb-3 border-b border-[#EDE7D8]">
              <div className="flex items-center gap-2 font-bold text-[#02443A] text-base">
                <FolderPlus className="w-5 h-5 text-[#B79E6A]" />
                <span>{formMode === 'create' ? 'إنشاء نموذج مراسلة إدارية جديد' : 'تعديل النموذج الإداري'}</span>
              </div>
              <button
                type="button"
                onClick={() => setFormMode(null)}
                className="text-xs text-[#5E6B64] hover:text-[#02443A] underline font-semibold"
              >
                العودة إلى قائمة النماذج
              </button>
            </div>

            {errorMessage && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {errorMessage}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-bold text-[#02443A] mb-1.5">
                  عنوان النموذج <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="مثال: مذكرة استيضاح إداري رسمي"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full p-2.5 rounded-lg border border-[#DDD8CA] bg-white text-xs focus:border-[#B79E6A] focus:outline-none"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-bold text-[#02443A] mb-1.5">
                  المجال والتصنيف الإداري <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full p-2.5 rounded-lg border border-[#DDD8CA] bg-white text-xs focus:border-[#B79E6A] focus:outline-none"
                >
                  {DEFAULT_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                  <option value="أخرى">تصنيف آخر (مخصص)...</option>
                </select>
                {formData.category === 'أخرى' && (
                  <input
                    type="text"
                    placeholder="اكتب اسم التصنيف الجديد..."
                    value={formData.customCategory}
                    onChange={(e) => setFormData({ ...formData, customCategory: e.target.value })}
                    className="w-full mt-2 p-2 rounded-lg border border-[#B79E6A] bg-white text-xs focus:outline-none"
                  />
                )}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-bold text-[#02443A] mb-1.5">
                الوصف المؤسسي المختصر
              </label>
              <input
                type="text"
                placeholder="توضيح موجز للغرض من هذا النموذج واستخدامه في المعاملات الرسمية..."
                value={formData.desc}
                onChange={(e) => setFormData({ ...formData, desc: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-[#DDD8CA] bg-white text-xs focus:border-[#B79E6A] focus:outline-none"
              />
            </div>

            {/* Icon Picker */}
            <div>
              <label className="block text-xs font-bold text-[#02443A] mb-1.5">
                أيقونة النموذج
              </label>
              <div className="flex flex-wrap gap-2">
                {Object.keys(ICON_MAP).map(iconName => {
                  const IconComp = ICON_MAP[iconName];
                  const isSelected = formData.icon === iconName;
                  return (
                    <button
                      key={iconName}
                      type="button"
                      onClick={() => setFormData({ ...formData, icon: iconName })}
                      className={`p-2 rounded-lg border flex items-center gap-1.5 text-xs transition-colors ${
                        isSelected 
                          ? 'bg-[#02443A] text-[#E8D9A8] border-[#02443A] font-bold shadow-xs' 
                          : 'bg-white text-[#5E6B64] border-[#DDD8CA] hover:bg-[#F0EDE4]'
                      }`}
                    >
                      <IconComp className="w-4 h-4" />
                      <span>{iconName}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Prompt Structure */}
            <div>
              <label className="block text-xs font-bold text-[#02443A] mb-1.5">
                نص وهيكل النموذج الإجرائي <span className="text-rose-500">*</span>
              </label>
              <p className="text-[11px] text-[#5E6B64] mb-2 leading-relaxed">
                اكتب التعليمات والبنود التي سيتم إدراجها تلقائياً في شريط المحادثة عند اختيار هذا النموذج. يمكنك استخدام أقواس مثل [اسم الجهة] لتحديد الخانات المطلوبة.
              </p>
              <textarea
                required
                rows={7}
                dir="rtl"
                value={formData.prompt}
                onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                placeholder="المطلوب صياغة مسودة كتاب رسمي..."
                className="w-full p-3 rounded-lg border border-[#DDD8CA] bg-white font-mono text-xs leading-relaxed focus:border-[#B79E6A] focus:outline-none shadow-inner"
              />
            </div>

            {/* Actions */}
            <div className="pt-3 border-t border-[#EDE7D8] flex items-center justify-between">
              <button
                type="button"
                onClick={() => setFormMode(null)}
                className="px-4 py-2 rounded-lg bg-[#EDE7D8] hover:bg-[#DDD8CA] text-[#02443A] font-semibold transition-colors"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-2 rounded-lg bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] font-bold transition-all shadow-md disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>{isSaving ? 'جارٍ الحفظ...' : (formMode === 'create' ? 'اعتماد وحفظ النموذج' : 'تحديث النموذج')}</span>
              </button>
            </div>
          </form>
        ) : (
          /* --- BROWSE MODE: SEARCH, CATEGORIES, TEMPLATES GRID --- */
          <>
            {/* Toolbar: Search and Category Pills */}
            <div className="p-4 bg-[#FBFAF6] border-b border-[#EDE7D8] space-y-3">
              {/* Search Box */}
              <div className="relative">
                <Search className="w-4 h-4 absolute right-3.5 top-3 text-[#7A7A7B]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="بحث في مستودع النماذج الإدارية والقانونية والمالية..."
                  className="w-full pr-10 pl-4 py-2 bg-white border border-[#DDD8CA] focus:border-[#B79E6A] rounded-xl text-xs md:text-sm placeholder-[#7A7A7B] focus:outline-none shadow-2xs"
                />
              </div>

              {/* Category Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                {allCategories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-all ${
                      selectedCategory === cat
                        ? 'bg-[#02443A] text-[#E8D9A8] font-bold shadow-xs'
                        : 'bg-[#F0EDE4] hover:bg-[#EBE6D9] text-[#02443A]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Templates Grid */}
            <div className="p-6 overflow-y-auto flex-1 bg-[#F7F5EF]/60">
              {isLoading ? (
                <div className="py-16 text-center text-xs text-[#5E6B64]">
                  جارٍ تحميل مستودع النماذج الحكومية...
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="py-16 text-center text-xs text-[#5E6B64] space-y-3">
                  <p>لم يتم العثور على نماذج مطابقة لبحثك في هذا التصنيف.</p>
                  <button
                    onClick={handleOpenCreateForm}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#02443A] text-[#E8D9A8] font-bold text-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>إنشاء هذا النموذج الآن</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredTemplates.map((tmpl) => {
                    const IconComp = ICON_MAP[tmpl.icon] || FileText;
                    const isSystem = Boolean(tmpl.is_system);
                    const canEdit = !isSystem || currentUser?.role === 'admin' || currentUser?.role === 'superadmin';

                    return (
                      <div
                        key={tmpl.id}
                        onClick={() => {
                          onSelectTemplate(tmpl.prompt);
                          onClose();
                        }}
                        className="group p-4 rounded-xl bg-white border border-[#E4E0D6] hover:border-[#B79E6A] shadow-2xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between relative"
                      >
                        <div>
                          {/* Top Row: Category + Badges + Icon + Edit/Delete */}
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EBE6D9] text-[#02443A]">
                                {tmpl.category}
                              </span>
                              {isSystem ? (
                                <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-[#E7F0EA] text-[#2E6B4F] border border-[#2E6B4F]/20">
                                  سيادي معتمد
                                </span>
                              ) : (
                                <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-[#FCF7EA] text-[#8A6A12] border border-[#B79E6A]/30">
                                  مخصص
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1">
                              {canEdit && (
                                <button
                                  onClick={(e) => handleOpenEditForm(tmpl, e)}
                                  className="p-1 rounded text-[#7A7A7B] hover:text-[#02443A] hover:bg-[#F0EDE4] transition-colors"
                                  title="تعديل هذا النموذج"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {!isSystem && (
                                <button
                                  onClick={(e) => handleDeleteTemplate(tmpl, e)}
                                  className="p-1 rounded text-[#7A7A7B] hover:text-[#D14343] hover:bg-[#FCE8E8] transition-colors"
                                  title="حذف هذا النموذج"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <div className="p-1.5 rounded-lg bg-[#F0EDE4] group-hover:bg-[#02443A] transition-colors ml-1">
                                <IconComp className="w-4 h-4 text-[#B79E6A] group-hover:text-[#E8D9A8]" />
                              </div>
                            </div>
                          </div>

                          {/* Title */}
                          <h4 className="font-bold text-sm text-[#02443A] group-hover:text-[#002723] mb-1.5">
                            {tmpl.title}
                          </h4>

                          {/* Description */}
                          <p className="text-xs text-[#5E6B64] leading-relaxed mb-3 line-clamp-2">
                            {tmpl.desc || tmpl.prompt?.slice(0, 100) + '...'}
                          </p>
                        </div>

                        {/* Bottom CTA */}
                        <div className="pt-2.5 border-t border-[#EDE7D8] flex items-center justify-between text-xs text-[#02443A] font-bold group-hover:text-[#B79E6A] transition-colors">
                          <span>تطبيق هذا النموذج في المحادثة</span>
                          <span className="text-sm">←</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 bg-[#FBFAF6] border-t border-[#DDD8CA] flex flex-wrap items-center justify-between text-xs text-[#5E6B64] gap-2">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#2E6B4F]" />
                <span>إجمالي النماذج المتاحة: <strong>{templates.length} نموذج</strong> — قابلة للإضافة والتعديل المؤسسي الدائم.</span>
              </div>
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg bg-[#F0EDE4] hover:bg-[#EBE6D9] text-[#02443A] font-semibold transition-colors"
              >
                إغلاق
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

