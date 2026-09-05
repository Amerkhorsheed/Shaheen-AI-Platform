import React, { useState, useEffect } from 'react';
import { X, UserPlus, Trash2, Shield, User, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../services/api';

export default function UsersModal({ isOpen, onClose, currentUserId }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // New user form state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: '', msg: '' });

  useEffect(() => {
    if (isOpen) {
      loadUsers();
    }
  }, [isOpen]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const list = await api.getUsers();
      setUsers(list);
    } catch (err) {
      setFeedback({ type: 'error', msg: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback({ type: '', msg: '' });

    try {
      await api.createUser({
        username: newUsername,
        password: newPassword,
        displayName: newDisplayName,
        role: newRole
      });
      setFeedback({ type: 'success', msg: 'تم إنشاء المستخدم بنجاح' });
      setNewUsername('');
      setNewPassword('');
      setNewDisplayName('');
      setShowAddForm(false);
      loadUsers();
    } catch (err) {
      setFeedback({ type: 'error', msg: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!confirm('هل أنت متأكد من رغبتك في حذف هذا المستخدم نهائياً؟')) return;
    try {
      await api.deleteUser(userId);
      setFeedback({ type: 'success', msg: 'تم حذف المستخدم بنجاح' });
      loadUsers();
    } catch (err) {
      setFeedback({ type: 'error', msg: err.message });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl bg-white border border-[#DDD8CA] rounded-2xl shadow-2xl overflow-hidden text-right flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#0A241C] text-[#FBFAF6] flex items-center justify-between border-b border-[#1A4638]">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#B79E6A]" />
            <h3 className="font-bold text-base text-[#E8D9A8]">إدارة مستخدمي المنصة المحلية</h3>
          </div>
          <button onClick={onClose} className="p-1 text-[#A6956D] hover:text-white rounded-md">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {feedback.msg && (
            <div
              className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                feedback.type === 'success'
                  ? 'bg-[#E7F0EA] text-[#2E6B4F] border border-[#2E6B4F]/20'
                  : 'bg-[#F7E4E4] text-[#8A1B1B] border border-[#8A1B1B]/20'
              }`}
            >
              {feedback.type === 'success' && <CheckCircle2 className="w-4 h-4" />}
              <span>{feedback.msg}</span>
            </div>
          )}

          {/* Action Bar */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#5E6B64]">
              إجمالي المستخدمين المسجلين في قاعدة البيانات المحلية: {users.length}
            </span>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] text-xs font-semibold transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              <span>{showAddForm ? 'إلغاء' : 'إضافة مستخدم جديد'}</span>
            </button>
          </div>

          {/* Add User Form */}
          {showAddForm && (
            <form onSubmit={handleCreateUser} className="p-4 bg-[#FBFAF6] border border-[#DDD8CA] rounded-xl space-y-3">
              <h4 className="text-xs font-bold text-[#02443A] mb-2">بيانات الحساب الجديد</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#5E6B64] mb-1">اسم المستخدم (للدخول):</label>
                  <input
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="مثال: ahmad_it"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD8CA] rounded-lg focus:outline-none focus:border-[#B79E6A]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#5E6B64] mb-1">كلمة المرور:</label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="كلمة مرور قوية"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD8CA] rounded-lg focus:outline-none focus:border-[#B79E6A]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#5E6B64] mb-1">الاسم المعروض:</label>
                  <input
                    type="text"
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder="مثال: أحمد المحمد"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD8CA] rounded-lg focus:outline-none focus:border-[#B79E6A]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#5E6B64] mb-1">الصلاحية:</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-[#DDD8CA] rounded-lg focus:outline-none focus:border-[#B79E6A]"
                  >
                    <option value="user">مستخدم عادي</option>
                    <option value="admin">مدير نظام (مسؤول)</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                >
                  {submitting ? 'جاري الإنشاء...' : 'حفظ وإنشاء الحساب'}
                </button>
              </div>
            </form>
          )}

          {/* Users Table */}
          <div className="border border-[#DDD8CA] rounded-xl overflow-hidden bg-white">
            <table className="w-full text-right text-xs">
              <thead className="bg-[#F0EDE4] text-[#02443A] border-b border-[#DDD8CA]">
                <tr>
                  <th className="p-3">المستخدم</th>
                  <th className="p-3">اسم الدخول</th>
                  <th className="p-3">الصلاحية</th>
                  <th className="p-3">تاريخ الإنشاء</th>
                  <th className="p-3 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDE7D8]">
                {loading ? (
                  <tr>
                    <td colSpan="5" className="p-6 text-center text-[#5E6B64]">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-1 text-[#B79E6A]" />
                      <span>جاري تحميل الحسابات...</span>
                    </td>
                  </tr>
                ) : users.map((u) => {
                  const isSelf = u.id === currentUserId;
                  return (
                    <tr key={u.id} className="hover:bg-[#FBFAF6]">
                      <td className="p-3 font-semibold text-[#02443A] flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-[#EBE6D9] flex items-center justify-center text-[10px] text-[#02443A]">
                          <User className="w-3.5 h-3.5" />
                        </div>
                        <span>{u.display_name || u.username}</span>
                        {isSelf && <span className="text-[10px] text-[#A6956D] font-normal">(حسابك)</span>}
                      </td>
                      <td className="p-3 font-mono text-[#5E6B64]">{u.username}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            u.role === 'admin'
                              ? 'bg-[#E7F0EA] text-[#2E6B4F] border border-[#2E6B4F]/30'
                              : 'bg-[#F0EDE4] text-[#5E6B64]'
                          }`}
                        >
                          {u.role === 'admin' ? 'مدير نظام' : 'مستخدم'}
                        </span>
                      </td>
                      <td className="p-3 text-[#7A7A7B] text-[11px]">
                        {new Date(u.created_at).toLocaleDateString('ar-SY')}
                      </td>
                      <td className="p-3 text-center">
                        {!isSelf && (
                          <button
                            onClick={() => handleDeleteUser(u.id)}
                            className="p-1.5 text-[#8A1B1B] hover:bg-[#F7E4E4] rounded-md transition-colors"
                            title="حذف الحساب"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
