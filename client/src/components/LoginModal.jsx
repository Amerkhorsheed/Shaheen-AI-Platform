import React, { useState, useEffect } from 'react';
import { Lock, User, ShieldCheck, ArrowLeft, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import EagleEmblem from '../assets/EagleEmblem';
import { authService } from '../services/auth.service.js';

export default function LoginModal({ onLoginSuccess, notice = '' }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberUser, setRememberUser] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('shaheen_remember_user');
    if (saved) {
      setUsername(saved);
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('يرجى إدخال اسم المستخدم وكلمة المرور للمتابعة');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const data = await authService.login(username.trim(), password);
      if (rememberUser) {
        localStorage.setItem('shaheen_remember_user', username.trim());
      } else {
        localStorage.removeItem('shaheen_remember_user');
      }
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.message || 'فشل تسجيل الدخول، يرجى التحقق من البيانات');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A241C]/85 backdrop-blur-md p-4">
      <div className="w-full max-w-md bg-white border border-[#DDD8CA] rounded-2xl shadow-2xl overflow-hidden text-right">
        {/* Sovereign Decorative Header */}
        <div className="bg-gradient-to-b from-[#02443A] via-[#103228] to-[#0A241C] p-6 text-center text-white relative border-b border-[#B79E6A]/30">
          <div className="flex justify-center mb-3">
            <div className="w-20 h-20 rounded-2xl bg-[#081B15] p-3 flex items-center justify-center border border-[#B79E6A]/70 shadow-xl shadow-black/20">
              <EagleEmblem className="w-14 h-11" fill="#B79E6A" />
            </div>
          </div>
          <h2 className="font-display text-xl font-bold tracking-tight text-[#E8D9A8] mb-1">
            منظومة OSS للذكاء الاصطناعي
          </h2>
          <p className="text-xs text-[#C5B78F]">
            الجمهورية العربية السورية — بوابة الولوج المؤسسي الموحدة
          </p>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-4">
          {!error && notice && (
            <div className="flex items-start gap-2 p-2.5 mb-3 rounded-lg bg-[#FCF9EE] border border-[#E3D6A8] text-[12px] text-[#6B5A22]">
              <span>{notice}</span>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-[#FDF2F2] border border-[#8A1B1B]/20 text-[#8A1B1B] text-xs flex items-center gap-2 animate-fadeIn">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[#02443A] mb-1.5">
              اسم المستخدم
            </label>
            <div className="relative">
              <User className="w-4 h-4 absolute right-3.5 top-3.5 text-[#5E6B64]" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                autoFocus={!username}
                className="w-full bg-[#FBFAF6] border border-[#DDD8CA] focus:border-[#B79E6A] focus:bg-white rounded-xl pr-10 pl-3 py-2.5 text-sm text-[#14201C] focus:outline-none transition-all placeholder:text-[#9AA5A0]"
                placeholder="أدخل اسم المستخدم المؤسسي"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#02443A] mb-1.5">
              كلمة المرور
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute right-3.5 top-3.5 text-[#5E6B64]" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="w-full bg-[#FBFAF6] border border-[#DDD8CA] focus:border-[#B79E6A] focus:bg-white rounded-xl pr-10 pl-10 py-2.5 text-sm text-[#14201C] focus:outline-none transition-all placeholder:text-[#9AA5A0]"
                placeholder="أدخل كلمة المرور"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                className="absolute left-3 top-3 text-[#5E6B64] hover:text-[#02443A] transition-colors"
                title={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Remember username option */}
          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-[#5E6B64] select-none">
              <input
                type="checkbox"
                checked={rememberUser}
                onChange={(e) => setRememberUser(e.target.checked)}
                className="rounded border-[#DDD8CA] text-[#02443A] focus:ring-[#B79E6A] accent-[#02443A] w-3.5 h-3.5"
              />
              <span>تذكر اسم المستخدم على هذا الجهاز</span>
            </label>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] font-bold text-sm transition-all shadow-md hover:shadow-lg disabled:opacity-50 mt-3 cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span>تسجيل الدخول إلى المنظومة</span>
                <ArrowLeft className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Security & Air-gap Badge */}
        <div className="px-6 py-3 bg-[#FBFAF6] border-t border-[#DDD8CA] text-center text-[11px] text-[#5E6B64] flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-[#2E6B4F]" />
          <span>منظومة ذكاء اصطناعي سيادية — معزولة محلياً وتخزين مشفر آمن</span>
        </div>
      </div>
    </div>
  );
}
