import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { api, EmailDetail } from '../lib/api';
import { copyToClipboard, formatMailDetailDate, formatLanguageLabel } from '../lib/utils';
import {
  Copy,
  Check,
  Archive,
  MailCheck,
  Code,
  FileText,
  Clock,
  User,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Languages,
  Loader2,
  MoreHorizontal,
} from 'lucide-react';

interface MailDetailProps {
  email: EmailDetail | null;
  loading: boolean;
  onToggleRead: (id: number) => void;
  onArchive: (id: number) => void;
}

interface TranslationResult {
  translated_subject: string;
  translated_body_html: string;
  translated_body_text: string;
}

export const MailDetail: React.FC<MailDetailProps> = ({
  email,
  loading,
  onToggleRead,
  onArchive,
}) => {
  const [copied, setCopied] = useState(false);
  const [viewHtml, setViewHtml] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [autoScaleRatio, setAutoScaleRatio] = useState<number | null>(null);
  const [translating, setTranslating] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translations, setTranslations] = useState<Record<number, TranslationResult>>({});
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 当切换邮件时重置自适应状态、翻译展示状态和更多菜单
  useEffect(() => {
    setAutoScaleRatio(null);
    setShowTranslation(false);
    setTranslating(false);
    setShowMoreMenu(false);
  }, [email?.id]);

  // 点击外部自动收起更多操作菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    if (showMoreMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMoreMenu]);

  // 计算当前最终生效的缩放比：用户手动缩放优先，默认100%模式下自动采用自适应比率
  const effectiveZoom = zoomLevel === 100 && autoScaleRatio ? autoScaleRatio : zoomLevel;

  // 内存级即时应用缩放：直接操作 iframe 内部文档样式，0 闪烁、0 重绘、完全解耦
  const applyZoomToIframe = useCallback((zoom: number) => {
    try {
      const iframeEl = iframeRef.current;
      const doc = iframeEl?.contentDocument;
      if (!iframeEl || !doc || !doc.body) return;
      const zoomVal = zoom === 100 ? '' : `${zoom}%`;
      (doc.body.style as any).zoom = zoomVal;
    } catch (err) {
      console.warn('应用缩放失败:', err);
    }
  }, []);

  // 自适应测绘核心函数：探测邮件固有物理宽度并计算最佳等比适配缩放比（彻底根除假溢出与震荡循环）
  const handleMeasureAndFit = useCallback(() => {
    try {
      const iframeEl = iframeRef.current;
      const doc = iframeEl?.contentDocument;
      if (!iframeEl || !doc || !doc.body) return;

      const clientW = iframeEl.clientWidth;
      if (!clientW || clientW < 100) return;

      // 1. 探测 HTML 属性与 inline style 中的最大固有物理宽度（避开 max-width）
      let maxIntrinsicWidth = 0;
      const elements = doc.querySelectorAll<HTMLElement>('table, div, img');
      elements.forEach((el) => {
        const wAttr = parseInt(el.getAttribute('width') || '0', 10);
        if (wAttr > maxIntrinsicWidth && wAttr < 2500) maxIntrinsicWidth = wAttr;
        const style = el.getAttribute('style') || '';
        const match = style.match(/(?:^|[;\s])(?:min-)?width\s*:\s*(\d+)px/i);
        if (match) {
          const wStyle = parseInt(match[1], 10);
          if (wStyle > maxIntrinsicWidth && wStyle < 2500) maxIntrinsicWidth = wStyle;
        }
      });

      // 2. 检测是否存在真实的水平排版溢出（对比内部真实 scrollWidth 与 clientWidth，预留 4px 容差）
      const body = doc.body;
      const html = doc.documentElement;
      const scrollW = Math.max(body?.scrollWidth || 0, html?.scrollWidth || 0);
      const clientWInside = Math.min(body?.clientWidth || clientW, html?.clientWidth || clientW);

      const hasOverflow = (maxIntrinsicWidth > clientW - 32) || (scrollW > clientWInside + 4);

      if (hasOverflow) {
        // 物理固有宽度优先，结合真实溢出量
        const contentWidth = Math.max(maxIntrinsicWidth, scrollW);
        const availableWidth = clientW - 32;
        const calculated = Math.floor((availableWidth / contentWidth) * 100);
        // 舒适阅读区间锁定在 85% ~ 98%，避免文字过小
        const bestZoom = Math.max(85, calculated);
        if (bestZoom < 98) {
          setAutoScaleRatio((prev) => (prev === bestZoom ? prev : bestZoom));
        } else {
          setAutoScaleRatio(null);
        }
      } else {
        setAutoScaleRatio(null);
      }
    } catch (err) {
      console.warn('自适应测绘异常:', err);
    }
  }, []);

  // 监听 effectiveZoom 改变，无刷新即时在内存中应用到 iframe DOM
  useEffect(() => {
    applyZoomToIframe(effectiveZoom);
  }, [effectiveZoom, applyZoomToIframe]);

  // 在 iframe 加载完成后单次执行测绘与缩放应用
  const onIframeLoad = () => {
    handleMeasureAndFit();
    applyZoomToIframe(effectiveZoom);
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(handleMeasureAndFit, 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timer) clearTimeout(timer);
    };
  }, [handleMeasureAndFit]);

  // 探测当前是否展示译文
  const currentTranslation = email ? translations[email.id] : null;
  const isCurrentlyTranslated = showTranslation && !!currentTranslation;

  const displaySubject = isCurrentlyTranslated && currentTranslation.translated_subject
    ? currentTranslation.translated_subject
    : email?.subject || '(无主题)';

  const displayBodyHtml = isCurrentlyTranslated && currentTranslation.translated_body_html
    ? currentTranslation.translated_body_html
    : email?.body_html || '';

  const displayBodyText = isCurrentlyTranslated && currentTranslation.translated_body_text
    ? currentTranslation.translated_body_text
    : email?.body_text || '（此邮件正文为空）';

  // 沙箱隔离注入：纯静态 HTML 生成，完全解耦于缩放比，保证每封邮件仅加载唯一一次，彻底杜绝闪烁
  const sandboxedHtml = useMemo(() => {
    if (!displayBodyHtml) return '';
    const raw = displayBodyHtml;
    const injectedStyles = `
      <base target="_blank">
      <style>
        html, body {
          word-break: break-word;
          overflow-wrap: break-word;
          padding: 16px;
          margin: 0;
          box-sizing: border-box;
          background-color: transparent;
        }
        body {
          overflow-x: auto;
        }
        *, *::before, *::after {
          box-sizing: border-box !important;
        }
        img, video, iframe {
          max-width: 100% !important;
          height: auto !important;
        }
        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(150, 150, 150, 0.3);
          border-radius: 9999px;
        }
      </style>
    `;

    if (raw.toLowerCase().includes('<head>')) {
      return raw.replace(/<head>/i, `<head>${injectedStyles}`);
    } else if (raw.toLowerCase().includes('<html>')) {
      return raw.replace(/<html>/i, `<html><head>${injectedStyles}</head>`);
    } else {
      return `<!DOCTYPE html><html><head><meta charset="utf-8">${injectedStyles}</head><body>${raw}</body></html>`;
    }
  }, [email?.id, displayBodyHtml]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-muted-foreground text-[13px]">
        正在加载邮件详情...
      </div>
    );
  }

  if (!email) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-muted-foreground text-[13px] select-none">
        <MailCheck className="w-10 h-10 mb-2.5 opacity-30 stroke-[1.5]" />
        <span>未选择邮件</span>
      </div>
    );
  }

  const handleTranslate = async () => {
    if (!email || translating) return;

    // 若当前为译文状态，再次点击瞬切回原文
    if (showTranslation) {
      setShowTranslation(false);
      return;
    }

    // 若已有翻译缓存，直接快速切至译文，不重复请求 AI
    if (translations[email.id]) {
      setShowTranslation(true);
      return;
    }

    // 否则调用后端 AI 进行高保真原位翻译
    setTranslating(true);
    try {
      const res = await api.emails.translate(email.id, 'zh');
      if (res && res.success) {
        setTranslations((prev) => ({
          ...prev,
          [email.id]: {
            translated_subject: res.translated_subject,
            translated_body_html: res.translated_body_html,
            translated_body_text: res.translated_body_text,
          },
        }));
        setShowTranslation(true);
      }
    } catch (err: any) {
      console.error('邮件翻译失败:', err);
      alert(err.message || '翻译请求失败，请稍后重试');
    } finally {
      setTranslating(false);
    }
  };

  const handleCopy = async () => {
    const textToCopy = displayBodyText || displaySubject;
    const success = await copyToClipboard(textToCopy);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 10, 150));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 10, 60));
  const handleResetZoom = () => setZoomLevel(100);

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden border-r">
      {/* 邮件顶部工具栏 */}
      <div className="h-[52px] px-3 border-b flex items-center justify-between bg-muted/20 gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            title={email.account_name || email.account_email}
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary truncate max-w-[140px]"
          >
            {email.account_name || email.account_email}
          </span>
          {email.language_detected && (
            <span
              title={`来信语言判定: ${formatLanguageLabel(email.language_detected)}`}
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 border ${
                email.language_detected.toLowerCase().startsWith('zh')
                  ? 'bg-primary/10 text-primary border-primary/20'
                  : 'bg-muted/80 text-muted-foreground border-border'
              }`}
            >
              {formatLanguageLabel(email.language_detected)}
            </span>
          )}

          {/* 仅在外语邮件（非中文）时展示一键翻译按钮 */}
          {email.language_detected && !email.language_detected.toLowerCase().startsWith('zh') && (
            <button
              onClick={handleTranslate}
              disabled={translating}
              title={
                showTranslation
                  ? '点击切回原语言文本'
                  : translating
                  ? '知了 AI 正在翻译中...'
                  : '一键调用 AI 翻译邮件内容为中文'
              }
              className={`flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-medium rounded-full border transition-all select-none shadow-xs shrink-0 ${
                showTranslation
                  ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
                  : 'bg-background hover:bg-muted text-muted-foreground hover:text-foreground border-border'
              } ${translating ? 'opacity-80 cursor-wait' : 'cursor-pointer'}`}
            >
              {translating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              ) : (
                <Languages className={`w-3.5 h-3.5 ${showTranslation ? 'text-primary-foreground' : 'text-primary'}`} />
              )}
              <span>
                {translating ? '翻译中...' : showTranslation ? '显示原文' : '翻译'}
              </span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* 页面缩放控制器（按实际宽度自适应与按需缩放） */}
          <div className="flex items-center border rounded-md bg-background px-1 py-0.5 shadow-xs">
            <button
              onClick={handleZoomOut}
              disabled={zoomLevel <= 60}
              title="缩小正文 (最小 60%)"
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-40 rounded transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleResetZoom}
              title="点击重置为 100% / 最佳自适应"
              className="px-1 text-[11px] font-mono text-muted-foreground hover:text-primary transition-colors flex items-center gap-0.5"
            >
              <span>{effectiveZoom}%</span>
              {zoomLevel === 100 && autoScaleRatio && (
                <span className="text-[10px] text-primary font-sans font-medium">(适应)</span>
              )}
            </button>
            <button
              onClick={handleZoomIn}
              disabled={zoomLevel >= 150}
              title="放大正文 (最大 150%)"
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-40 rounded transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleResetZoom}
              title="一键适应实际宽度"
              className="p-1 text-muted-foreground hover:text-primary rounded transition-colors border-l ml-0.5 pl-1"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => onToggleRead(email.id)}
            className="p-1.5 text-[12px] text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors cursor-pointer"
            title="切换已读/未读"
          >
            <MailCheck className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => onArchive(email.id)}
            className={`p-1.5 text-[12px] rounded hover:bg-muted transition-colors cursor-pointer ${
              email.status === 'archived'
                ? 'text-primary bg-primary/10 hover:bg-primary/20 font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title={email.status === 'archived' ? '移回收件箱 (取消归档)' : '归档此邮件'}
          >
            <Archive className="w-3.5 h-3.5" />
          </button>

          {/* 更多操作下拉菜单（收纳纯文本切换等辅助功能） */}
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => setShowMoreMenu((prev) => !prev)}
              className={`p-1.5 text-[12px] rounded hover:bg-muted transition-colors cursor-pointer ${
                showMoreMenu ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="更多操作"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 top-full mt-1 w-36 py-1 bg-popover text-popover-foreground border rounded-md shadow-md z-50 t-dropdown-surface">
                {email.body_html && (
                  <button
                    onClick={() => {
                      setViewHtml(!viewHtml);
                      setShowMoreMenu(false);
                    }}
                    className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-muted flex items-center gap-2 transition-colors cursor-pointer text-popover-foreground"
                  >
                    {viewHtml ? <FileText className="w-3.5 h-3.5 text-muted-foreground" /> : <Code className="w-3.5 h-3.5 text-muted-foreground" />}
                    <span>{viewHtml ? '查看纯文本' : '查看原网页'}</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    handleCopy();
                    // 延时 750ms 关闭，让用户看清已复制状态与对勾动效
                    setTimeout(() => setShowMoreMenu(false), 750);
                  }}
                  className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-muted flex items-center gap-2 transition-colors cursor-pointer text-popover-foreground"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-primary t-icon-swap-in" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                  <span>{copied ? '已复制正文' : '复制正文'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 邮件主体信息 */}
      <div className="p-4 border-b">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h2 className="text-[16px] font-semibold text-foreground leading-snug">
            {displaySubject}
          </h2>
          {isCurrentlyTranslated && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0 border border-primary/20 select-none">
              中文译文
            </span>
          )}
        </div>

        <div className="space-y-1.5 text-[13px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-[12px] font-medium text-muted-foreground">发件人：</span>
            <span className="text-[13px] text-foreground font-medium select-all">{email.sender}</span>
          </div>

          {email.to_recipients && (
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-[12px] font-medium text-muted-foreground">收件人：</span>
              <span className="text-[13px] text-foreground truncate select-all">{email.to_recipients}</span>
            </div>
          )}

          {email.cc_recipients && (
            <div className="flex gap-1.5">
              <span className="shrink-0">抄送：</span>
              <span className="text-foreground break-all select-all">{email.cc_recipients}</span>
            </div>
          )}
          {email.folder === 'sent' && email.bcc_recipients && (
            <div className="flex gap-1.5">
              <span className="shrink-0">密送：</span>
              <span className="text-foreground break-all select-all">{email.bcc_recipients}</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-[12px]">
            <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span>发送时间：{formatMailDetailDate(email.sent_date)}</span>
          </div>
        </div>
      </div>

      {/* 正文阅读视窗：物理沙箱隔离与自适应缩放 */}
      <div className="flex-1 overflow-hidden relative bg-background">
        {/* 翻译中视觉交互动效蒙层 */}
        {translating && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-background/80 backdrop-blur-xs transition-all animate-in fade-in duration-200 select-none">
            <div className="flex flex-col items-center p-6 rounded-2xl bg-card border shadow-xl max-w-[280px] text-center space-y-3">
              <div className="relative flex items-center justify-center">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
                  <Languages className="w-6 h-6 text-primary" />
                </div>
                <Loader2 className="w-12 h-12 text-primary/40 animate-spin absolute inset-0" />
              </div>
              <div className="space-y-1">
                <div className="text-[13px] font-semibold text-foreground">知了 AI 正在翻译邮件</div>
                <div className="text-[11px] text-muted-foreground leading-relaxed">
                  正在原位解析商务语境并替换正文文本...
                </div>
              </div>
            </div>
          </div>
        )}

        {viewHtml && (displayBodyHtml || email.body_html) ? (
          <iframe
            ref={iframeRef}
            key={`${email.id}-${showTranslation ? 'translated' : 'original'}`}
            onLoad={onIframeLoad}
            title="Email Content Sandbox"
            srcDoc={sandboxedHtml}
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            className="w-full h-full border-0 bg-transparent block"
          />
        ) : (
          <div className="h-full overflow-auto p-4 stable-scrollbar">
            <div
              className="mail-content-container origin-top-left transition-all duration-150"
              style={{
                zoom: `${zoomLevel}%`,
              }}
            >
              <pre className="whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-foreground select-text break-words">
                {displayBodyText}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
