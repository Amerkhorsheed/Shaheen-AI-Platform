import React, { useState, useEffect } from 'react';
import { 
  X, 
  UserPlus, 
  Trash2, 
  Shield, 
  User, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Building2,
  Briefcase,
  Layers,
  Search,
  Key,
  Edit3,
  Plus,
  RefreshCw,
  Eye,
  EyeOff,
  ShieldAlert,
  ShieldCheck,
  Lock,
  BookOpen,
  Sliders,
  FileCode,
  Sparkles
} from 'lucide-react';
import { usersService } from '../services/users.service.js';
import { categoriesService } from '../services/categories.service.js';
import { promptsService } from '../services/prompts.service.js';
import { useDialog } from '../context/DialogContext.jsx';

export default function UsersModal({ isOpen, onClose, currentUserId, currentUser }) {
  const effectiveUserId = currentUserId || currentUser?.id;
  const isCurrentSuperAdmin = currentUser?.role === 'superadmin';
  const [activeTab, setActiveTab] = useState('users'); // 'users', 'categories', or 'prompts'
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const dialog = useDialog();

  // Prompt Library state
  const [modules, setModules] = useState([]);
  const [charter, setCharter] = useState('');
  const [previewCatId, setPreviewCatId] = useState('');
  const [previewClassification, setPreviewClassification] = useState('official');
  const [previewResult, setPreviewResult] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedModuleDetail, setSelectedModuleDetail] = useState(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('all');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState('all');

  // Modals state
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  // Add User Form State
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newJobTitle, setNewJobTitle] = useState('');
  const [newCategoryId, setNewCategoryId] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [newNotes, setNewNotes] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Edit User Form State
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editJobTitle, setEditJobTitle] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editRole, setEditRole] = useState('user');
  const [editStatus, setEditStatus] = useState('active');
  const [editNewPassword, setEditNewPassword] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [showEditPassword, setShowEditPassword] = useState(false);

  // Add Category Form State
  const [catName, setCatName] = useState('');
  const [catCode, setCatCode] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catClearance, setCatClearance] = useState('official');
  const [catColor, setCatColor] = useState('#02443A');
  const [catPrompt, setCatPrompt] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: '', msg: '' });

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [userList, catList, statsData, promptModules, charterData] = await Promise.all([
        usersService.getUsers(),
        categoriesService.getCategories(),
        usersService.getUserStats().catch(() => null),
        promptsService.getModules().catch(() => []),
        promptsService.getCharter().catch(() => ({ charter: '' }))
      ]);
      setUsers(userList || []);
      setCategories(catList || []);
      setStats(statsData);
      setModules(promptModules || []);
      setCharter(charterData?.charter || '');

      // Default category for new user form if not set
      if (catList && catList.length > 0) {
        if (!newCategoryId) setNewCategoryId(catList[0].id);
        if (!previewCatId) setPreviewCatId(catList[0].id);
      }
    } catch (err) {
      setFeedback({ type: 'error', msg: err.message || 'فشل تحميل البيانات' });
    } finally {
      setLoading(false);
    }
  };

  const handleLoadPreview = async (catId, classLevel) => {
    const targetCat = catId || previewCatId || (categories[0]?.id ?? 'cat_exec');
    const targetClass = classLevel || previewClassification || 'official';
    setPreviewLoading(true);
    try {
      const res = await promptsService.preview(targetCat, targetClass);
      setPreviewResult(res);
    } catch (err) {
      setFeedback({ type: 'error', msg: 'فشل استرجاع معاينة البرومبت: ' + (err.message || 'خطأ غير متوقع') });
    } finally {
      setPreviewLoading(false);
    }
  };

  // -------------------------------------------------------------
  // USER ACTIONS
  // -------------------------------------------------------------

  const handleOpenAddUser = () => {
    setNewUsername('');
    setNewPassword('');
    setNewDisplayName('');
    setNewJobTitle('');
    setNewRole('user');
    setNewNotes('');
    if (categories.length > 0) {
      setNewCategoryId(categories[0].id);
    }
    setFeedback({ type: '', msg: '' });
    setShowAddUserModal(true);
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newCategoryId) {
      setFeedback({ type: 'error', msg: 'يجب اختيار التصنيف المؤسسي للمستخدم' });
      return;
    }

    setSubmitting(true);
    setFeedback({ type: '', msg: '' });

    try {
      await usersService.createUser({
        username: newUsername.trim(),
        password: newPassword,
        displayName: newDisplayName.trim(),
        jobTitle: newJobTitle.trim() || 'مستشار إداري',
        categoryId: newCategoryId,
        role: newRole,
        notes: newNotes.trim()
      });

      setFeedback({ type: 'success', msg: `تم إنشاء حساب "${newDisplayName || newUsername}" بنجاح وإدراجه في الهيكل` });
      setShowAddUserModal(false);
      loadData();
    } catch (err) {
      setFeedback({ type: 'error', msg: err.message || 'فشل إنشاء المستخدم' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEditUser = (u) => {
    setEditingUser(u);
    setEditDisplayName(u.display_name || '');
    setEditJobTitle(u.job_title || '');
    setEditCategoryId(u.category_id || (categories[0]?.id || ''));
    setEditRole(u.role || 'user');
    setEditStatus(u.status || 'active');
    setEditNewPassword('');
    setEditNotes(u.notes || '');
    setFeedback({ type: '', msg: '' });
    setShowEditUserModal(true);
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!editingUser) return;

    setSubmitting(true);
    setFeedback({ type: '', msg: '' });

    try {
      await usersService.updateUser(editingUser.id, {
        displayName: editDisplayName.trim(),
        jobTitle: editJobTitle.trim(),
        categoryId: editCategoryId,
        role: editRole,
        status: editStatus,
        notes: editNotes.trim(),
        newPassword: editNewPassword.trim() ? editNewPassword.trim() : undefined
      });

      setFeedback({ type: 'success', msg: `تم تحديث بيانات وتصنيف "${editDisplayName || editingUser.username}" بنجاح` });
      setShowEditUserModal(false);
      setEditingUser(null);
      loadData();
    } catch (err) {
      setFeedback({ type: 'error', msg: err.message || 'فشل تحديث المستخدم' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (userToDelete) => {
    if (userToDelete.id === effectiveUserId) {
      await dialog.alert({
        title: 'إجراء غير مسموح',
        message: 'لا يمكنك حذف حسابك الشخصي الحالي الذي قمت بتسجيل الدخول به.',
        variant: 'warning'
      });
      return;
    }

    const confirmed = await dialog.confirm({
      title: 'تأكيد الحذف النهائي للمستخدم',
      message: `هل أنت متأكد من رغبتك في حذف حساب "${userToDelete.display_name || userToDelete.username}" نهائياً من قاعدة البيانات؟`,
      itemName: `${userToDelete.display_name || userToDelete.username} (@${userToDelete.username})`,
      description: 'سيتم حذف المستخدم وجميع الصلاحيات وسجلات النشاط المرتبطة بهذا الحساب بشكل نهائي.',
      confirmText: 'حذف المستخدم نهائياً',
      cancelText: 'إلغاء الأمر',
      variant: 'danger'
    });

    if (!confirmed) {
      return;
    }

    try {
      await usersService.deleteUser(userToDelete.id);
      setFeedback({ type: 'success', msg: 'تم حذف المستخدم وسجلاته بنجاح' });
      loadData();
    } catch (err) {
      setFeedback({ type: 'error', msg: err.message || 'فشل حذف المستخدم' });
    }
  };

  // -------------------------------------------------------------
  // CATEGORY ACTIONS
  // -------------------------------------------------------------

  const handleCreateCategory = async (e) => {
    e.preventDefault();
    if (!catName.trim() || !catCode.trim()) {
      setFeedback({ type: 'error', msg: 'يرجى تزويد اسم التصنيف ورمزه الكودي' });
      return;
    }

    setSubmitting(true);
    setFeedback({ type: '', msg: '' });

    try {
      await categoriesService.createCategory({
        name: catName.trim(),
        code: catCode.trim().toUpperCase(),
        description: catDesc.trim(),
        clearance_level: catClearance,
        color: catColor,
        prompt_context: catPrompt.trim()
      });

      setFeedback({ type: 'success', msg: `تم إنشاء التصنيف المؤسسي "${catName}" بنجاح` });
      setCatName('');
      setCatCode('');
      setCatDesc('');
      setCatPrompt('');
      setShowAddCategoryModal(false);
      loadData();
    } catch (err) {
      setFeedback({ type: 'error', msg: err.message || 'فشل إنشاء التصنيف' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCategory = async (cat) => {
    const confirmed = await dialog.confirm({
      title: 'حذف التصنيف المؤسسي',
      message: `هل أنت متأكد من حذف التصنيف المؤسسي "${cat.name}"؟`,
      itemName: `${cat.name} (${cat.code})`,
      description: 'ملاحظة أمنية: لا يمكن حذف أي تصنيف يحتوي على مستخدمين مسجلين.',
      confirmText: 'حذف التصنيف',
      cancelText: 'إلغاء الأمر',
      variant: 'danger'
    });

    if (!confirmed) {
      return;
    }

    try {
      await categoriesService.deleteCategory(cat.id);
      setFeedback({ type: 'success', msg: 'تم حذف التصنيف بنجاح' });
      loadData();
    } catch (err) {
      setFeedback({ type: 'error', msg: err.message || 'فشل حذف التصنيف' });
    }
  };

  // Filtered Users List
  const filteredUsers = users.filter((u) => {
    const matchesSearch = 
      (u.display_name && u.display_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (u.username && u.username.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (u.job_title && u.job_title.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (u.category_name && u.category_name.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = selectedCategoryFilter === 'all' || u.category_id === selectedCategoryFilter;
    const matchesRole = selectedRoleFilter === 'all' || u.role === selectedRoleFilter;

    return matchesSearch && matchesCategory && matchesRole;
  });

  const getClearanceBadge = (level) => {
    switch (level) {
      case 'top_secret':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F2] text-[#8A1B1B] border border-[#8A1B1B]/30">سري للغاية</span>;
      case 'secret':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FCF7EA] text-[#8A6A12] border border-[#8A6A12]/30">سري</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#E7F0EA] text-[#2E6B4F] border border-[#2E6B4F]/30">رسمي</span>;
    }
  };

  const getRoleBadge = (role) => {
    switch (role) {
      case 'superadmin':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#02443A] text-[#E8D9A8] border-2 border-[#B79E6A] shadow-xs">المدير العام (Super Admin)</span>;
      case 'admin':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#02443A] text-[#E8D9A8] border border-[#B79E6A]/40">مدير المنظومة</span>;
      case 'analyst':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#1E40AF]/15 text-[#1E40AF] border border-[#1E40AF]/30">محلل معتمد</span>;
      case 'auditor':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#475569]/15 text-[#334155] border border-[#475569]/30">مدقق رقابي</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F0EDE4] text-[#5E6B64] border border-[#DDD8CA]">مستخدم تنفيذي</span>;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A241C]/80 backdrop-blur-xs p-3 md:p-6 select-none animate-fadeIn">
      <div className="w-full max-w-5xl bg-[#FBFAF6] border border-[#DDD8CA] rounded-2xl shadow-2xl overflow-hidden text-right flex flex-col max-h-[92vh]">
        
        {/* Sovereign Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-[#02443A] via-[#0A241C] to-[#002723] text-[#FBFAF6] flex items-center justify-between border-b border-[#B79E6A]/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#081B15] border border-[#B79E6A]/60 flex items-center justify-center text-[#B79E6A] shadow-md">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-[#E8D9A8] tracking-tight">
                إدارة الكوادر والتصنيفات المؤسسية
              </h3>
              <p className="text-[11px] text-[#C5B78F]">
                الهيكل التنظيمي، إدارة الحسابات، تصنيف المستخدمين وضبط الصلاحيات
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="p-2 text-[#C5B78F] hover:text-white hover:bg-[#103228] rounded-lg transition-colors cursor-pointer"
              title="تحديث البيانات"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-[#C5B78F] hover:text-white hover:bg-[#103228] rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 pt-3 bg-[#F0EDE4] border-b border-[#DDD8CA] flex items-center gap-2">
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'users'
                ? 'bg-[#FBFAF6] text-[#02443A] border-t-2 border-r border-l border-[#02443A] shadow-xs'
                : 'text-[#5E6B64] hover:text-[#02443A] hover:bg-[#EBE6D9]'
            }`}
          >
            <User className="w-4 h-4" />
            <span>الكوادر والمستخدمون</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#EBE6D9] text-[#02443A] font-mono font-bold">
              {users.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('categories')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'categories'
                ? 'bg-[#FBFAF6] text-[#02443A] border-t-2 border-r border-l border-[#02443A] shadow-xs'
                : 'text-[#5E6B64] hover:text-[#02443A] hover:bg-[#EBE6D9]'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>الهيكل والتصنيفات المؤسسية</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#EBE6D9] text-[#02443A] font-mono font-bold">
              {categories.length}
            </span>
          </button>

          <button
            onClick={() => {
              setActiveTab('prompts');
              if (!previewResult && categories.length > 0) {
                handleLoadPreview(previewCatId || categories[0].id, previewClassification);
              }
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'prompts'
                ? 'bg-[#FBFAF6] text-[#02443A] border-t-2 border-r border-l border-[#02443A] shadow-xs'
                : 'text-[#5E6B64] hover:text-[#02443A] hover:bg-[#EBE6D9]'
            }`}
          >
            <BookOpen className="w-4 h-4 text-[#B79E6A]" />
            <span>مكتبة التوجيه الذكي والميثاق</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#EBE6D9] text-[#02443A] font-mono font-bold">
              {modules.length}
            </span>
          </button>
        </div>

        {/* Global Feedback Alert */}
        {feedback.msg && (
          <div className="mx-6 mt-4">
            <div
              className={`p-3 rounded-xl text-xs flex items-center justify-between gap-2 shadow-xs ${
                feedback.type === 'success'
                  ? 'bg-[#E7F0EA] text-[#2E6B4F] border border-[#2E6B4F]/30'
                  : 'bg-[#FDF2F2] text-[#8A1B1B] border border-[#8A1B1B]/30'
              }`}
            >
              <div className="flex items-center gap-2">
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-[#2E6B4F]" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-[#8A1B1B]" />
                )}
                <span className="font-semibold">{feedback.msg}</span>
              </div>
              <button 
                onClick={() => setFeedback({ type: '', msg: '' })} 
                className="text-[#5E6B64] hover:text-black text-xs font-bold px-1.5 cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Main Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          
          {/* ========================================================= */}
          {/* TAB 1: USERS & PERSONNEL                                  */}
          {/* ========================================================= */}
          {activeTab === 'users' && (
            <>
              {/* Metrics Ribbon */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-white border border-[#DDD8CA] rounded-xl shadow-2xs">
                  <span className="text-[11px] text-[#5E6B64] block">إجمالي الكوادر المسجلة</span>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xl font-bold font-mono text-[#02443A]">{users.length}</span>
                    <User className="w-4 h-4 text-[#B79E6A]" />
                  </div>
                </div>

                <div className="p-3 bg-white border border-[#DDD8CA] rounded-xl shadow-2xs">
                  <span className="text-[11px] text-[#5E6B64] block">الحسابات النشطة</span>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xl font-bold font-mono text-[#2E6B4F]">
                      {users.filter(u => u.status !== 'suspended').length}
                    </span>
                    <ShieldCheck className="w-4 h-4 text-[#2E6B4F]" />
                  </div>
                </div>

                <div className="p-3 bg-white border border-[#DDD8CA] rounded-xl shadow-2xs">
                  <span className="text-[11px] text-[#5E6B64] block">التصنيفات المعتمدة</span>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xl font-bold font-mono text-[#B79E6A]">{categories.length}</span>
                    <Layers className="w-4 h-4 text-[#B79E6A]" />
                  </div>
                </div>

                <div className="p-3 bg-white border border-[#DDD8CA] rounded-xl shadow-2xs">
                  <span className="text-[11px] text-[#5E6B64] block">المدراء والمشرفون</span>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xl font-bold font-mono text-[#02443A]">
                      {users.filter(u => u.role === 'admin' || u.role === 'superadmin').length}
                    </span>
                    <ShieldAlert className="w-4 h-4 text-[#02443A]" />
                  </div>
                </div>
              </div>

              {/* Action & Filter Bar */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white p-3 border border-[#DDD8CA] rounded-xl shadow-2xs">
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute right-3 top-2.5 text-[#5E6B64]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث بالاسم، المسمى الوظيفي، أو اسم الدخول..."
                    className="w-full bg-[#FBFAF6] border border-[#DDD8CA] focus:border-[#B79E6A] rounded-lg pr-9 pl-3 py-1.5 text-xs text-[#14201C] focus:outline-none"
                  />
                </div>

                {/* Role Filter */}
                <div className="flex items-center gap-2">
                  <select
                    value={selectedRoleFilter}
                    onChange={(e) => setSelectedRoleFilter(e.target.value)}
                    className="bg-[#FBFAF6] border border-[#DDD8CA] text-[#02443A] text-xs font-semibold py-1.5 px-3 rounded-lg focus:outline-none"
                  >
                    <option value="all">كل الصلاحيات</option>
                    <option value="superadmin">المدراء العامون (Super Admin)</option>
                    <option value="admin">مدراء المنظومة (Admin)</option>
                    <option value="analyst">المحللون</option>
                    <option value="auditor">المدققون</option>
                    <option value="user">المستخدمون التنفيذيون</option>
                  </select>

                  {/* Add User Button */}
                  <button
                    onClick={handleOpenAddUser}
                    className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] text-xs font-bold transition-all shadow-sm hover:shadow cursor-pointer flex-shrink-0"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>إضافة مستخدم جديد</span>
                  </button>
                </div>
              </div>

              {/* Category Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                <span className="text-[11px] text-[#5E6B64] font-semibold ml-1 flex-shrink-0">تصفية حسب التصنيف:</span>
                <button
                  onClick={() => setSelectedCategoryFilter('all')}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors flex-shrink-0 cursor-pointer ${
                    selectedCategoryFilter === 'all'
                      ? 'bg-[#02443A] text-[#E8D9A8]'
                      : 'bg-white border border-[#DDD8CA] text-[#5E6B64] hover:bg-[#F0EDE4]'
                  }`}
                >
                  الكل ({users.length})
                </button>
                {categories.map((c) => {
                  const count = users.filter(u => u.category_id === c.id).length;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCategoryFilter(c.id)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors flex-shrink-0 flex items-center gap-1.5 cursor-pointer ${
                        selectedCategoryFilter === c.id
                          ? 'bg-[#02443A] text-[#E8D9A8]'
                          : 'bg-white border border-[#DDD8CA] text-[#5E6B64] hover:bg-[#F0EDE4]'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color || '#B79E6A' }}></span>
                      <span>{c.name}</span>
                      <span className="font-mono text-[10px] opacity-75">({count})</span>
                    </button>
                  );
                })}
              </div>

              {/* Users Table */}
              <div className="border border-[#DDD8CA] rounded-xl overflow-hidden bg-white shadow-xs">
                <table className="w-full text-right text-xs">
                  <thead className="bg-[#F0EDE4] text-[#02443A] border-b border-[#DDD8CA] font-bold">
                    <tr>
                      <th className="p-3">الكادر والمسمى الوظيفي</th>
                      <th className="p-3">اسم الدخول</th>
                      <th className="p-3">التصنيف المؤسسي</th>
                      <th className="p-3">الصلاحية</th>
                      <th className="p-3">الحالة</th>
                      <th className="p-3 text-center">الجلسات</th>
                      <th className="p-3 text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EDE7D8]">
                    {loading ? (
                      <tr>
                        <td colSpan="7" className="p-8 text-center text-[#5E6B64]">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#B79E6A]" />
                          <span>جاري تحميل سجلات الكوادر...</span>
                        </td>
                      </tr>
                    ) : filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="p-8 text-center text-[#5E6B64]">
                          <div className="max-w-xs mx-auto space-y-2">
                            <User className="w-8 h-8 mx-auto text-[#DDD8CA]" />
                            <p className="font-semibold">لم يتم العثور على مستخدمين يطابقون خيارات البحث</p>
                            <button
                              onClick={() => { setSearchQuery(''); setSelectedCategoryFilter('all'); setSelectedRoleFilter('all'); }}
                              className="text-xs text-[#02443A] underline font-bold cursor-pointer"
                            >
                              إعادة ضبط عوامل التصفية
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => {
                        const isSelf = u.id === effectiveUserId;
                        const isSuspended = u.status === 'suspended';
                        const isTargetSuperAdmin = u.role === 'superadmin';
                        const canManage = isCurrentSuperAdmin || !isTargetSuperAdmin;

                        return (
                          <tr key={u.id} className={`hover:bg-[#FBFAF6] transition-colors ${isSuspended ? 'bg-[#FDF2F2]/30' : ''}`}>
                            {/* Name & Job Title */}
                            <td className="p-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-[#02443A] text-[#E8D9A8] flex items-center justify-center text-xs font-bold border border-[#B79E6A]/50 flex-shrink-0">
                                  {u.display_name?.[0] || u.username[0].toUpperCase()}
                                </div>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-1.5 font-bold text-[#02443A]">
                                    <span>{u.display_name || u.username}</span>
                                    {isSelf && (
                                      <span className="text-[10px] text-[#A6956D] bg-[#FCF7EA] px-1.5 py-0.2 rounded border border-[#B79E6A]/30">
                                        حسابك الحالي
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-[#5E6B64]">{u.job_title || 'مستشار إداري'}</span>
                                </div>
                              </div>
                            </td>

                            {/* Username */}
                            <td className="p-3 font-mono text-[#5E6B64] font-semibold text-[11px]">
                              @{u.username}
                            </td>

                            {/* Category & Clearance */}
                            <td className="p-3">
                              <div className="flex flex-col gap-1 items-start">
                                <span 
                                  className="px-2 py-0.5 rounded text-[11px] font-bold text-white flex items-center gap-1 shadow-2xs"
                                  style={{ backgroundColor: u.category_color || '#02443A' }}
                                >
                                  {u.category_code && <span className="opacity-80 font-mono text-[9px]">[{u.category_code}]</span>}
                                  <span>{u.category_name || u.department || 'غير مصنف'}</span>
                                </span>
                                {u.category_clearance && getClearanceBadge(u.category_clearance)}
                              </div>
                            </td>

                            {/* Role */}
                            <td className="p-3">
                              {getRoleBadge(u.role)}
                            </td>

                            {/* Status */}
                            <td className="p-3">
                              {isSuspended ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#8A1B1B]">
                                  <span className="w-2 h-2 rounded-full bg-[#8A1B1B]"></span>
                                  <span>موقوف</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#2E6B4F]">
                                  <span className="w-2 h-2 rounded-full bg-[#2E6B4F] animate-pulse"></span>
                                  <span>نشط</span>
                                </span>
                              )}
                            </td>

                            {/* Chat Metric */}
                            <td className="p-3 text-center">
                              <span className="font-mono font-bold text-[#02443A] bg-[#F0EDE4] px-2 py-0.5 rounded-full text-[11px]">
                                {u.chat_count || 0}
                              </span>
                            </td>

                            {/* Action Buttons */}
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                {canManage && (
                                  <button
                                    onClick={() => handleOpenEditUser(u)}
                                    className="p-1.5 text-[#02443A] hover:bg-[#EBE6D9] rounded-md transition-colors cursor-pointer"
                                    title="تعديل بيانات المستخدم والتصنيف"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                )}
                                {!isSelf && canManage && (
                                  <button
                                    onClick={() => handleDeleteUser(u)}
                                    className="p-1.5 text-[#8A1B1B] hover:bg-[#FDF2F2] rounded-md transition-colors cursor-pointer"
                                    title="حذف الحساب نهائياً"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ========================================================= */}
          {/* TAB 2: ORGANIZATIONAL CATEGORIES                          */}
          {/* ========================================================= */}
          {activeTab === 'categories' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-sm text-[#02443A]">الهيكل التنظيمي والتصنيفات المؤسسية</h4>
                  <p className="text-xs text-[#5E6B64]">
                    كل مستخدم ينتمي إلزامياً إلى أحد التصنيفات أدناه لضبط محددات الذكاء الاصطناعي ودرجات السرية
                  </p>
                </div>
                <button
                  onClick={() => setShowAddCategoryModal(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] text-xs font-bold transition-all shadow-sm cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة تصنيف جديد</span>
                </button>
              </div>

              {/* Categories Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {categories.map((c) => (
                  <div
                    key={c.id}
                    className="p-4 bg-white border border-[#DDD8CA] rounded-xl shadow-2xs space-y-3 relative overflow-hidden"
                  >
                    <div 
                      className="absolute top-0 right-0 left-0 h-1.5"
                      style={{ backgroundColor: c.color || '#02443A' }}
                    ></div>

                    <div className="flex items-start justify-between pt-1">
                      <div className="flex items-center gap-2">
                        <span 
                          className="font-mono font-bold text-xs px-2 py-0.5 rounded text-white shadow-2xs"
                          style={{ backgroundColor: c.color || '#02443A' }}
                        >
                          {c.code}
                        </span>
                        <h5 className="font-bold text-sm text-[#02443A]">{c.name}</h5>
                      </div>
                      <div className="flex items-center gap-2">
                        {getClearanceBadge(c.clearance_level)}
                        {/* Only allow deleting custom categories without users */}
                        {c.user_count === 0 && !['cat_exec', 'cat_strategy', 'cat_legal'].includes(c.id) && (
                          <button
                            onClick={() => handleDeleteCategory(c)}
                            className="p-1 text-[#8A1B1B] hover:bg-[#FDF2F2] rounded cursor-pointer"
                            title="حذف هذا التصنيف"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-[#5E6B64] leading-relaxed">
                      {c.description || 'لا يوجد وصف محدد لهذا القسم'}
                    </p>

                    {c.prompt_context && (
                      <div className="p-2.5 rounded-lg bg-[#FBFAF6] border border-[#DDD8CA] text-[11px] text-[#02443A] space-y-1">
                        <span className="font-bold text-[#B79E6A] block">المحدد التوجيهي للنموذج:</span>
                        <p className="italic text-[#5E6B64] leading-normal">{c.prompt_context}</p>
                      </div>
                    )}

                    <div className="pt-2 border-t border-[#EDE7D8] flex items-center justify-between text-xs text-[#5E6B64]">
                      <span className="flex items-center gap-1">
                        <User className="w-3.5 h-3.5 text-[#B79E6A]" />
                        <span>الكوادر المسندة لهذا التصنيف:</span>
                      </span>
                      <span className="font-bold font-mono text-[#02443A] bg-[#F0EDE4] px-2 py-0.5 rounded-full">
                        {c.user_count || 0} موظف
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* TAB 3: PROMPT LIBRARY & COMPOSABLE SYSTEM PROMPTS          */}
          {/* ========================================================= */}
          {activeTab === 'prompts' && (
            <div className="space-y-6">
              {/* Overview & Architecture Header */}
              <div className="p-4 bg-white border border-[#DDD8CA] rounded-xl shadow-2xs space-y-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-5 h-5 text-[#B79E6A]" />
                      <h4 className="font-bold text-sm text-[#02443A]">هندسة الأوامر المجمعة وميثاق الذكاء الاصطناعي</h4>
                    </div>
                    <p className="text-xs text-[#5E6B64] leading-relaxed">
                      يتم تجميع أوامر النظام آلياً على الخادم من 4 طبقات تشغيلية حتمية لمنع تزييف المعطيات والامتثال للمحددات المؤسسية:
                    </p>
                  </div>
                  <span className="text-[11px] px-2.5 py-1 rounded-full bg-[#E7F0EA] text-[#2E6B4F] font-bold border border-[#2E6B4F]/30 flex-shrink-0">
                    ميثاق نشط وحتمي
                  </span>
                </div>

                {/* 4 Layers Indicator Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 pt-1">
                  <div className="p-2.5 rounded-lg bg-[#FBFAF6] border border-[#DDD8CA] text-right space-y-1">
                    <span className="text-[10px] font-bold text-[#B79E6A] block">الطبقة 1: الميثاق المؤسسي</span>
                    <p className="text-[11px] font-semibold text-[#02443A]">SYSTEM_CHARTER</p>
                    <p className="text-[10px] text-[#5E6B64]">قواعد نزاهة مطلقة تلزم كافة الطلبات وتمنع اختلاق البيانات.</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#FBFAF6] border border-[#DDD8CA] text-right space-y-1">
                    <span className="text-[10px] font-bold text-[#B79E6A] block">الطبقة 2: الوحدات المشتركة</span>
                    <p className="text-[11px] font-semibold text-[#02443A]">PROMPT_MODULES</p>
                    <p className="text-[10px] text-[#5E6B64]">{modules.length} وحدات مشتركة تربط بالتصنيفات المؤسسية.</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#FBFAF6] border border-[#DDD8CA] text-right space-y-1">
                    <span className="text-[10px] font-bold text-[#B79E6A] block">الطبقة 3: التوجيه التخصصي</span>
                    <p className="text-[11px] font-semibold text-[#02443A]">DIRECTIVES</p>
                    <p className="text-[10px] text-[#5E6B64]">توجيهات مخصصة لكل إدارة وشعبة من الهيكل الإداري.</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#FBFAF6] border border-[#DDD8CA] text-right space-y-1">
                    <span className="text-[10px] font-bold text-[#B79E6A] block">الطبقة 4: سياق التشغيل</span>
                    <p className="text-[11px] font-semibold text-[#02443A]">RUNTIME</p>
                    <p className="text-[10px] text-[#5E6B64]">المسمى الوظيفي للمستخدم ودرجة السرية والملاحظات.</p>
                  </div>
                </div>
              </div>

              {/* Interactive Live Preview Box */}
              <div className="p-4 bg-white border border-[#DDD8CA] rounded-xl shadow-2xs space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-[#EDE7D8] pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#B79E6A]" />
                    <h5 className="font-bold text-xs text-[#02443A]">معاينة حية للبرومبت المجمع (Live Prompt Preview)</h5>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    {/* Select Category */}
                    <select
                      value={previewCatId}
                      onChange={(e) => {
                        setPreviewCatId(e.target.value);
                        handleLoadPreview(e.target.value, previewClassification);
                      }}
                      className="bg-[#FBFAF6] border border-[#DDD8CA] text-[#02443A] text-xs font-semibold py-1.5 px-3 rounded-lg focus:outline-none focus:border-[#B79E6A]"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.code})
                        </option>
                      ))}
                    </select>

                    {/* Select Classification */}
                    <select
                      value={previewClassification}
                      onChange={(e) => {
                        setPreviewClassification(e.target.value);
                        handleLoadPreview(previewCatId, e.target.value);
                      }}
                      className="bg-[#FBFAF6] border border-[#DDD8CA] text-[#02443A] text-xs font-semibold py-1.5 px-3 rounded-lg focus:outline-none focus:border-[#B79E6A]"
                    >
                      <option value="official">عادي / رسمي (Official)</option>
                      <option value="secret">سري (Secret)</option>
                      <option value="top_secret">سري للغاية (Top Secret)</option>
                      <option value="unclassified">غير مصنف (Unclassified)</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => handleLoadPreview(previewCatId, previewClassification)}
                      disabled={previewLoading}
                      className="px-3 py-1.5 bg-[#02443A] text-[#E8D9A8] hover:bg-[#002723] rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${previewLoading ? 'animate-spin' : ''}`} />
                      <span>تحديث المعاينة</span>
                    </button>
                  </div>
                </div>

                {previewLoading ? (
                  <div className="p-8 text-center text-[#5E6B64]">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#B79E6A]" />
                    <span className="text-xs">جاري تركيب ومعاينة تعليمات النظام...</span>
                  </div>
                ) : previewResult ? (
                  <div className="space-y-3">
                    {/* Layer Badges */}
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="px-2.5 py-0.5 rounded-full bg-[#F0EDE4] text-[#02443A] font-bold">
                        إجمالي المحارف: {previewResult.prompt?.length?.toLocaleString()} حرف
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-[#E7F0EA] text-[#2E6B4F] font-bold">
                        طول الميثاق: {previewResult.layers?.charterChars} حرف
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-[#FDF4E3] text-[#8B6F3E] font-bold">
                        الوحدات المشتركة: {previewResult.layers?.modules?.length || 0} وحدة
                      </span>
                      {previewResult.layers?.hasCategoryDirective && (
                        <span className="px-2.5 py-0.5 rounded-full bg-[#EDE7F6] text-[#6B21A8] font-bold">
                          يتضمن توجيهاً تخصصياً
                        </span>
                      )}
                    </div>

                    {/* Formatted Code / Prompt View */}
                    <div className="p-4 bg-[#0A241C] text-[#E8D9A8] rounded-xl font-mono text-[11px] leading-relaxed max-h-72 overflow-y-auto whitespace-pre-wrap border border-[#1A4638] text-right" dir="rtl">
                      {previewResult.prompt}
                    </div>
                  </div>
                ) : (
                  <div className="p-6 text-center text-[#5E6B64] text-xs">
                    اختر التصنيف ودرجة السرية أعلاه واضغط «تحديث المعاينة» لعرض الأوامر المجمعة بدقة.
                  </div>
                )}
              </div>

              {/* Modules List & Inspector */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="font-bold text-xs text-[#02443A]">وحدات التوجيه المشتركة في المنظومة ({modules.length})</h5>
                  <span className="text-[11px] text-[#5E6B64]">قابلة لإعادة الاستخدام عبر مختلف الإدارات</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {modules.map((mod) => (
                    <div
                      key={mod.id}
                      className="p-3.5 bg-white border border-[#DDD8CA] rounded-xl shadow-2xs space-y-2 hover:border-[#B79E6A] transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-0.5">
                          <span className="font-mono text-[10px] text-[#B79E6A] font-bold block">{mod.id}</span>
                          <h6 className="font-bold text-xs text-[#02443A]">{mod.name}</h6>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {mod.is_system === 1 && (
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-[#EBE6D9] text-[#02443A] rounded-full">
                              أساسية
                            </span>
                          )}
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 bg-[#F0EDE4] text-[#5E6B64] rounded-full">
                            {mod.category_count || 0} إدارات
                          </span>
                        </div>
                      </div>

                      <p className="text-[11px] text-[#5E6B64] leading-relaxed">
                        {mod.description}
                      </p>

                      <div className="pt-2 border-t border-[#EDE7D8] flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setSelectedModuleDetail(selectedModuleDetail?.id === mod.id ? null : mod)}
                          className="text-[11px] font-bold text-[#02443A] hover:underline cursor-pointer"
                        >
                          {selectedModuleDetail?.id === mod.id ? 'إخفاء نص الوحدة ▲' : 'عرض نص وتوجيهات الوحدة ▼'}
                        </button>
                      </div>

                      {selectedModuleDetail?.id === mod.id && (
                        <div className="p-3 rounded-lg bg-[#FBFAF6] border border-[#DDD8CA] text-[11px] text-[#02443A] font-mono leading-relaxed whitespace-pre-wrap text-right mt-2" dir="rtl">
                          {mod.content}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#F0EDE4] border-t border-[#DDD8CA] flex items-center justify-between text-xs text-[#5E6B64]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-[#2E6B4F]" />
            <span>نظام الصلاحيات والحسابات المؤسسي — مشفر محلياً ومسجل في سجلات التدقيق</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#02443A] text-[#E8D9A8] hover:bg-[#002723] rounded-lg font-bold text-xs transition-colors cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>

      {/* ============================================================= */}
      {/* SUB-MODAL: ADD NEW USER                                       */}
      {/* ============================================================= */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white border border-[#DDD8CA] rounded-2xl shadow-2xl overflow-hidden text-right animate-scaleIn">
            <div className="px-5 py-3.5 bg-[#02443A] text-white flex items-center justify-between border-b border-[#B79E6A]/50">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-[#B79E6A]" />
                <h4 className="font-bold text-sm text-[#E8D9A8]">إضافة مستخدم جديد للهيكل المؤسسي</h4>
              </div>
              <button onClick={() => setShowAddUserModal(false)} className="text-[#C5B78F] hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-5 space-y-3.5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Full Name */}
                <div>
                  <label className="block text-xs font-bold text-[#02443A] mb-1">
                    الاسم الكامل واللقب: <span className="text-[#8A1B1B]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder="مثال: د. سامر العلي"
                    className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none focus:border-[#B79E6A]"
                  />
                </div>

                {/* Job Title */}
                <div>
                  <label className="block text-xs font-bold text-[#02443A] mb-1">
                    المسمى الوظيفي: <span className="text-[#8A1B1B]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newJobTitle}
                    onChange={(e) => setNewJobTitle(e.target.value)}
                    placeholder="مثال: رئيس شعبة الدراسات"
                    className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none focus:border-[#B79E6A]"
                  />
                </div>

                {/* Username */}
                <div>
                  <label className="block text-xs font-bold text-[#02443A] mb-1">
                    اسم تسجيل الدخول: <span className="text-[#8A1B1B]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="مثال: samer_ali"
                    className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none focus:border-[#B79E6A] font-mono"
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-xs font-bold text-[#02443A] mb-1">
                    كلمة المرور (10 خانات كحد أدنى، حروف وأرقام): <span className="text-[#8A1B1B]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      minLength={10}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none focus:border-[#B79E6A] pl-8"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute left-2.5 top-2 text-[#5E6B64] hover:text-[#02443A] cursor-pointer"
                    >
                      {showNewPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Mandatory Category Dropdown */}
              <div className="p-3 bg-[#FCF7EA] border border-[#B79E6A]/40 rounded-xl space-y-1.5">
                <label className="block text-xs font-bold text-[#02443A]">
                  التصنيف المؤسسي / الإدارة التنظيمية: <span className="text-[#8A1B1B]">*</span>
                </label>
                <select
                  value={newCategoryId}
                  onChange={(e) => setNewCategoryId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs bg-white border border-[#B79E6A] rounded-lg focus:outline-none font-bold text-[#02443A]"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      [{c.code}] {c.name} ({c.clearance_level === 'top_secret' ? 'سري للغاية' : c.clearance_level === 'secret' ? 'سري' : 'رسمي'})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-[#A6956D]">
                  يحدد هذا التصنيف الهيكل الإداري للمستخدم ويضبط تلقائياً السياق التوجيهي للذكاء الاصطناعي ومستوى السرية.
                </p>
              </div>

              {/* Role Selection */}
              <div>
                <label className="block text-xs font-bold text-[#02443A] mb-1">
                  مستوى الصلاحية الإدارية:
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none"
                >
                  <option value="user">مستخدم تنفيذي (محادثات، رفع ملفات، وتوليد تقارير)</option>
                  <option value="analyst">محلل معتمد (صلاحيات تحليلية وتدقيق متقدم)</option>
                  <option value="auditor">مدقق رقابي (سجلات الرقابة والتدقيق)</option>
                  <option value="admin">مدير المنظومة (إشراف وإدارة الحسابات)</option>
                  {isCurrentSuperAdmin && (
                    <option value="superadmin">المدير العام — Super Admin (تحكم كامل بالنماذج والمنظومة)</option>
                  )}
                </select>
              </div>

              {/* Administrative Notes */}
              <div>
                <label className="block text-xs font-semibold text-[#5E6B64] mb-1">
                  ملاحظات إدارية (اختياري):
                </label>
                <input
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="رقم القيد، الشعبة، أو أي تفاصيل إدارية"
                  className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DDD8CA]">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="px-4 py-2 text-xs font-bold text-[#5E6B64] hover:bg-[#F0EDE4] rounded-lg transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] rounded-lg text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {submitting ? 'جاري الاعتماد...' : 'اعتماد وإنشاء الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================= */}
      {/* SUB-MODAL: EDIT USER                                          */}
      {/* ============================================================= */}
      {showEditUserModal && editingUser && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white border border-[#DDD8CA] rounded-2xl shadow-2xl overflow-hidden text-right animate-scaleIn">
            <div className="px-5 py-3.5 bg-[#02443A] text-white flex items-center justify-between border-b border-[#B79E6A]/50">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-[#B79E6A]" />
                <h4 className="font-bold text-sm text-[#E8D9A8]">
                  تعديل بيانات وتصنيف: {editingUser.display_name || editingUser.username}
                </h4>
              </div>
              <button onClick={() => setShowEditUserModal(false)} className="text-[#C5B78F] hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateUser} className="p-5 space-y-3.5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Full Name */}
                <div>
                  <label className="block text-xs font-bold text-[#02443A] mb-1">الاسم الكامل:</label>
                  <input
                    type="text"
                    required
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none"
                  />
                </div>

                {/* Job Title */}
                <div>
                  <label className="block text-xs font-bold text-[#02443A] mb-1">المسمى الوظيفي:</label>
                  <input
                    type="text"
                    required
                    value={editJobTitle}
                    onChange={(e) => setEditJobTitle(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              {/* Category Dropdown */}
              <div className="p-3 bg-[#FCF7EA] border border-[#B79E6A]/40 rounded-xl space-y-1">
                <label className="block text-xs font-bold text-[#02443A]">
                  التصنيف المؤسسي / القسم:
                </label>
                <select
                  value={editCategoryId}
                  onChange={(e) => setEditCategoryId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-[#B79E6A] rounded-lg focus:outline-none font-bold text-[#02443A]"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      [{c.code}] {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Role */}
                <div>
                  <label className="block text-xs font-bold text-[#02443A] mb-1">الصلاحية:</label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value)}
                    disabled={editingUser.id === effectiveUserId || (editingUser.role === 'superadmin' && !isCurrentSuperAdmin)}
                    className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none disabled:opacity-60"
                  >
                    <option value="user">مستخدم تنفيذي</option>
                    <option value="analyst">محلل معتمد</option>
                    <option value="auditor">مدقق رقابي</option>
                    <option value="admin">مدير المنظومة</option>
                    {isCurrentSuperAdmin && (
                      <option value="superadmin">المدير العام (Super Admin)</option>
                    )}
                  </select>
                </div>

                {/* Status */}
                <div>
                  <label className="block text-xs font-bold text-[#02443A] mb-1">حالة الحساب:</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    disabled={editingUser.id === effectiveUserId || (editingUser.role === 'superadmin' && !isCurrentSuperAdmin)}
                    className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none disabled:opacity-60"
                  >
                    <option value="active">🟢 نشط ومفعل</option>
                    <option value="suspended">🔴 موقوف إدارياً</option>
                  </select>
                </div>
              </div>

              {/* Password Reset Option */}
              <div className="p-3 bg-[#FBFAF6] border border-[#DDD8CA] rounded-xl space-y-1">
                <label className="block text-xs font-bold text-[#02443A] flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-[#B79E6A]" />
                  <span>إعادة تعيين كلمة المرور (اختياري):</span>
                </label>
                <div className="relative">
                  <input
                    type={showEditPassword ? 'text' : 'password'}
                    value={editNewPassword}
                    onChange={(e) => setEditNewPassword(e.target.value)}
                    placeholder="اتركه فارغاً إذا لم ترغب بتغيير كلمة المرور (10 خانات كحد أدنى)"
                    className="w-full px-3 py-2 text-xs bg-white border border-[#DDD8CA] rounded-lg focus:outline-none pl-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPassword(!showEditPassword)}
                    className="absolute left-2.5 top-2 text-[#5E6B64] hover:text-[#02443A] cursor-pointer"
                  >
                    {showEditPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-[#5E6B64] mb-1">ملاحظات إدارية:</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DDD8CA]">
                <button
                  type="button"
                  onClick={() => setShowEditUserModal(false)}
                  className="px-4 py-2 text-xs font-bold text-[#5E6B64] hover:bg-[#F0EDE4] rounded-lg transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] rounded-lg text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {submitting ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================= */}
      {/* SUB-MODAL: ADD NEW CATEGORY                                   */}
      {/* ============================================================= */}
      {showAddCategoryModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white border border-[#DDD8CA] rounded-2xl shadow-2xl overflow-hidden text-right animate-scaleIn">
            <div className="px-5 py-3.5 bg-[#02443A] text-white flex items-center justify-between border-b border-[#B79E6A]/50">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#B79E6A]" />
                <h4 className="font-bold text-sm text-[#E8D9A8]">إضافة تصنيف مؤسسي جديد</h4>
              </div>
              <button onClick={() => setShowAddCategoryModal(false)} className="text-[#C5B78F] hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCategory} className="p-5 space-y-3.5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Category Name */}
                <div>
                  <label className="block text-xs font-bold text-[#02443A] mb-1">
                    اسم التصنيف / القسم: <span className="text-[#8A1B1B]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                    placeholder="مثال: دائرة التخطيط والبرامج"
                    className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none"
                  />
                </div>

                {/* Code */}
                <div>
                  <label className="block text-xs font-bold text-[#02443A] mb-1">
                    الرمز الكودي: <span className="text-[#8A1B1B]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={8}
                    value={catCode}
                    onChange={(e) => setCatCode(e.target.value.toUpperCase())}
                    placeholder="مثال: PLAN"
                    className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Clearance */}
                <div>
                  <label className="block text-xs font-bold text-[#02443A] mb-1">درجة السرية:</label>
                  <select
                    value={catClearance}
                    onChange={(e) => setCatClearance(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none"
                  >
                    <option value="official">🟢 رسمي وموثق</option>
                    <option value="secret">🟠 سري وخاص</option>
                    <option value="top_secret">🔴 سري للغاية ومكتوم</option>
                  </select>
                </div>

                {/* Color */}
                <div>
                  <label className="block text-xs font-bold text-[#02443A] mb-1">لون الشعار التمييزي:</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={catColor}
                      onChange={(e) => setCatColor(e.target.value)}
                      className="w-10 h-8 rounded border border-[#DDD8CA] cursor-pointer"
                    />
                    <input
                      type="text"
                      value={catColor}
                      onChange={(e) => setCatColor(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-[#5E6B64] mb-1">وصف مهام القسم:</label>
                <textarea
                  rows={2}
                  value={catDesc}
                  onChange={(e) => setCatDesc(e.target.value)}
                  placeholder="وصف موجز للمهام والاختصاصات الموكلة لهذا القسم"
                  className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none resize-none"
                />
              </div>

              {/* Custom AI Prompt Context */}
              <div>
                <label className="block text-xs font-bold text-[#02443A] mb-1">
                  المحدد التوجيهي للذكاء الاصطناعي الخاص بهذا القسم:
                </label>
                <textarea
                  rows={3}
                  value={catPrompt}
                  onChange={(e) => setCatPrompt(e.target.value)}
                  placeholder="مثال: أنت مستشار دائرة التخطيط. ركز على إعداد الجداول الزمنية، مصفوفات الأولويات، ومؤشرات قياس الأداء KPI..."
                  className="w-full px-3 py-2 text-xs bg-[#FBFAF6] border border-[#DDD8CA] rounded-lg focus:outline-none resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DDD8CA]">
                <button
                  type="button"
                  onClick={() => setShowAddCategoryModal(false)}
                  className="px-4 py-2 text-xs font-bold text-[#5E6B64] hover:bg-[#F0EDE4] rounded-lg transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-[#02443A] hover:bg-[#002723] text-[#E8D9A8] rounded-lg text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {submitting ? 'جاري الحفظ...' : 'حفظ وإضافة التصنيف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
