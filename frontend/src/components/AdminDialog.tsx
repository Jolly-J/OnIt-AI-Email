import React, { useState, useEffect, useMemo } from 'react';
import { api, AdminUserItem, User } from '../lib/api';
import {
  X,
  Users,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  ShieldAlert,
  UserCheck,
  UserX,
  CheckCircle2,
  AlertCircle,
  Building2,
  LoaderCircle,
} from 'lucide-react';

interface AdminDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
}

export const AdminDialog: React.FC<AdminDialogProps> = ({ isOpen, onClose, currentUser }) => {
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'admin'>('all');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [mounted, setMounted] = useState(false);
  const [animating, setAnimating] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await api.admin.getUsers();
      setUsers(data);
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || '加载员工目录失败' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      loadUsers();
      setFeedback(null);
      const timer = setTimeout(() => setAnimating(true), 20);
      return () => clearTimeout(timer);
    } else {
      setAnimating(false);
      const timer = setTimeout(() => setMounted(false), 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // 一键同步钉钉通讯录
  const handleSyncOrg = async () => {
    setSyncing(true);
    setFeedback(null);
    try {
      const res = await api.admin.syncDingTalk();
      setFeedback({
        type: 'success',
        message: `${res.message} (当前组织共计 ${res.total_synced} 人)`,
      });
      await loadUsers();
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || '同步钉钉通讯录失败' });
    } finally {
      setSyncing(false);
    }
  };

  // 切换系统使用权限
  const handleToggleAccess = async (user: AdminUserItem) => {
    if (user.id === currentUser?.id && user.is_active) {
      setFeedback({ type: 'error', message: '不能关闭当前登录管理员自己的使用权限' });
      return;
    }

    const nextState = !user.is_active;
    try {
      await api.admin.toggleAccess(user.id, nextState);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, is_active: nextState } : u))
      );
      setFeedback({
        type: 'success',
        message: `已${nextState ? '开通' : '关闭'}【${user.display_name}】的系统使用权限`,
      });
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || '修改权限失败' });
    }
  };

  // 切换管理员角色
  const handleToggleAdmin = async (user: AdminUserItem) => {
    if (user.id === currentUser?.id && user.is_admin) {
      setFeedback({ type: 'error', message: '不能撤销当前登录管理员自己的管理权限' });
      return;
    }

    const nextAdmin = !user.is_admin;
    try {
      await api.admin.toggleAdmin(user.id, nextAdmin);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === user.id ? { ...u, is_admin: nextAdmin, is_active: nextAdmin ? true : u.is_active } : u
        )
      );
      setFeedback({
        type: 'success',
        message: `已将【${user.display_name}】${nextAdmin ? '设为管理员' : '降为普通员工'}`,
      });
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || '修改管理员角色失败' });
    }
  };

  // 本地搜索与筛选
  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      const matchQuery =
        !q ||
        (u.display_name && u.display_name.toLowerCase().includes(q)) ||
        (u.job_number && u.job_number.toLowerCase().includes(q)) ||
        (u.department_name && u.department_name.toLowerCase().includes(q)) ||
        (u.dingtalk_userid && u.dingtalk_userid.toLowerCase().includes(q));

      if (!matchQuery) return false;

      if (statusFilter === 'active') return u.is_active;
      if (statusFilter === 'inactive') return !u.is_active;
      if (statusFilter === 'admin') return u.is_admin;
      return true;
    });
  }, [users, searchQuery, statusFilter]);

  // 统计数值
  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.is_active).length;
    const inactive = users.filter((u) => !u.is_active).length;
    const adminCount = users.filter((u) => u.is_admin).length;
    return { total, active, inactive, adminCount };
  }, [users]);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 overflow-y-auto bg-black/50 backdrop-blur-xs t-modal-backdrop ${
        animating ? 'is-open' : 'is-closing'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full max-w-4xl bg-card rounded-2xl border shadow-2xl overflow-hidden my-auto sm:my-6 flex flex-col max-h-[94vh] sm:max-h-[90vh] t-modal-surface ${
          animating ? 'is-open' : 'is-closing'
        }`}
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b bg-muted/20 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-[15px] flex items-center gap-2">
                <span>企业与员工权限管理</span>
                <span className="px-2 py-0.5 text-[11px] font-normal bg-primary/10 text-primary rounded-full">
                  钉钉组织直连
                </span>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                同步钉钉企业通讯录，精准授权员工登录使用权限与系统管理员角色
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 快捷操作与统计区 */}
        <div className="px-4 sm:px-6 py-3 border-b bg-muted/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 w-full sm:w-auto">
            <div className="bg-background border rounded-xl px-3.5 py-2 flex items-center justify-between gap-3 min-w-[110px]">
              <div className="text-xs text-muted-foreground font-medium">企业总人数</div>
              <div className="text-base font-bold text-foreground font-mono">{stats.total}</div>
            </div>
            <div className="bg-background border rounded-xl px-3.5 py-2 flex items-center justify-between gap-3 min-w-[110px]">
              <div className="text-xs text-emerald-600 font-medium flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 shrink-0" />
                <span>已授权</span>
              </div>
              <div className="text-base font-bold text-emerald-600 font-mono">{stats.active}</div>
            </div>
            <div className="bg-background border rounded-xl px-3.5 py-2 flex items-center justify-between gap-3 min-w-[110px]">
              <div className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                <UserX className="w-3.5 h-3.5 shrink-0" />
                <span>未开通</span>
              </div>
              <div className="text-base font-bold text-muted-foreground font-mono">{stats.inactive}</div>
            </div>
            <div className="bg-background border rounded-xl px-3.5 py-2 flex items-center justify-between gap-3 min-w-[110px]">
              <div className="text-xs text-primary font-medium flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 shrink-0" />
                <span>管理员</span>
              </div>
              <div className="text-base font-bold text-primary font-mono">{stats.adminCount}</div>
            </div>
          </div>

          <button
            onClick={handleSyncOrg}
            disabled={syncing}
            className="w-full sm:w-auto min-w-[155px] h-9 px-3.5 bg-primary text-primary-foreground text-xs font-medium rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 shadow-xs shrink-0 whitespace-nowrap select-none disabled:opacity-75 disabled:cursor-not-allowed cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${syncing ? 'animate-spin' : ''}`} />
            <span className="whitespace-nowrap">{syncing ? '正在同步通讯录...' : '一键同步钉钉员工'}</span>
          </button>
        </div>

        {/* 提示消息 */}
        {feedback && (
          <div
            className={`mx-4 sm:mx-6 mt-3 sm:mt-4 p-3 text-xs rounded-xl flex items-center gap-2 border ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-destructive/10 text-destructive border-destructive/20'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* 筛选与搜索工具条 */}
        <div className="px-4 sm:px-6 py-2.5 sm:py-3 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          {/* 状态标签切换 */}
          <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl w-full sm:w-auto overflow-x-auto">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors font-medium whitespace-nowrap ${
                statusFilter === 'all' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              全部 ({stats.total})
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors font-medium whitespace-nowrap ${
                statusFilter === 'active' ? 'bg-background shadow-xs text-emerald-600' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              已授权 ({stats.active})
            </button>
            <button
              onClick={() => setStatusFilter('inactive')}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors font-medium whitespace-nowrap ${
                statusFilter === 'inactive' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              未开通 ({stats.inactive})
            </button>
            <button
              onClick={() => setStatusFilter('admin')}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors font-medium whitespace-nowrap ${
                statusFilter === 'admin' ? 'bg-background shadow-xs text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              管理员 ({stats.adminCount})
            </button>
          </div>

          {/* 搜索框 */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索员工姓名 / 工号 / 部门..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-background border rounded-lg focus:ring-2 focus:ring-primary focus:outline-none placeholder:text-muted-foreground/70"
            />
          </div>
        </div>

        {/* 员工表格/卡片区：带有标签切换动态过渡动效与自适应展示 */}
        <div
          key={statusFilter}
          className="flex-1 overflow-y-auto px-4 sm:px-6 pb-4 sm:pb-6 stable-scrollbar transition-all duration-300 ease-out animate-in fade-in-50 duration-200"
        >
          {loading ? (
            <div className="h-48 flex flex-col items-center justify-center text-muted-foreground text-xs gap-2">
              <LoaderCircle className="w-6 h-6 animate-spin text-primary" />
              <span>加载员工目录中...</span>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="h-48 border border-dashed rounded-xl flex flex-col items-center justify-center text-muted-foreground text-xs gap-2">
              <Users className="w-8 h-8 opacity-40" />
              <span>没有找到符合条件的员工</span>
              {users.length === 0 && (
                <button
                  onClick={handleSyncOrg}
                  className="text-primary hover:underline font-medium text-xs mt-1"
                >
                  点此立即从钉钉拉取组织架构
                </button>
              )}
            </div>
          ) : (
            <>
              {/* 移动端专属卡片列表视图 (屏幕宽度 < 640px) */}
              <div className="sm:hidden space-y-2.5">
                {filteredUsers.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <div
                      key={u.id}
                      className="bg-background border rounded-xl p-3.5 flex flex-col gap-2.5 shadow-xs hover:border-primary/40 transition-colors"
                    >
                      {/* 卡片头部：头像 + 姓名 + 标识 + 账号 */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {u.avatar ? (
                            <img
                              src={u.avatar}
                              alt={u.display_name || u.username}
                              className="w-9 h-9 rounded-full object-cover border shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                              {(u.display_name || u.username || '员').slice(0, 1)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-medium text-foreground text-sm flex items-center gap-1.5 flex-wrap">
                              <span className="truncate">{u.display_name || u.username}</span>
                              {isSelf && (
                                <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.2 rounded font-normal shrink-0">
                                  当前账号
                                </span>
                              )}
                              {u.is_admin && (
                                <span className="text-[10px] bg-amber-500/10 text-amber-600 border border-amber-500/20 px-1.5 py-0.2 rounded font-medium shrink-0 flex items-center gap-0.5">
                                  <ShieldCheck className="w-2.5 h-2.5" />
                                  管理员
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
                              工号: {u.job_number || '-'} · 钉钉ID: {u.dingtalk_userid || '-'}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 部门与职位展示 */}
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 px-2.5 py-1.5 rounded-lg">
                        <Building2 className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
                        <span className="truncate">{u.department_name || '未设部门'}</span>
                      </div>

                      {/* 底部便捷开关操作条 */}
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-dashed">
                        <button
                          type="button"
                          onClick={() => handleToggleAccess(u)}
                          disabled={isSelf && u.is_active}
                          className={`h-8 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all active:scale-98 ${
                            u.is_active
                              ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 hover:bg-emerald-500/20'
                              : 'bg-muted text-muted-foreground border hover:bg-muted/80'
                          } ${isSelf && u.is_active ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                          title={isSelf && u.is_active ? '不可关闭自己的使用权限' : '点击切换员工使用权限'}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              u.is_active ? 'bg-emerald-500' : 'bg-muted-foreground'
                            }`}
                          />
                          <span>{u.is_active ? '已开通权限' : '未开通使用'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleAdmin(u)}
                          disabled={isSelf && u.is_admin}
                          className={`h-8 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all active:scale-98 ${
                            u.is_admin
                              ? 'bg-primary/15 text-primary border border-primary/20 hover:bg-primary/25'
                              : 'bg-muted text-muted-foreground border hover:bg-muted/80'
                          } ${isSelf && u.is_admin ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                          title={isSelf && u.is_admin ? '不可撤销自己的管理员角色' : '点击设置/撤销管理员'}
                        >
                          {u.is_admin ? (
                            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                          ) : (
                            <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                          <span>{u.is_admin ? '系统管理员' : '设为管理员'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 桌面端标准表格视图 (屏幕宽度 >= 640px) */}
              <div className="hidden sm:block border rounded-xl overflow-x-auto bg-background">
                <table className="w-full text-left text-xs min-w-[560px]">
                  <thead className="bg-muted/40 border-b text-muted-foreground font-medium">
                    <tr>
                      <th className="py-2.5 px-3.5">员工姓名</th>
                      <th className="py-2.5 px-3.5">工号 / 账号</th>
                      <th className="py-2.5 px-3.5">部门 / 职位</th>
                      <th className="py-2.5 px-3.5 text-center">系统使用权限</th>
                      <th className="py-2.5 px-3.5 text-center">管理员身份</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredUsers.map((u) => {
                      const isSelf = u.id === currentUser?.id;
                      return (
                        <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                          {/* 姓名与头像 */}
                          <td className="py-2.5 px-3.5">
                            <div className="flex items-center gap-2.5">
                              {u.avatar ? (
                                <img
                                  src={u.avatar}
                                  alt={u.display_name || u.username}
                                  className="w-7 h-7 rounded-full object-cover border"
                                />
                              ) : (
                                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                                  {(u.display_name || u.username || '员').slice(0, 1)}
                                </div>
                              )}
                              <div>
                                <div className="font-medium text-foreground flex items-center gap-1.5">
                                  <span>{u.display_name || u.username}</span>
                                  {isSelf && (
                                    <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.2 rounded font-normal">
                                      当前账号
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground/80 font-mono">
                                  {u.dingtalk_userid || '-'}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* 工号 */}
                          <td className="py-2.5 px-3.5 font-mono text-muted-foreground">
                            {u.job_number || '-'}
                          </td>

                          {/* 部门 */}
                          <td className="py-2.5 px-3.5 text-muted-foreground">
                            <div className="flex items-center gap-1 max-w-[180px] truncate" title={u.department_name || '未设部门'}>
                              <Building2 className="w-3 h-3 text-muted-foreground/70 shrink-0" />
                              <span className="truncate">{u.department_name || '未设部门'}</span>
                            </div>
                          </td>

                          {/* 系统使用权限切换开关 */}
                          <td className="py-2.5 px-3.5 text-center">
                            <button
                              onClick={() => handleToggleAccess(u)}
                              disabled={isSelf && u.is_active}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                                u.is_active
                                  ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
                              } ${isSelf && u.is_active ? 'opacity-60 cursor-not-allowed' : ''}`}
                              title={isSelf && u.is_active ? '不可关闭自己的使用权限' : '点击切换员工使用权限'}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  u.is_active ? 'bg-emerald-500' : 'bg-muted-foreground'
                                }`}
                              />
                              <span>{u.is_active ? '已开通' : '未开通 (禁止使用)'}</span>
                            </button>
                          </td>

                          {/* 管理员角色切换开关 */}
                          <td className="py-2.5 px-3.5 text-center">
                            <button
                              onClick={() => handleToggleAdmin(u)}
                              disabled={isSelf && u.is_admin}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                                u.is_admin
                                  ? 'bg-primary/15 text-primary hover:bg-primary/25'
                                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
                              } ${isSelf && u.is_admin ? 'opacity-60 cursor-not-allowed' : ''}`}
                              title={isSelf && u.is_admin ? '不可撤销自己的管理员角色' : '点击设置/撤销管理员'}
                            >
                              {u.is_admin ? (
                                <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                              ) : (
                                <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                              )}
                              <span>{u.is_admin ? '系统管理员' : '普通员工'}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
