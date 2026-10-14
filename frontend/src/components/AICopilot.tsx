import React, { useState, useEffect, useRef } from 'react';
import { EmailDetail, ChatMessageItem, api } from '../lib/api';
import { formatLanguageLabel } from '../lib/utils';
import {
  Sparkles,
  Send,
  CheckCheck,
  AlertTriangle,
  Loader2,
  RefreshCw,
  ListTodo,
  Lightbulb,
  FileText,
  PenTool,
  Pencil,
  RotateCcw,
  ArrowUpRight,
  ArrowLeft,
  Calendar,
  Video,
} from 'lucide-react';
import { toast } from './ui/Toast';
import { EnhancedMarkdown } from './EnhancedMarkdown';
import { ThinkingProcess } from './ThinkingProcess';
import { DingTalkScheduleDialog } from './DingTalkScheduleDialog';

interface AICopilotProps {
  email: EmailDetail | null;
  onReplySuccess: () => void;
  onEmailUpdated?: () => void;
  onOpenAdvancedReply?: (draftText: string, lang: 'zh' | 'foreign') => void;
  isAdvancedEditorOpen?: boolean;
  onDraftSync?: (newDraft: string) => void;
  externalDraft?: string;
}

export const AICopilot: React.FC<AICopilotProps> = ({
  email,
  onReplySuccess,
  onEmailUpdated,
  onOpenAdvancedReply,
  isAdvancedEditorOpen = false,
  onDraftSync,
  externalDraft,
}) => {
  const [chatHistory, setChatHistory] = useState<ChatMessageItem[]>([]);
  const [instruction, setInstruction] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const [sendingMsg, setSendingMsg] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [editedDrafts, setEditedDrafts] = useState<Record<string | number, string>>({});
  const [draftLangMap, setDraftLangMap] = useState<Record<string | number, 'orig' | 'zh'>>({});
  const [error, setError] = useState('');
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [isExtractingMeeting, setIsExtractingMeeting] = useState(false);
  const [meetingData, setMeetingData] = useState<any>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // 统一草稿状态键名，彻底杜绝高级编辑器与伴随栏双向同步错位
  const getDraftKeys = (msgId: number | string, lang: 'orig' | 'zh') => {
    const draftKey = String(msgId);
    const editKey = `${draftKey}_${lang}`;
    return { draftKey, editKey };
  };

  // 严格限制：始终计算出最新一条包含真实草稿的 assistant 消息 ID
  const latestDraftMsgId = [...chatHistory].reverse().find(
    (m) => m.role === 'assistant' && (Boolean(m.draft_reply?.trim()) || Boolean(m.draft_reply_zh?.trim()))
  )?.id;

  // 当用户在高级编辑器中修改文字时，实时双向反映到 AI 伴随栏当前最新的草稿卡片中
  useEffect(() => {
    // 关键安全守卫：仅当高级编辑器确实处于打开协同状态时，才接收外部草稿同步，彻底避免初始化空字符串意外刷掉本地正常草稿
    if (!isAdvancedEditorOpen || externalDraft === undefined || chatHistory.length === 0) {
      return;
    }
    const lastAssistantMsg = [...chatHistory].reverse().find(
      (m) => m.role === 'assistant' && (Boolean(m.draft_reply?.trim()) || Boolean(m.draft_reply_zh?.trim()))
    );
    if (lastAssistantMsg) {
      const currentLang = draftLangMap[String(lastAssistantMsg.id)] || 'orig';
      const { editKey } = getDraftKeys(lastAssistantMsg.id, currentLang);
      setEditedDrafts((prev) => {
        if (prev[editKey] === externalDraft) return prev;
        return { ...prev, [editKey]: externalDraft };
      });
    }
  }, [isAdvancedEditorOpen, externalDraft, chatHistory, draftLangMap]);

  // 加载该邮件的历史对话
  useEffect(() => {
    setEditedDrafts({});
    setDraftLangMap({});
    if (!email) {
      setChatHistory([]);
      return;
    }
    const loadHistory = async () => {
      setLoadingChat(true);
      setError('');
      try {
        const history = await api.chat.getHistory(email.id);
        setChatHistory(history);
      } catch (err: any) {
        console.error(err);
      } finally {
        setLoadingChat(false);
      }
    };
    loadHistory();
  }, [email?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, sendingMsg]);

  if (!email) {
    return (
      <div className="w-full flex flex-col items-center justify-center text-center text-[13px] text-muted-foreground bg-muted/10 h-full shrink-0 select-none">
        <img src="/bandu_logo.png" alt="知了伴随" className="w-10 h-10 max-w-[40px] max-h-[40px] mb-2.5 opacity-50 grayscale select-none object-contain" />
        <span>知了伴随</span>
      </div>
    );
  }

  const handleSendInstruction = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault();
    const textToSend = (customText !== undefined ? customText : instruction).trim();
    if (!textToSend || sendingMsg) return;

    if (customText === undefined) {
      setInstruction('');
    }
    setSendingMsg(true);
    setError('');

    // 获取当前正在查看或已手动编辑的最新草稿，以及当前活跃语言（中文/外文）
    let activeDraft = '';
    let currentActiveLang: 'orig' | 'zh' = 'orig';
    const latestAssistantMsg = [...chatHistory].reverse().find(
      (m) => m.role === 'assistant' && (Boolean(m.draft_reply?.trim()) || Boolean(m.draft_reply_zh?.trim()))
    );
    if (latestAssistantMsg) {
      currentActiveLang = draftLangMap[String(latestAssistantMsg.id)] || 'orig';
    }

    if (externalDraft && externalDraft.trim()) {
      activeDraft = externalDraft.trim();
    } else if (latestAssistantMsg) {
      const { editKey } = getDraftKeys(latestAssistantMsg.id, currentActiveLang);
      const baseText = currentActiveLang === 'zh' ? latestAssistantMsg.draft_reply_zh : latestAssistantMsg.draft_reply;
      const currentText = editedDrafts[editKey] !== undefined ? editedDrafts[editKey] : (baseText || '');
      if (currentText && currentText.trim()) {
        activeDraft = currentText.trim();
      }
    }

    // 乐观添加用户消息
    const tempUserMsg: ChatMessageItem = {
      id: Date.now(),
      role: 'user',
      content: textToSend,
      draft_reply: '',
      created_at: new Date().toISOString(),
    };
    setChatHistory((prev) => [...prev, tempUserMsg]);

    try {
      const assistantMsg = await api.chat.sendMessage(email.id, textToSend, activeDraft || undefined);
      setChatHistory((prev) => [...prev.slice(0, -1), tempUserMsg, assistantMsg]);

      // 判断本次大模型是否输出了新的草稿（沟通优先：若大模型仅为交流探讨，草稿字段为空，此时不冲刷大编辑器）
      const hasForeignDraft = Boolean(assistantMsg.draft_reply && assistantMsg.draft_reply.trim());
      const hasZhDraft = Boolean(assistantMsg.draft_reply_zh && assistantMsg.draft_reply_zh.trim());
      const hasAnyNewDraft = hasForeignDraft || hasZhDraft;

      if (hasAnyNewDraft) {
        // 自动继承当前语种视角（若上一轮在看中文且新草稿有中文，继续保持中文；否则若只有中文则切中文）
        let inheritLang: 'orig' | 'zh' = currentActiveLang;
        if (currentActiveLang === 'zh' && hasZhDraft) {
          inheritLang = 'zh';
        } else if (!hasForeignDraft && hasZhDraft) {
          inheritLang = 'zh';
        } else if (!hasZhDraft && hasForeignDraft) {
          inheritLang = 'orig';
        }
        setDraftLangMap((prev) => ({ ...prev, [String(assistantMsg.id)]: inheritLang }));

        // 若高级编辑器正打开中，根据继承的语种，将对应的新草稿精准推入高级编辑器
        if (isAdvancedEditorOpen) {
          const targetDraft = inheritLang === 'zh'
            ? (assistantMsg.draft_reply_zh || assistantMsg.draft_reply || '')
            : (assistantMsg.draft_reply || assistantMsg.draft_reply_zh || '');
          if (targetDraft.trim()) {
            onDraftSync?.(targetDraft);
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'AI 回复生成失败，请检查 DeepSeek API 配置');
    } finally {
      setSendingMsg(false);
    }
  };

  const handleReanalyze = async () => {
    if (!email || reanalyzing) return;
    setReanalyzing(true);
    setError('');
    try {
      await api.emails.reanalyze(email.id);
      if (onEmailUpdated) onEmailUpdated();
    } catch (err: any) {
      setError(err.message || '重新分析失败，请检查 DeepSeek API Key');
    } finally {
      setReanalyzing(false);
    }
  };

  const hasMeetingCue = Boolean(
    email && (
      (email.action_items && email.action_items.some((it) => /会议|线上|对谈|视频|安排时间|钉钉|拜访|沟通|协商/i.test(it))) ||
      (email.summary_zh && /会议|线上|对谈|视频|安排时间|钉钉|拜访/i.test(email.summary_zh)) ||
      (email.ai_guided_question && /会议|线上|时间|视频|对谈/i.test(email.ai_guided_question))
    )
  );

  const handleOpenScheduleDialog = async () => {
    if (!email) return;
    setIsExtractingMeeting(true);
    try {
      let cleanSender = email.sender || '';
      if (cleanSender.includes('<') && cleanSender.includes('>')) {
        cleanSender = cleanSender.split('<')[1].split('>')[0].trim();
      }

      const lastAssistantMsg = [...chatHistory].reverse().find(
        (m) => m.role === 'assistant' && (Boolean(m.draft_reply?.trim()) || Boolean(m.draft_reply_zh?.trim()))
      );
      const currentDraftText = lastAssistantMsg
        ? (lastAssistantMsg.draft_reply || lastAssistantMsg.draft_reply_zh || '')
        : '';

      const contentToAnalyze = [
        email.body_text || email.summary_zh || '',
        currentDraftText ? `【拟定回复草稿】\n${currentDraftText}` : '',
      ].filter(Boolean).join('\n\n');

      const proposal = await api.calendar.extractProposal({
        content: contentToAnalyze,
        email_subject: email.subject,
      });

      // 无论何种情况，会议主题必须 100% 保持规范简体中文
      const containsJapanese = (str: string) => /[\u3040-\u30ff]/.test(str);
      const isCleanChinese = (str: string) => Boolean(str && !containsJapanese(str) && /[\u4e00-\u9fa5]/.test(str));

      let finalSummary = '';
      if (proposal.summary && isCleanChinese(proposal.summary)) {
        finalSummary = proposal.summary.startsWith('【') ? proposal.summary : `【线上沟通】${proposal.summary}`;
      } else if (email.translated_subject && isCleanChinese(email.translated_subject)) {
        finalSummary = email.translated_subject.startsWith('【')
          ? email.translated_subject
          : `【线上沟通】${email.translated_subject}`;
      } else if (email.subject && isCleanChinese(email.subject)) {
        finalSummary = email.subject.startsWith('【')
          ? email.subject
          : `【线上沟通】${email.subject}`;
      } else {
        finalSummary = '【线上沟通】业务对接与技术交流';
      }

      const today = new Date().toISOString().split('T')[0];
      setMeetingData({
        summary: finalSummary,
        description: proposal.description || email.summary_zh || '',
        meeting_date: proposal.meeting_date || today,
        start_time: proposal.start_time || '15:00',
        end_time: proposal.end_time || '16:00',
        attendee_mobiles: proposal.attendee_mobiles || [],
        attendee_emails: proposal.attendee_emails?.length ? proposal.attendee_emails : (cleanSender ? [cleanSender] : []),
        email_account_id: email.account_id,
      });
      setIsScheduleDialogOpen(true);
    } catch (err: any) {
      console.error('提取会议日程提议失败:', err);
      const containsJapanese = (str: string) => /[\u3040-\u30ff]/.test(str);
      const isCleanChinese = (str: string) => Boolean(str && !containsJapanese(str) && /[\u4e00-\u9fa5]/.test(str));

      let fallbackSummary = '';
      if (email.translated_subject && isCleanChinese(email.translated_subject)) {
        fallbackSummary = email.translated_subject.startsWith('【')
          ? email.translated_subject
          : `【线上沟通】${email.translated_subject}`;
      } else if (email.subject && isCleanChinese(email.subject)) {
        fallbackSummary = email.subject.startsWith('【')
          ? email.subject
          : `【线上沟通】${email.subject}`;
      } else {
        fallbackSummary = '【线上沟通】业务对接与技术交流';
      }

      const today = new Date().toISOString().split('T')[0];
      setMeetingData({
        summary: fallbackSummary,
        description: email.summary_zh || '',
        meeting_date: today,
        start_time: '15:00',
        end_time: '16:00',
        attendee_emails: [email.sender],
        email_account_id: email.account_id,
      });
      setIsScheduleDialogOpen(true);
    } finally {
      setIsExtractingMeeting(false);
    }
  };

  return (
    <div className="w-full flex flex-col h-full bg-background shrink-0 select-none">
      {/* 标题 */}
      <div className="h-[52px] px-3 border-b flex items-center justify-between bg-muted/10 gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <img
            src="/bandu_logo.png"
            alt="知了伴随"
            className="w-7 h-7 max-w-[28px] max-h-[28px] object-contain select-none shrink-0"
          />
          <h3 className="font-semibold text-[13px] text-foreground">知了伴随</h3>
          {isAdvancedEditorOpen && (
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-primary/25 bg-primary/10 text-primary flex items-center gap-1 animate-pulse shrink-0"
              title="当前正与中间的高级邮件编辑器保持实时双向同步"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              协同中
            </span>
          )}
          {email.language_detected && (
            <span
              title={`来信语言判定: ${formatLanguageLabel(email.language_detected)}`}
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${
                email.language_detected.toLowerCase().startsWith('zh')
                  ? 'bg-primary/10 text-primary border-primary/20'
                  : 'bg-muted/80 text-muted-foreground border-border'
              }`}
            >
              {formatLanguageLabel(email.language_detected)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleOpenScheduleDialog}
            disabled={isExtractingMeeting || !email}
            title="安排钉钉视频会议日程并静默锁定 OA 会议室"
            className="px-2.5 py-1 text-[12px] font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 rounded-md flex items-center gap-1 transition-colors disabled:opacity-50"
          >
            {isExtractingMeeting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
            ) : (
              <Video className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            )}
            <span>排期会议</span>
          </button>

          <button
            onClick={handleReanalyze}
            disabled={reanalyzing}
            title="重新深度分析"
            className="px-2.5 py-1 text-[12px] font-medium text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/15 rounded-md flex items-center gap-1 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reanalyzing ? 'animate-spin' : ''}`} />
            <span>{reanalyzing ? '分析中...' : '重新分析'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-2.5 mx-3 mt-2 text-[13px] text-destructive bg-destructive/10 rounded-lg border border-destructive/20 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 滚动交互区 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 stable-scrollbar select-text">
        {email.folder === 'sent' && (
          <div className="p-3 rounded-xl bg-primary/5 border border-primary/15 text-[12px] text-muted-foreground flex items-center gap-2">
            <CheckCheck className="w-4 h-4 text-primary shrink-0" />
            <span className="text-foreground/90 font-medium">该邮件为已发送邮件，已由系统及云端服务商归档存管。</span>
          </div>
        )}
        {email.folder === 'drafts' && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <Pencil className="w-4 h-4 shrink-0" />
            <span>该邮件为草稿箱未发送信件。</span>
          </div>
        )}
        {email.folder === 'trash' && (
          <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-[12px] text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>该邮件当前位于已删除 / 垃圾箱。</span>
          </div>
        )}

        {/* ① 邮件内容与要点解读卡片 */}
        <div className="p-3.5 rounded-xl bg-card border shadow-xs space-y-2.5">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-primary">
            <FileText className="w-3.5 h-3.5" />
            <span>{email.folder === 'sent' ? '发件核心内容速览' : '邮件内容与核心要点'}</span>
          </div>

          {email.summary_zh ? (
            <p className="text-[13px] text-foreground leading-relaxed font-medium">
              {email.summary_zh}
            </p>
          ) : (
            <div className="py-2 px-3 rounded-lg bg-primary/5 border border-primary/10 flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
              <span className="font-medium text-foreground text-[13px]">正在深度分析...</span>
            </div>
          )}

          {email.key_points && email.key_points.length > 0 && (
            <ul className="space-y-1 text-[13px] text-muted-foreground list-disc list-inside pt-0.5">
              {email.key_points.map((pt, i) => (
                <li key={i} className="leading-normal">{pt}</li>
              ))}
            </ul>
          )}

          {email.action_items && email.action_items.length > 0 && (
            <div className="pt-2 border-t mt-2">
              <span className="text-[12px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5 mb-1">
                <ListTodo className="w-3.5 h-3.5" />
                <span>对方诉求 / 待办事项：</span>
              </span>
              <ul className="space-y-1 text-[13px] text-muted-foreground list-disc list-inside">
                {email.action_items.map((it, i) => (
                  <li key={i} className="leading-normal">{it}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ② AI 专业应对建议卡片（仅收件箱展示） */}
        {email.folder !== 'sent' && email.ai_guided_question && (
          <div className="p-3.5 rounded-xl bg-gradient-to-br from-primary/5 via-primary/8 to-primary/15 border border-primary/20 shadow-xs space-y-1.5">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-primary">
              <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
              <span>AI 专业应对建议</span>
            </div>
            <p className="text-[13px] font-medium text-foreground leading-relaxed">
              {email.ai_guided_question}
            </p>
          </div>
        )}

        {/* 会议排期智能感知卡片 */}
        {hasMeetingCue && (
          <div className="p-3.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-800/40 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                <Video className="w-3.5 h-3.5 text-blue-500" />
                <span>检测到会议日程沟通</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300 font-medium">
                钉钉 + OA 联动
              </span>
            </div>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              双方沟通中涉及线上交流或时间协商。可一键安排钉钉视频日程并静默锁定物理会议室。
            </p>
            <button
              type="button"
              onClick={handleOpenScheduleDialog}
              disabled={isExtractingMeeting}
              className="w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              {isExtractingMeeting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>智能提取中...</span>
                </>
              ) : (
                <>
                  <Calendar className="w-3.5 h-3.5" />
                  <span>一键安排钉钉视频会议日程</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* ③ 回复草稿快捷拟定（未下达指令时展示快捷入口） */}
        {chatHistory.length === 0 && (
          <div className="p-3.5 rounded-xl bg-muted/30 border border-dashed space-y-2">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <PenTool className="w-3.5 h-3.5 text-primary" />
              <span>回复草稿</span>
            </div>

            <div className="space-y-1.5">
              <button
                onClick={() => handleSendInstruction(undefined, '请根据上述 AI 应对建议与策略，帮我起草一份正式得体的完整商务回复邮件。')}
                disabled={sendingMsg}
                className="w-full py-2 px-3 bg-primary text-primary-foreground text-[12px] font-medium rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-between shadow-xs disabled:opacity-50 text-left"
              >
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span>采纳 AI 建议一键起草回复</span>
                </span>
                <span className="text-[11px] opacity-80">点击起草 &rarr;</span>
              </button>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => handleSendInstruction(undefined, '请帮我礼貌委婉地回复谢绝对方的提议/请求，保持良好商务关系。')}
                  disabled={sendingMsg}
                  className="py-1.5 px-2 bg-background hover:bg-muted border text-foreground text-[11px] font-medium rounded-lg transition-colors text-center disabled:opacity-50"
                >
                  礼貌委婉谢绝
                </button>
                <button
                  onClick={() => handleSendInstruction(undefined, '请帮我起草简短回复，确认已收到邮件，正在内部评估，稍后正式答复。')}
                  disabled={sendingMsg}
                  className="py-1.5 px-2 bg-background hover:bg-muted border text-foreground text-[11px] font-medium rounded-lg transition-colors text-center disabled:opacity-50"
                >
                  告知稍后答复
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ③ 多轮对话消息流 */}
        {chatHistory.map((msg, idx) => {
          const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id || idx}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-2`}
              >
                {/* 气泡 ①：小助理简要汇报 */}
                <div
                  className={`max-w-[90%] p-3 rounded-xl text-[13px] leading-relaxed ${
                    isUser
                      ? 'bg-primary text-primary-foreground font-medium rounded-br-none whitespace-pre-wrap'
                      : 'bg-card border text-foreground rounded-bl-none shadow-sm'
                  }`}
                >
                  {isUser ? msg.content : <EnhancedMarkdown content={msg.content} />}
                </div>

                {/* 卡片 ②：回复草稿框（支持外文原稿 / 1:1完整中文公文互切，仅在真正生成拟稿时展示） */}
                {(Boolean(msg.draft_reply?.trim()) || Boolean(msg.draft_reply_zh?.trim())) && (() => {
                  const isLatestDraft = msg.id === latestDraftMsgId;
                  const currentLang = draftLangMap[String(msg.id)] || 'orig';
                  const hasZhDraft = Boolean(msg.draft_reply_zh && msg.draft_reply_zh.trim());
                  const hasForeignDraft = Boolean(msg.draft_reply && msg.draft_reply.trim());

                  // 统一键名，确保仅最新草稿与高级编辑器实时双向同步
                  const { draftKey, editKey } = getDraftKeys(msg.id, currentLang);
                  const baseText = currentLang === 'zh'
                    ? (msg.draft_reply_zh || msg.draft_reply || '')
                    : (msg.draft_reply || msg.draft_reply_zh || '');
                  const currentDraft = editedDrafts[editKey] !== undefined ? editedDrafts[editKey] : baseText;
                  const isModified = isLatestDraft && editedDrafts[editKey] !== undefined && editedDrafts[editKey] !== baseText;

                  return (
                    <div className={`w-full p-3.5 rounded-xl border shadow-xs space-y-2.5 text-left animate-in fade-in duration-150 ${
                      isLatestDraft ? 'bg-card' : 'bg-muted/15 border-dashed opacity-90'
                    }`}>
                      <div className="flex items-center justify-between text-[12px] font-semibold text-primary gap-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Pencil className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{isLatestDraft ? '回复草稿' : '历史回复草稿'}</span>
                          {isModified && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-normal shrink-0">
                              已修改
                            </span>
                          )}
                          {!isLatestDraft && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-normal shrink-0">
                              历史存档
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* 双语切换 Tab（当同时存在外文原稿与 1:1 中文公文时展示，采用 16-tabs-sliding 规范） */}
                          {hasZhDraft && hasForeignDraft && (
                            <div className="relative grid grid-cols-2 w-36 bg-muted/80 p-0.5 rounded-lg border text-[11px] select-none">
                              <div
                                className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-background shadow-xs transition-transform duration-200 ease-out pointer-events-none"
                                style={{
                                  transform: currentLang === 'orig' ? 'translateX(0%)' : 'translateX(100%)',
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setDraftLangMap((prev) => ({ ...prev, [draftKey]: 'orig' }));
                                  // 关键守卫：仅最新草稿的 Tab 切换才同步给高级编辑器，历史草稿仅供本地查阅
                                  if (isLatestDraft) {
                                    const origText = editedDrafts[`${draftKey}_orig`] !== undefined ? editedDrafts[`${draftKey}_orig`] : (msg.draft_reply || '');
                                    onDraftSync?.(origText);
                                  }
                                }}
                                className={`relative z-10 w-full py-0.5 text-center rounded-md transition-colors font-medium ${
                                  currentLang === 'orig'
                                    ? 'text-foreground font-semibold'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                外文原稿
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDraftLangMap((prev) => ({ ...prev, [draftKey]: 'zh' }));
                                  // 关键守卫：仅最新草稿的 Tab 切换才同步给高级编辑器，历史草稿仅供本地查阅
                                  if (isLatestDraft) {
                                    const zhText = editedDrafts[`${draftKey}_zh`] !== undefined ? editedDrafts[`${draftKey}_zh`] : (msg.draft_reply_zh || '');
                                    onDraftSync?.(zhText);
                                  }
                                }}
                                className={`relative z-10 w-full py-0.5 text-center rounded-md transition-colors font-medium ${
                                  currentLang === 'zh'
                                    ? 'text-primary font-semibold'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                <span>中文译稿</span>
                              </button>
                            </div>
                          )}

                          {isModified && (
                            <button
                              onClick={() => {
                                setEditedDrafts((prev) => {
                                  const next = { ...prev };
                                  delete next[editKey];
                                  return next;
                                });
                                if (isLatestDraft) {
                                  onDraftSync?.(baseText || '');
                                }
                              }}
                              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
                              title="撤销当前语言的手动修改，还原为 AI 原始草稿"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>还原</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 可直接自由修改的文本框（历史草稿卡片归档为只读查看模式） */}
                      <textarea
                        key={`${msg.id}_${currentLang}`}
                        value={isLatestDraft ? currentDraft : baseText}
                        readOnly={!isLatestDraft}
                        onChange={isLatestDraft ? (e) => {
                          const val = e.target.value;
                          setEditedDrafts((prev) => ({ ...prev, [editKey]: val }));
                          onDraftSync?.(val);
                        } : undefined}
                        rows={7}
                        placeholder={
                          !isLatestDraft
                            ? '历史版本草稿（仅供查阅与比对）'
                            : (currentLang === 'zh' ? '在此查看或修改对应的完整中文公文...' : '在此直接编辑修改外语回复草稿...')
                        }
                        className={`w-full text-[13px] leading-relaxed p-3 rounded-lg border font-sans resize-y stable-scrollbar min-h-[140px] transition-all animate-in fade-in duration-200 ${
                          isLatestDraft
                            ? 'bg-muted/20 hover:bg-background focus:bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary'
                            : 'bg-muted/10 text-muted-foreground/90 border-dashed select-text cursor-default'
                        }`}
                      />

                      {/* 仅最新一条草稿展示进入高级编辑器按钮，历史草稿卡片隐藏 */}
                      {isLatestDraft && (
                        <button
                          disabled={!currentDraft.trim()}
                          onClick={() => onOpenAdvancedReply?.(currentDraft, currentLang === 'zh' ? 'zh' : 'foreign')}
                          className={`w-full py-2 px-3 text-[13px] font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 group ${
                            isAdvancedEditorOpen
                              ? 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary/15'
                              : 'bg-primary text-primary-foreground hover:bg-primary/90'
                          }`}
                          title="在大窗口中进一步编辑、挂载普通或超大附件并最终确认发信"
                        >
                          {isAdvancedEditorOpen ? (
                            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
                          ) : (
                            <ArrowUpRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                          )}
                          <span>{isAdvancedEditorOpen ? '正在高级编辑器协同编辑中' : '去发送'}</span>
                        </button>
                      )}
                    </div>
                  );
                })()}

              {/* 气泡 ③：外文稿内容对照与策略说明（统一为标准对话气泡） */}
              {msg.explanation && (
                <div className="max-w-[90%] p-3 rounded-xl text-[13px] leading-relaxed bg-card border text-foreground rounded-bl-none shadow-sm select-text">
                  <EnhancedMarkdown content={msg.explanation} />
                </div>
              )}
            </div>
          );
        })}

        {sendingMsg && (
          <ThinkingProcess />
        )}

        <div ref={chatEndRef} />
      </div>

      {/* 底部用户指令输入框 */}
      <div className="p-3 border-t bg-card">
        <form onSubmit={handleSendInstruction} className="flex items-center gap-2">
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="请指示"
            className="flex-1 px-4 py-2 text-[13px] bg-background border rounded-full focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60"
          />
          <button
            type="submit"
            disabled={!instruction.trim() || sendingMsg}
            title="发送指令"
            className="w-9 h-9 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center shrink-0 shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>

      {/* 钉钉视频会议日程与 OA 物理会议室静默预约弹窗 */}
      <DingTalkScheduleDialog
        open={isScheduleDialogOpen}
        onOpenChange={setIsScheduleDialogOpen}
        initialData={meetingData}
        onSuccess={() => {
          toast.success('钉钉视频会议日程已安排，OA 物理会议室已静默锁定');
        }}
      />
    </div>
  );
};
