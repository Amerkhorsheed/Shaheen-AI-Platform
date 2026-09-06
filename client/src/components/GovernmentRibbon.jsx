import React from 'react';
import { ShieldCheck, ShieldAlert, Lock, FileText, ChevronDown } from 'lucide-react';
import EagleEmblem from '../assets/EagleEmblem';

export const CLASSIFICATIONS = {
  official: {
    id: 'official',
    label: 'رسمي وموثق',
    shortLabel: 'رسمي',
    color: 'text-[#2E6B4F]',
    bg: 'bg-[#E7F0EA]',
    border: 'border-[#2E6B4F]/30',
    dot: 'bg-[#2E6B4F]'
  },
  secret: {
    id: 'secret',
    label: 'سري وخاص',
    shortLabel: 'سري',
    color: 'text-[#8A6A12]',
    bg: 'bg-[#FCF7EA]',
    border: 'border-[#8A6A12]/30',
    dot: 'bg-[#8A6A12]'
  },
  top_secret: {
    id: 'top_secret',
    label: 'سري للغاية ومكتوم',
    shortLabel: 'سري للغاية',
    color: 'text-[#8A1B1B]',
    bg: 'bg-[#FDF2F2]',
    border: 'border-[#8A1B1B]/40',
    dot: 'bg-[#8A1B1B]'
  },
  unclassified: {
    id: 'unclassified',
    label: 'عام / غير مصنف',
    shortLabel: 'عام',
    color: 'text-[#5E6B64]',
    bg: 'bg-[#F0EDE4]',
    border: 'border-[#DDD8CA]',
    dot: 'bg-[#7A7A7B]'
  }
};

export default function GovernmentRibbon({
  classification = 'official',
  onChangeClassification,
  isConnected
}) {
  const current = CLASSIFICATIONS[classification] || CLASSIFICATIONS.official;

  return (
    <div className="w-full bg-[#0A241C] text-[#FBFAF6] border-b border-[#1A4638] px-3 py-1.5 flex flex-wrap items-center justify-between text-xs select-none shadow-xs">
      {/* State Authority Name */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 font-bold text-[#E8D9A8] text-[11px] md:text-xs tracking-tight">
          <EagleEmblem className="w-4 h-3.5" fill="#B79E6A" />
          <span>الجمهورية العربية السورية</span>
          <span className="text-[#A6956D]">|</span>
          <span className="hidden sm:inline text-[#DDD8CA] font-normal">منظومة OSS للذكاء الاصطناعي</span>
        </div>
      </div>

      {/* Security Classification Selector & Sovereign Isolation Pill */}
      <div className="flex items-center gap-2">
        {/* Classification Selector */}
        <div className="relative flex items-center gap-1.5">
          <span className="text-[10px] text-[#A6956D] hidden md:inline">التصنيف الأمني:</span>
          <div className="relative inline-block">
            <select
              value={classification}
              onChange={(e) => onChangeClassification && onChangeClassification(e.target.value)}
              className={`appearance-none text-[11px] font-bold px-2.5 py-0.5 pr-6 rounded border ${current.bg} ${current.color} ${current.border} cursor-pointer focus:outline-none shadow-2xs`}
            >
              <option value="official">🟢 رسمي وموثق</option>
              <option value="secret">🟠 سري وخاص</option>
              <option value="top_secret">🔴 سري للغاية ومكتوم</option>
              <option value="unclassified">⚪ غير مصنف</option>
            </select>
            <ChevronDown className="w-3 h-3 absolute left-1.5 top-1.5 pointer-events-none opacity-60" />
          </div>
        </div>

        {/* Offline Air-Gap Security Badge */}
        <div className="hidden lg:flex items-center gap-1 px-2 py-0.5 rounded bg-[#103228] border border-[#1A4638] text-[10px] text-[#A6956D]">
          <ShieldCheck className="w-3 h-3 text-[#2E6B4F]" />
          <span>بيئة معزولة 100% عن الإنترنت</span>
        </div>
      </div>
    </div>
  );
}
