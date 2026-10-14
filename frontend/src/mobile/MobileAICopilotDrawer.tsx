import React, { useState, useEffect, useRef } from 'react';
import { EmailDetail, ChatMessageItem, api } from '@/lib/api';
import { formatLanguageLabel, copyToClipboard } from '@/lib/utils';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  Send,
  X,
  RefreshCw,
  Loader2,
  FileText,
  ListTodo,
  Lightbulb,
  Check,
  Copy,
  ArrowUpRight,
  AlertTriangle,
} from 'lucide-react';
import { toast } from '@/components/ui/Toast';
import { EnhancedMarkdown } from '@/components/EnhancedMarkdown';
import { ThinkingProcess } from '@/components/ThinkingProcess';

interface MobileAICopilotDrawerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  email: EmailDetail | null;
  onOpenAdvancedReply?: (draftText: string, lang: 'zh' | 'foreign') => void;
  onEmailUpdated?: () => void;
}

export const MobileAICopilotDrawer: React.FC<MobileAICopilotDrawerProps> = ({
  isOpen,
  onOpenChange,
  email,
  onOpenAdvancedReply,
  onEmailUpdated,
}) => {
  const [chatHistory, setChatHistory] = useState<ChatMessageItem[]>([]);
  const [instruction, setInstruction] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [copiedDraftId, setCopiedDraftId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [draftLangMap, setDraftLangMap] = useState<Record<string | number, 'orig' | 'zh'>>({});
  // 记录基准真实物理视口高度，防御 Android/DingTalk 软键盘收起后视口惰性更新 bug
  const [stableViewportHeight, setStableViewportHeight] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return window.innerHeight;
    }
    return 800;
  });
  const touchStartYRef = useRef<number | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 监听真实视口大小，仅在非软键盘弹起状态下更新物理基准视口
  useEffect(() => {
    if (!isOpen) return;

    const updateBaseHeight = () => {
      const isInputActive =
        typeof document !== 'undefined' &&
        (document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.tagName === 'TEXTAREA');
      if (!isInputActive && typeof window !== 'undefined' && window.innerHeight > 400) {
        setStableViewportHeight(window.innerHeight);
      }
    };

    updateBaseHeight();

    window.addEventListener('resize', updateBaseHeight);
    window.visualViewport?.addEventListener('resize', updateBaseHeight);

    return () => {
      window.removeEventListener('resize', updateBaseHeight);
      window.visualViewport?.removeEventListener('resize', updateBaseHeight);
    };
  }, [isOpen]);

  // 加载该邮件的历史会话
  useEffect(() => {
    if (!isOpen || !email) return;
    let isCancelled = false;

    api.chat
      .getHistory(email.id)
      .then((history) => {
        if (!isCancelled) {
          setChatHistory(history);
        }
      })
      .catch(() => {
        if (!isCancelled) setChatHistory([]);
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, email?.id]);

  // 新消息平滑滚动（仅在内部容器滚动，严禁使用 scrollIntoView，避免在手机端导致 window 上顶而顶飞拉手）
  useEffect(() => {
    if (isOpen && scrollContainerRef.current) {
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({
            top: scrollContainerRef.current.scrollHeight,
            behavior: 'smooth',
          });
        }
      });
    }
  }, [chatHistory, isOpen]);

  if (!email) return null;

  // 重新深度分析
  const handleReanalyze = async () => {
    if (reanalyzing) return;
    setReanalyzing(true);
    setError('');
    try {
      await api.emails.reanalyze(email.id);
      if (onEmailUpdated) onEmailUpdated();
      toast.success('已完成 AI 重新深度分析');
    } catch (err: any) {
      setError(err.message || '重新分析失败');
    } finally {
      setReanalyzing(false);
    }
  };

  // 发送指令
  const handleSendMessage = async (text?: string) => {
    const textToSend = (text !== undefined ? text : instruction).trim();
    if (!textToSend || sendingMsg) return;

    // 主动让出软键盘失焦，避免移动端残留键盘高度
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    // 延迟触发视口重排广播，促使 Android DingTalk WebView 恢复全屏渲染，杜绝高度坍塌
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('resize'));
      }
    }, 150);

    setInstruction('');
    setSendingMsg(true);
    setError('');

    // 乐观添加
    const tempUserMsg: ChatMessageItem = {
      id: Date.now(),
      role: 'user',
      content: textToSend,
      draft_reply: '',
      created_at: new Date().toISOString(),
    };
    setChatHistory((prev) => [...prev, tempUserMsg]);

    try {
      const assistantMsg = await api.chat.sendMessage(email.id, textToSend);
      setChatHistory((prev) => [...prev.slice(0, -1), tempUserMsg, assistantMsg]);
    } catch (err: any) {
      setError(err.message || 'AI 思考出错，请重试');
      toast.error('发送指令失败');
    } finally {
      setSendingMsg(false);
    }
  };

  const handleCopy = (text: string, idKey: string) => {
    copyToClipboard(text);
    setCopiedDraftId(idKey);
    toast.success('已复制到剪贴板');
    setTimeout(() => setCopiedDraftId(null), 2000);
  };

  // 计算抽屉全屏绝对高度像素值（86% 视口高度），防御软键盘收起后 Android WebView 高度塌陷
  const targetHeightPx = Math.round(stableViewportHeight * 0.86);
  const currentHeightStyle = `${targetHeightPx}px`;

  // 顶部标题栏/手柄手势交互（标准移动端手势：大幅向下滑动收起抽屉）
  const handleHeaderTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleHeaderTouchEnd = (e: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
    touchStartYRef.current = null;

    // 向下滑动 > 60px -> 收起抽屉
    if (deltaY > 60) {
      onOpenChange(false);
    }
  };

  return (
    <Drawer open={isOpen} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent
        className="mobile-drawer-responsive-height flex flex-col bg-background focus:outline-none overflow-hidden"
        style={{ height: currentHeightStyle, maxHeight: currentHeightStyle }}
      >
        {/* 顶部标题栏（统一纯全屏态，支持标准下滑收起） */}
        <DrawerHeader
          data-vaul-no-drag
          onTouchStart={handleHeaderTouchStart}
          onTouchEnd={handleHeaderTouchEnd}
          className="px-4 py-2.5 border-b bg-background flex flex-row items-center justify-between shrink-0 touch-pan-y select-none"
        >
          <div className="flex items-center gap-2 min-w-0">
            <img src="/bandu_logo.png" alt="知了伴随" className="w-5 h-5 object-contain shrink-0" />
            <DrawerTitle className="text-xs font-bold tracking-tight">知了 AI 伴随</DrawerTitle>
            {email.language_detected && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-primary/20">
                {formatLanguageLabel(email.language_detected)}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-primary"
              onClick={handleReanalyze}
              disabled={reanalyzing}
              title="重新深度分析"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reanalyzing ? 'animate-spin text-primary' : ''}`} />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onOpenChange(false)}
              title="收起抽屉"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </DrawerHeader>

        {/* 中部交互滚动区（data-vaul-no-drag 禁止 Vaul 劫持内部滑动手势） */}
        <div
          ref={scrollContainerRef}
          data-vaul-no-drag
          className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3 text-xs select-text touch-pan-y overscroll-contain"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {error && (
            <div className="p-2.5 rounded-xl bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ① 深度分析与核心要点卡片 */}
          <div className="p-3.5 rounded-xl bg-card border shadow-xs space-y-2.5">
            <div className="flex items-center gap-1.5 font-semibold text-primary">
              <FileText className="w-3.5 h-3.5" />
              <span>核心要点与诉求</span>
            </div>

            {email.summary_zh ? (
              <p className="text-foreground leading-relaxed font-medium">
                {email.summary_zh}
              </p>
            ) : (
              <div className="py-2 px-2.5 rounded-lg bg-primary/5 flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                <span>AI 正在深度解析邮件...</span>
              </div>
            )}

            {email.key_points && email.key_points.length > 0 && (
              <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                {email.key_points.map((pt, i) => (
                  <li key={i} className="leading-relaxed">{pt}</li>
                ))}
              </ul>
            )}

            {email.action_items && email.action_items.length > 0 && (
              <div className="pt-2 border-t mt-2">
                <div className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5 mb-1">
                  <ListTodo className="w-3.5 h-3.5" />
                  <span>对方诉求与待办</span>
                </div>
                <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                  {email.action_items.map((act, i) => (
                    <li key={i} className="leading-relaxed">{act}</li>
                  ))}
                </ul>
              </div>
            )}

            {email.ai_guided_question && (
              <div className="pt-2 border-t mt-2 flex items-start gap-1.5 text-muted-foreground">
                <Lightbulb className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <span className="leading-relaxed italic">{email.ai_guided_question}</span>
              </div>
            )}
          </div>

          {/* ② 对话历史与草稿呈现 */}
          {chatHistory.map((msg) => {
            const isUser = msg.role === 'user';
            const hasDraft = Boolean(msg.draft_reply?.trim() || msg.draft_reply_zh?.trim());
            const currentLang = draftLangMap[msg.id] || (msg.draft_reply ? 'orig' : 'zh');

            return (
              <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1.5`}>
                {msg.content && (
                  <div
                    className={`p-3 rounded-2xl max-w-[90%] leading-relaxed ${
                      isUser
                        ? 'bg-primary text-primary-foreground rounded-br-xs shadow-xs'
                        : 'bg-muted/60 text-foreground border rounded-bl-xs'
                    }`}
                  >
                    <EnhancedMarkdown content={msg.content} />
                  </div>
                )}

                {!isUser && hasDraft && (
                  <div className="w-full p-3 rounded-xl bg-card border shadow-xs space-y-2 mt-1">
                    <div className="flex items-center justify-between border-b pb-1.5">
                      <div className="flex items-center gap-1.5 text-primary font-semibold text-[11px]">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>AI 拟定回复草稿</span>
                      </div>

                      {msg.draft_reply && msg.draft_reply_zh && (
                        <div className="flex items-center bg-muted/60 rounded-md p-0.5 border">
                          <button
                            onClick={() => setDraftLangMap((prev) => ({ ...prev, [msg.id]: 'orig' }))}
                            className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                              currentLang === 'orig' ? 'bg-background shadow-xs text-primary' : 'text-muted-foreground'
                            }`}
                          >
                            外语草稿
                          </button>
                          <button
                            onClick={() => setDraftLangMap((prev) => ({ ...prev, [msg.id]: 'zh' }))}
                            className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                              currentLang === 'zh' ? 'bg-background shadow-xs text-primary' : 'text-muted-foreground'
                            }`}
                          >
                            中文对照
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="p-2.5 rounded-lg bg-muted/30 border font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text max-h-48 overflow-y-auto">
                      {currentLang === 'zh' ? (msg.draft_reply_zh || msg.draft_reply) : (msg.draft_reply || msg.draft_reply_zh)}
                    </div>

                    {msg.explanation && (
                      <div className="text-[11px] text-muted-foreground bg-primary/5 p-2 rounded-lg border border-primary/10">
                        <span className="font-semibold text-primary">策略分析：</span>
                        {msg.explanation}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px] gap-1 px-2.5"
                        onClick={() => {
                          const text = currentLang === 'zh' ? (msg.draft_reply_zh || msg.draft_reply) : (msg.draft_reply || msg.draft_reply_zh);
                          if (text) handleCopy(text, String(msg.id));
                        }}
                      >
                        {copiedDraftId === String(msg.id) ? (
                          <>
                            <Check className="w-3 h-3 text-primary" />
                            <span className="text-primary font-medium">已复制</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>复制</span>
                          </>
                        )}
                      </Button>

                      {onOpenAdvancedReply && (
                        <Button
                          size="sm"
                          className="h-7 text-[11px] gap-1 px-3 shadow-xs active:scale-95 font-semibold"
                          onClick={() => {
                            const draftToUse = msg.draft_reply || msg.draft_reply_zh || '';
                            const langToUse = msg.draft_reply ? 'foreign' : 'zh';
                            onOpenChange(false);
                            onOpenAdvancedReply(draftToUse, langToUse);
                          }}
                        >
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          <span>采纳此稿去回复</span>
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {sendingMsg && (
            <div className="p-3 rounded-2xl bg-muted/60 text-foreground border rounded-bl-xs w-full">
              <ThinkingProcess />
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* 底部输入栏 */}
        <div className="px-3.5 pt-3 border-t bg-background shrink-0 pb-safe-offset">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendMessage();
              }}
              placeholder="输入拟稿或修改指令..."
              readOnly={sendingMsg}
              className="flex-1 h-10 px-3.5 text-xs rounded-xl bg-muted/60 border border-transparent focus:border-primary/40 focus:bg-background focus:outline-none transition-all"
            />
            <Button
              size="icon"
              className="h-10 w-10 rounded-xl shadow-xs shrink-0"
              onClick={() => handleSendMessage()}
              disabled={!instruction.trim() || sendingMsg}
            >
              {sendingMsg ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
