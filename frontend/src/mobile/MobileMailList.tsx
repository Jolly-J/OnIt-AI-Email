import React from 'react';
import { EmailListItem } from '@/lib/api';
import { Clock, CheckCircle2, Inbox, ArrowDown, Loader2, RefreshCw } from 'lucide-react';
import { formatMailListDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface MobileMailListProps {
  emails: EmailListItem[];
  selectedEmailId: number | null;
  onSelectEmail: (id: number) => void;
  currentFolder: string;
  filterLabel?: string;
  loading: boolean;
  onSyncAll: () => void;
  syncing: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  hasMoreHistory?: boolean;
  newArrivalIds?: Set<number>;
}

export const MobileMailList: React.FC<MobileMailListProps> = ({
  emails,
  selectedEmailId,
  onSelectEmail,
  currentFolder,
  filterLabel,
  loading,
  onSyncAll,
  syncing,
  onLoadMore,
  loadingMore = false,
  hasMoreHistory = true,
  newArrivalIds,
}) => {
  const isSentFolder = currentFolder === 'sent';

  if (loading && emails.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-muted-foreground text-sm gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <span>正在加载邮件...</span>
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-muted-foreground select-none">
        <Inbox className="w-12 h-12 mb-3 opacity-25 stroke-[1.5]" />
        <span className="text-base font-semibold text-foreground mb-1.5">暂无邮件</span>
        <p className="text-sm text-muted-foreground text-center mb-4">
          当前文件夹下未找到邮件记录
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onSyncAll}
          disabled={syncing}
          className="gap-2 text-sm rounded-xl h-10 px-4 font-medium"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          <span>立即检查新邮件</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-border/60 bg-background no-overscroll">
      {emails.map((email) => {
        const isSelected = selectedEmailId === email.id;
        const isNewArrival = newArrivalIds?.has(email.id);
        const displayContact = isSentFolder
          ? `发给: ${(email.to_recipients || '收件人').split('<')[0].replace(/"/g, '').trim()}`
          : (email.sender.split('<')[0].replace(/"/g, '').trim() || email.sender);

        return (
          <div
            key={email.id}
            onClick={() => onSelectEmail(email.id)}
            className={`p-3.5 cursor-pointer transition-all active:bg-muted/70 select-none relative touch-press ${
              isNewArrival ? 'animate-slide-down-new z-10' : ''
            } ${
              isSelected ? 'bg-primary/5 border-l-4 border-l-primary' : 'hover:bg-muted/30'
            }`}
          >
            {/* 顶栏：邮箱账户、发件人/收件人、时间 */}
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground shrink-0 max-w-[120px] truncate">
                  {email.account_name}
                </span>
                {isNewArrival && (
                  <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4 bg-primary/20 text-primary border-primary/30">
                    新到
                  </Badge>
                )}
                <span className="text-[14px] font-semibold text-foreground truncate min-w-0 flex-1">
                  {displayContact}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0 text-xs text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                <span>{formatMailListDate(email.sent_date) || '近期'}</span>
              </div>
            </div>

            {/* 邮件主题与未读小红点 */}
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <h3
                className={`text-[15px] line-clamp-1 leading-snug flex-1 ${
                  !email.is_read ? 'font-bold text-foreground' : 'font-medium text-foreground/80'
                }`}
              >
                {email.subject || '(无主题)'}
              </h3>
              {!email.is_read && (
                <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
              )}
            </div>

            {/* AI 极简中文摘要卡片 */}
            {email.summary_zh ? (
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/40 border text-[13px] text-muted-foreground truncate">
                <span className="text-[11px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-md shrink-0">
                  {isSentFolder ? '发信速览' : 'AI 速览'}
                </span>
                <span className="truncate font-medium text-foreground/90 text-[13px]">{email.summary_zh}</span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground truncate px-0.5">
                {isSentFolder ? '已归档存管' : '正在等待 AI 提炼要点...'}
              </p>
            )}

            {/* 状态徽标 */}
            {email.status === 'replied' && (
              <div className="mt-1.5 flex items-center gap-1">
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-green-500/10 text-green-700 dark:text-green-400 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 已回复
                </span>
              </div>
            )}
          </div>
        );
      })}

      {/* 底部加载更多历史邮件 */}
      {onLoadMore && (
        <div className="p-4 flex items-center justify-center pb-safe">
          {hasMoreHistory ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="w-full max-w-xs text-sm rounded-xl gap-2 h-10 font-medium"
            >
              {loadingMore ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  <span>正在从云端拉取历史邮件...</span>
                </>
              ) : (
                <>
                  <ArrowDown className="w-3.5 h-3.5" />
                  <span>点击拉取更早历史邮件</span>
                </>
              )}
            </Button>
          ) : (
            <span className="text-[11px] text-muted-foreground/60 py-2">
              已加载全部历史邮件
            </span>
          )}
        </div>
      )}
    </div>
  );
};
