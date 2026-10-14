import React, { useState, useEffect } from 'react';
import { api, MailAccount } from '../lib/api';
import { X, Plus, Trash2, RefreshCw, CheckCircle2, AlertCircle, ShieldCheck, Lightbulb, Loader2, Pencil, Check } from 'lucide-react';
import { MailProviderLogo } from './MailProviderLogo';
import { toast } from './ui/Toast';
import { AlertDialog } from './ui/AlertDialog';
import { formatSyncTime } from '../lib/utils';

interface AccountDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAccountUpdated: () => void;
}

export const AccountDialog: React.FC<AccountDialogProps> = ({
  isOpen,
  onClose,
  onAccountUpdated,
}) => {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [presets, setPresets] = useState<Record<string, any>>({});
  const [selectedPreset, setSelectedPreset] = useState('aliyun_enterprise');

  // 别名编辑状态
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [savingName, setSavingName] = useState(false);

  // 表单状态
  const [name, setName] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState(993);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(465);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [syncingAccountIds, setSyncingAccountIds] = useState<Set<number>>(new Set());

  const loadData = async () => {
    try {
      const [accs, pres] = await Promise.all([
        api.accounts.list(),
        api.accounts.getPresets(),
      ]);
      setAccounts(accs);
      setPresets(pres);

      // 应用默认预设
      if (pres['aliyun_enterprise']) {
        applyPreset('aliyun_enterprise', pres['aliyun_enterprise']);
      }
    } catch (e: any) {
      console.error(e);
    }
  };

  const handleStartEdit = (acc: MailAccount) => {
    setEditingAccountId(acc.id);
    setEditingName(acc.name || acc.email_address);
  };

  const handleCancelEdit = () => {
    setEditingAccountId(null);
    setEditingName('');
  };

  const handleSaveName = async (accId: number) => {
    if (savingName) return;
    const trimmed = editingName.trim();
    setSavingName(true);
    try {
      await api.accounts.updateName(accId, trimmed);
      toast.success('邮箱显示别名已更新');
      setAccounts((prev) =>
        prev.map((a) => (a.id === accId ? { ...a, name: trimmed || a.email_address } : a))
      );
      setEditingAccountId(null);
      onAccountUpdated();
    } catch (err: any) {
      toast.error(err.message || '更新别名失败');
    } finally {
      setSavingName(false);
    }
  };

  const [mounted, setMounted] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      loadData();
      handleCancelEdit();
      setTestResult(null);
      setError('');
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

  const applyPreset = (key: string, data: any) => {
    setSelectedPreset(key);
    setImapHost(data.imap_host || '');
    setImapPort(data.imap_port || 993);
    setSmtpHost(data.smtp_host || '');
    setSmtpPort(data.smtp_port || 465);
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!emailAddress || !password || !imapHost || !smtpHost) {
      setError('请先填写完整邮箱、授权码及服务器地址');
      return;
    }
    setError('');
    setTesting(true);
    setTestResult(null);

    try {
      const res = await api.accounts.test({
        email_address: emailAddress,
        password,
        imap_host: imapHost,
        imap_port: Number(imapPort),
        imap_ssl: true,
        smtp_host: smtpHost,
        smtp_port: Number(smtpPort),
        smtp_ssl: true,
      });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || '测试失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await api.accounts.create({
        provider: selectedPreset,
        name: name.trim() || emailAddress.trim(),
        email_address: emailAddress.trim(),
        password: password.trim(),
        imap_host: imapHost.trim(),
        imap_port: Number(imapPort),
        imap_ssl: true,
        smtp_host: smtpHost.trim(),
        smtp_port: Number(smtpPort),
        smtp_ssl: true,
        is_active: true,
      });

      // 清空表单并重载
      setEmailAddress('');
      setPassword('');
      setName('');
      setTestResult(null);
      await loadData();
      onAccountUpdated();
    } catch (err: any) {
      setError(err.message || '添加邮箱失败');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;
    setDeleting(true);
    try {
      await api.accounts.delete(deleteTargetId);
      await loadData();
      onAccountUpdated();
      toast.success('邮箱已成功解绑');
      setDeleteTargetId(null);
    } catch (err: any) {
      toast.error(err.message || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleSync = async (id: number) => {
    if (syncingAccountIds.has(id)) return;
    setSyncingAccountIds((prev) => new Set(prev).add(id));
    try {
      const res = await api.accounts.sync(id);
      if ((res as any)?.status === 'already_syncing') {
        toast.info((res as any)?.message || '该邮箱当前正在同步中，请稍候...');
      } else {
        toast.success((res as any)?.message || '已触发后台同步，请稍后刷新列表查看新邮件');
      }
      onAccountUpdated();
    } catch (err: any) {
      toast.error(err.message || '同步失败');
    } finally {
      setTimeout(() => {
        setSyncingAccountIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 2500);
    }
  };

  if (!mounted) return null;

  const currentPresetInfo = presets[selectedPreset];

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-black/50 backdrop-blur-xs t-modal-backdrop ${
        animating ? 'is-open' : 'is-closing'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full max-w-2xl bg-card rounded-2xl border shadow-2xl overflow-hidden my-auto flex flex-col max-h-[92vh] sm:max-h-[85vh] t-modal-surface ${
          animating ? 'is-open' : 'is-closing'
        }`}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-sm sm:text-base text-foreground">我的邮箱账户管理</h3>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-5 sm:space-y-6 flex-1 overflow-y-auto stable-scrollbar">
          {/* 已绑定邮箱列表 */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              已接入的邮箱 ({accounts.length})
            </h4>
            {accounts.length === 0 ? (
              <div className="text-center py-6 border border-dashed rounded-lg text-sm text-muted-foreground bg-muted/10">
                暂未接入任何邮箱，请在下方添加您的工作或个人邮箱
              </div>
            ) : (
              <div className="divide-y border rounded-xl overflow-hidden bg-background">
                {accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="p-3 sm:p-3.5 flex flex-col gap-2 hover:bg-muted/20 transition-colors"
                  >
                    {/* 第 1 行：服务商 Logo + 别名名称（带编辑笔）+ 右侧操作按钮 */}
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <MailProviderLogo
                          provider={acc.provider}
                          emailAddress={acc.email_address}
                          imapHost={acc.imap_host}
                          className="w-5 h-5 sm:w-6 sm:h-6 shrink-0 shadow-2xs"
                        />
                        {editingAccountId === acc.id ? (
                          <div className="flex items-center gap-1 py-0.5">
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveName(acc.id);
                                } else if (e.key === 'Escape') {
                                  handleCancelEdit();
                                }
                              }}
                              autoFocus
                              placeholder="输入邮箱别名..."
                              className="text-xs px-2 py-1 rounded border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-32 sm:w-48 shadow-2xs"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveName(acc.id)}
                              disabled={savingName}
                              title="保存别名"
                              className="p-1 rounded text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              disabled={savingName}
                              title="取消"
                              className="p-1 rounded text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 group/name min-w-0">
                            <span
                              onClick={() => handleStartEdit(acc)}
                              title="点击修改别名"
                              className="font-semibold text-sm text-foreground truncate max-w-[170px] sm:max-w-[240px] cursor-pointer hover:text-primary transition-colors"
                            >
                              {acc.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleStartEdit(acc)}
                              title="修改邮箱显示别名"
                              className="p-1 text-muted-foreground hover:text-primary rounded hover:bg-muted/80 transition-all opacity-70 group-hover/name:opacity-100 shrink-0"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* 右侧：立即同步与解绑按钮 */}
                      <div className="flex items-center gap-1 shrink-0">
                        {(() => {
                          const isSyncingThis = syncingAccountIds.has(acc.id);
                          return (
                            <button
                              type="button"
                              disabled={isSyncingThis}
                              title={isSyncingThis ? '正在同步收取中...' : '立即收取该邮箱新邮件'}
                              onClick={() => handleSync(acc.id)}
                              className="p-1.5 text-muted-foreground hover:text-primary hover:bg-muted rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <RefreshCw className={`w-4 h-4 ${isSyncingThis ? 'animate-spin text-primary' : ''}`} />
                            </button>
                          );
                        })()}
                        <button
                          type="button"
                          title="解绑邮箱"
                          onClick={() => setDeleteTargetId(acc.id)}
                          className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* 第 2 行：换行展示邮箱完整地址 Badge */}
                    <div className="flex items-center pl-7 sm:pl-8.5">
                      <span className="text-xs px-2 py-0.5 rounded-md bg-primary/10 text-primary font-mono font-medium truncate max-w-full">
                        {acc.email_address}
                      </span>
                    </div>

                    {/* 第 3 行：换行展示详细服务器参数与最近同步时间 */}
                    <div className="text-[11px] text-muted-foreground pl-7 sm:pl-8.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>IMAP: {acc.imap_host}</span>
                      {acc.last_sync_at && (
                        <span>最近同步: {formatSyncTime(acc.last_sync_at)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 新增邮箱表单 */}
          <div className="border-t pt-5">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              接入新邮箱
            </h4>

            {error && (
              <div className="mb-4 p-3 text-xs text-destructive bg-destructive/10 rounded-lg border border-destructive/20 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form id="account-form" onSubmit={handleAddAccount} className="space-y-4">
              {/* 预设选择器 */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  选择邮箱服务商（自动匹配服务器设置）
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(presets).map(([key, item]: [string, any]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => applyPreset(key, item)}
                      className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border text-left transition-all ${
                        selectedPreset === key
                          ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <MailProviderLogo provider={key} className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.name}</span>
                    </button>
                  ))}
                </div>
                {currentPresetInfo?.tips && (
                  <div className="flex items-start gap-1.5 text-xs text-primary/90 mt-1.5 bg-primary/5 p-2 rounded-md border border-primary/10">
                    <Lightbulb className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    <span>提示：{currentPresetInfo.tips}</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    邮箱账号 / 登录邮箱
                  </label>
                  <input
                    type="email"
                    required
                    value={emailAddress}
                    onChange={(e) => setEmailAddress(e.target.value)}
                    placeholder="例如: employee@company.com"
                    className="w-full px-3 py-2 text-sm bg-background border rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    邮箱授权码 / 客户端专有密码
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="企业邮箱/QQ/网易专有授权码"
                    className="w-full px-3 py-2 text-sm bg-background border rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    邮箱显示别名 (可选)
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如: 业务主邮箱"
                    className="w-full px-3 py-2 text-sm bg-background border rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      IMAP 主机
                    </label>
                    <input
                      type="text"
                      required
                      value={imapHost}
                      onChange={(e) => setImapHost(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs bg-background border rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      SMTP 主机
                    </label>
                    <input
                      type="text"
                      required
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs bg-background border rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>

        {/* 固定底栏 */}
        <div className="shrink-0 px-4 sm:px-6 py-3 border-t bg-muted/20 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pb-safe-offset">
          {/* 左侧：测试连通性按钮与测试结果反馈 */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              disabled={testing || submitting}
              onClick={handleTest}
              className="px-3 py-2 border rounded-lg text-xs font-medium hover:bg-muted text-foreground transition-colors disabled:opacity-50 flex items-center gap-1.5 shrink-0 whitespace-nowrap"
            >
              {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {testing ? '测试中...' : '测试连通性'}
            </button>

            {testResult && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border min-w-0 max-w-[240px] sm:max-w-[320px] ${
                  testResult.success
                    ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20'
                    : 'bg-destructive/10 text-destructive border-destructive/20'
                }`}
                title={testResult.message}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-600 dark:text-green-400" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-destructive" />
                )}
                <span className="truncate">{testResult.message}</span>
              </div>
            )}
          </div>

          {/* 右侧：关闭与提交按钮 */}
          <div className="flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3 sm:px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            >
              完成
            </button>
            <button
              form="account-form"
              type="submit"
              disabled={submitting}
              className="flex-1 sm:flex-initial px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              {submitting ? '正在验证并添加...' : '确认接入邮箱'}
            </button>
          </div>
        </div>
      </div>

      <AlertDialog
        isOpen={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        title="确定解绑此邮箱？"
        description="解绑后将停止自动收取该邮箱的新邮件。已同步到本地的历史邮件将被保留或按规则清理。"
        confirmText="确定解绑"
        cancelText="取消"
        variant="destructive"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
};
