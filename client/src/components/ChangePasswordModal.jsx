import React, { useState } from 'react';
import { KeyRound, Eye, EyeOff, ShieldAlert, LogOut, Loader2 } from 'lucide-react';
import EagleEmblem from '../assets/EagleEmblem';
import { authService } from '../services/auth.service.js';

const MIN_LENGTH = 10;

/**
 * Shown when the server reports that the account's password must be replaced
 * before the platform can be used — a first login on a newly provisioned
 * account, an administrative reset, or an account still carrying a previously
 * published default credential. It cannot be dismissed; the only way past it
 * is to set a new password or sign out.
 */
export default function ChangePasswordModal({ onChanged, onLogout }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const rules = [
    { ok: newPassword.length >= MIN_LENGTH, label: `${MIN_LENGTH} خانات على الأقل` },
    { ok: /[A-Za-z؀-ۿ]/.test(newPassword), label: 'حرف واحد على الأقل' },
    { ok: /[0-9]/.test(newPassword), label: 'رقم واحد على الأقل' },
    { ok: newPassword.length > 0 && newPassword !== currentPassword, label: 'مختلفة عن كلمة المرور الحالية' }
  ];
  const allRulesMet = rules.every((r) => r.ok);
  const matches = newPassword.length > 0 && newPassword === confirmPassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!allRulesMet) return setError('كلمة المرور الجديدة لا تحقق الشروط المطلوبة.');
    if (!matches) return setError('كلمتا المرور غير متطابقتين.');

    setIsSaving(true);
    try {
      const data = await authService.changePassword(currentPassword, newPassword);
      onChanged(data.user);
    } catch (err) {
      setError(err.message || 'تعذّر تغيير كلمة المرور.');
    } finally {
      setIsSaving(false);
    }
  };

  const fieldClass =
    'w-full px-3 py-2.5 rounded-lg border border-[#DDD8CA] bg-[#FBFAF6] text-sm text-[#14201C] ' +
    'focus:outline-none focus:border-[#B79E6A] focus:ring-2 focus:ring-[#B79E6A]/20 transition';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A241C]/80 backdrop-blur-sm p-4" dir="rtl">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#DDD8CA] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-[#02443A] to-[#0A241C] px-6 py-5 border-b-2 border-[#B79E6A] text-center">
          <div className="flex justify-center mb-2">
            <EagleEmblem className="w-10 h-8" fill="#E8D9A8" />
          </div>
          <h2 className="text-base font-bold text-[#E8D9A8]">تغيير كلمة المرور مطلوب</h2>
          <p className="text-[11px] text-[#CFC49E] mt-1">لا يمكن استخدام المنظومة قبل تعيين كلمة مرور جديدة</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[#FCF9EE] border border-[#E3D6A8] text-[11.5px] text-[#6B5A22] leading-relaxed">
            <ShieldAlert className="w-4 h-4 text-[#8A6A12] shrink-0 mt-0.5" />
            <span>
              كلمة المرور الحالية لهذا الحساب إمّا مؤقتة أو معروفة مسبقاً. اختر كلمة مرور جديدة
              لا تُستخدم في أي نظام آخر. سيتم إنهاء جميع الجلسات المفتوحة لهذا الحساب بعد التغيير.
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#02443A] mb-1.5">كلمة المرور الحالية</label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={fieldClass}
              autoComplete="current-password"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-[#02443A]">كلمة المرور الجديدة</label>
              <button
                type="button"
                onClick={() => setShowPasswords((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-[#5E6B64] hover:text-[#02443A] transition"
              >
                {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showPasswords ? 'إخفاء' : 'إظهار'}</span>
              </button>
            </div>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={fieldClass}
              autoComplete="new-password"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#02443A] mb-1.5">تأكيد كلمة المرور الجديدة</label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={fieldClass}
              autoComplete="new-password"
              required
            />
            {confirmPassword.length > 0 && !matches && (
              <p className="text-[11px] text-[#8A1B1B] mt-1">كلمتا المرور غير متطابقتين</p>
            )}
          </div>

          <ul className="grid grid-cols-2 gap-1.5 text-[11px]">
            {rules.map((rule) => (
              <li
                key={rule.label}
                className={`flex items-center gap-1.5 ${rule.ok ? 'text-[#2E6B4F]' : 'text-[#8A8578]'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${rule.ok ? 'bg-[#2E6B4F]' : 'bg-[#DDD8CA]'}`} />
                <span>{rule.label}</span>
              </li>
            ))}
          </ul>

          {error && (
            <div className="p-2.5 rounded-lg bg-[#FDF2F2] border border-[#F8B4B4] text-[12px] text-[#8A1B1B]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSaving || !allRulesMet || !matches}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#02443A] hover:bg-[#002723]
                       disabled:bg-[#9AA5A0] disabled:cursor-not-allowed text-[#E8D9A8] font-bold text-sm transition"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            <span>{isSaving ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور والمتابعة'}</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#F0EDE4]
                       hover:bg-[#EBE6D9] text-[#5E6B64] font-semibold text-xs transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>تسجيل الخروج</span>
          </button>
        </form>
      </div>
    </div>
  );
}
