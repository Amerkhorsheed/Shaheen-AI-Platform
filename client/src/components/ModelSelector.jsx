import React, { useState } from 'react';
import { ChevronDown, Sliders, RefreshCw, Cpu, Check, AlertCircle } from 'lucide-react';

export default function ModelSelector({
  models = [],
  selectedModel,
  onSelectModel,
  isConnected,
  onRefreshModels,
  temperature,
  onChangeTemperature,
  maxTokens,
  onChangeMaxTokens
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isParamsOpen, setIsParamsOpen] = useState(false);

  return (
    <div className="relative flex items-center gap-2">
      {/* Model Dropdown Trigger */}
      <div className="relative">
        <button
          onClick={() => {
            setIsOpen(!isOpen);
            setIsParamsOpen(false);
          }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#FBFAF6] hover:bg-[#F0EDE4] border border-[#DDD8CA] text-xs md:text-sm font-semibold text-[#02443A] transition-all shadow-2xs"
        >
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#2E6B4F]' : 'bg-[#8A6A12]'}`} />
          <Cpu className="w-4 h-4 text-[#B79E6A]" />
          <span className="truncate max-w-[150px] md:max-w-[240px]">
            {selectedModel || (models.length > 0 ? models[0].id : 'جاري فحص النماذج...')}
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-[#5E6B64] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Models Dropdown Menu */}
        {isOpen && (
          <div className="absolute top-full right-0 mt-1.5 w-72 md:w-80 bg-white border border-[#DDD8CA] rounded-xl shadow-xl z-50 p-2 text-right">
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#EBE6D9] mb-1">
              <span className="text-xs font-bold text-[#02443A]">نماذج LM Studio المتاحة</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRefreshModels();
                }}
                className="p-1 hover:bg-[#F0EDE4] rounded text-[#5E6B64] hover:text-[#02443A] transition-colors"
                title="تحديث قائمة النماذج"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1">
              {models.map((m) => {
                const isCurrent = m.id === selectedModel;
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      onSelectModel(m.id);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors text-right ${
                      isCurrent
                        ? 'bg-[#E7F0EA] text-[#02443A] font-bold'
                        : 'hover:bg-[#FBFAF6] text-[#14201C]'
                    }`}
                  >
                    <div className="truncate flex-1 min-w-0 pr-1">
                      <div className="truncate font-medium">{m.id}</div>
                      <div className="text-[10px] text-[#5E6B64]">نموذج محلي جاهز</div>
                    </div>
                    {isCurrent && <Check className="w-4 h-4 text-[#2E6B4F] flex-shrink-0 mr-2" />}
                  </button>
                );
              })}

              {models.length === 0 && (
                <div className="p-3 text-center text-xs text-[#8A6A12] bg-[#FCF7EA] rounded-lg">
                  <AlertCircle className="w-4 h-4 mx-auto mb-1 text-[#8A6A12]" />
                  <span>لم يتم العثور على نماذج محملة في LM Studio. يرجى تشغيل النموذج من تطبيق LM Studio.</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Model Generation Parameters Popover Button */}
      <div className="relative">
        <button
          onClick={() => {
            setIsParamsOpen(!isParamsOpen);
            setIsOpen(false);
          }}
          className="p-2 rounded-lg bg-[#FBFAF6] hover:bg-[#F0EDE4] border border-[#DDD8CA] text-[#5E6B64] hover:text-[#02443A] transition-colors shadow-2xs"
          title="معلمات النموذج (الحرارة، طول الإجابة)"
        >
          <Sliders className="w-4 h-4" />
        </button>

        {isParamsOpen && (
          <div className="absolute top-full left-0 md:right-0 md:left-auto mt-2 w-80 md:w-96 bg-white border border-[#DDD8CA] rounded-2xl shadow-2xl z-50 p-4 text-right">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#EBE6D9]">
              <h4 className="text-xs font-bold text-[#02443A] flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[#B79E6A]" />
                <span>نمط الصياغة ومستوى التفصيل للمخرجات</span>
              </h4>
              <button 
                onClick={() => setIsParamsOpen(false)}
                className="text-[11px] text-[#7A7A7B] hover:text-[#02443A] font-semibold"
              >
                تم
              </button>
            </div>

            {/* 1. Drafting Style (Style & Rigor) */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-[#02443A] mb-1.5">
                أسلوب الصياغة الإدارية:
              </label>
              <div className="space-y-1.5">
                {[
                  {
                    value: 0.2,
                    label: 'قانوني وصارم',
                    desc: 'التزام حرفي بالوقائع والأنظمة دون اجتهاد — مناسب للعقود والقرارات والمراسيم',
                    icon: '⚖️'
                  },
                  {
                    value: 0.5,
                    label: 'متوازن ومؤسسي (الافتراضي)',
                    desc: 'صياغة إدارية رصينة تجمع بين الدقة والمرونة — مناسب للكتب والمذكرات الرسمية',
                    icon: '🏛️'
                  },
                  {
                    value: 0.8,
                    label: 'تحليلي وتطويري',
                    desc: 'توليد خيارات ورؤى وتوصيات إبداعية متعددة — مناسب للدراسات والاستراتيجيات',
                    icon: '💡'
                  }
                ].map((opt) => {
                  const isSelected = Math.abs(temperature - opt.value) < 0.16;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onChangeTemperature(opt.value)}
                      className={`w-full text-right p-2.5 rounded-xl border text-xs transition-all ${
                        isSelected
                          ? 'bg-[#E7F0EA] border-[#2E6B4F] text-[#02443A] font-bold shadow-2xs'
                          : 'bg-[#FBFAF6] hover:bg-[#F0EDE4] border-[#E4E0D6] text-[#5E6B64]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="flex items-center gap-1.5 text-xs text-[#02443A]">
                          <span>{opt.icon}</span>
                          <span>{opt.label}</span>
                        </span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-[#2E6B4F]" />}
                      </div>
                      <p className="text-[11px] text-[#5E6B64] font-normal leading-relaxed">
                        {opt.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Output Detail & Depth */}
            <div className="mb-3">
              <label className="block text-xs font-bold text-[#02443A] mb-1.5">
                حجم المخرجات ومستوى الشرح:
              </label>
              <div className="grid grid-cols-1 gap-1.5">
                {[
                  {
                    tokens: 1500,
                    label: 'موجز تنفيذي سريع',
                    desc: 'إجابات مركزة ومباشرة في نقاط محددة موجزة (~صفحة واحدة)'
                  },
                  {
                    tokens: 4096,
                    label: 'تقرير متكامل ومفصل (الافتراضي)',
                    desc: 'تغطية شاملة للموضوع مع شروحات وجداول معتمدة (~3 صفحات)'
                  },
                  {
                    tokens: 8192,
                    label: 'دراسة موسعة وشاملة',
                    desc: 'تحليل مستفيض لكافة المحاور والتوصيات دون أي اختصار (~6 صفحات)'
                  }
                ].map((len) => {
                  const isSelected = maxTokens === len.tokens || (len.tokens === 4096 && maxTokens !== 1500 && maxTokens !== 8192);
                  return (
                    <button
                      key={len.tokens}
                      type="button"
                      onClick={() => onChangeMaxTokens(len.tokens)}
                      className={`w-full text-right px-3 py-2 rounded-xl border text-xs transition-all ${
                        isSelected
                          ? 'bg-[#E7F0EA] border-[#2E6B4F] text-[#02443A] font-bold shadow-2xs'
                          : 'bg-[#FBFAF6] hover:bg-[#F0EDE4] border-[#E4E0D6] text-[#5E6B64]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[#02443A]">{len.label}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-[#2E6B4F]" />}
                      </div>
                      <div className="text-[10.5px] text-[#5E6B64] font-normal">
                        {len.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Subtle summary bar */}
            <div className="pt-2 border-t border-[#EDE7D8] flex items-center justify-between text-[11px] text-[#7A7A7B]">
              <span>الضبط الحالي:</span>
              <span className="font-semibold text-[#02443A]">
                {temperature <= 0.3 ? 'قانوني وصارم' : temperature >= 0.7 ? 'تحليلي وتطويري' : 'متوازن ومؤسسي'} • {maxTokens <= 2000 ? 'موجز' : maxTokens >= 6000 ? 'موسع' : 'مفصل'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
