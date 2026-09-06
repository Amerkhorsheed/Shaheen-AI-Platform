import React from 'react';
import { FileText, Send, Scale, FileSpreadsheet, ShieldCheck, ScrollText, AlertTriangle } from 'lucide-react';
import EagleEmblem from '../assets/EagleEmblem';

const GOVERNMENT_QUICK_ACTIONS = [
  {
    icon: FileText,
    title: 'صياغة كتاب رسمي إداري',
    category: 'مراسلات',
    prompt: 'المطلوب صياغة مسودة كتاب رسمي إداري موجه إلى جهة معنية بأسلوب رصين وفق المعايير المؤسسية للجمهورية العربية السورية.'
  },
  {
    icon: Send,
    title: 'صياغة تعميم وزاري تنفيذي',
    category: 'تعاميم',
    prompt: 'صغ تعميماً وزارياً تنظيمياً موجهاً لكافة الإدارات والمديريات التابعة للالتزام بالتعليمات المحددة.'
  },
  {
    icon: FileSpreadsheet,
    title: 'تحليل مصفوفة بيانات وجداول (CSV)',
    category: 'إحصاء ومؤشرات',
    prompt: 'حلل البيانات الإحصائية التالية واستخرج جدولاً بيانياً مفصلاً يوضح نسب الإنجاز وجاهزاً للتصدير الفوري بصيغة CSV.'
  },
  {
    icon: Scale,
    title: 'تدقيق عقد أو اتفاقية قانونية',
    category: 'حوكمة وتدقيق',
    prompt: 'قم بإجراء تدقيق قانوني وإداري للمستند المرفق ورصد التزامات الطرفين والشروط الجزائية وتقديم الملاحظات اللازمة.'
  }
];

export default function WelcomeScreen({
  onSelectSuggestion,
  isConnected,
  isCheckingConnection = false,
  currentModel,
  onOpenTemplates,
  connectionError = '',
  isSuperAdmin = false
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-4xl mx-auto my-auto select-none">
      {/* Golden Syrian Eagle Emblem with Institutional Halo */}
      <div className="relative mb-5 flex items-center justify-center">
        <div className="absolute w-40 h-40 rounded-full bg-[#B79E6A]/20 blur-3xl pointer-events-none"></div>
        <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-[#02443A] via-[#103228] to-[#002723] p-4 flex items-center justify-center shadow-xl border-2 border-[#B79E6A]/60">
          <EagleEmblem className="w-18 h-14" fill="#E8D9A8" />
        </div>
      </div>

      {/* State Entity & System Title */}
      <div className="inline-block px-3 py-1 rounded-full bg-[#EBE6D9] text-[#02443A] text-xs font-bold mb-3 border border-[#DDD8CA]">
        الجمهورية العربية السورية — رئاسة مجلس الوزراء
      </div>
      <h1 className="text-2xl md:text-3xl font-extrabold text-[#02443A] tracking-tight mb-2">
        منظومة OSS للذكاء الاصطناعي
      </h1>
      <p className="text-xs md:text-sm text-[#5E6B64] max-w-xl mb-6 leading-relaxed">
        البيئة الوطنية الآمنة للتحليل الذكي للمستندات والبيانات، وصياغة المراسلات والتقارير التنفيذية بأعلى معايير الدقة والموثوقية التامة.
      </p>

      {/* Model status. When checking, display a calm loading indicator.
          When the local model is unreachable, show the warning only after
          the check has completed — never flash an error during initialization. */}
      {isCheckingConnection ? (
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-[#DDD8CA] text-xs text-[#5E6B64] font-semibold mb-8 shadow-xs">
          <span className="w-2 h-2 rounded-full bg-[#B79E6A] animate-pulse"></span>
          <span>جاري التحقق من جاهزية المحرك المحلي...</span>
        </div>
      ) : isConnected ? (
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-[#DDD8CA] text-xs text-[#02443A] font-semibold mb-8 shadow-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
          {isSuperAdmin && (
            <>
              <span>النموذج المحلي المعتمد: {currentModel || '—'}</span>
              <span className="text-[#DDD8CA]">|</span>
            </>
          )}
          <div className="flex items-center gap-1 text-[#2E6B4F]">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>يعمل محلياً دون اتصال خارجي</span>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-xl mb-8 flex items-start gap-2.5 p-3.5 rounded-xl bg-[#FDF2F2] border border-[#F8B4B4] text-right">
          <AlertTriangle className="w-4 h-4 text-[#8A1B1B] shrink-0 mt-0.5" />
          <div className="text-[12.5px] text-[#8A1B1B] leading-relaxed">
            <div className="font-bold mb-0.5">
              {isSuperAdmin
                ? 'خادم النموذج المحلي غير متاح — لا يمكن توليد أي رد حالياً.'
                : 'خدمة الذكاء الاصطناعي غير متاحة حالياً.'}
            </div>
            <div className="text-[#9C4A4A]">
              {isSuperAdmin
                ? (connectionError || 'يرجى تشغيل Local Server من داخل LM Studio ثم تحديث حالة الاتصال.')
                : 'يرجى مراجعة مسؤول المنظومة لتشغيل محرك المعالجة.'}
            </div>
          </div>
        </div>
      )}

      {/* Quick Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-right mb-4">
        {GOVERNMENT_QUICK_ACTIONS.map((s, idx) => {
          const Icon = s.icon;
          return (
            <button
              key={idx}
              onClick={() => onSelectSuggestion(s.prompt)}
              className="group p-4 rounded-xl bg-white hover:bg-[#FBFAF6] border border-[#E4E0D6] hover:border-[#B79E6A] shadow-xs hover:shadow-md transition-all text-right flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#F0EDE4] text-[#02443A]">
                  {s.category}
                </span>
                <div className="p-1.5 rounded-md bg-[#F0EDE4] group-hover:bg-[#02443A] transition-colors">
                  <Icon className="w-4 h-4 text-[#B79E6A] group-hover:text-[#E8D9A8]" />
                </div>
              </div>
              <h3 className="text-xs font-bold text-[#02443A] group-hover:text-[#002723] mb-1">
                {s.title}
              </h3>
              <p className="text-[11px] text-[#5E6B64] line-clamp-2 leading-relaxed">
                {s.prompt}
              </p>
            </button>
          );
        })}
      </div>

      {/* View All Government Templates Button */}
      {onOpenTemplates && (
        <button
          onClick={onOpenTemplates}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#F0EDE4] hover:bg-[#EBE6D9] text-[#02443A] font-bold text-xs border border-[#DDD8CA] transition-colors"
        >
          <ScrollText className="w-4 h-4 text-[#B79E6A]" />
          <span>استعراض كافة النماذج والقوالب الحكومية المعتمدة</span>
        </button>
      )}
    </div>
  );
}
