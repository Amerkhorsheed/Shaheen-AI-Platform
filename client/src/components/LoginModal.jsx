import React, { useState } from 'react';
import { Lock, User, ShieldCheck, ArrowLeft, AlertCircle, Loader2 } from 'lucide-react';
import EagleEmblem from '../assets/EagleEmblem';
import { api } from '../services/api';

export default function LoginModal({ onLoginSuccess }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await api.login(username, password);
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.message || 'فشل تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A241C]/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white border border-[#DDD8CA] rounded-2xl shadow-2xl overflow-hidden text-right">
        {/* Top Decorative Header */}
        <div className="bg-gradient-to-r from-[#02443A] via-[#103228] to-[#002723] p-6 text-center text-white relative">
          <div className="flex justify-center mb-3">
            <div className="w-20 h-20 rounded-2xl bg-[#0A241C] p-3 flex items-center justify-center border border-[#B79E6A]/60 shadow-lg">
              <EagleEmblem className="w-14 h-11" fill="#B79E6A" />
            </div>
          </div>
          <h2 className="font-display text-xl font-bold tracking-tight text-[#E8D9A8] mb-1">
            منظومة OSS للذكاء الاصطناعي السيادي
          </h2>
          <p className="text-xs text-[#A6956D]">
            الجمهورية العربية السورية — بوابة الدخول إلى المنظومة السيادية
          </p>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-[#F7E4E4] border border-[#8A1B1B]/20 text-[#8A1B1B] text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[#02443A] mb-1.5">
              اسم المستخدم
            </label>
            <div className="relative">
              <User className="w-4 h-4 absolute right-3 top-3 text-[#5E6B64]" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full bg-[#FBFAF6] border border-[#DDD8CA] focus:border-[#B79E6A] rounded-xl pr-10 pl-3 py-2.5 text-sm text-[#14201C] focus:outline-none transition-colors"
                placeholder="أدخل اسم المستخدم"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#02443A] mb-1.5">
              كلمة المرور
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute right-3 top-3 text-[#5E6B64]" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-[#FBFAF6] border border-[#DDD8CA] focus:border-[#B79E6A] rounded-xl pr-10 pl-3 py-2.5 text-sm text-[#14201C] focus:outline-none transition-colors"
                placeholder="أدخل كلمة المرور"
              />
            </div>
          </div>

          {/* Quick Credential Hint */}
          <div className="p-2.5 bg-[#F0EDE4] rounded-lg text-[11px] text-[#5E6B64] flex items-center justify-between border border-[#DDD8CA]">
            <span>الحساب الافتراضي للمسؤول:</span>
            <span className="font-mono text-[#02443A] font-semibold">admin / admin123</span>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] font-bold text-sm transition-all shadow-md hover:shadow-lg disabled:opacity-50 mt-2"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span>تسجيل الدخول</span>
                <ArrowLeft className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Footer Note */}
        <div className="px-6 py-3 bg-[#FBFAF6] border-t border-[#DDD8CA] text-center text-[11px] text-[#7A7A7B] flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-[#2E6B4F]" />
          <span>تخزين البيانات والتحقق محلي بالكامل دون أي سحابة خارجية</span>
        </div>
      </div>
    </div>
  );
}
