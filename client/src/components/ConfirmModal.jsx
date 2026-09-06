import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Trash2, Info, AlertCircle, X, ShieldAlert } from 'lucide-react';
import EagleEmblem from '../assets/EagleEmblem';

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'تأكيد الإجراء',
  message = 'هل أنت متأكد من رغبتك في متابعة هذا الإجراء؟',
  itemName = '',
  description = '',
  confirmText = 'تأكيد',
  cancelText = 'إلغاء الأمر',
  variant = 'danger', // 'danger' | 'warning' | 'info'
  isAlert = false // if true, shows only a single dismiss/confirm button
}) {
  const confirmButtonRef = useRef(null);
  const cancelButtonRef = useRef(null);

  // Keyboard navigation & accessibility
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && !isAlert) {
        // Only trigger confirm if focus is not explicitly on cancel
        if (document.activeElement !== cancelButtonRef.current) {
          e.preventDefault();
          onConfirm();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Default focus to cancel for destructive operations for safety, or confirm for alerts
    const timer = setTimeout(() => {
      if (isAlert) {
        confirmButtonRef.current?.focus();
      } else if (variant === 'danger') {
        cancelButtonRef.current?.focus();
      } else {
        confirmButtonRef.current?.focus();
      }
    }, 50);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, onClose, onConfirm, isAlert, variant]);

  if (!isOpen) return null;

  // Icon & Theme Styling
  const variantConfig = {
    danger: {
      headerIcon: <Trash2 className="w-5 h-5 text-red-500" />,
      badgeBg: 'bg-red-50 border-red-200 text-[#D14343]',
      confirmButtonBg: 'bg-[#D14343] hover:bg-[#B02A2A] text-white shadow-xs focus:ring-2 focus:ring-red-500/40',
      badgeText: 'عملية حذف نهائية'
    },
    warning: {
      headerIcon: <AlertTriangle className="w-5 h-5 text-[#B79E6A]" />,
      badgeBg: 'bg-[#FFF9E6] border-[#E8D9A8] text-[#8A6A12]',
      confirmButtonBg: 'bg-[#B79E6A] hover:bg-[#9E8654] text-[#0A241C] font-bold shadow-xs focus:ring-2 focus:ring-[#B79E6A]/40',
      badgeText: 'تنبيه إداري'
    },
    info: {
      headerIcon: <Info className="w-5 h-5 text-[#428177]" />,
      badgeBg: 'bg-[#E8F3EE] border-[#BBD7CB] text-[#02443A]',
      confirmButtonBg: 'bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] font-bold shadow-xs focus:ring-2 focus:ring-[#02443A]/40',
      badgeText: 'إشعار المنظومة'
    }
  };

  const currentVariant = variantConfig[variant] || variantConfig.danger;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#0A241C]/80 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
      dir="rtl"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white border border-[#DDD8CA] rounded-2xl shadow-2xl overflow-hidden text-right flex flex-col animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        {/* Sovereign Header */}
        <div className="px-5 py-3.5 bg-[#0A241C] text-[#FBFAF6] flex items-center justify-between border-b border-[#1A4638]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#02443A] p-1 flex items-center justify-center border border-[#B79E6A]/40">
              <EagleEmblem className="w-5 h-4" fill="#E8D9A8" />
            </div>
            <div>
              <h3 id="dialog-title" className="font-bold text-sm text-[#E8D9A8]">
                {title}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1A4638] text-[#B79E6A] font-semibold border border-[#B79E6A]/20">
              {currentVariant.badgeText}
            </span>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-[#A6956D] hover:text-white hover:bg-[#1A4638] transition-colors cursor-pointer"
              title="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Dialog Body */}
        <div className="p-6 bg-[#FBFAF6] space-y-4">
          <div className="flex items-start gap-3.5">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${currentVariant.badgeBg}`}
            >
              {currentVariant.headerIcon}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[#14201C] leading-relaxed break-words">
                {message}
              </p>

              {description && (
                <p className="text-xs text-[#5E6B64] mt-1.5 leading-relaxed break-words whitespace-pre-line">
                  {description}
                </p>
              )}
            </div>
          </div>

          {/* Targeted Item Highlight Card */}
          {itemName && (
            <div className="p-3 bg-[#F0EDE4] border border-[#DDD8CA] rounded-xl">
              <span className="text-[11px] text-[#5E6B64] font-medium block mb-0.5">
                العنصر المستهدف:
              </span>
              <div className="text-sm font-bold text-[#02443A] truncate" title={itemName}>
                « {itemName} »
              </div>
            </div>
          )}

          {/* Danger Callout Warning */}
          {variant === 'danger' && !isAlert && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-red-50/80 border border-red-200 text-[#8A1B1B] text-xs font-semibold">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>تحذير: سيتم حذف البيانات وسجلها بالكامل دون إمكانية استرجاعها.</span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="px-5 py-3.5 bg-white border-t border-[#EDE7D8] flex items-center justify-end gap-2.5">
          {!isAlert && (
            <button
              ref={cancelButtonRef}
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[#DDD8CA] bg-white text-[#5E6B64] hover:bg-[#F0EDE4] hover:text-[#14201C] text-xs font-bold transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#B79E6A]/30"
            >
              {cancelText}
            </button>
          )}

          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className={`px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 focus:outline-none ${currentVariant.confirmButtonBg}`}
          >
            {variant === 'danger' && !isAlert && <Trash2 className="w-3.5 h-3.5" />}
            <span>{confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
