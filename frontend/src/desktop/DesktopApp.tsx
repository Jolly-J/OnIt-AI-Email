import { useState, useEffect, useCallback, useRef } from 'react';
import { api, User, MailAccount, EmailListItem, EmailDetail } from '@/lib/api';
import { MailSidebar, FolderCounts, FolderType } from '@/components/MailSidebar';
import { MailList } from '@/components/MailList';
import { MailDetail as MailDetailView } from '@/components/MailDetail';
import { AICopilot } from '@/components/AICopilot';
import { ComposeCopilot } from '@/components/ComposeCopilot';
import { AccountDialog } from '@/components/AccountDialog';
import { ComposeDialog, QuoteEmailInfo } from '@/components/ComposeDialog';
import { AuthModal } from '@/components/AuthModal';
import { AdminDialog } from '@/components/AdminDialog';
import { Toaster, toast } from '@/components/ui/Toast';

export function DesktopApp() {
  // 预判本地是否已持有身份令牌
  const hasLocalToken = typeof window !== 'undefined' && !!localStorage.getItem('email_agent_token');
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(hasLocalToken);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authRequired, setAuthRequired] = useState<boolean>(!hasLocalToken);
  // 仓储大门卷帘升起动效状态（本地已有 token 时默认卸载大门，彻底杜绝刷新闪烁）
  const [doorOpening, setDoorOpening] = useState(false);
  const [doorUnmounted, setDoorUnmounted] = useState<boolean>(hasLocalToken);

  // 邮箱账号状态
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  // 文件夹与邮件过滤
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

  // 邮件列表与当前选中邮件（支持从钉钉 AppLink ?emailId=xxx 链接直接高亮定位）
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
  const selectedEmailIdRef = useRef<number | null>(selectedEmailId);
  useEffect(() => {
    selectedEmailIdRef.current = selectedEmailId;
  }, [selectedEmailId]);

  const [activeReplyDraft, setActiveReplyDraft] = useState<string>('');

  // 同步选定邮件并即时对齐 Ref，杜绝异步调度时隙
  const handleSelectEmail = useCallback((id: number | null) => {
    selectedEmailIdRef.current = id;
    setSelectedEmailId(id);
    setActiveReplyDraft('');
  }, []);

  // 邮件列表与生命周期管理
  const [emails, setEmails] = useState<EmailListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const [currentEmailDetail, setCurrentEmailDetail] = useState<EmailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const listLimitRef = useRef(50);

  // 实时推送到信的新邮件集合（用于触发列表平滑下推与高光动效）
  const [newArrivalIds, setNewArrivalIds] = useState<Set<number>>(new Set());

  // 弹窗状态
  const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false);
  const [composeConfig, setComposeConfig] = useState<{
    isOpen: boolean;
    mode: 'compose' | 'reply';
    initialTo?: string;
    initialSubject?: string;
    initialBody?: string;
    inReplyToEmailId?: number;
    accountId?: number | null;
    quoteEmail?: QuoteEmailInfo | null;
  }>({
    isOpen: false,
    mode: 'compose',
  });
  const [composeToEmail, setComposeToEmail] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [isAdminDialogOpen, setIsAdminDialogOpen] = useState(false);

  // 彻底重置所有与业务数据相关的状态（用于登出与切换账号）
  const resetAllState = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setAccounts([]);
    setSelectedAccountId(null);
    setCurrentFolder('inbox');
    setInboxFilter('all');
    setSearchQuery('');
    setFolderCounts({
      inboxTotal: 0,
      inboxUnread: 0,
      inboxRead: 0,
      sentTotal: 0,
      draftsTotal: 0,
      trashTotal: 0,
      repliedTotal: 0,
      archivedTotal: 0,
    });
    setEmails([]);
    handleSelectEmail(null);
    setCurrentEmailDetail(null);
    setNewArrivalIds(new Set());
    setListLoading(false);
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setHasMoreHistory(true);
    listLimitRef.current = 50;
  }, [handleSelectEmail]);

  // 检查登录态
  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem('email_agent_token');
    if (!token) {
      setIsAuthChecking(false);
      setAuthRequired(true);
      setDoorOpening(false);
      setDoorUnmounted(false);
      return;
    }
    try {
      const user = await api.auth.getMe();
      setCurrentUser(user);
      setAuthRequired(false);
      setDoorUnmounted(true);
    } catch {
      localStorage.removeItem('email_agent_token');
      setCurrentUser(null);
      setAuthRequired(true);
      setDoorOpening(false);
      setDoorUnmounted(false);
    } finally {
      setIsAuthChecking(false);
    }
  }, []);

  useEffect(() => {
    localStorage.removeItem('sidebar_collapsed');
    checkAuth();
    const handleUnauthorized = () => {
      resetAllState();
      setCurrentUser(null);
      setDoorOpening(false);
      setDoorUnmounted(false);
      setAuthRequired(true);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, [checkAuth, resetAllState]);

  // 加载账号列表
  const loadAccounts = useCallback(async () => {
    if (!currentUser) return;
    try {
      const accs = await api.accounts.list();
      setAccounts(accs);
    } catch (e) {
      console.error(e);
    }
  }, [currentUser]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // 加载各分类与文件夹邮件数量统计
  const loadCounts = useCallback(async () => {
    if (!currentUser) return;
    try {
      const res = await api.emails.getCounts(selectedAccountId);
      setFolderCounts({
        inboxTotal: res.inbox_total,
        inboxUnread: res.inbox_unread,
        inboxRead: res.inbox_read,
        sentTotal: res.sent_total,
        draftsTotal: res.drafts_total,
        trashTotal: res.trash_total,
        repliedTotal: res.replied_total,
        archivedTotal: res.archived_total,
      });
    } catch (e) {
      console.error(e);
    }
  }, [currentUser, selectedAccountId]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  // 加载邮件列表（支持物理取消旧请求、时序版本比对、优雅选中对齐与加载阻尼）
  const loadEmails = useCallback(async (customLimit?: number) => {
    if (!currentUser) return;

    // 1. 物理中断前一次未完成的请求，杜绝旧响应覆盖新视图
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const currentRequestId = ++requestIdRef.current;

    setListLoading(true);
    try {
      const isRealFolder = ['inbox', 'sent', 'drafts', 'trash'].includes(currentFolder);
      const limitToUse = customLimit ?? listLimitRef.current;
      const res = await api.emails.list(
        {
          account_id: selectedAccountId,
          folder: isRealFolder ? currentFolder : undefined,
          status: !isRealFolder ? currentFolder : undefined,
          read_filter: currentFolder === 'inbox' ? inboxFilter : undefined,
          q: searchQuery,
          limit: limitToUse,
        },
        controller.signal
      );

      // 若在此期间有更新的请求发出，丢弃滞后响应
      if (currentRequestId !== requestIdRef.current) return;

      setEmails(res.items);
      loadCounts();

      // 2. 选中项严密对齐：若当前选中的邮件存在于新列表中则保留，否则对齐至首封或置空
      const currentSelected = selectedEmailIdRef.current;
      const hasCurrentSelected = res.items.some((it) => it.id === currentSelected);

      if (res.items.length > 0) {
        if (!currentSelected || !hasCurrentSelected) {
          handleSelectEmail(res.items[0].id);
        }
      } else {
        handleSelectEmail(null);
        setCurrentEmailDetail(null);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        // 请求被后续操作主动取消，静默返回
        return;
      }
      console.error(e);
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setListLoading(false);
      }
    }
  }, [currentUser, selectedAccountId, currentFolder, inboxFilter, searchQuery, loadCounts, handleSelectEmail]);

  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  // 当选中的邮件变更时，加载邮件详情
  useEffect(() => {
    if (!selectedEmailId) {
      setCurrentEmailDetail(null);
      return;
    }
    const loadDetail = async () => {
      setDetailLoading(true);
      try {
        const detail = await api.emails.getDetail(selectedEmailId);
        setCurrentEmailDetail(detail);
        // 更新列表中该邮件的未读状态为已读
        setEmails((prev) =>
          prev.map((item) =>
            item.id === selectedEmailId ? { ...item, is_read: true } : item
          )
        );
        loadCounts();
      } catch (e) {
        console.error(e);
      } finally {
        setDetailLoading(false);
      }
    };
    loadDetail();
  }, [selectedEmailId, loadCounts]);

  // 智能静默轮询：如果当前选中的邮件 AI 尚未分析完毕（summary_zh 为空），定时向后端核对最新分析状态
  useEffect(() => {
    if (!selectedEmailId || !currentEmailDetail || currentEmailDetail.summary_zh) {
      return;
    }

    let pollCount = 0;
    const maxPolls = 8; // 最多轮询 8 次（约 20 秒）
    const timer = setInterval(async () => {
      pollCount++;
      try {
        const latest = await api.emails.getDetail(selectedEmailId);
        if (latest.summary_zh) {
          setCurrentEmailDetail(latest);
          // 同步更新列表中该邮件的精简摘要
          setEmails((prev) =>
            prev.map((item) =>
              item.id === selectedEmailId
                ? { ...item, summary_zh: latest.summary_zh }
                : item
            )
          );
          clearInterval(timer);
        } else if (pollCount >= maxPolls) {
          clearInterval(timer);
        }
      } catch (err) {
        console.error(err);
        clearInterval(timer);
      }
    }, 2500);

    return () => clearInterval(timer);
  }, [selectedEmailId, currentEmailDetail?.id, currentEmailDetail?.summary_zh]);

  // SSE 实时推流监听：秒级捕获后台抓到的新邮件与 AI 要点更新
  useEffect(() => {
    if (!currentUser) return;
    const token = localStorage.getItem('email_agent_token');
    if (!token) return;

    const eventSource = new EventSource(`/api/emails/events?token=${encodeURIComponent(token)}`);

    eventSource.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.event === 'new_email') {
          const newEmail: EmailListItem = payload.data;

          // 仅在符合当前选择账号且处于收件箱（全部或未读）时才直接推入视图顶部
          const matchesAccount = !selectedAccountId || newEmail.account_id === selectedAccountId;
          const matchesFolder = currentFolder === 'inbox';
          const matchesFilter = inboxFilter === 'all' || inboxFilter === 'unread';

          if (matchesAccount && matchesFolder && matchesFilter) {
            setEmails((prev) => {
              if (prev.some((item) => item.id === newEmail.id)) return prev;
              return [newEmail, ...prev];
            });

            // 触发入场动效：平滑下推与浅蓝高光
            setNewArrivalIds((prev) => new Set(prev).add(newEmail.id));
            setTimeout(() => {
              setNewArrivalIds((prev) => {
                const next = new Set(prev);
                next.delete(newEmail.id);
                return next;
              });
            }, 4000);
          }

          loadCounts();
        } else if (payload.event === 'email_analyzed') {
          const { id, summary_zh, key_points, action_items, ai_guided_question } = payload.data;
          setEmails((prev) =>
            prev.map((item) =>
              item.id === id
                ? { ...item, summary_zh, key_points, ai_guided_question }
                : item
            )
          );
          setCurrentEmailDetail((prev) =>
            prev && prev.id === id
              ? {
                  ...prev,
                  summary_zh,
                  key_points,
                  action_items: action_items ?? prev.action_items,
                  ai_guided_question,
                }
              : prev
          );
        } else if (payload.event === 'counts_updated') {
          loadCounts();
        }
      } catch (err) {
        console.error('[SSE] 消息解析异常:', err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [currentUser, selectedAccountId, currentFolder, inboxFilter, loadCounts]);

  // 当切换文件夹或特定邮箱时，重置历史邮件加载状态与显示容量
  useEffect(() => {
    setHasMoreHistory(true);
    listLimitRef.current = 50;
  }, [currentFolder, selectedAccountId]);

  // 手动同步所有邮箱
  const handleSyncAll = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await api.emails.syncAll();
      if ((res as any)?.status === 'already_syncing') {
        toast.info((res as any)?.message || '当前所有邮箱已在同步中，请稍候查看最新邮件！');
      } else {
        toast.success((res as any)?.message || '已触发邮箱收取任务！');
      }
      setTimeout(async () => {
        await loadEmails();
        loadCounts();
        setSyncing(false);
      }, 3000);
    } catch (e: any) {
      toast.error(e?.message || '收取新邮件失败');
      setSyncing(false);
    }
  };

  // 向后拉取更早的历史邮件
  const handleLoadMore = async () => {
    if (loadingMoreRef.current || loadingMore || !currentUser) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const startTime = Date.now();
    try {
      const isRealFolder = ['inbox', 'sent', 'drafts', 'trash'].includes(currentFolder);
      const targetFolder = isRealFolder ? currentFolder : 'inbox';
      const res = await api.emails.loadMore({
        account_id: selectedAccountId,
        folder: targetFolder,
        limit: 20,
      });

      setHasMoreHistory(res.has_more);
      if (res.loaded_count > 0) {
        toast.success(res.message || `成功加载 ${res.loaded_count} 封历史邮件`);
        const nextLimit = listLimitRef.current + res.loaded_count;
        listLimitRef.current = nextLimit;
        await loadEmails(nextLimit);
        loadCounts();
      } else {
        toast.info(res.message || '没有更早的历史邮件了');
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || '加载历史邮件失败，请稍后重试');
    } finally {
      // 视觉阻尼：确保“正在拉取”文案至少展示 450ms，杜绝微任务和极快接口响应造成的按钮跳变与高频闪烁
      const elapsed = Date.now() - startTime;
      const minDuration = 450;
      if (elapsed < minDuration) {
        await new Promise((resolve) => setTimeout(resolve, minDuration - elapsed));
      }
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const handleToggleRead = async (id: number) => {
    try {
      const res = await api.emails.toggleRead(id);
      setEmails((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, is_read: res.is_read } : item
        )
      );
      if (currentEmailDetail && currentEmailDetail.id === id) {
        setCurrentEmailDetail({ ...currentEmailDetail, is_read: res.is_read });
      }
      loadCounts();
    } catch (e) {
      console.error(e);
    }
  };

  const handleArchive = async (id: number) => {
    try {
      const res = await api.emails.archive(id);
      if (res.status === 'archived') {
        toast.success(res.message || '邮件已成功归档');
      } else {
        toast.success(res.message || '邮件已移出归档并恢复至收件箱');
      }
      setCurrentEmailDetail((prev) =>
        prev && prev.id === id ? { ...prev, status: res.status as any } : prev
      );
      await loadEmails();
      loadCounts();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || '归档操作失败，请稍后重试');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('email_agent_token');
    resetAllState();
    setCurrentUser(null);
    setDoorOpening(false);
    setDoorUnmounted(false);
    setAuthRequired(true);
  };

  const handleLoginSuccess = (user: User) => {
    resetAllState();
    setCurrentUser(user);
    setAuthRequired(false);
    // 触发工业卷帘大门向上拉起加减速曲线动效
    setDoorOpening(true);
    // 780ms 动画结束后彻底从 DOM 卸载大门
    setTimeout(() => {
      setDoorUnmounted(true);
    }, 780);
    loadAccounts();
  };

  const getFilterLabel = () => {
    if (currentFolder === 'inbox') {
      if (inboxFilter === 'unread') return '收件箱 · 未读';
      if (inboxFilter === 'read') return '收件箱 · 已读';
      return '收件箱 · 全部';
    }
    if (currentFolder === 'sent') return '发件箱 · 已发送';
    if (currentFolder === 'drafts') return '草稿箱';
    if (currentFolder === 'trash') return '已删除 / 垃圾箱';
    if (currentFolder === 'replied') return '已回复 / 待跟进';
    if (currentFolder === 'archived') return '已归档';
    return undefined;
  };

  // 若处于本地 Token 静默核验阶段（刷新页面时仅需数毫秒），直接返回纯净背景底色，不渲染任何提示图文，绝不产生视觉闪烁
  if (isAuthChecking) {
    return <div className="flex h-screen w-screen bg-background" />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground font-sans relative">
      {/* 仓储卷帘大门登录图层 (未卸载前置于顶层，带工业级加减速上拉动效) */}
      {!doorUnmounted && (
        <AuthModal
          onSuccess={handleLoginSuccess}
          isOpening={doorOpening}
        />
      )}

      {/* 主工作台界面 (仅在用户已授权确认后挂载，保障未登录时完全不泄露界面框架) */}
      {currentUser && (
        <>
          {/* 左栏：邮箱与文件夹导航 */}
          <MailSidebar
            accounts={accounts}
            selectedAccountId={selectedAccountId}
            onSelectAccount={(accId) => {
              if (selectedAccountId === accId) return;
              setSelectedAccountId(accId);
              handleSelectEmail(null);
            }}
            currentFolder={currentFolder}
            onSelectFolder={(folder) => {
              if (currentFolder === folder) return;
              if (folder === 'inbox') {
                setInboxFilter('all');
              }
              setCurrentFolder(folder);
              handleSelectEmail(null);
            }}
            inboxFilter={inboxFilter}
            onSelectInboxFilter={(filter) => {
              if (currentFolder === 'inbox' && inboxFilter === filter) {
                loadEmails();
                return;
              }
              setCurrentFolder('inbox');
              setInboxFilter(filter);
              handleSelectEmail(null);
            }}
            counts={folderCounts}
            onOpenCompose={() => {
              setActiveReplyDraft('');
              setComposeToEmail('');
              setComposeSubject('');
              setComposeConfig({ isOpen: true, mode: 'compose', accountId: selectedAccountId });
            }}
            onOpenAccounts={() => setIsAccountDialogOpen(true)}
            onOpenAdmin={() => setIsAdminDialogOpen(true)}
            currentUser={currentUser}
            onLogout={handleLogout}
          />

          {/* 中栏：邮件列表 */}
          <MailList
            emails={emails}
            selectedEmailId={selectedEmailId}
            onSelectEmail={handleSelectEmail}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            filterLabel={getFilterLabel()}
            onSyncAll={handleSyncAll}
            syncing={syncing}
            loading={listLoading}
            newArrivalIds={newArrivalIds}
            currentFolder={currentFolder}
            onLoadMore={handleLoadMore}
            loadingMore={loadingMore}
            hasMoreHistory={hasMoreHistory}
          />

      {/* 右栏：双重视窗（左：邮件正文阅读，右：DeepSeek AI 副驾驶） */}
      <div className="flex-1 flex h-full overflow-hidden">
        <MailDetailView
          email={currentEmailDetail}
          loading={detailLoading}
          onToggleRead={handleToggleRead}
          onArchive={handleArchive}
        />
        <div className="w-80 md:w-[420px] h-full relative overflow-hidden shrink-0 border-l">
          {composeConfig.isOpen && composeConfig.mode === 'compose' ? (
            <div className="w-full h-full animate-in fade-in duration-150">
              <ComposeCopilot
                toEmail={composeToEmail}
                subject={composeSubject}
                draftBody={activeReplyDraft}
                onApplyDraft={(draft) => setActiveReplyDraft(draft)}
                currentUser={currentUser}
              />
            </div>
          ) : (
            <div className="w-full h-full animate-in fade-in duration-150">
              <AICopilot
                email={currentEmailDetail}
                onReplySuccess={() => {
                  loadEmails();
                  if (selectedEmailId) {
                    api.emails.getDetail(selectedEmailId).then(setCurrentEmailDetail);
                  }
                }}
                onEmailUpdated={() => {
                  loadEmails();
                  if (selectedEmailId) {
                    api.emails.getDetail(selectedEmailId).then(setCurrentEmailDetail);
                  }
                }}
                onOpenAdvancedReply={(draftText) => {
                  if (!currentEmailDetail) return;
                  let cleanSender = currentEmailDetail.sender;
                  if (cleanSender.includes('<') && cleanSender.includes('>')) {
                    cleanSender = cleanSender.split('<')[1].split('>')[0].trim();
                  }
                  const origSub = currentEmailDetail.subject || '';
                  const replySub = origSub.toLowerCase().startsWith('re:') ? origSub : `Re: ${origSub}`;

                  setActiveReplyDraft(draftText);
                  setComposeToEmail(cleanSender);
                  setComposeSubject(replySub);
                  setComposeConfig({
                    isOpen: true,
                    mode: 'reply',
                    initialTo: cleanSender,
                    initialSubject: replySub,
                    initialBody: draftText,
                    inReplyToEmailId: currentEmailDetail.id,
                    accountId: currentEmailDetail.account_id || selectedAccountId,
                    quoteEmail: {
                      sender: currentEmailDetail.sender,
                      sent_date: currentEmailDetail.sent_date,
                      to_recipients: currentEmailDetail.to_recipients,
                      subject: currentEmailDetail.subject,
                      body_text: currentEmailDetail.body_text,
                    },
                  });
                }}
                isAdvancedEditorOpen={composeConfig.isOpen && composeConfig.mode === 'reply'}
                onDraftSync={(newDraft) => setActiveReplyDraft(newDraft)}
                externalDraft={composeConfig.isOpen && composeConfig.mode === 'reply' ? activeReplyDraft : undefined}
              />
            </div>
          )}
        </div>
      </div>

      {/* 弹窗：管理多邮箱 */}
      <AccountDialog
        isOpen={isAccountDialogOpen}
        onClose={() => setIsAccountDialogOpen(false)}
        onAccountUpdated={() => {
          loadAccounts();
          loadEmails();
        }}
      />

      {/* 弹窗：写新邮件 / 回复高级编辑器 */}
      <ComposeDialog
        isOpen={composeConfig.isOpen}
        onClose={() => setComposeConfig((prev) => ({ ...prev, isOpen: false }))}
        accounts={accounts}
        defaultAccountId={composeConfig.accountId || selectedAccountId}
        initialTo={composeConfig.initialTo}
        initialSubject={composeConfig.initialSubject}
        initialBody={composeConfig.initialBody}
        inReplyToEmailId={composeConfig.inReplyToEmailId}
        mode={composeConfig.mode}
        quoteEmail={composeConfig.quoteEmail}
        activeDraftBody={activeReplyDraft}
        onDraftChange={(newDraft) => setActiveReplyDraft(newDraft)}
        onToChange={(newTo) => setComposeToEmail(newTo)}
        onSubjectChange={(newSub) => setComposeSubject(newSub)}
        onSent={() => {
          loadEmails();
          if (selectedEmailId) {
            api.emails.getDetail(selectedEmailId).then(setCurrentEmailDetail);
          }
        }}
      />

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
}

export default DesktopApp;
