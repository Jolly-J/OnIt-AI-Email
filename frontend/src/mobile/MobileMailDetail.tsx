import React, { useState, useMemo, useRef, useEffect } from 'react';
import { api, EmailDetail } from '@/lib/api';
import { copyToClipboard, formatMailDetailDate, formatLanguageLabel } from '@/lib/utils';
import {
  ArrowLeft,
  Copy,
  Check,
  Languages,
  Loader2,
  MoreVertical,
  Paperclip,
  Download,
  Clock,
  User,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MobileBottomBar } from './MobileBottomBar';
import { toast } from '@/components/ui/Toast';

interface MobileMailDetailProps {
  email: EmailDetail | null;
  loading: boolean;
  onBack: () => void;
  onOpenAICopilot: () => void;
  onOpenReply: () => void;
  onToggleRead: (id: number) => void;
  onArchive: (id: number) => void;
}

interface TranslationResult {
  translated_subject: string;
  translated_body_html: string;
  translated_body_text: string;
}

export const MobileMailDetail: React.FC<MobileMailDetailProps> = ({
  email,
  loading,
  onBack,
  onOpenAICopilot,
  onOpenReply,
  onToggleRead,
  onArchive,
}) => {
  const [copied, setCopied] = useState(false);
  const [viewHtml, setViewHtml] = useState(true);
  const [translating, setTranslating] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translations, setTranslations] = useState<Record<number, TranslationResult>>({});
  const [showMenu, setShowMenu] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setShowTranslation(false);
    setTranslating(false);
    setShowMenu(false);
  }, [email?.id]);

  const currentTranslation = email ? translations[email.id] : null;
  const isCurrentlyTranslated = showTranslation && currentTranslation;

  const displaySubject = isCurrentlyTranslated
    ? currentTranslation.translated_subject
    : email?.subject || '(无主题)';

  const displayBodyHtml = isCurrentlyTranslated
    ? currentTranslation.translated_body_html
    : email?.body_html || '';

  const displayBodyText = isCurrentlyTranslated
    ? currentTranslation.translated_body_text
    : email?.body_text || '';

  // 移动端专用沙箱 HTML：注入移动端视口与样式约束
  const sandboxedHtml = useMemo(() => {
    const raw = displayBodyHtml || email?.body_html || '';
    if (!raw) return '';

    const mobileStyles = `
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=2.0, user-scalable=yes" />
      <style>
        html, body {
          margin: 0 !important;
          padding: 14px !important;
          overflow-x: hidden !important;
          width: 100% !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif !important;
          font-size: 14px !important;
          line-height: 1.6 !important;
          color: #1a1a1a !important;
          background-color: transparent !important;
          word-break: break-word !important;
          overflow-wrap: break-word !important;
        }
        *, *::before, *::after {
          box-sizing: border-box !important;
        }
        img, video, iframe {
          max-width: 100% !important;
          height: auto !important;
        }
        table {
          max-width: 100% !important;
          width: 100% !important;
          display: block !important;
          overflow-x: auto !important;
        }
      </style>
    `;

    if (raw.toLowerCase().includes('<head>')) {
      return raw.replace(/<head>/i, `<head>${mobileStyles}`);
    } else if (raw.toLowerCase().includes('<html>')) {
      return raw.replace(/<html>/i, `<html><head>${mobileStyles}</head>`);
    } else {
      return `<!DOCTYPE html><html><head><meta charset="utf-8">${mobileStyles}</head><body>${raw}</body></html>`;
    }
  }, [email?.id, displayBodyHtml]);

  if (!email && !loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-muted-foreground text-xs select-none">
        <span>请选择左侧列表中的一封邮件开始阅读</span>
      </div>
    );
  }

  // 翻译处理
  const handleTranslate = async () => {
    if (!email || translating) return;

    if (showTranslation) {
      setShowTranslation(false);
      return;
    }

    if (translations[email.id]) {
      setShowTranslation(true);
      return;
    }

    setTranslating(true);
    try {
      const res = await api.emails.translate(email.id);
      if (res && res.translated_body_html) {
        setTranslations((prev) => ({
          ...prev,
          [email.id]: {
            translated_subject: res.translated_subject || email.subject,
            translated_body_html: res.translated_body_html,
            translated_body_text: res.translated_body_text || '',
          },
        }));
        setShowTranslation(true);
        toast.success('已完成 AI 邮件全文翻译');
      }
    } catch (err: any) {
      toast.error(err.message || '翻译失败');
    } finally {
      setTranslating(false);
    }
  };

  const handleCopy = async () => {
    const textToCopy = displayBodyText || displaySubject;
    const success = await copyToClipboard(textToCopy);
    if (success) {
      setCopied(true);
      toast.success('已复制邮件正文');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden relative select-none">
      {/* 顶部工具栏（适配钉钉状态栏安全区） */}
      <header className="h-14 px-3 border-b bg-background/95 backdrop-blur-md flex items-center justify-between gap-2 shrink-0 pt-safe z-20">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="p-2 -ml-1 rounded-xl text-foreground hover:bg-muted active:scale-95 transition-all"
            title="返回邮件列表"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <span
            title={email?.account_name || email?.account_email || ''}
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary truncate max-w-[120px]"
          >
            {email?.account_name || email?.account_email || '加载中...'}
          </span>

          {email?.language_detected && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
              {formatLanguageLabel(email.language_detected)}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* 外语邮件一键翻译按钮 */}
          {email?.language_detected && !email.language_detected.toLowerCase().startsWith('zh') && (
            <button
              onClick={handleTranslate}
              disabled={translating || loading || !email}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border transition-all ${
                showTranslation
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background hover:bg-muted text-muted-foreground'
              }`}
            >
              {translating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              ) : (
                <Languages className="w-3.5 h-3.5" />
              )}
              <span>{translating ? '翻译中' : showTranslation ? '原文' : '翻译'}</span>
            </button>
          )}

          {/* 更多操作菜单按钮 */}
          <div className="relative">
            <button
              onClick={() => setShowMenu((prev) => !prev)}
              disabled={loading || !email}
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground active:bg-muted disabled:opacity-40 disabled:pointer-events-none"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showMenu && email && (
              <div className="absolute right-0 mt-1 w-32 bg-popover border rounded-xl shadow-lg p-1 z-30 animate-in fade-in zoom-in-95 duration-150">
                {email.body_html && (
                  <button
                    onClick={() => {
                      setViewHtml(!viewHtml);
                      setShowMenu(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg hover:bg-muted text-popover-foreground transition-colors"
                  >
                    {viewHtml ? '查看纯文本' : '查看原网页'}
                  </button>
                )}
                <button
                  onClick={() => {
                    handleCopy();
                    setShowMenu(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg hover:bg-muted text-popover-foreground transition-colors flex items-center gap-1.5"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>复制正文</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 邮件主干信息与正文滚动容器 */}
      <div className="flex-1 overflow-y-auto no-overscroll pb-20">
        {loading || !email ? (
          /* 骨架屏：切换邮件或加载详情时平滑过渡，零白屏、零闪退 */
          <div className="p-4 space-y-4 animate-in fade-in duration-150">
            <div className="space-y-2">
              <div className="h-5 w-4/5 bg-muted/80 rounded-md animate-pulse" />
              <div className="h-4 w-1/2 bg-muted/50 rounded-md animate-pulse" />
            </div>

            <div className="p-3 rounded-xl bg-card border flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-muted/70 animate-pulse shrink-0" />
              <div className="space-y-1.5 flex-1">
                <div className="h-3.5 w-28 bg-muted/70 rounded animate-pulse" />
                <div className="h-3 w-40 bg-muted/50 rounded animate-pulse" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-card border space-y-3 pt-5">
              <div className="h-3.5 w-full bg-muted/60 rounded animate-pulse" />
              <div className="h-3.5 w-11/12 bg-muted/60 rounded animate-pulse" />
              <div className="h-3.5 w-4/5 bg-muted/60 rounded animate-pulse" />
              <div className="h-3.5 w-full bg-muted/40 rounded animate-pulse" />
              <div className="h-3.5 w-3/4 bg-muted/40 rounded animate-pulse" />
              <div className="h-3.5 w-5/6 bg-muted/40 rounded animate-pulse" />
              <div className="h-3.5 w-2/3 bg-muted/30 rounded animate-pulse" />
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in duration-150">
            {/* 邮件头信息 */}
            <div className="p-4 border-b bg-card select-text">
              <h2 className="text-base font-bold text-foreground leading-snug mb-2">
                {displaySubject}
              </h2>

              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-semibold text-foreground truncate">{email.sender}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>{formatMailDetailDate(email.sent_date) || '未知时间'}</span>
                </div>
                {email.to_recipients && (
                  <div className="text-[11px] text-muted-foreground truncate">
                    发给：{email.to_recipients}
                  </div>
                )}
                {email.cc_recipients && (
                  <div className="text-[11px] break-all">抄送：{email.cc_recipients}</div>
                )}
                {email.folder === 'sent' && email.bcc_recipients && (
                  <div className="text-[11px] break-all">密送：{email.bcc_recipients}</div>
                )}
              </div>

              {/* 附件与大文件下载提示 */}
              {(email as any).attachments && (email as any).attachments.length > 0 && (
                <div className="mt-3 pt-2.5 border-t space-y-1.5">
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-primary">
                    <Paperclip className="w-3.5 h-3.5" />
                    <span>包含附件 ({((email as any).attachments).length})</span>
                  </div>
                  <div className="space-y-1">
                    {((email as any).attachments).map((att: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-lg bg-muted/40 border text-xs"
                      >
                        <span className="truncate flex-1 font-medium">{att.filename || '未命名附件'}</span>
                        {att.download_url && (
                          <a
                            href={att.download_url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 text-primary hover:underline flex items-center gap-0.5 text-[11px]"
                          >
                            <Download className="w-3 h-3" />
                            <span>下载</span>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 邮件正文沙箱 iframe 或纯文本（自适应撑满全部垂直空间） */}
            <div className="flex-1 w-full bg-background relative min-h-[calc(100dvh-220px)]">
              {viewHtml && (displayBodyHtml || email.body_html) ? (
                <iframe
                  ref={iframeRef}
                  key={`${email.id}-${showTranslation ? 'trans' : 'orig'}`}
                  title="Mobile Email Content"
                  srcDoc={sandboxedHtml}
                  sandbox="allow-same-origin allow-popups"
                  scrolling="no"
                  onLoad={() => {
                    try {
                      const doc = iframeRef.current?.contentDocument;
                      if (doc?.body) {
                        const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
                        if (h > 100 && iframeRef.current) {
                          iframeRef.current.style.height = `${h + 30}px`;
                        }
                      }
                    } catch {
                      // 忽略
                    }
                  }}
                  style={{ minHeight: 'calc(100dvh - 220px)' }}
                  className="w-full border-0 bg-transparent block"
                />
              ) : (
                <div className="p-4 select-text min-h-[calc(100dvh-220px)]">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground break-words">
                    {displayBodyText}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 移动端底部常驻操作条（知了伴随 + 回复 + 归档/已读） */}
      <MobileBottomBar
        email={email}
        loading={loading}
        onOpenAICopilot={onOpenAICopilot}
        onOpenReply={onOpenReply}
        onToggleRead={() => email && onToggleRead(email.id)}
        onArchive={() => email && onArchive(email.id)}
      />
    </div>
  );
};
