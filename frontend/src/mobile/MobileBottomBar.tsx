import React from 'react';
import { EmailDetail } from '@/lib/api';
import {
  Sparkles,
  Reply,
  Languages,
  MailCheck,
  Mail,
  Archive,
  Loader2,
} from 'lucide-react';

interface MobileBottomBarProps {
  email: EmailDetail | null;
  loading?: boolean;
  onOpenAICopilot: () => void;
  onOpenReply: () => void;
  onToggleRead: () => void;
  onArchive: () => void;
}

export const MobileBottomBar: React.FC<MobileBottomBarProps> = ({
  email,
  loading = false,
  onOpenAICopilot,
  onOpenReply,
  onToggleRead,
  onArchive,
}) => {
  const isDisabled = loading || !email;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur-md border-t pb-safe select-none shadow-lg">
      <div className="h-14 px-3.5 flex items-center justify-between gap-2">
        {/* 左侧：轻量纯图标快捷操作（标记已读/未读、归档），防止窄屏空间拥挤 */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onToggleRead}
            disabled={isDisabled}
            aria-label={email?.is_read ? '标为未读' : '标为已读'}
            className="h-10 w-10 flex items-center justify-center rounded-xl bg-muted/60 text-muted-foreground hover:text-foreground active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
            title={email?.is_read ? '标为未读' : '标为已读'}
          >
            {email?.is_read ? <Mail className="w-5 h-5" /> : <MailCheck className="w-5 h-5 text-primary" />}
          </button>

          <button
            onClick={onArchive}
            disabled={isDisabled}
            aria-label="归档邮件"
            className="h-10 w-10 flex items-center justify-center rounded-xl bg-muted/60 text-muted-foreground hover:text-foreground active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
            title="归档邮件"
          >
            <Archive className="w-5 h-5" />
          </button>
        </div>

        {/* 右侧：两大核心行动按钮（知了伴随 + 回复），紧凑防折行 */}
        <div className="flex items-center gap-2 shrink-0">
          {/* 知了伴随核心入口（呼吸动效高亮） */}
          <button
            onClick={onOpenAICopilot}
            disabled={isDisabled}
            className="h-10 px-3.5 flex items-center gap-1.5 rounded-xl bg-primary/10 hover:bg-primary/15 active:scale-95 text-primary border border-primary/20 font-semibold text-xs transition-all shadow-xs whitespace-nowrap shrink-0 disabled:opacity-50 disabled:pointer-events-none"
          >
            <img src="/bandu_logo.png" alt="知了伴随" className="w-4 h-4 object-contain shrink-0" />
            <span className="whitespace-nowrap">知了伴随</span>
            {email?.action_items && email.action_items.length > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
            )}
          </button>

          {/* 一键回复 */}
          <button
            onClick={onOpenReply}
            disabled={isDisabled}
            className="h-10 px-4 flex items-center gap-1.5 rounded-xl bg-primary text-primary-foreground font-semibold text-xs shadow-xs hover:bg-primary/90 active:scale-95 transition-all whitespace-nowrap shrink-0 disabled:opacity-50 disabled:pointer-events-none"
          >
            <Reply className="w-4 h-4 shrink-0" />
            <span className="whitespace-nowrap">回复</span>
          </button>
        </div>
      </div>
    </div>
  );
};
