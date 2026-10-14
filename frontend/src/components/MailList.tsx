import React from 'react';
import { EmailListItem } from '../lib/api';
import { Search, RefreshCw, Clock, CheckCircle2, Inbox, ArrowDown, Loader2 } from 'lucide-react';
import { formatMailListDate } from '../lib/utils';

interface MailListProps {
  emails: EmailListItem[];
  selectedEmailId: number | null;
  onSelectEmail: (id: number) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filterLabel?: string;
  onSyncAll: () => void;
  syncing: boolean;
  newArrivalIds?: Set<number>;
  currentFolder?: string;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  hasMoreHistory?: boolean;
  loading?: boolean;
}

export const MailList: React.FC<MailListProps> = ({
  emails,
  selectedEmailId,
  onSelectEmail,
  searchQuery,
  onSearchChange,
  filterLabel,
  onSyncAll,
  syncing,
  newArrivalIds,
  currentFolder,
  onLoadMore,
  loadingMore = false,
  hasMoreHistory = true,
  loading = false,
}) => {
  const getEmptyText = () => {
    if (currentFolder === 'inbox') {
      if (filterLabel === 'unread' || filterLabel?.includes('未读')) return '暂无未读邮件';
      if (filterLabel === 'read' || filterLabel?.includes('已读')) return '暂无已读邮件';
      return '收件箱暂无邮件';
    }
    switch (currentFolder) {
      case 'sent':
        return '暂无已发送邮件';
      case 'drafts':
        return '暂无草稿';
      case 'trash':
        return '垃圾箱为空';
      case 'replied':
        return '暂无已回复邮件';
      case 'archived':
        return '暂无归档邮件';
      default:
        return '暂无邮件';
    }
  };

  return (
    <div className="w-72 md:w-80 border-r flex flex-col h-screen bg-background shrink-0 select-none">
      {/* 顶栏：搜索与一键收取 */}
      <div className="h-[52px] px-3 border-b flex items-center gap-2 shrink-0">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索邮件..."
            className="w-full pl-8 pr-3 py-1.5 text-[13px] bg-muted/40 border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/70"
          />
        </div>
        <button
          onClick={onSyncAll}
          disabled={syncing}
          title="收取新邮件"
          className="p-2 text-muted-foreground hover:text-primary hover:bg-muted rounded-lg border transition-colors disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-primary' : ''}`} />
        </button>
      </div>

      {/* 邮件卡片列表 */}
      <div className="flex-1 overflow-y-auto divide-y stable-scrollbar flex flex-col">
        {loading && emails.length === 0 ? (
          <div className="flex-1 divide-y divide-border/60">
            {[1, 2, 3, 4, 5].map((idx) => (
              <div key={idx} className="p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="h-3.5 w-16 t-skel-pulse-bar rounded" />
                  <div className="h-3 w-10 t-skel-pulse-bar rounded" />
                </div>
                <div className="h-4 w-4/5 t-skel-pulse-bar rounded" />
                <div className="h-3 w-2/3 t-skel-pulse-bar rounded opacity-60" />
              </div>
            ))}
          </div>
        ) : emails.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground text-[13px] select-none -translate-y-[26px]">
            <Inbox className="w-10 h-10 mb-2.5 opacity-30 stroke-[1.5]" />
            <span>{getEmptyText()}</span>
          </div>
        ) : (
          emails.map((email) => {
            const isSelected = email.id === selectedEmailId;
            const isNewArrival = newArrivalIds?.has(email.id);
            const isSentFolder = currentFolder === 'sent' || email.folder === 'sent';
            const displayContact = isSentFolder
              ? `发给: ${(email.to_recipients || '收件人').split('<')[0].replace(/"/g, '').trim()}`
              : (email.sender.split('<')[0].replace(/"/g, '').trim() || email.sender);

            return (
              <div
                key={email.id}
                onClick={() => onSelectEmail(email.id)}
                className={`p-3.5 cursor-pointer transition-colors text-left relative ${
                  isNewArrival ? 'animate-slide-down-new z-10' : ''
                } ${
                  isSelected
                    ? 'bg-primary/5 border-l-4 border-l-primary'
                    : 'hover:bg-muted/30'
                }`}
              >
                {/* 顶栏：所属邮箱标签与时间 */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span
                      title={email.account_name}
                      className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground shrink-0 max-w-[120px] truncate select-none"
                    >
                      {email.account_name}
                    </span>
                    {isNewArrival && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary shrink-0">
                        新到达
                      </span>
                    )}
                    <span
                      title={displayContact}
                      className="text-[13px] font-semibold text-foreground truncate min-w-0 flex-1"
                    >
                      {displayContact}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 text-[11px] text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>{formatMailListDate(email.sent_date) || '近期'}</span>
                  </div>
                </div>

                {/* 邮件主题与未读蓝点 */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h4
                    className={`text-[13px] line-clamp-1 leading-snug ${
                      !email.is_read
                        ? 'font-bold text-foreground'
                        : 'font-medium text-foreground/80'
                    }`}
                  >
                    {email.subject || '(无主题)'}
                  </h4>
                  {!email.is_read && (
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1" />
                  )}
                </div>

                {/* 摘要 */}
                {email.summary_zh ? (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted/40 border border-border/60 text-[12px] text-muted-foreground truncate">
                    <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0 select-none">
                      {isSentFolder ? '已发' : '速览'}
                    </span>
                    <span className="truncate font-medium text-foreground/90">{email.summary_zh}</span>
                  </div>
                ) : (
                  <p className="text-[12px] text-muted-foreground truncate px-1">
                    {isSentFolder ? '无正文预览' : '正在等待 AI 分析...'}
                  </p>
                )}

                {/* 仅在已回复时展示紧凑标记 */}
                {email.status === 'replied' && (
                  <div className="mt-2 flex items-center gap-1">
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-green-500/10 text-green-700 dark:text-green-400 font-medium">
                      <CheckCircle2 className="w-3 h-3" /> 已回复
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* 历史邮件分页加载栏 */}
        {emails.length > 0 && onLoadMore && (
          <div className="p-3 border-t bg-muted/15 text-center select-none shrink-0">
            {hasMoreHistory ? (
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className="w-full py-2 px-3 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/70 active:bg-muted rounded-lg border border-border/80 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent shadow-2xs cursor-pointer"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                    <span>正在从服务器拉取历史邮件...</span>
                  </>
                ) : (
                  <>
                    <ArrowDown className="w-3.5 h-3.5 shrink-0" />
                    <span>加载更早的历史邮件 (20封)</span>
                  </>
                )}
              </button>
            ) : (
              <div className="py-1 text-[11px] text-muted-foreground/60 font-medium">
                已同步该文件夹全部历史邮件
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
