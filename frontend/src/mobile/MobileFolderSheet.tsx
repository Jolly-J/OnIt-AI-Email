import React from 'react';
import { MailAccount, User } from '@/lib/api';
import { FolderType, FolderCounts } from '@/components/MailSidebar';
import { MailProviderLogo } from '@/components/MailProviderLogo';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Inbox,
  Mail,
  Send,
  Archive,
  Layers,
  FileText,
  Trash2,
  CheckCircle2,
  Settings,
  ShieldCheck,
  LogOut,
  Sparkles,
  PanelLeftClose,
} from 'lucide-react';

interface MobileFolderSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: MailAccount[];
  selectedAccountId: number | null;
  onSelectAccount: (accountId: number | null) => void;
  currentFolder: FolderType;
  onSelectFolder: (folder: FolderType) => void;
  inboxFilter: 'all' | 'unread' | 'read';
  onSelectInboxFilter: (filter: 'all' | 'unread' | 'read') => void;
  counts: FolderCounts;
  onOpenAccounts: () => void;
  onOpenAdmin?: () => void;
  currentUser: User | null;
  onLogout: () => void;
}

export const MobileFolderSheet: React.FC<MobileFolderSheetProps> = ({
  isOpen,
  onOpenChange,
  accounts,
  selectedAccountId,
  onSelectAccount,
  currentFolder,
  onSelectFolder,
  inboxFilter,
  onSelectInboxFilter,
  counts,
  onOpenAccounts,
  onOpenAdmin,
  currentUser,
  onLogout,
}) => {
  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="left" hideClose={true} className="w-[210px] max-w-[62vw] p-0 flex flex-col h-full bg-background border-r">
        {/* 顶部 Brand 与折叠收起按钮 */}
        <SheetHeader className="h-14 px-3 border-b bg-background flex flex-row items-center justify-between shrink-0 space-y-0">
          <SheetTitle className="sr-only">知了企业邮件</SheetTitle>
          <div className="flex items-center gap-1.5 min-w-0">
            <img
              src="/zhiliao_logo_full.webp"
              alt="知了 OnIt"
              className="h-7 w-auto max-w-[115px] object-contain select-none"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg active:scale-95 shrink-0"
            onClick={() => onOpenChange(false)}
            title="折叠收起导航栏"
          >
            <PanelLeftClose className="w-4.5 h-4.5" />
          </Button>
        </SheetHeader>

        {/* 邮箱账号列表 */}
        <div className="p-3.5 border-b bg-card shrink-0">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">邮箱账号</span>
            <button
              onClick={() => {
                onOpenChange(false);
                onOpenAccounts();
              }}
              className="text-xs text-primary hover:underline flex items-center gap-1 font-semibold"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>管理</span>
            </button>
          </div>

          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            <button
              onClick={() => {
                onSelectAccount(null);
                onOpenChange(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                selectedAccountId === null
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-foreground hover:bg-muted'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <Layers className="w-4 h-4 shrink-0" />
                <span className="truncate">全部聚合邮箱</span>
              </div>
              <Badge variant="secondary" className="text-xs px-2 py-0.5 h-5 rounded-full">
                {accounts.length}
              </Badge>
            </button>

            {accounts.map((acc) => (
              <button
                key={acc.id}
                onClick={() => {
                  onSelectAccount(acc.id);
                  onOpenChange(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  selectedAccountId === acc.id
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-foreground hover:bg-muted'
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <MailProviderLogo emailAddress={acc.email_address} provider={acc.provider} className="w-4 h-4 shrink-0" />
                  <span className="truncate">{acc.name || acc.email_address}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 文件夹导航菜单（标准大字号与 48px 触控区） */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-1.5">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 px-1">
            文件夹
          </div>

          {/* 收件箱 */}
          <button
            onClick={() => {
              onSelectFolder('inbox');
              onSelectInboxFilter('all');
              onOpenChange(false);
            }}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-[15px] font-medium transition-all ${
              currentFolder === 'inbox' && inboxFilter === 'all'
                ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            <div className="flex items-center gap-3">
              <Inbox className="w-5 h-5 shrink-0" />
              <span>收件箱</span>
            </div>
            {counts.inboxTotal > 0 && (
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  currentFolder === 'inbox' && inboxFilter === 'all'
                    ? 'bg-white/20 text-white'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {counts.inboxTotal}
              </span>
            )}
          </button>

          {/* 仅看未读（移动端一等公民入口） */}
          <button
            onClick={() => {
              onSelectFolder('inbox');
              onSelectInboxFilter('unread');
              onOpenChange(false);
            }}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-[15px] font-medium transition-all ${
              currentFolder === 'inbox' && inboxFilter === 'unread'
                ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 shrink-0 text-amber-500" />
              <span>未读邮件</span>
            </div>
            {counts.inboxUnread > 0 && (
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  currentFolder === 'inbox' && inboxFilter === 'unread'
                    ? 'bg-white/20 text-white'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                }`}
              >
                {counts.inboxUnread}
              </span>
            )}
          </button>

          {/* 已回复 */}
          <button
            onClick={() => {
              onSelectFolder('replied');
              onOpenChange(false);
            }}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-[15px] font-medium transition-all ${
              currentFolder === 'replied'
                ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>已回复</span>
            </div>
            {counts.repliedTotal > 0 && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${currentFolder === 'replied' ? 'bg-white/20 text-white' : 'text-muted-foreground'}`}>
                {counts.repliedTotal}
              </span>
            )}
          </button>

          {/* 已发送 */}
          <button
            onClick={() => {
              onSelectFolder('sent');
              onOpenChange(false);
            }}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-[15px] font-medium transition-all ${
              currentFolder === 'sent'
                ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            <div className="flex items-center gap-3">
              <Send className="w-5 h-5 shrink-0" />
              <span>已发送</span>
            </div>
            {counts.sentTotal > 0 && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${currentFolder === 'sent' ? 'bg-white/20 text-white' : 'text-muted-foreground'}`}>
                {counts.sentTotal}
              </span>
            )}
          </button>

          {/* 草稿箱 */}
          <button
            onClick={() => {
              onSelectFolder('drafts');
              onOpenChange(false);
            }}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-[15px] font-medium transition-all ${
              currentFolder === 'drafts'
                ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 shrink-0" />
              <span>草稿箱</span>
            </div>
            {counts.draftsTotal > 0 && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${currentFolder === 'drafts' ? 'bg-white/20 text-white' : 'text-muted-foreground'}`}>
                {counts.draftsTotal}
              </span>
            )}
          </button>

          {/* 已归档 */}
          <button
            onClick={() => {
              onSelectFolder('archived');
              onOpenChange(false);
            }}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-[15px] font-medium transition-all ${
              currentFolder === 'archived'
                ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            <div className="flex items-center gap-3">
              <Archive className="w-5 h-5 shrink-0" />
              <span>已归档</span>
            </div>
            {counts.archivedTotal > 0 && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${currentFolder === 'archived' ? 'bg-white/20 text-white' : 'text-muted-foreground'}`}>
                {counts.archivedTotal}
              </span>
            )}
          </button>

          {/* 垃圾箱 */}
          <button
            onClick={() => {
              onSelectFolder('trash');
              onOpenChange(false);
            }}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-[15px] font-medium transition-all ${
              currentFolder === 'trash'
                ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            <div className="flex items-center gap-3">
              <Trash2 className="w-5 h-5 shrink-0" />
              <span>垃圾箱</span>
            </div>
            {counts.trashTotal > 0 && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${currentFolder === 'trash' ? 'bg-white/20 text-white' : 'text-muted-foreground'}`}>
                {counts.trashTotal}
              </span>
            )}
          </button>
        </div>

        {/* 底部员工用户信息与系统操作 */}
        <div className="p-2.5 border-t bg-card/70 shrink-0 space-y-1.5 pb-safe-offset">
          {/* 员工用户信息微卡片 */}
          <div className="flex items-center gap-2 p-1.5 rounded-xl bg-muted/40 border border-border/60">
            {currentUser?.avatar ? (
              <img
                src={currentUser.avatar}
                alt={currentUser.display_name}
                className="w-7 h-7 rounded-full object-cover border shrink-0 shadow-2xs"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[11px] font-bold shrink-0">
                {currentUser?.display_name?.slice(0, 1) || currentUser?.username?.slice(0, 1) || 'U'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <p className="text-[11px] font-semibold text-foreground truncate leading-tight">
                  {currentUser?.display_name || currentUser?.username}
                </p>
                {currentUser?.is_admin && (
                  <span className="text-[8px] px-1 py-0.2 rounded bg-primary/10 text-primary font-medium border border-primary/20 shrink-0 leading-none">
                    管理员
                  </span>
                )}
              </div>
              <p className="text-[9px] text-muted-foreground truncate mt-0.5">
                {currentUser?.department_name || (currentUser?.is_admin ? '系统管理员' : '企业成员')}
              </p>
            </div>
          </div>

          {/* 管理员权限入口与退出登录按钮 */}
          <div className="space-y-0.5">
            {currentUser?.is_admin && onOpenAdmin && (
              <button
                onClick={() => {
                  onOpenChange(false);
                  onOpenAdmin();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>员工权限管理</span>
              </button>
            )}

            <button
              onClick={() => {
                onOpenChange(false);
                onLogout();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span>退出登录</span>
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
