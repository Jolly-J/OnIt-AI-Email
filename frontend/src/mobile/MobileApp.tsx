import React, { useState, useEffect, useCallback } from 'react';
import { api, User, MailAccount, EmailListItem, EmailDetail } from '@/lib/api';
import { FolderType, FolderCounts } from '@/components/MailSidebar';
import { useResponsive } from '@/lib/useResponsive';
import { MobileMailHeader } from './MobileMailHeader';
import { MobileFolderSheet } from './MobileFolderSheet';
import { MobileMailList } from './MobileMailList';
import { MobileMailDetail } from './MobileMailDetail';
import { MobileAICopilotDrawer } from './MobileAICopilotDrawer';
import { MobileComposeSheet } from './MobileComposeSheet';
import { QuoteEmailInfo } from '@/components/ComposeDialog';
import { AccountDialog } from '@/components/AccountDialog';
import { AdminDialog } from '@/components/AdminDialog';
import { AuthModal } from '@/components/AuthModal';
import { Toaster, toast } from '@/components/ui/Toast';

interface MobileAppProps {
  initialUser?: User | null;
}

export const MobileApp: React.FC<MobileAppProps> = () => {
  const { isTablet, isFoldable } = useResponsive();

  // 认证状态
  const hasLocalToken = typeof window !== 'undefined' && !!localStorage.getItem('email_agent_token');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authRequired, setAuthRequired] = useState<boolean>(!hasLocalToken);

  // 账号与文件夹
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [currentFolder, setCurrentFolder] = useState<FolderType>('inbox');
  const [inboxFilter, setInboxFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [folderCounts, setFolderCounts] = useState<FolderCounts>({
    inboxTotal: 0,
    inboxUnread: 0,
    inboxRead: 0,
    sentTotal: 0,
    draftsTotal: 0,
    trashTotal: 0,
    repliedTotal: 0,
    archivedTotal: 0,
  });

  // 邮件列表与当前选中邮件（支持从钉钉 AppLink ?emailId=xxx 深链直达）
  const getInitialEmailId = (): number | null => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const targetIdStr = params.get('emailId');
    if (targetIdStr) {
      const parsed = Number(targetIdStr);
      return !isNaN(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
  };
  const [selectedEmailId, setSelectedEmailId] = useState<number | null>(getInitialEmailId);
  const [emails, setEmails] = useState<EmailListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [currentEmailDetail, setCurrentEmailDetail] = useState<EmailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [newArrivalIds, setNewArrivalIds] = useState<Set<number>>(new Set());

  // 抽屉与浮层状态
  const [isFolderSheetOpen, setIsFolderSheetOpen] = useState(false);
  const [isAICopilotOpen, setIsAICopilotOpen] = useState(false);
  const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false);
  const [isAdminDialogOpen, setIsAdminDialogOpen] = useState(false);

  // 单栏手机推栈状态：'list' 列表 | 'detail' 邮件详情
  const [mobileViewMode, setMobileViewMode] = useState<'list' | 'detail'>(
    getInitialEmailId() ? 'detail' : 'list'
  );

  // 移动端写信 / 回复
  const [composeConfig, setComposeConfig] = useState<{
    isOpen: boolean;
    mode: 'compose' | 'reply';
    initialTo?: string;
    initialSubject?: string;
    initialBody?: string;
    inReplyToEmailId?: number;
    quoteEmail?: QuoteEmailInfo | null;
  }>({
    isOpen: false,
    mode: 'compose',
  });

  // 1. 初始化登录身份检查
  useEffect(() => {
    if (!hasLocalToken) {
      setAuthRequired(true);
      return;
    }
    api.auth
      .getMe()
      .then((user: User) => {
        setCurrentUser(user);
        setAuthRequired(false);
      })
      .catch(() => {
        localStorage.removeItem('email_agent_token');
        setAuthRequired(true);
      });
  }, [hasLocalToken]);

  // 2. 加载邮箱账号
  const loadAccounts = useCallback(async () => {
    try {
      const data = await api.accounts.list();
      setAccounts(data);
    } catch {
      // 忽略
    }
  }, []);

  // 3. 加载文件夹计数
  const loadCounts = useCallback(async () => {
    try {
      const data = await api.emails.getCounts(selectedAccountId || undefined);
      setFolderCounts({
        inboxTotal: data.inbox_total,
        inboxUnread: data.inbox_unread,
        inboxRead: data.inbox_read,
        sentTotal: data.sent_total,
        draftsTotal: data.drafts_total,
        trashTotal: data.trash_total,
        repliedTotal: data.replied_total,
        archivedTotal: data.archived_total,
      });
    } catch {
      // 忽略
    }
  }, [selectedAccountId]);

  // 4. 加载邮件列表
  const loadEmails = useCallback(async () => {
    setListLoading(true);
    try {
      const data = await api.emails.list({
        account_id: selectedAccountId || undefined,
        folder: currentFolder === 'replied' || currentFolder === 'archived' ? undefined : currentFolder,
        status: currentFolder === 'replied' ? 'replied' : currentFolder === 'archived' ? 'archived' : undefined,
        read_filter: currentFolder === 'inbox' && inboxFilter !== 'all' ? inboxFilter : undefined,
        q: searchQuery || undefined,
        limit: 50,
      });
      setEmails(data.items);
    } catch (err: any) {
      toast.error(err.message || '加载邮件失败');
    } finally {
      setListLoading(false);
    }
  }, [selectedAccountId, currentFolder, inboxFilter, searchQuery]);

  // 用户登录后拉取核心数据
  useEffect(() => {
    if (currentUser) {
      loadAccounts();
      loadCounts();
      loadEmails();
    }
  }, [currentUser, loadAccounts, loadCounts, loadEmails]);

  // 加载选中邮件详情
  useEffect(() => {
    if (!selectedEmailId) {
      setCurrentEmailDetail(null);
      return;
    }
    let isCancelled = false;
    setCurrentEmailDetail(null);
    setDetailLoading(true);

    api.emails
      .getDetail(selectedEmailId)
      .then((detail) => {
        if (!isCancelled) {
          setCurrentEmailDetail(detail);
          // 如果未读，更新本地已读状态
          setEmails((prev) =>
            prev.map((item) => (item.id === selectedEmailId ? { ...item, is_read: true } : item))
          );
          loadCounts();
        }
      })
      .catch((err: any) => {
        if (!isCancelled) toast.error(err.message || '加载详情失败');
      })
      .finally(() => {
        if (!isCancelled) setDetailLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [selectedEmailId, loadCounts]);

  // SSE 实时推送到信监听
  useEffect(() => {
    if (!currentUser) return;
    const token = localStorage.getItem('email_agent_token');
    const url = `/api/emails/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const es = new EventSource(url);

    es.addEventListener('new_email', (event: any) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.id) {
          setNewArrivalIds((prev) => new Set(prev).add(payload.id));
        }
        loadEmails();
        loadCounts();
      } catch {
        // 忽略
      }
    });

    es.addEventListener('email_analyzed', (event: any) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.email_id && payload.email_id === selectedEmailId) {
          api.emails.getDetail(payload.email_id).then(setCurrentEmailDetail);
        }
        loadEmails();
      } catch {
        // 忽略
      }
    });

    es.addEventListener('counts_updated', () => {
      loadCounts();
    });

    return () => {
      es.close();
    };
  }, [currentUser, selectedEmailId, loadEmails, loadCounts]);

  // 点击选择邮件
  const handleSelectEmail = (id: number) => {
    setSelectedEmailId(id);
    setMobileViewMode('detail');
  };

  // 手动全量同步
  const handleSyncAll = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await api.emails.syncAll();
      if ((res as any)?.status === 'already_syncing') {
        toast.info((res as any)?.message || '当前所有邮箱已在同步中，请稍候查看最新邮件！');
      } else {
        toast.success('已触发全量邮箱同步');
      }
      loadEmails();
      loadCounts();
    } catch (err: any) {
      toast.error(err.message || '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  // 拉取更早历史邮件
  const handleLoadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.emails.loadMore({
        account_id: selectedAccountId || undefined,
        folder: currentFolder === 'replied' || currentFolder === 'archived' ? undefined : currentFolder,
        limit: 50,
      });
      if (res && res.loaded_count > 0) {
        loadEmails();
        toast.success(`已拉取 ${res.loaded_count} 封历史邮件`);
      } else {
        setHasMoreHistory(false);
        toast.info('已到达更早历史邮件边界');
      }
    } catch {
      toast.error('拉取历史失败');
    } finally {
      setLoadingMore(false);
    }
  };

  // 标记已读/未读
  const handleToggleRead = async (id: number) => {
    if (!currentEmailDetail) return;
    try {
      const res = await api.emails.toggleRead(id);
      setCurrentEmailDetail((prev) => (prev ? { ...prev, is_read: res.is_read } : null));
      setEmails((prev) =>
        prev.map((item) => (item.id === id ? { ...item, is_read: res.is_read } : item))
      );
      loadCounts();
      toast.success(res.is_read ? '已标为已读' : '已标为未读');
    } catch {
      toast.error('操作失败');
    }
  };

  // 归档
  const handleArchive = async (id: number) => {
    try {
      await api.emails.archive(id);
      toast.success('邮件已归档');
      setSelectedEmailId(null);
      setMobileViewMode('list');
      loadEmails();
      loadCounts();
    } catch {
      toast.error('归档失败');
    }
  };

  // 打开移动端高级回复
  const handleOpenReply = (draftText = '') => {
    if (!currentEmailDetail) return;
    let cleanSender = currentEmailDetail.sender;
    if (cleanSender.includes('<') && cleanSender.includes('>')) {
      cleanSender = cleanSender.split('<')[1].split('>')[0].trim();
    }
    const origSub = currentEmailDetail.subject || '';
    const replySub = origSub.toLowerCase().startsWith('re:') ? origSub : `Re: ${origSub}`;

    setComposeConfig({
      isOpen: true,
      mode: 'reply',
      initialTo: cleanSender,
      initialSubject: replySub,
      initialBody: draftText,
      inReplyToEmailId: currentEmailDetail.id,
      quoteEmail: {
        sender: currentEmailDetail.sender,
        sent_date: currentEmailDetail.sent_date,
        to_recipients: currentEmailDetail.to_recipients,
        subject: currentEmailDetail.subject,
        body_text: currentEmailDetail.body_text,
      },
    });
  };

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  // 是否渲染 iPad / 折叠屏展开态双栏模式（>=768px 或 折叠屏展开态）
  const isSplitLayout = isTablet || isFoldable;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground font-sans no-overscroll">
      {/* 登录弹窗 */}
      {authRequired && (
        <AuthModal
          onSuccess={(user: User) => {
            setCurrentUser(user);
            setAuthRequired(false);
          }}
        />
      )}

      {currentUser && (
        <>
          {/* 左侧滑出：移动端文件夹与多账号抽屉（shadcn Sheet） */}
          <MobileFolderSheet
            isOpen={isFolderSheetOpen}
            onOpenChange={setIsFolderSheetOpen}
            accounts={accounts}
            selectedAccountId={selectedAccountId}
            onSelectAccount={(accId: number | null) => setSelectedAccountId(accId)}
            currentFolder={currentFolder}
            onSelectFolder={(folder: FolderType) => {
              setCurrentFolder(folder);
              setMobileViewMode('list');
            }}
            inboxFilter={inboxFilter}
            onSelectInboxFilter={(filter: 'all' | 'unread' | 'read') => {
              setInboxFilter(filter);
              setMobileViewMode('list');
            }}
            counts={folderCounts}
            onOpenAccounts={() => setIsAccountDialogOpen(true)}
            onOpenAdmin={() => setIsAdminDialogOpen(true)}
            currentUser={currentUser}
            onLogout={() => {
              localStorage.removeItem('email_agent_token');
              setCurrentUser(null);
              setAuthRequired(true);
            }}
          />

          {/* 布局分流：如果是 iPad / 折叠屏展开态（双栏 Split-View） */}
          {isSplitLayout ? (
            <div className="flex-1 flex h-full overflow-hidden">
              {/* 左栏：邮件列表（在折叠屏展开态占 300px，在平板占 340px，为右侧详情留足空间） */}
              <div className="w-[300px] md:w-[340px] border-r flex flex-col h-full bg-background shrink-0">
                <MobileMailHeader
                  currentFolder={currentFolder}
                  selectedAccount={selectedAccount}
                  onOpenDrawer={() => setIsFolderSheetOpen(true)}
                  onOpenCompose={() => setComposeConfig({ isOpen: true, mode: 'compose' })}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onSync={handleSyncAll}
                  syncing={syncing}
                />
                <MobileMailList
                  emails={emails}
                  selectedEmailId={selectedEmailId}
                  onSelectEmail={(id: number) => setSelectedEmailId(id)}
                  currentFolder={currentFolder}
                  loading={listLoading}
                  onSyncAll={handleSyncAll}
                  syncing={syncing}
                  onLoadMore={handleLoadMore}
                  loadingMore={loadingMore}
                  hasMoreHistory={hasMoreHistory}
                  newArrivalIds={newArrivalIds}
                />
              </div>

              {/* 右栏：沉浸式邮件详情 */}
              <div className="flex-1 flex h-full overflow-hidden bg-background">
                {currentEmailDetail ? (
                  <MobileMailDetail
                    email={currentEmailDetail}
                    loading={detailLoading}
                    onBack={() => setSelectedEmailId(null)}
                    onOpenAICopilot={() => setIsAICopilotOpen(true)}
                    onOpenReply={() => handleOpenReply()}
                    onToggleRead={handleToggleRead}
                    onArchive={handleArchive}
                  />
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-muted-foreground text-xs select-none">
                    <span>请选择左侧列表中的一封邮件开始阅读</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* 直板机 / 单栏模式（<768px）：页面栈切换（列表 ⇋ 详情，丝滑推栈转场） */
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
              {mobileViewMode === 'list' ? (
                <div key="list-view" className="flex-1 flex flex-col h-full overflow-hidden mobile-pop-in">
                  <MobileMailHeader
                    currentFolder={currentFolder}
                    selectedAccount={selectedAccount}
                    onOpenDrawer={() => setIsFolderSheetOpen(true)}
                    onOpenCompose={() => setComposeConfig({ isOpen: true, mode: 'compose' })}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onSync={handleSyncAll}
                    syncing={syncing}
                  />
                  <MobileMailList
                    emails={emails}
                    selectedEmailId={selectedEmailId}
                    onSelectEmail={handleSelectEmail}
                    currentFolder={currentFolder}
                    loading={listLoading}
                    onSyncAll={handleSyncAll}
                    syncing={syncing}
                    onLoadMore={handleLoadMore}
                    loadingMore={loadingMore}
                    hasMoreHistory={hasMoreHistory}
                    newArrivalIds={newArrivalIds}
                  />
                </div>
              ) : (
                <div key="detail-view" className="flex-1 flex flex-col h-full overflow-hidden mobile-push-in">
                  <MobileMailDetail
                    email={currentEmailDetail}
                    loading={detailLoading}
                    onBack={() => setMobileViewMode('list')}
                    onOpenAICopilot={() => setIsAICopilotOpen(true)}
                    onOpenReply={() => handleOpenReply()}
                    onToggleRead={handleToggleRead}
                    onArchive={handleArchive}
                  />
                </div>
              )}
            </div>
          )}

          {/* 移动端 AI 伴随核心手势抽屉（基于 shadcn Drawer 多档位吸附） */}
          <MobileAICopilotDrawer
            isOpen={isAICopilotOpen}
            onOpenChange={setIsAICopilotOpen}
            email={currentEmailDetail}
            onOpenAdvancedReply={(draftText: string) => handleOpenReply(draftText)}
            onEmailUpdated={() => {
              loadEmails();
              if (selectedEmailId) {
                api.emails.getDetail(selectedEmailId).then(setCurrentEmailDetail);
              }
            }}
          />

          {/* 移动端全屏写信与回复抽屉（基于 shadcn Sheet） */}
          <MobileComposeSheet
            isOpen={composeConfig.isOpen}
            onClose={() => setComposeConfig((prev) => ({ ...prev, isOpen: false }))}
            accounts={accounts}
            defaultAccountId={selectedAccountId}
            mode={composeConfig.mode}
            initialTo={composeConfig.initialTo}
            initialSubject={composeConfig.initialSubject}
            initialBody={composeConfig.initialBody}
            inReplyToEmailId={composeConfig.inReplyToEmailId}
            quoteEmail={composeConfig.quoteEmail}
            onSent={() => {
              loadEmails();
              if (selectedEmailId) {
                api.emails.getDetail(selectedEmailId).then(setCurrentEmailDetail);
              }
            }}
          />

          {/* 管理邮箱弹窗 */}
          <AccountDialog
            isOpen={isAccountDialogOpen}
            onClose={() => setIsAccountDialogOpen(false)}
            onAccountUpdated={() => {
              loadAccounts();
              loadEmails();
            }}
          />

          {/* 权限管理弹窗 */}
          <AdminDialog
            isOpen={isAdminDialogOpen}
            onClose={() => setIsAdminDialogOpen(false)}
            currentUser={currentUser}
          />
        </>
      )}

      <Toaster />
    </div>
  );
};

export default MobileApp;
