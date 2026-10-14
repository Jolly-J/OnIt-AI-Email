import React, { useState, useEffect, useRef } from 'react';
import { api, MailAccount, EmailAttachmentPayload } from '../lib/api';
import {
  X,
  Send,
  Sparkles,
  Loader2,
  Paperclip,
  Trash2,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  FileArchive,
  Film,
  File as FileIcon,
  CheckCircle2,
  AlertCircle,
  Clock,
  Mail,
  ChevronDown,
  Quote,
} from 'lucide-react';
import { toast } from './ui/Toast';
import { RecipientFields } from './RecipientFields';
import { normalizeRecipients } from '../lib/mailRecipients';

export interface QuoteEmailInfo {
  sender: string;
  sent_date: string;
  to_recipients?: string;
  subject: string;
  body_text: string;
}

export interface ComposeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: MailAccount[];
  defaultAccountId?: number | null;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  inReplyToEmailId?: number;
  mode?: 'compose' | 'reply';
  quoteEmail?: QuoteEmailInfo | null;
  activeDraftBody?: string;
  onDraftChange?: (newDraft: string) => void;
  onToChange?: (newTo: string) => void;
  onSubjectChange?: (newSubject: string) => void;
  onSent: () => void;
}

interface LocalAttachment {
  id: string;
  file: File;
  name: string;
  size: number;
  formattedSize: string;
  isLarge: boolean;
  status: 'ready' | 'uploading' | 'uploaded' | 'error';
  errorMsg?: string;
  largeToken?: string;
  downloadUrl?: string;
  expiresAt?: string;
  base64?: string;
}

const MAX_STANDARD_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_LARGE_SIZE = 200 * 1024 * 1024; // 200MB

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['pdf'].includes(ext)) {
    return <FileText className="w-4 h-4 text-rose-500 shrink-0" />;
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
    return <ImageIcon className="w-4 h-4 text-sky-500 shrink-0" />;
  }
  if (['xls', 'xlsx', 'csv'].includes(ext)) {
    return <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />;
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return <FileArchive className="w-4 h-4 text-amber-500 shrink-0" />;
  }
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
    return <Film className="w-4 h-4 text-indigo-500 shrink-0" />;
  }
  if (['doc', 'docx', 'txt', 'md'].includes(ext)) {
    return <FileText className="w-4 h-4 text-blue-500 shrink-0" />;
  }
  return <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />;
}

export const ComposeDialog: React.FC<ComposeDialogProps> = ({
  isOpen,
  onClose,
  accounts,
  defaultAccountId,
  initialTo = '',
  initialSubject = '',
  initialBody = '',
  inReplyToEmailId,
  mode = 'compose',
  quoteEmail,
  activeDraftBody,
  onDraftChange,
  onToChange,
  onSubjectChange,
  onSent,
}) => {
  const [mounted, setMounted] = useState(false);
  const [animating, setAnimating] = useState(false);

  const [selectedAccountId, setSelectedAccountId] = useState<number>(
    defaultAccountId || (accounts[0]?.id ?? 0)
  );
  const [toEmail, setToEmail] = useState('');
  const [ccEmail, setCcEmail] = useState('');
  const [bccEmail, setBccEmail] = useState('');
  const [expandedRecipients, setExpandedRecipients] = useState({ cc: false, bcc: false });
  const [subject, setSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [showQuote, setShowQuote] = useState(false);
  const [sending, setSending] = useState(false);
  const [toError, setToError] = useState('');
  const [isShakingTo, setIsShakingTo] = useState(false);
  const toInputRef = useRef<HTMLInputElement>(null);

  // 附件管理状态
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [cachedAttachments, setCachedAttachments] = useState<LocalAttachment[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (attachments.length > 0) {
      setCachedAttachments(attachments);
    }
  }, [attachments]);

  const displayAttachments = attachments.length > 0 ? attachments : cachedAttachments;

  // 动画生命周期控制与表单初始化
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      const timer = setTimeout(() => setAnimating(true), 20);

      const initTo = initialTo || '';
      const initSub = initialSubject || '';
      const initB = activeDraftBody !== undefined ? activeDraftBody : (initialBody || '');

      setToEmail(initTo);
      setCcEmail('');
      setBccEmail('');
      setExpandedRecipients({ cc: false, bcc: false });
      setSubject(initSub);
      setDraftBody(initB);
      onToChange?.(initTo);
      onSubjectChange?.(initSub);
      onDraftChange?.(initB);
      setAttachments([]);
      setToError('');
      setIsShakingTo(false);

      if (defaultAccountId) {
        setSelectedAccountId(defaultAccountId);
      } else if (accounts.length > 0 && !selectedAccountId) {
        setSelectedAccountId(accounts[0].id);
      }

      return () => clearTimeout(timer);
    } else {
      setAnimating(false);
      const timer = setTimeout(() => setMounted(false), 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialTo, initialSubject, inReplyToEmailId, mode, defaultAccountId]);

  // 当外部草稿产生变更（如右侧 AI 生成新拟稿或切换中/外文 Tab 时），实时同步更新当前编辑区
  useEffect(() => {
    if (activeDraftBody !== undefined && activeDraftBody !== draftBody) {
      setDraftBody(activeDraftBody);
    }
  }, [activeDraftBody]);

  // 处理所选文件列表
  const handleAddFiles = (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (!fileList.length) return;

    const newAttachments: LocalAttachment[] = [];

    fileList.forEach((file) => {
      // 校验大小上限 200MB
      if (file.size > MAX_LARGE_SIZE) {
        toast.error(`文件 "${file.name}" 超过 200MB 最大限制，无法添加`);
        return;
      }

      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const isLarge = file.size > MAX_STANDARD_SIZE;

      const item: LocalAttachment = {
        id,
        file,
        name: file.name,
        size: file.size,
        formattedSize: formatBytes(file.size),
        isLarge,
        status: 'uploading',
      };

      newAttachments.push(item);

      // 分流处理：普通附件转 Base64，超大附件上传云端中转站
      if (!isLarge) {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64Content = result.split(',')[1] || '';
          setAttachments((prev) =>
            prev.map((att) =>
              att.id === id ? { ...att, status: 'ready', base64: base64Content } : att
            )
          );
        };
        reader.onerror = () => {
          setAttachments((prev) =>
            prev.map((att) =>
              att.id === id ? { ...att, status: 'error', errorMsg: '读取文件失败' } : att
            )
          );
        };
        reader.readAsDataURL(file);
      } else {
        // 大文件立即异步触发中转上传
        api.emails
          .uploadLargeAttachment(file)
          .then((res) => {
            setAttachments((prev) =>
              prev.map((att) =>
                att.id === id
                  ? {
                      ...att,
                      status: 'uploaded',
                      largeToken: res.token,
                      downloadUrl: res.download_url,
                      expiresAt: res.expires_at,
                    }
                  : att
              )
            );
          })
          .catch((err) => {
            setAttachments((prev) =>
              prev.map((att) =>
                att.id === id
                  ? { ...att, status: 'error', errorMsg: err.message || '大文件上传失败' }
                  : att
              )
            );
          });
      }
    });

    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccountId) {
      toast.error('请选择发信邮箱');
      return;
    }

    let recipients: ReturnType<typeof normalizeRecipients>;
    try {
      recipients = normalizeRecipients(toEmail, ccEmail, bccEmail);
    } catch (error) {
      const message = error instanceof Error ? error.message : '邮箱地址格式不正确';
      if (message.startsWith('收件人') || message.startsWith('请输入收件人')) {
        setToError(message);
        setIsShakingTo(true);
        setTimeout(() => setIsShakingTo(false), 500);
        toInputRef.current?.focus();
      } else {
        toast.error(message);
      }
      return;
    }

    // 检查是否有大附件正在上传
    const isStillUploading = attachments.some((a) => a.status === 'uploading');
    if (isStillUploading) {
      toast.error('超大附件仍在上传中，请稍候片刻再发送');
      return;
    }

    // 检查是否有上传失败的附件
    const hasError = attachments.some((a) => a.status === 'error');
    if (hasError) {
      toast.error('部分附件处理失败，请先移除失败项后再发送');
      return;
    }

    setToError('');
    setSending(true);

    try {
      const payloadAttachments: EmailAttachmentPayload[] = attachments.map((att) => {
        if (att.isLarge) {
          return {
            filename: att.name,
            size: att.size,
            is_large: true,
            large_token: att.largeToken,
            download_url: att.downloadUrl,
            expires_at: att.expiresAt,
            content_type: att.file.type,
          };
        } else {
          return {
            filename: att.name,
            size: att.size,
            is_large: false,
            content_base64: att.base64,
            content_type: att.file.type,
          };
        }
      });

      const quoteContent = (mode === 'reply' && quoteEmail) ? [
        `----- Original Message -----`,
        `From: ${quoteEmail.sender}`,
        `Sent: ${quoteEmail.sent_date}`,
        quoteEmail.to_recipients ? `To: ${quoteEmail.to_recipients}` : null,
        `Subject: ${quoteEmail.subject}`,
        '',
        quoteEmail.body_text || '',
      ].filter(Boolean).join('\n') : '';

      const finalBodyText = quoteContent ? `${draftBody.trimEnd()}\n\n${quoteContent}` : draftBody;

      const result = await api.emails.compose({
        account_id: selectedAccountId,
        ...recipients,
        subject: subject.trim(),
        body_text: finalBodyText,
        attachments: payloadAttachments,
        in_reply_to_email_id: inReplyToEmailId,
      });

      if (result.delivery_warning) {
        toast.warning(result.delivery_warning, { duration: Infinity });
      } else {
        toast.success(mode === 'reply' ? '邮件回复已提交发信服务器！' : '邮件已提交发信服务器！');
      }
      setToEmail('');
      setSubject('');
      setDraftBody('');
      setAttachments([]);
      onSent();
      onClose();
    } catch (err: any) {
      toast.error(err.message || '发送失败，请检查网络与发信服务器状态');
    } finally {
      setSending(false);
    }
  };

  if (!mounted) return null;

  const totalAttachmentSize = attachments.reduce((acc, curr) => acc + curr.size, 0);
  const isUploadingAny = attachments.some((a) => a.status === 'uploading');

  return (
    <div
      className={`fixed inset-y-0 left-0 right-80 md:right-[420px] z-40 flex items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-xs select-text overflow-hidden t-modal-backdrop ${
        animating ? 'is-open' : 'is-closing'
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        if (e.dataTransfer.files) {
          handleAddFiles(e.dataTransfer.files);
        }
      }}
    >
      <div
        className={`w-full max-w-3xl lg:max-w-4xl bg-card rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] t-modal-surface ${
          animating ? 'is-open' : 'is-closing'
        } ${isDraggingOver ? 'ring-2 ring-primary ring-offset-2' : ''}`}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/20 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Mail className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground tracking-tight">
                {mode === 'reply' ? '回复邮件 · 高级编辑器' : '撰写新邮件'}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 表单主体 */}
        <form onSubmit={handleSend} noValidate className="px-6 py-4 flex-1 min-h-0 space-y-3 overflow-y-auto stable-scrollbar">
          {/* 发件人与收件人 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground/80 mb-1.5">
                发件人邮箱
              </label>
              <div className="relative">
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(Number(e.target.value))}
                  className="w-full h-10 px-3 pr-8 text-sm bg-background border border-input rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none appearance-none transition-colors text-foreground"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.email_address})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-3 top-3 pointer-events-none" />
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-foreground/80 mb-1.5 flex items-center justify-between gap-2">
                <span>收件人地址</span>
                <div className="flex items-center gap-3 shrink-0">
                  {!expandedRecipients.cc && !ccEmail && <button type="button" disabled={sending}
                    className="text-primary hover:underline" onClick={() => setExpandedRecipients((prev) => ({ ...prev, cc: true }))}>抄送</button>}
                  {!expandedRecipients.bcc && !bccEmail && <button type="button" disabled={sending}
                    className="text-primary hover:underline" onClick={() => setExpandedRecipients((prev) => ({ ...prev, bcc: true }))}>密送</button>}
                </div>
              </div>
              {toError && (
                <span className="mb-1 text-[11px] text-destructive font-normal flex items-center gap-1 animate-in fade-in duration-150">
                  <AlertCircle className="w-3 h-3" />
                  <span>{toError}</span>
                </span>
              )}
              <div className="relative">
                <input
                  ref={toInputRef}
                  type="text"
                  required
                  value={toEmail}
                  onChange={(e) => {
                    const val = e.target.value;
                    setToEmail(val);
                    onToChange?.(val);
                    if (toError) setToError('');
                  }}
                  placeholder="client@foreign-company.com"
                  className={`w-full h-10 px-3 text-sm bg-background rounded-lg focus:outline-none transition-all placeholder:text-muted-foreground/60 ${
                    toError
                      ? 'border border-destructive ring-1 ring-destructive/40 text-destructive'
                      : 'border border-input focus:ring-2 focus:ring-primary/20 focus:border-primary text-foreground'
                  } ${isShakingTo ? 't-error-shake' : ''}`}
                />
              </div>
            </div>
          </div>

          <RecipientFields key={String(isOpen)} cc={ccEmail} bcc={bccEmail}
            expanded={expandedRecipients}
            onCollapse={(field) => setExpandedRecipients((prev) => ({ ...prev, [field]: false }))}
            onCcChange={setCcEmail} onBccChange={setBccEmail} disabled={sending} />

          {/* 邮件主题 */}
          <div>
            <label className="block text-xs font-medium text-foreground/80 mb-1.5">
              邮件主题
            </label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => {
                const val = e.target.value;
                setSubject(val);
                onSubjectChange?.(val);
              }}
              placeholder="Inquiry / Quotation / Follow up"
              className="w-full h-10 px-3 text-sm bg-background border border-input rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none transition-colors text-foreground placeholder:text-muted-foreground/60"
            />
          </div>

          {/* 邮件正文区域 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
                <span>正文内容</span>
                <span className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full font-normal border border-primary/20 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  与右侧 AI 伴随实时双向同步
                </span>
              </label>
            </div>
            <textarea
              required
              rows={8}
              value={draftBody}
              onChange={(e) => {
                const val = e.target.value;
                setDraftBody(val);
                onDraftChange?.(val);
              }}
              placeholder="在此输入邮件正文（可在右侧继续与 AI 对话下达指令，最新拟稿将实时更新在此）..."
              className="block w-full h-[clamp(180px,30vh,360px)] min-h-[120px] p-3.5 text-sm bg-background border border-input rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none resize-y overflow-y-auto stable-scrollbar leading-relaxed text-foreground placeholder:text-muted-foreground/50 transition-colors"
            />

            {/* 结构化原邮件往来追溯引用 */}
            {mode === 'reply' && quoteEmail && (
              <div className="mt-2.5 p-3 bg-muted/30 rounded-xl border border-border/70 text-xs select-text transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium flex items-center gap-1.5 text-foreground/80 min-w-0 truncate">
                    <Quote className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="truncate">原邮件往来追溯引用 · {quoteEmail.sender}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowQuote(!showQuote)}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-background hover:bg-muted/80 text-foreground/80 border border-input shadow-2xs flex items-center gap-1.5 transition-all active:scale-95 shrink-0"
                  >
                    <span>{showQuote ? '收起往来原文' : '展开查看往来原文'}</span>
                    <ChevronDown
                      className={`w-3 h-3 text-muted-foreground transition-transform duration-200 ease-out ${
                        showQuote ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                </div>

                {/* 平滑生长折叠过渡动画 */}
                <div
                  className={`grid transition-all duration-300 ease-in-out ${
                    showQuote ? 'grid-rows-[1fr] opacity-100 mt-2.5' : 'grid-rows-[0fr] opacity-0 mt-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="pt-2.5 border-t border-border/50 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto stable-scrollbar font-sans bg-background/60 p-3 rounded-lg border border-border/40 select-text">
                      <div className="text-[10px] text-muted-foreground/75 mb-2 pb-1.5 border-b border-border/30 space-y-0.5 font-sans">
                        <div><span className="font-medium text-foreground/70">发件人：</span>{quoteEmail.sender}</div>
                        <div><span className="font-medium text-foreground/70">时　间：</span>{quoteEmail.sent_date}</div>
                        <div><span className="font-medium text-foreground/70">主　题：</span>{quoteEmail.subject}</div>
                      </div>
                      {quoteEmail.body_text || '（无原邮件文本）'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 已选附件展示区域（方案 B：采用 21-accordion.md 规范，利用 grid-template-rows: 0fr ↔ 1fr 平滑伸展与收缩） */}
          <div
            className="t-acc-panel"
            data-open={attachments.length > 0}
          >
            <div className="t-acc-panel-inner">
              {displayAttachments.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
                    <span className="font-medium text-foreground/80 flex items-center gap-1.5">
                      <Paperclip className="w-3.5 h-3.5 text-primary" />
                      已添加附件 ({attachments.length})
                    </span>
                    <span>总容量: {formatBytes(totalAttachmentSize)}</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[160px] overflow-y-auto stable-scrollbar pr-1">
                    {displayAttachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-card/60 hover:bg-muted/40 transition-colors group"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                            {getFileIcon(att.name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-foreground truncate" title={att.name}>
                              {att.name}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                              <span>{att.formattedSize}</span>
                              {att.isLarge ? (
                                <span className="inline-flex items-center gap-0.5 text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400 px-1.5 py-0.2 rounded text-[10px] font-medium border border-amber-200/60 dark:border-amber-800/40">
                                  <Clock className="w-2.5 h-2.5" /> 7天云中转
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400 px-1.5 py-0.2 rounded text-[10px] font-medium border border-emerald-200/60 dark:border-emerald-800/40">
                                  普通附件
                                </span>
                              )}

                              {att.status === 'uploading' && (
                                <span className="text-primary flex items-center gap-1">
                                  <Loader2 className="w-3 h-3 animate-spin" /> 处理中
                                </span>
                              )}
                              {att.status === 'error' && (
                                <span className="text-destructive">{att.errorMsg || '失败'}</span>
                              )}
                              {att.status === 'ready' && (
                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                              )}
                              {att.status === 'uploaded' && (
                                <CheckCircle2 className="w-3 h-3 text-amber-500" />
                              )}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(att.id)}
                          className="p-1 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10 transition-colors ml-2"
                          title="移除附件"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 底部操作工具栏 */}
          <div className="flex items-center justify-between pt-4 border-t border-border mt-2 shrink-0">
            {/* 添加附件入口 */}
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    handleAddFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="h-9 px-3 text-xs font-medium text-foreground bg-background hover:bg-muted border border-input rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs"
              >
                <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                <span>添加附件</span>
              </button>
              <span className="text-[11px] text-muted-foreground hidden sm:inline">
                支持拖拽文件，单文件最大 200MB
              </span>
            </div>

            {/* 发送与取消 */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={sending}
                className="h-9 px-3.5 text-xs font-medium text-foreground bg-background hover:bg-muted border border-input rounded-lg transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={sending || isUploadingAny}
                className="h-9 px-4 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>正在发信...</span>
                  </>
                ) : isUploadingAny ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>附件就绪中...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>立即发送</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
