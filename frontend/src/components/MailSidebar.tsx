import React, { useState } from 'react';
import { MailAccount, User } from '../lib/api';
import { MailProviderLogo } from './MailProviderLogo';
import {
  Inbox,
  Send,
  Archive,
  Plus,
  Settings,
  LogOut,
  Sparkles,
  Layers,
  ChevronRight,
  ChevronDown,
  ShieldCheck,
  FileText,
  Trash2,
  CheckCircle2,
} from 'lucide-react';

export type FolderType = 'inbox' | 'sent' | 'drafts' | 'trash' | 'replied' | 'archived';

export interface FolderCounts {
  inboxTotal: number;
  inboxUnread: number;
  inboxRead: number;
  sentTotal: number;
  draftsTotal: number;
  trashTotal: number;
  repliedTotal: number;
  archivedTotal: number;
}

interface MailSidebarProps {
  accounts: MailAccount[];
  selectedAccountId: number | null; // null 表示全部聚合
  onSelectAccount: (accountId: number | null) => void;
  currentFolder: FolderType;
  onSelectFolder: (folder: FolderType) => void;
  inboxFilter: 'all' | 'unread' | 'read';
  onSelectInboxFilter: (filter: 'all' | 'unread' | 'read') => void;
  counts: FolderCounts;
  onOpenCompose: () => void;
  onOpenAccounts: () => void;
  onOpenAdmin?: () => void;
  currentUser: User | null;
  onLogout: () => void;
}

export const MailSidebar: React.FC<MailSidebarProps> = ({
  accounts,
  selectedAccountId,
  onSelectAccount,
  currentFolder,
  onSelectFolder,
  inboxFilter,
  onSelectInboxFilter,
  counts,
  onOpenCompose,
  onOpenAccounts,
  onOpenAdmin,
  currentUser,
  onLogout,
}) => {
  const [inboxExpanded, setInboxExpanded] = useState(true);

  return (
    <aside className="w-44 bg-sidebar border-r flex flex-col h-screen select-none shrink-0">
      {/* 顶部 Brand：常驻完整展开，双向完美居中 */}
      <div className="h-[52px] px-2 border-b flex items-center justify-center shrink-0 w-full">
        <img
          src="/zhiliao_logo_full.webp"
          alt="知了 OnIt"
          className="h-[36px] w-auto max-w-[146px] object-contain select-none"
        />
      </div>

      {/* 写新邮件主按钮 */}
      <div className="p-2">
        <button
          onClick={onOpenCompose}
          className="w-full py-2 px-2.5 bg-primary text-primary-foreground text-[13px] font-medium rounded-lg hover:bg-primary/90 transition-all flex items-center justify-center gap-1.5 shadow-xs"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>写新邮件</span>
        </button>
      </div>

      {/* 文件夹导航 */}
      <div className="px-2 py-1 space-y-0.5">
        {/* 收件箱（可展开/折叠全部、未读、已读） */}
        <div className="space-y-0.5">
          <div
            onClick={() => {
              onSelectInboxFilter('all');
              setInboxExpanded(true);
            }}
            className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer transition-colors ${
              currentFolder === 'inbox'
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
            }`}
          >
            <div className="flex items-center gap-1.5 truncate">
              <Inbox className="w-4 h-4 shrink-0" />
              <span className="truncate">收件箱</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {counts.inboxUnread > 0 ? (
                <span
                  key={counts.inboxUnread}
                  className="px-1.5 py-0.5 text-[11px] font-semibold rounded-full bg-primary text-primary-foreground min-w-[18px] text-center t-badge-pop-in"
                >
                  {counts.inboxUnread}
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground font-mono">
                  {counts.inboxTotal}
                </span>
              )}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setInboxExpanded((prev) => !prev);
                }}
                className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                title={inboxExpanded ? '折叠收件箱' : '展开收件箱'}
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-250 ease-out ${
                    inboxExpanded ? 'rotate-0' : '-rotate-90'
                  }`}
                />
              </span>
            </div>
          </div>

          {/* 展开的子项：全部、未读、已读（平滑生长与收起动效） */}
          <div
            className={`grid transition-[grid-template-rows,opacity] duration-250 ease-out ${
              inboxExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
            }`}
          >
            <div className="overflow-hidden">
              <div className="pl-2.5 pr-1 py-0.5 space-y-0.5 border-l border-border/70 ml-3.5 my-0.5">
                <button
                  onClick={() => onSelectInboxFilter('all')}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[12px] transition-colors ${
                    currentFolder === 'inbox' && inboxFilter === 'all'
                      ? 'text-primary font-semibold bg-primary/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/30'
                  }`}
                >
                  <span>全部</span>
                  <span className="text-[11px] font-mono opacity-80">{counts.inboxTotal}</span>
                </button>

                <button
                  onClick={() => onSelectInboxFilter('unread')}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[12px] transition-colors ${
                    currentFolder === 'inbox' && inboxFilter === 'unread'
                      ? 'text-primary font-semibold bg-primary/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/30'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <span>未读</span>
                  </span>
                  <span className="text-[11px] font-mono text-primary font-bold">{counts.inboxUnread}</span>
                </button>

                <button
                  onClick={() => onSelectInboxFilter('read')}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[12px] transition-colors ${
                    currentFolder === 'inbox' && inboxFilter === 'read'
                      ? 'text-primary font-semibold bg-primary/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/30'
                  }`}
                >
                  <span>已读</span>
                  <span className="text-[11px] font-mono opacity-80">{counts.inboxRead}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 发件箱 */}
        <button
          onClick={() => onSelectFolder('sent')}
          className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
            currentFolder === 'sent'
              ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
              : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
          }`}
        >
          <div className="flex items-center gap-1.5 truncate">
            <Send className="w-4 h-4 shrink-0" />
            <span className="truncate">发件箱</span>
          </div>
          <span className="text-[11px] text-muted-foreground font-mono shrink-0">
            {counts.sentTotal}
          </span>
        </button>

        {/* 草稿箱 */}
        <button
          onClick={() => onSelectFolder('drafts')}
          className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
            currentFolder === 'drafts'
              ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
              : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
          }`}
        >
          <div className="flex items-center gap-1.5 truncate">
            <FileText className="w-4 h-4 shrink-0" />
            <span className="truncate">草稿箱</span>
          </div>
          <span className="text-[11px] text-muted-foreground font-mono shrink-0">
            {counts.draftsTotal}
          </span>
        </button>

        {/* 已回复 */}
        <button
          onClick={() => onSelectFolder('replied')}
          className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
            currentFolder === 'replied'
              ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
              : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
          }`}
        >
          <div className="flex items-center gap-1.5 truncate">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="truncate">已回复</span>
          </div>
          <span className="text-[11px] text-muted-foreground font-mono shrink-0">
            {counts.repliedTotal}
          </span>
        </button>

        {/* 已删除 / 垃圾箱 */}
        <button
          onClick={() => onSelectFolder('trash')}
          className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
            currentFolder === 'trash'
              ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
              : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
          }`}
        >
          <div className="flex items-center gap-1.5 truncate">
            <Trash2 className="w-4 h-4 shrink-0" />
            <span className="truncate">垃圾箱</span>
          </div>
          <span className="text-[11px] text-muted-foreground font-mono shrink-0">
            {counts.trashTotal}
          </span>
        </button>

        {/* 已归档 */}
        <button
          onClick={() => onSelectFolder('archived')}
          className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
            currentFolder === 'archived'
              ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
              : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
          }`}
        >
          <div className="flex items-center gap-1.5 truncate">
            <Archive className="w-4 h-4 shrink-0" />
            <span className="truncate">已归档</span>
          </div>
          <span className="text-[11px] text-muted-foreground font-mono shrink-0">
            {counts.archivedTotal}
          </span>
        </button>
      </div>

      {/* 邮箱账号列表 */}
      <div className="flex-1 overflow-y-auto px-2 py-1.5 border-t mt-1.5 stable-scrollbar">
        <div className="flex items-center justify-between mb-1 px-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            邮箱账号
          </span>
          <button
            onClick={onOpenAccounts}
            title="管理邮箱账号"
            className="p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-sidebar-accent transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 聚合选项 */}
        <button
          onClick={() => onSelectAccount(null)}
          className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[12px] transition-colors mb-0.5 ${
            selectedAccountId === null
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
          }`}
        >
          <div className="flex items-center gap-1.5 truncate">
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">全部邮箱</span>
          </div>
          {selectedAccountId === null && <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
        </button>

        {/* 各邮箱 */}
        {accounts.map((acc) => (
          <button
            key={acc.id}
            onClick={() => onSelectAccount(acc.id)}
            className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[12px] transition-colors mb-0.5 ${
              selectedAccountId === acc.id
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
            }`}
          >
            <div className="min-w-0 text-left truncate flex items-center gap-1.5">
              <MailProviderLogo
                provider={acc.provider}
                emailAddress={acc.email_address}
                imapHost={acc.imap_host}
                className="w-3.5 h-3.5 shrink-0"
              />
              <div className="truncate font-medium">{acc.name}</div>
            </div>
            {selectedAccountId === acc.id && <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
          </button>
        ))}

        {accounts.length === 0 && (
          <div
            onClick={onOpenAccounts}
            className="cursor-pointer border border-dashed rounded-lg p-2.5 text-center text-[12px] text-muted-foreground hover:text-primary hover:border-primary transition-colors mt-1"
          >
            <Plus className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
            <span>点此绑定邮箱</span>
          </div>
        )}
      </div>

      {/* 底部员工用户信息 */}
      <div className="p-2 pt-1">
        <div className="flex items-center justify-between p-1.5 rounded-xl bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-all">
          <div className="flex items-center gap-1.5 min-w-0">
            {currentUser?.avatar ? (
              <img
                src={currentUser.avatar}
                alt={currentUser.display_name}
                className="w-6 h-6 rounded-full object-cover border shrink-0"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[11px] font-bold shrink-0">
                {currentUser?.display_name?.slice(0, 1) || currentUser?.username?.slice(0, 1) || 'U'}
              </div>
            )}
            <div className="truncate max-w-[85px]">
              <p className="text-[12px] font-medium text-sidebar-foreground truncate leading-tight">
                {currentUser?.display_name || currentUser?.username}
              </p>
              {currentUser?.is_admin && (
                <span className="text-[9px] text-primary font-semibold block leading-none mt-0.5">
                  管理员
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {currentUser?.is_admin && onOpenAdmin && (
              <button
                onClick={onOpenAdmin}
                title="企业与员工权限管理"
                className="p-1 text-primary hover:text-primary/80 rounded-lg hover:bg-primary/10 transition-colors"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={onLogout}
              title="退出登录"
              className="p-1 text-muted-foreground hover:text-destructive rounded-lg hover:bg-background/80 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
