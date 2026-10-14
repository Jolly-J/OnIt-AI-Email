import React, { useState, useEffect, useRef } from 'react';
import { User, ChatMessageItem, api } from '../lib/api';
import {
  Sparkles,
  Loader2,
  FileText,
  Pencil,
  Copy,
  Check,
  RotateCcw,
  ArrowRight,
  ChevronRight,
  ShieldCheck,
  SendHorizontal,
  Lightbulb,
  ExternalLink,
  Globe,
  FileSpreadsheet,
  Package,
  Handshake,
  Wand2,
} from 'lucide-react';
import { toast } from './ui/Toast';
import { EnhancedMarkdown } from './EnhancedMarkdown';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

export interface ComposeCopilotProps {
  toEmail?: string;
  subject?: string;
  draftBody?: string;
  onApplyDraft: (draftText: string) => void;
  currentUser?: User | null;
}

interface SceneCard {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  inquiryPrompt: string;
  quickTags: string[];
  badge: string;
}

export const ComposeCopilot: React.FC<ComposeCopilotProps> = ({
  toEmail = '',
  subject = '',
  draftBody = '',
  onApplyDraft,
  currentUser,
}) => {
  const [chatHistory, setChatHistory] = useState<ChatMessageItem[]>([]);
  const [activeSceneTags, setActiveSceneTags] = useState<string[]>([]);
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draftLangMap, setDraftLangMap] = useState<Record<string | number, 'orig' | 'zh'>>({});
  const [copiedId, setCopiedId] = useState<string | number | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const userName = (currentUser?.display_name || currentUser?.username || '业务专员').trim();

  // 通用商务场景定义
  const sceneCards: SceneCard[] = [
    {
      id: 'cold_outreach',
      icon: Globe,
      iconColor: 'text-blue-600 dark:text-blue-400',
      iconBg: 'bg-blue-500/10 dark:bg-blue-950/40',
      title: '新客商务开发信',
      description: '向潜在新客户自荐并探讨业务合作',
      inquiryPrompt: '收到！帮您起草【新客商务开发信】。为了信件更精准得体，请简单告诉我：\n1. 目标客户是谁？（如海外贸易商、行业买家）\n2. 核心想推介的产品或合作方向？\n3. 期望推进的下一步行动？',
      quickTags: ['首次建联', '行业潜在买家', '推介核心产品', '索取产品资料', '预约线上会议'],
      badge: '新客开拓',
    },
    {
      id: 'quotation',
      icon: FileSpreadsheet,
      iconColor: 'text-amber-600 dark:text-amber-400',
      iconBg: 'bg-amber-500/10 dark:bg-amber-950/40',
      title: '商务报价与方案',
      description: '规范发送产品报价单、交期与合作条款',
      inquiryPrompt: '收到！帮您起草【商务报价函】。请简要告诉我：\n1. 针对哪款产品或方案进行报价？\n2. 预计交付周期与核心付款条款？\n3. 是否有阶梯价格或报价单有效期？',
      quickTags: ['标准采购报价', '阶梯批发价', '交货周期4周', '30天有效', '附规格书明细'],
      badge: '商务推进',
    },
    {
      id: 'sample_notice',
      icon: Package,
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      iconBg: 'bg-emerald-500/10 dark:bg-emerald-950/40',
      title: '样品与发运通知',
      description: '告知样品已寄出，约定后续技术测试对接',
      inquiryPrompt: '收到！帮您起草【样品寄送通知】。请告知：\n1. 本次寄送的样品名称与数量？\n2. 快递承运商及单号？\n3. 期望对方重点测试或反馈的事项？',
      quickTags: ['测试样品已空运', '提供国际单号', '附测试指南', '预约下周交流'],
      badge: '履约跟进',
    },
    {
      id: 'exhibition',
      icon: Handshake,
      iconColor: 'text-indigo-600 dark:text-indigo-400',
      iconBg: 'bg-indigo-500/10 dark:bg-indigo-950/40',
      title: '展会邀约与会面',
      description: '真诚邀约合作伙伴莅临展位或商务面谈',
      inquiryPrompt: '收到！帮您起草【展会邀约与会面】。请确认：\n1. 展会名称、时间与我方展位号？\n2. 重点邀请对方参与什么活动？（展台参观 / 高管会谈 / 技术演示）\n3. 是否需要预约具体时段？',
      quickTags: ['莅临展位参观', '预约高层会谈', '现场产品演示', '探讨深度合作'],
      badge: '面对面交流',
    },
    {
      id: 'polish_translate',
      icon: Wand2,
      iconColor: 'text-primary',
      iconBg: 'bg-primary/10',
      title: '草稿润色与翻译',
      description: '将左侧已写内容润色为高级商务公文',
      inquiryPrompt: '收到！帮您进行【公文深度润色与翻译】。请告诉我您的期望风格：\n1. 期望目标语种（如地道商务英文）？\n2. 语气风格要求（如更委婉礼貌、正式严谨、还是推进签约）？',
      quickTags: ['更正式客观', '委婉礼貌', '地道商务英文', '重点催促回复'],
      badge: '公文润色',
    },
  ];

  const [cachedChatHistory, setCachedChatHistory] = useState<ChatMessageItem[]>([]);
  useEffect(() => {
    if (chatHistory.length > 0) {
      setCachedChatHistory(chatHistory);
    }
  }, [chatHistory]);

  const displayChatHistory = chatHistory.length > 0 ? chatHistory : cachedChatHistory;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, loading]);

  // 选择场景：开启交互式意图探询
  const handleSelectScene = (sc: SceneCard) => {
    setActiveSceneTags(sc.quickTags);
    const assistantInquiry: ChatMessageItem = {
      id: Date.now(),
      role: 'assistant',
      content: sc.inquiryPrompt,
      draft_reply: '',
      created_at: new Date().toISOString(),
    };
    setChatHistory([assistantInquiry]);
    textareaRef.current?.focus();
  };

  // 点击快捷标签：追加至输入框
  const handleTagClick = (tag: string) => {
    setInstruction((prev) => (prev.trim() ? `${prev}，${tag}` : tag));
    textareaRef.current?.focus();
  };

  const handleSend = async (customInstruction?: string) => {
    const textToSend = (customInstruction !== undefined ? customInstruction : instruction).trim();
    if (!textToSend || loading) return;

    if (customInstruction === undefined) {
      setInstruction('');
    }
    setLoading(true);
    setError('');

    const tempUserMsg: ChatMessageItem = {
      id: Date.now(),
      role: 'user',
      content: textToSend,
      draft_reply: '',
      created_at: new Date().toISOString(),
    };
    setChatHistory((prev) => [...prev, tempUserMsg]);

    const apiChatHistory = chatHistory.map((m) => {
      let content = m.content || '';
      if (m.role === 'assistant' && (m.draft_reply || m.draft_reply_zh)) {
        const parts = [content];
        if (m.draft_reply) parts.push(`【外语草稿】:\n${m.draft_reply}`);
        if (m.draft_reply_zh) parts.push(`【中文公文】:\n${m.draft_reply_zh}`);
        content = parts.join('\n\n');
      }
      return { role: m.role, content };
    });

    try {
      const assistantMsg = await api.chat.composeWithAI({
        instruction: textToSend,
        to_email: toEmail,
        subject: subject,
        current_draft: draftBody,
        chat_history: apiChatHistory,
      });

      setChatHistory((prev) => [...prev.slice(0, -1), tempUserMsg, assistantMsg]);

      // 默认展示语言优先：若有外文草稿默认展示外文
      if (assistantMsg.draft_reply) {
        setDraftLangMap((prev) => ({ ...prev, [String(assistantMsg.id)]: 'orig' }));
      } else if (assistantMsg.draft_reply_zh) {
        setDraftLangMap((prev) => ({ ...prev, [String(assistantMsg.id)]: 'zh' }));
      }
    } catch (err: any) {
      setError(err.message || 'AI 写信生成失败，请检查网络或 API 配置');
    } finally {
      setLoading(false);
    }
  };

  const handleClearHistory = () => {
    setChatHistory([]);
    setActiveSceneTags([]);
    setError('');
  };

  const handleCopy = (text: string, id: string | number) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success('公文内容已复制到剪贴板');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleApplyToCompose = (text: string) => {
    if (!text) return;
    onApplyDraft(text);
    toast.success('已将 AI 起草公文填入左侧邮件正文！');
  };

  return (
    <div className="w-full h-full flex flex-col bg-background select-none overflow-hidden">
      {/* 顶栏：极简标题与协同状态 */}
      <div className="h-[52px] px-3.5 border-b flex items-center justify-between bg-muted/10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src="/bandu_logo.png"
            alt="知了伴随"
            className="w-7 h-7 max-w-[28px] max-h-[28px] object-contain select-none shrink-0"
          />
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="font-semibold text-[13px] text-foreground tracking-tight truncate">
              写信伴随
            </h3>
            <Badge
              variant="outline"
              className="text-[10px] font-medium px-2 py-0.5 rounded-full border-primary/30 bg-primary/10 text-primary flex items-center gap-1 shrink-0"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              协同中
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {chatHistory.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearHistory}
              className="h-7 px-2.5 text-[11px] font-medium rounded-full text-muted-foreground hover:bg-primary hover:text-white transition-all duration-150 active:scale-95 shadow-2xs"
              title="重新开始"
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              重新开始
            </Button>
          )}
        </div>
      </div>

      {/* 错误提示条 */}
      {error && (
        <div className="p-2 mx-3 mt-2 text-[12px] text-destructive bg-destructive/10 rounded-lg border border-destructive/20 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* 主体区域：利用独立 t-copilot-slide 在场景向导 (page 1) 与 意图探询对话 (page 2) 之间丝滑过渡 */}
      <div
        className="flex-1 relative overflow-hidden t-copilot-slide"
        data-page={chatHistory.length === 0 ? '1' : '2'}
      >
        {/* Page 1: 空白状态与常用场景引导 */}
        <div
          data-page-id="1"
          inert={chatHistory.length > 0}
          className="t-copilot-page flex flex-col overflow-y-auto p-3 space-y-3.5 stable-scrollbar select-text"
        >
          <div className="space-y-3">
            {/* 精炼问候卡片（方案一：纯净极简大标题排版） */}
            <div className="p-4 rounded-2xl bg-muted/20 border border-border/60 space-y-1.5 t-stagger is-shown">
              <h4 className="text-[15px] sm:text-base font-semibold tracking-tight leading-snug t-stagger-line t-stagger-line--1">
                <span className="bg-gradient-to-r from-emerald-700 via-emerald-500 to-teal-500 dark:from-emerald-400 dark:via-emerald-300 dark:to-teal-300 bg-clip-text text-transparent font-bold">
                  {userName}，您好！今天想写点什么？
                </span>
              </h4>

              <p className="text-[12px] text-muted-foreground/85 leading-normal t-stagger-line t-stagger-line--2">
                点击下方场景开始意图梳理，或直接在底部输入您的写信需求：
              </p>

              {(toEmail || subject) && (
                <div className="pt-1.5 border-t border-border/40 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground t-stagger-line t-stagger-line--3">
                  {toEmail && (
                    <span className="px-2 py-0.5 rounded-md bg-background border text-foreground/80">
                      收件人: {toEmail}
                    </span>
                  )}
                  {subject && (
                    <span className="px-2 py-0.5 rounded-md bg-background border text-foreground/80">
                      主题: {subject}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* 若左侧已输入正文，显式提供体检润色卡片 */}
            {draftBody.trim().length > 10 && (
              <div className="p-3 rounded-2xl border border-primary/25 bg-primary/5 hover:bg-primary/8 transition-colors shadow-2xs flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-primary">
                    <Lightbulb className="w-3.5 h-3.5 shrink-0" />
                    <span>左侧已有草稿正文</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    AI 帮您全面体检礼仪格式，润色为双语公文
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleSend('请对左侧正文中已写的内容进行全面商务体检与深度润色，使其符合严谨地道的商务公文规范。')}
                  disabled={loading}
                  className="h-7 px-2.5 text-xs shrink-0 rounded-lg"
                >
                  一键润色
                </Button>
              </div>
            )}

            {/* 常用场景：方案 A 苹果经典 Inset Grouped 分组列表规范 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-0.5">
                <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                  <FileText className="w-3 h-3 text-primary" />
                  常用写信场景
                </span>
                <span className="text-[10px] text-muted-foreground/60">
                  点击场景即刻开启探询
                </span>
              </div>

              <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-xs overflow-hidden shadow-2xs divide-y divide-border/40 select-none">
                {sceneCards.map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => handleSelectScene(sc)}
                    className="w-full text-left p-3 flex items-center gap-3 hover:bg-muted/40 active:bg-muted/70 transition-colors cursor-pointer group"
                  >
                    {/* 苹果 Squircle 微质感图标底座 */}
                    <div className={`w-8 h-8 rounded-[10px] ${sc.iconBg} ${sc.iconColor} flex items-center justify-center shrink-0 shadow-2xs`}>
                      <sc.icon className="w-4 h-4" />
                    </div>

                    {/* 场景主标题与意图说明 */}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-foreground tracking-tight group-hover:text-primary transition-colors truncate">
                        {sc.title}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate mt-0.5 font-normal">
                        {sc.description}
                      </div>
                    </div>

                    {/* 苹果风格绝对居中对称右侧：淡雅标签 + 细线浅色 Chevron 箭头 */}
                    <div className="flex items-center gap-1 shrink-0 pl-1">
                      <span className="text-[11px] text-muted-foreground/70 font-normal">
                        {sc.badge}
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Page 2: 意图探询与起草对话流 */}
        <div
          data-page-id="2"
          inert={chatHistory.length === 0}
          className="t-copilot-page flex flex-col overflow-y-auto p-3 space-y-3.5 stable-scrollbar select-text"
        >
          {displayChatHistory.map((msg, idx) => {
          const isUser = msg.role === 'user';
          const hasDraft = Boolean(msg.draft_reply?.trim() || msg.draft_reply_zh?.trim());

          return (
            <div
              key={msg.id || idx}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-2`}
            >
              {/* 对话气泡 */}
              <div
                className={`max-w-[92%] p-3 rounded-2xl text-[13px] leading-relaxed ${
                  isUser
                    ? 'bg-primary text-primary-foreground font-medium rounded-br-none whitespace-pre-wrap shadow-2xs'
                    : 'bg-card border text-foreground rounded-bl-none shadow-xs'
                }`}
              >
                {isUser ? msg.content : <EnhancedMarkdown content={msg.content} />}
              </div>

              {/* 草稿卡片（带外文原稿与 1:1 中文公文互切，支持一键采纳填入） */}
              {hasDraft && (() => {
                const currentLang = draftLangMap[String(msg.id)] || (msg.draft_reply ? 'orig' : 'zh');
                const hasZh = Boolean(msg.draft_reply_zh?.trim());
                const hasForeign = Boolean(msg.draft_reply?.trim());

                const activeText = currentLang === 'zh'
                  ? (msg.draft_reply_zh || msg.draft_reply || '')
                  : (msg.draft_reply || msg.draft_reply_zh || '');

                return (
                  <div className="w-full p-3 rounded-xl border bg-card shadow-xs space-y-2.5 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between text-xs font-semibold text-primary gap-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Pencil className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">起草成果</span>
                      </div>

                      {/* 双语切换 Tab */}
                      {hasZh && hasForeign && (
                        <div className="relative grid grid-cols-2 w-32 bg-muted/80 p-0.5 rounded-lg border text-[11px] select-none">
                          <div
                            className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-background shadow-2xs transition-transform duration-200 ease-out pointer-events-none"
                            style={{
                              transform: currentLang === 'zh' ? 'translateX(100%)' : 'translateX(0%)',
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setDraftLangMap((prev) => ({ ...prev, [String(msg.id)]: 'orig' }))}
                            className={`relative z-10 py-0.5 text-center font-medium transition-colors ${
                              currentLang === 'orig' ? 'text-primary font-semibold' : 'text-muted-foreground'
                            }`}
                          >
                            外文原稿
                          </button>
                          <button
                            type="button"
                            onClick={() => setDraftLangMap((prev) => ({ ...prev, [String(msg.id)]: 'zh' }))}
                            className={`relative z-10 py-0.5 text-center font-medium transition-colors ${
                              currentLang === 'zh' ? 'text-primary font-semibold' : 'text-muted-foreground'
                            }`}
                          >
                            中文对照
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 正文预览框 */}
                    <div className="p-2.5 bg-muted/25 rounded-lg border border-border/70 text-[12px] leading-relaxed text-foreground whitespace-pre-wrap max-h-60 overflow-y-auto font-sans select-text">
                      {activeText}
                    </div>

                    {/* 策略与要点说明 */}
                    {msg.explanation && (
                      <div className="p-2 rounded-lg bg-primary/5 border border-primary/15 text-[11px] text-muted-foreground leading-normal flex items-start gap-1.5">
                        <Lightbulb className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                        <span>{msg.explanation}</span>
                      </div>
                    )}

                    {/* 卡片底栏操作：一键采纳填入正文 + 复制 */}
                    <div className="flex items-center justify-between pt-1 border-t border-border/50 gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopy(activeText, msg.id)}
                        className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        {copiedId === msg.id ? (
                          <>
                            <Check className="w-3 h-3 mr-1 text-emerald-500" />
                            已复制
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 mr-1" />
                            复制
                          </>
                        )}
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleApplyToCompose(activeText)}
                        className="h-7 px-2.5 text-xs bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-1.5 shadow-2xs"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>采纳并填入正文</span>
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-2.5 rounded-xl bg-card border shadow-xs animate-pulse">
            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
            <span>AI 正在组织高水准商务公文...</span>
          </div>
        )}

        <div ref={chatEndRef} />
        </div>
      </div>

      {/* 底部交互区：快捷要素标签 + 输入框 */}
      <div className="border-t bg-card shrink-0">
        {/* 方案 B：快捷要素标签点选推荐 */}
        {activeSceneTags.length > 0 && (
          <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth animate-in fade-in duration-200">
            <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-1 font-medium">
              <Sparkles className="w-3 h-3 text-primary" />
              快捷要素:
            </span>
            {activeSceneTags.map((tag, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleTagClick(tag)}
                className="px-2 py-0.5 text-[11px] rounded-md bg-muted/60 hover:bg-primary/10 hover:text-primary border border-border/70 text-muted-foreground transition-colors shrink-0 active:scale-95"
              >
                + {tag}
              </button>
            ))}
          </div>
        )}

        <div className="p-3 pt-1.5 space-y-1.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="relative flex flex-col space-y-1.5"
          >
            <textarea
              ref={textareaRef}
              rows={2}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="输入客户信息与意图..."
              className="w-full resize-none p-2.5 text-xs bg-background border border-input rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none pr-10 min-h-[54px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 transition-colors"
            />

            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] text-muted-foreground">
                Enter 发送，Shift+Enter 换行
              </span>

              <Button
                type="submit"
                size="sm"
                disabled={loading || !instruction.trim()}
                className="h-7 px-3 text-xs flex items-center gap-1 shadow-2xs"
              >
                {loading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <SendHorizontal className="w-3 h-3" />
                )}
                <span>发送</span>
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
