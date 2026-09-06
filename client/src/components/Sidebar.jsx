import React, { useState } from 'react';
import { 
  Plus, 
  MessageSquare, 
  Search, 
  Settings, 
  Users, 
  LogOut, 
  Trash2, 
  Edit2, 
  Pin, 
  Check, 
  X, 
  PanelLeftClose, 
  ShieldCheck,
  FileCheck2,
  ScrollText,
  Lock
} from 'lucide-react';
import EagleEmblem from '../assets/EagleEmblem';
import { CLASSIFICATIONS } from './GovernmentRibbon';
import { useDialog } from '../context/DialogContext.jsx';

export default function Sidebar({
  isOpen,
  onToggle,
  chats = [],
  activeChatId,
  onSelectChat,
  onNewChat,
  onUpdateChatTitle,
  onTogglePinChat,
  onDeleteChat,
  currentUser,
  onOpenUsersModal,
  onOpenSettingsModal,
  onOpenTemplatesModal,
  onLogout
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const dialog = useDialog();

  // Filter chats by search
  const filteredChats = chats.filter(c => 
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group chats by date
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const lastWeek = today - 7 * 86400000;

  const groups = {
    pinned: [],
    today: [],
    yesterday: [],
    lastWeek: [],
    older: []
  };

  filteredChats.forEach(chat => {
    if (chat.pinned) {
      groups.pinned.push(chat);
      return;
    }
    const chatTime = new Date(chat.updated_at || chat.created_at).getTime();
    if (chatTime >= today) {
      groups.today.push(chat);
    } else if (chatTime >= yesterday) {
      groups.yesterday.push(chat);
    } else if (chatTime >= lastWeek) {
      groups.lastWeek.push(chat);
    } else {
      groups.older.push(chat);
    }
  });

  const startRename = (chat, e) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditingTitle(chat.title);
  };

  const saveRename = (chatId, e) => {
    e?.stopPropagation?.();
    if (editingTitle.trim()) {
      onUpdateChatTitle(chatId, editingTitle.trim());
    }
    setEditingChatId(null);
  };

  const cancelRename = (e) => {
    e?.stopPropagation?.();
    setEditingChatId(null);
  };

  return (
    <aside
      className={`fixed md:static inset-y-0 right-0 z-40 flex flex-col bg-[#0A241C] text-[#FBFAF6] border-l border-[#1A4638] transition-all duration-300 shadow-2xl md:shadow-none ${
        isOpen ? 'w-72 md:w-80 translate-x-0' : 'w-0 translate-x-full md:w-0 md:translate-x-0 overflow-hidden'
      }`}
    >
      {/* Brand Header */}
      <div className="p-4 border-b border-[#1A4638] flex items-center justify-between bg-[#071a14]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#02443A] to-[#002723] p-1.5 flex items-center justify-center border border-[#B79E6A]/50 shadow-md">
            <EagleEmblem className="w-7 h-5.5" fill="#B79E6A" />
          </div>
          <div>
            <h2 className="font-bold text-sm tracking-wide text-[#E8D9A8]">منظومة OSS</h2>
            <div className="flex items-center gap-1 text-[10px] text-[#A6956D]">
              <ShieldCheck className="w-3 h-3 text-[#2E6B4F]" />
              <span>الجمهورية العربية السورية</span>
            </div>
          </div>
        </div>

        <button
          onClick={onToggle}
          className="p-1 text-[#A6956D] hover:text-[#FBFAF6] hover:bg-[#1A4638] rounded-md transition-colors md:hidden"
          title="إغلاق القائمة"
        >
          <PanelLeftClose className="w-5 h-5" />
        </button>
      </div>

      {/* Action Buttons: New Chat & Government Templates */}
      <div className="p-3 space-y-2">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#02443A] hover:bg-[#1A4638] border border-[#B79E6A]/40 text-[#E8D9A8] font-bold text-xs md:text-sm transition-all shadow-sm group"
        >
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#B79E6A] group-hover:scale-110 transition-transform" />
            <span>جلسة عمل جديدة</span>
          </div>
          <span className="text-[10px] bg-[#0A241C] text-[#A6956D] px-1.5 py-0.5 rounded font-mono">
            ⌘K
          </span>
        </button>

        <button
          onClick={onOpenTemplatesModal}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-[#103228] hover:bg-[#153a2f] border border-[#1A4638] text-[#E8D9A8] text-xs font-semibold transition-all"
        >
          <ScrollText className="w-4 h-4 text-[#B79E6A]" />
          <span>نماذج وقوالب المراسلات الرسمية</span>
        </button>
      </div>

      {/* Search Filter */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute right-3 top-2.5 text-[#5E6B64]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث في السجلات الرسمية..."
            className="w-full bg-[#071a14] border border-[#1A4638] focus:border-[#B79E6A] rounded-lg pr-9 pl-3 py-1.5 text-xs text-[#FBFAF6] placeholder-[#5E6B64] focus:outline-none"
          />
        </div>
      </div>

      {/* Chat History List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-3.5 py-1">
        {Object.entries({
          'الجلسات المثبتة': groups.pinned,
          'اليوم': groups.today,
          'الأمس': groups.yesterday,
          'آخر 7 أيام': groups.lastWeek,
          'الأرشيف السابق': groups.older
        }).map(([label, items]) => {
          if (!items || items.length === 0) return null;

          return (
            <div key={label}>
              <div className="px-2.5 pb-1 text-[10.5px] font-bold text-[#A6956D] uppercase tracking-wider">
                {label}
              </div>
              <div className="space-y-1">
                {items.map((chat) => {
                  const isActive = chat.id === activeChatId;
                  const isEditing = chat.id === editingChatId;
                  const chatClass = CLASSIFICATIONS[chat.classification] || CLASSIFICATIONS.official;

                  return (
                    <div
                      key={chat.id}
                      onClick={() => onSelectChat(chat.id)}
                      className={`group relative flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer transition-all ${
                        isActive
                          ? 'bg-[#1A4638] text-[#E8D9A8] font-bold border-r-4 border-[#B79E6A] shadow-xs'
                          : 'text-[#DDD8CA] hover:bg-[#103228] hover:text-[#FBFAF6]'
                      }`}
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={(e) => {
                              if (e.relatedTarget?.getAttribute('data-action') === 'cancel') return;
                              saveRename(chat.id, e);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                saveRename(chat.id, e);
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelRename(e);
                              }
                            }}
                            autoFocus
                            className="bg-[#071a14] text-[#FBFAF6] border border-[#B79E6A] rounded px-2 py-0.5 text-xs w-full focus:outline-none shadow-xs"
                          />
                          <button 
                            data-action="save"
                            onClick={(e) => saveRename(chat.id, e)} 
                            className="p-1 text-emerald-400 hover:text-emerald-300 rounded hover:bg-[#103228] transition-colors"
                            title="حفظ التعديل"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            data-action="cancel"
                            onClick={cancelRename} 
                            className="p-1 text-rose-400 hover:text-rose-300 rounded hover:bg-[#103228] transition-colors"
                            title="إلغاء التعديل"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${chatClass.dot}`} />
                            <span className="truncate">{chat.title}</span>
                            {Boolean(chat.pinned) && (
                              <Pin className="w-3 h-3 text-[#B79E6A] fill-[#B79E6A] flex-shrink-0 rotate-45" title="جلسة مثبتة في الأعلى" />
                            )}
                          </div>

                          {/* Quick Actions (Pin / Edit / Delete) on hover or active */}
                          <div className={`items-center gap-1 ${isActive ? 'flex' : 'hidden group-hover:flex'}`}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onTogglePinChat(chat.id, !chat.pinned);
                              }}
                              className={`p-1 rounded transition-colors ${
                                chat.pinned ? 'text-[#B79E6A] bg-[#071a14]' : 'text-[#7A7A7B] hover:text-[#E8D9A8] hover:bg-[#071a14]'
                              }`}
                              title={chat.pinned ? 'إلغاء التثبيت' : 'تثبيت الجلسة في الأعلى'}
                            >
                              <Pin className={`w-3.5 h-3.5 ${chat.pinned ? 'fill-[#B79E6A]' : ''}`} />
                            </button>
                            <button
                              onClick={(e) => startRename(chat, e)}
                              className="p-1 text-[#7A7A7B] hover:text-[#FBFAF6] hover:bg-[#071a14] rounded transition-colors"
                              title="تعديل اسم الجلسة"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const confirmed = await dialog.confirm({
                                  title: 'تأكيد حذف الجلسة',
                                  message: 'هل أنت متأكد من رغبتك في حذف هذه الجلسة وسجلها بالكامل؟',
                                  itemName: chat.title,
                                  description: 'سيتم مسح المحادثات والمرفقات المرتبطة بهذه الجلسة نهائياً من النظام.',
                                  confirmText: 'حذف الجلسة نهائياً',
                                  cancelText: 'إلغاء الأمر',
                                  variant: 'danger'
                                });
                                if (confirmed) {
                                  onDeleteChat(chat.id);
                                }
                              }}
                              className="p-1 text-[#7A7A7B] hover:text-[#FF5252] hover:bg-[#071a14] rounded transition-colors cursor-pointer"
                              title="حذف الجلسة نهائياً"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {filteredChats.length === 0 && (
          <div className="text-center py-8 text-xs text-[#5E6B64]">
            لا توجد جلسات سابقة
          </div>
        )}
      </div>

      {/* User Profile & Institutional Controls */}
      <div className="p-3 border-t border-[#1A4638] bg-[#071a14]">
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[#02443A] text-[#E8D9A8] flex items-center justify-center font-bold text-xs border border-[#B79E6A]/50 flex-shrink-0">
              {currentUser?.displayName?.[0] || currentUser?.username?.[0]?.toUpperCase() || 'م'}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold text-[#FBFAF6] truncate">
                {currentUser?.displayName || currentUser?.username}
              </span>
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[10px] text-[#A6956D] truncate">
                  {currentUser?.jobTitle || (
                    currentUser?.role === 'superadmin'
                      ? 'المدير العام (Super Admin)'
                      : currentUser?.role === 'admin'
                      ? 'مدير المنظومة'
                      : 'مستشار'
                  )}
                </span>
                {currentUser?.categoryName && (
                  <span 
                    className="text-[9px] font-bold px-1.5 py-0.2 rounded text-white truncate max-w-[120px]"
                    style={{ backgroundColor: currentUser?.categoryColor || '#02443A' }}
                  >
                    {currentUser?.categoryName}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onLogout}
            className="p-1.5 text-[#5E6B64] hover:text-[#8A1B1B] hover:bg-[#1A4638] rounded-md transition-colors flex-shrink-0 cursor-pointer"
            title="تسجيل الخروج"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5 pt-1 text-xs">
          {(currentUser?.role === 'admin' || currentUser?.role === 'superadmin') && (
            <button
              onClick={onOpenUsersModal}
              className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-[#103228] hover:bg-[#1A4638] text-[#E8D9A8] font-semibold transition-colors"
            >
              <Users className="w-3.5 h-3.5" />
              <span>إدارة الحسابات</span>
            </button>
          )}
          <button
            onClick={onOpenSettingsModal}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-[#103228] hover:bg-[#1A4638] text-[#E8D9A8] font-semibold transition-colors ${
              currentUser?.role !== 'admin' && currentUser?.role !== 'superadmin' ? 'col-span-2' : ''
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>ضبط المنظومة</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
