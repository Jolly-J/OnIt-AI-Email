import { useId, useState } from 'react';
import { X } from 'lucide-react';

interface RecipientFieldsProps {
  cc: string;
  bcc: string;
  onCcChange: (value: string) => void;
  onBccChange: (value: string) => void;
  disabled?: boolean;
  expanded?: { cc: boolean; bcc: boolean };
  onCollapse?: (field: 'cc' | 'bcc') => void;
}

export function RecipientFields({ cc, bcc, onCcChange, onBccChange, disabled, expanded, onCollapse }: RecipientFieldsProps) {
  const id = useId();
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const ccOpen = Boolean((expanded?.cc ?? showCc) || cc);
  const bccOpen = Boolean((expanded?.bcc ?? showBcc) || bcc);

  return (
    <div className="min-w-0" style={expanded && !ccOpen && !bccOpen ? { marginTop: 0 } : undefined}>
      {!expanded && (!ccOpen || !bccOpen) && (
        <div className="flex items-center gap-4 text-xs">
          {!ccOpen && <button type="button" disabled={disabled} aria-expanded={false} aria-controls={`${id}-cc-panel`} className="text-primary hover:underline" onClick={() => setShowCc(true)}>添加抄送</button>}
          {!bccOpen && <button type="button" disabled={disabled} aria-expanded={false} aria-controls={`${id}-bcc-panel`} className="text-primary hover:underline" onClick={() => setShowBcc(true)}>添加密送</button>}
        </div>
      )}
      <div className={`grid min-w-0 ${ccOpen && bccOpen ? 'grid-cols-1 sm:grid-cols-2 gap-x-3' : 'grid-cols-1'}`}>
        {[
          { key: 'cc' as const, label: '抄送', value: cc, show: ccOpen, change: onCcChange },
          { key: 'bcc' as const, label: '密送', value: bcc, show: bccOpen, change: onBccChange },
        ].map((field) => (
          <div key={field.key} id={`${id}-${field.key}-panel`}
            className="t-acc-panel min-w-0" data-open={field.show}
            aria-hidden={!field.show} inert={!field.show}>
            <div className="t-acc-panel-inner">
              <div className="space-y-1 px-1 py-1">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`${id}-${field.key}`} className="text-xs font-medium text-muted-foreground"
                    title={field.key === 'bcc' ? '密送名单不会向收件人和抄送人公开' : undefined}>{field.label}</label>
                  <button type="button" aria-label={`收起${field.label}`}
                    disabled={disabled || Boolean(field.value)}
                    title={field.value ? '清空地址后可收起' : `收起${field.label}`}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                    onClick={() => {
                      if (field.value) return;
                      if (expanded) onCollapse?.(field.key);
                      else if (field.key === 'cc') setShowCc(false);
                      else setShowBcc(false);
                    }}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <input
                  id={`${id}-${field.key}`}
                  type="text"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={disabled || !field.show}
                  value={field.value}
                  onChange={(event) => field.change(event.target.value)}
                  placeholder="name@example.com"
                  className="w-full min-w-0 h-10 px-3 text-sm bg-background border border-input rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
