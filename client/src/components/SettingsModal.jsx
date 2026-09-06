import React, { useState, useEffect } from 'react';
import { X, Settings, CheckCircle2, AlertCircle, RefreshCw, ShieldCheck, Database } from 'lucide-react';
import { api } from '../services/api';

export default function SettingsModal({ isOpen, onClose, isAdmin = false }) {
  const [lmStudioUrl, setLmStudioUrl] = useState('http://127.0.0.1:1234/v1');
  const [systemName, setSystemName] = useState('منظومة OSS للذكاء الاصطناعي السيادي');
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      const settings = await api.getSettings();
      if (settings.lm_studio_url) setLmStudioUrl(settings.lm_studio_url);
      if (settings.system_name) setSystemName(settings.system_name);
      if (settings.default_system_prompt) setDefaultSystemPrompt(settings.default_system_prompt);
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      const res = await api.getModels();
      if (res.connected) {
        setConnectionResult({
          success: true,
          msg: `تم الاتصال بنجاح! تم العثور على (${res.models.length}) من النماذج المحملة في LM Studio.`
        });
      } else {
        setConnectionResult({
          success: false,
          msg: res.error || 'تعذر الاتصال بـ LM Studio'
        });
      }
    } catch (err) {
      setConnectionResult({
        success: false,
        msg: 'فشل الفحص: ' + err.message
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!isAdmin) return;

    setSaving(true);
    setSaveMessage('');
    try {
      await api.updateSettings({
        lm_studio_url: lmStudioUrl.trim(),
        system_name: systemName.trim(),
        default_system_prompt: defaultSystemPrompt.trim()
      });
      setSaveMessage('تم حفظ الإعدادات بنجاح في قاعدة البيانات المحلية!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err) {
      setSaveMessage('خطأ في الحفظ: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl bg-white border border-[#DDD8CA] rounded-2xl shadow-2xl overflow-hidden text-right flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-[#0A241C] text-[#FBFAF6] flex items-center justify-between border-b border-[#1A4638]">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-[#B79E6A]" />
            <h3 className="font-bold text-base text-[#E8D9A8]">إعدادات النظام والربط المحلي</h3>
          </div>
          <button onClick={onClose} className="p-1 text-[#A6956D] hover:text-white rounded-md">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 overflow-y-auto flex-1 space-y-5">
          {saveMessage && (
            <div className="p-3 bg-[#E7F0EA] border border-[#2E6B4F]/30 text-[#2E6B4F] rounded-lg text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{saveMessage}</span>
            </div>
          )}

          {/* LM Studio Connection */}
          <div className="p-4 bg-[#FBFAF6] border border-[#DDD8CA] rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#02443A]">عنوان خادم LM Studio المحلي (API Endpoint):</label>
              <span className="text-[10px] px-2 py-0.5 rounded bg-[#EBE6D9] text-[#5E6B64] font-mono">OpenAI Compatible</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={lmStudioUrl}
                onChange={(e) => setLmStudioUrl(e.target.value)}
                disabled={!isAdmin}
                placeholder="http://127.0.0.1:1234/v1"
                className="flex-1 px-3 py-2 text-xs font-mono bg-white border border-[#DDD8CA] rounded-lg focus:outline-none focus:border-[#B79E6A] disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testingConnection}
                className="px-3 py-2 bg-[#F0EDE4] hover:bg-[#EBE6D9] text-[#02443A] border border-[#DDD8CA] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testingConnection ? 'animate-spin' : ''}`} />
                <span>فحص الاتصال</span>
              </button>
            </div>

            {connectionResult && (
              <div
                className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                  connectionResult.success
                    ? 'bg-[#E7F0EA] text-[#2E6B4F] border border-[#2E6B4F]/20'
                    : 'bg-[#F7E4E4] text-[#8A1B1B] border border-[#8A1B1B]/20'
                }`}
              >
                {connectionResult.success ? (
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                )}
                <span>{connectionResult.msg}</span>
              </div>
            )}
            <p className="text-[11px] text-[#7A7A7B]">
              يجب تشغيل تطبيق <strong>LM Studio</strong>، ثم التوجه لتبويب <strong>Local Server</strong> والضغط على <strong>Start Server</strong> ليعمل على هذا المنفذ.
            </p>
          </div>

          {/* System Name */}
          <div>
            <label className="block text-xs font-bold text-[#02443A] mb-1.5">اسم المنصة الرسمي:</label>
            <input
              type="text"
              value={systemName}
              onChange={(e) => setSystemName(e.target.value)}
              disabled={!isAdmin}
              className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none focus:border-[#B79E6A] disabled:opacity-60"
            />
          </div>

          {/* Default System Prompt */}
          <div>
            <label className="block text-xs font-bold text-[#02443A] mb-1.5">تعليمات النظام الافتراضية (System Prompt):</label>
            <textarea
              rows={4}
              value={defaultSystemPrompt}
              onChange={(e) => setDefaultSystemPrompt(e.target.value)}
              disabled={!isAdmin}
              className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none focus:border-[#B79E6A] leading-relaxed disabled:opacity-60"
            />
          </div>

          {/* Offline Security Guarantee Box */}
          <div className="p-3.5 bg-[#E7F0EA]/70 border border-[#2E6B4F]/20 rounded-xl text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-[#2E6B4F]">
              <ShieldCheck className="w-4 h-4" />
              <span>ميثاق الأمان والعزل التام</span>
            </div>
            <p className="text-[#5E6B64] text-[11px] leading-relaxed">
              هذه المنصة مصممة للعمل في بيئة مغلقة دون اتصال خارجي؛ لا يتم تسريب أي سجل محادثة أو استفسار أو ملف إلى أي سيرفر خارجي إطلاقاً، والاتصال محصور بـ LM Studio على الشبكة المحلية أو الجهاز نفسه.
            </p>
          </div>

          {/* Submit */}
          {isAdmin && (
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] font-bold rounded-xl text-xs transition-all shadow-sm hover:shadow-md disabled:opacity-50"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
