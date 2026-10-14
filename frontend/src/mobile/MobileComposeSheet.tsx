import React, { useState, useEffect } from 'react';
import { MailAccount, api } from '@/lib/api';
import { QuoteEmailInfo } from '@/components/ComposeDialog';
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Send, ChevronDown, Paperclip } from 'lucide-react';
import { toast } from '@/components/ui/Toast';
import { RecipientFields } from '@/components/RecipientFields';
import { normalizeRecipients } from '@/lib/mailRecipients';

interface MobileComposeSheetProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: MailAccount[];
  defaultAccountId: number | null;
  mode: 'compose' | 'reply';
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  inReplyToEmailId?: number;
  quoteEmail?: QuoteEmailInfo | null;
  onSent: () => void;
}

export const MobileComposeSheet: React.FC<MobileComposeSheetProps> = ({
  isOpen,
  onClose,
  accounts,
  defaultAccountId,
  mode,
  initialTo = '',
  initialSubject = '',
  initialBody = '',
  inReplyToEmailId,
  quoteEmail,
  onSent,
}) => {
  const [selectedAccountId, setSelectedAccountId] = useState<number>(
    defaultAccountId || (accounts[0]?.id ?? 0)
  );
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [sending, setSending] = useState(false);
  const [showQuote, setShowQuote] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTo(initialTo);
      setCc('');
      setBcc('');
      setSubject(initialSubject);
      setBody(initialBody);
      setShowQuote(false);
      if (defaultAccountId) {
        setSelectedAccountId(defaultAccountId);
      } else if (accounts[0]) {
        setSelectedAccountId(accounts[0].id);
      }
    }
  }, [isOpen, initialTo, initialSubject, initialBody, defaultAccountId, accounts]);

  const handleSend = async () => {
    if (!selectedAccountId) {
      toast.error('请选择发件邮箱账号');
      return;
    }
    let recipients: ReturnType<typeof normalizeRecipients>;
    try {
      recipients = normalizeRecipients(to, cc, bcc);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '邮箱地址格式不正确');
      return;
    }
    if (!subject.trim()) {
      toast.error('请填写邮件主题');
      return;
    }

    setSending(true);
    try {
      let finalBody = body;
      if (quoteEmail && quoteEmail.body_text) {
        finalBody += `\n\n------------------ 原始邮件 ------------------\n发件人: ${quoteEmail.sender}\n发送时间: ${quoteEmail.sent_date}\n收件人: ${quoteEmail.to_recipients || ''}\n主题: ${quoteEmail.subject || ''}\n\n${quoteEmail.body_text}`;
      }

      const result = await api.emails.compose({
        account_id: selectedAccountId,
        ...recipients,
        subject: subject.trim(),
        body_text: finalBody,
        in_reply_to_email_id: inReplyToEmailId,
      });

      if (result.delivery_warning) {
        toast.warning(result.delivery_warning, { duration: Infinity });
      } else {
        toast.success('邮件已提交发信服务器！');
      }
      onSent();
      onClose();
    } catch (err: any) {
      toast.error(err.message || '发送失败，请检查网络或授权码');
    } finally {
      setSending(false);
    }
  };

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()} repositionInputs={false}>
      <DrawerContent
        className="mobile-drawer-responsive-height flex flex-col bg-background text-foreground focus:outline-none overflow-hidden"
        style={{ height: '90vh', maxHeight: '90vh' }}
      >
        {/* 顶部操作条（CSS Grid 三列等高严格水平共线，取消、标题、发送绝对在同一水平线） */}
        <div className="grid grid-cols-[72px_1fr_72px] items-center h-12 px-3.5 border-b bg-background shrink-0">
          <div className="flex items-center justify-start">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 rounded-full bg-muted/70 text-muted-foreground hover:text-foreground active:scale-95 text-xs font-medium transition-all flex items-center justify-center"
            >
              取消
            </button>
          </div>

          <DrawerTitle className="text-[15px] font-bold text-foreground text-center truncate tracking-tight">
            {mode === 'reply' ? '回复邮件' : '新邮件'}
          </DrawerTitle>

          <div className="flex items-center justify-end">
            <Button
              size="sm"
              onClick={handleSend}
              disabled={sending || !to.trim() || !body.trim()}
              className="h-8 px-3 rounded-full bg-primary text-primary-foreground text-xs font-semibold gap-1.5 shadow-xs active:scale-95 transition-all"
            >
              {sending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>发送中</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>发送</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* 抽屉内部滚动交互区（加入 flex flex-col 打通弹性继承，正文卡片自动吃满底部剩余空间） */}
        <div
          data-vaul-no-drag
          className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3 bg-background no-overscroll touch-pan-y flex flex-col pb-safe-offset"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {/* ① 元数据字段卡片（基于 shadcn Card，固定高度 shrink-0） */}
          <Card className="rounded-2xl border bg-muted/30 divide-y divide-border/50 overflow-hidden shadow-none py-0 shrink-0">
            {/* 发信账号选择 */}
            <div className="flex items-center px-3.5 py-2.5 gap-3">
              <span className="text-xs font-semibold text-muted-foreground w-12 shrink-0">发件人</span>
              <div className="relative flex-1 min-w-0 flex items-center">
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(Number(e.target.value))}
                  className="w-full text-xs bg-transparent border-0 focus:outline-none text-foreground font-medium truncate pr-6 appearance-none cursor-pointer"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name ? `${acc.name} <${acc.email_address}>` : acc.email_address}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-0 pointer-events-none shrink-0" />
              </div>
            </div>

            {/* 收件人 */}
            <div className="flex items-center px-3.5 py-2.5 gap-3">
              <span className="text-xs font-semibold text-muted-foreground w-12 shrink-0">收件人</span>
              <input
                type="text"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="recipient@example.com"
                className="flex-1 text-xs bg-transparent border-0 focus:outline-none text-foreground truncate"
              />
            </div>

            <div className="px-3.5 py-2.5">
              <RecipientFields key={String(isOpen)} cc={cc} bcc={bcc}
                onCcChange={setCc} onBccChange={setBcc} disabled={sending} />
            </div>

            {/* 主题 */}
            <div className="flex items-center px-3.5 py-2.5 gap-3">
              <span className="text-xs font-semibold text-muted-foreground w-12 shrink-0">主　题</span>
              <input
                type="text"
                dir="auto"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="邮件主题..."
                className="flex-1 text-xs bg-transparent border-0 focus:outline-none text-foreground font-medium truncate"
              />
            </div>
          </Card>

          {/* ② 核心动线：参考原信折叠便签（基于 shadcn Card，置于正文上方对照，shrink-0） */}
          {quoteEmail && (
            <Card className="rounded-2xl border bg-muted/20 overflow-hidden transition-all duration-200 shadow-none py-0 shrink-0">
              <button
                type="button"
                onClick={() => setShowQuote(!showQuote)}
                className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs text-muted-foreground hover:text-foreground active:bg-muted/40 transition-colors select-none"
              >
                <div className="flex items-center gap-2 truncate min-w-0">
                  <Paperclip className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="font-semibold text-xs text-foreground/90 truncate">
                    参考原信：{quoteEmail.sender.split('<')[0].replace(/"/g, '').trim()}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0 ml-2">
                  <span>{showQuote ? '收起' : '对照原信'}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-300 ease-out ${
                      showQuote ? 'rotate-180' : 'rotate-0'
                    }`}
                  />
                </div>
              </button>

              <div
                className={`grid transition-all duration-300 ease-in-out ${
                  showQuote ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="overflow-hidden">
                  <div className="px-3.5 pb-3 pt-1 border-t border-border/40 bg-background/60 text-xs text-muted-foreground leading-relaxed max-h-44 overflow-y-auto select-text">
                    <div className="text-[11px] text-muted-foreground/70 pb-1.5 border-b border-border/30 mb-2 flex flex-col gap-0.5">
                      <span>发送时间: {quoteEmail.sent_date}</span>
                      <span>主题: {quoteEmail.subject || '(无主题)'}</span>
                    </div>
                    <p className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground/80">{quoteEmail.body_text}</p>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* ③ 正文输入卡片（flex-1 自动向下吃满剩余全部空间，彻底告别底部空白浪费） */}
          <Card className="rounded-2xl border bg-card p-3.5 shadow-none flex-1 min-h-[180px] flex flex-col">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="在此输入邮件正文（或由知了伴随一键采纳带入草稿）..."
              className="w-full h-full flex-1 min-h-[160px] text-xs bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 resize-none text-foreground font-sans leading-relaxed shadow-none placeholder:text-muted-foreground/50"
            />
          </Card>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
