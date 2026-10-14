import React, { useEffect, useState } from 'react';
import { AlertCircle, HelpCircle } from 'lucide-react';

export interface AlertDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'destructive';
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

export const AlertDialog: React.FC<AlertDialogProps> = ({
  isOpen,
  onClose,
  title,
  description,
  confirmText = '确定',
  cancelText = '取消',
  variant = 'default',
  onConfirm,
  loading = false,
}) => {
  const [mounted, setMounted] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      const timer = setTimeout(() => setAnimating(true), 20);
      return () => clearTimeout(timer);
    } else {
      setAnimating(false);
      const timer = setTimeout(() => setMounted(false), 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      {/* 遮罩 */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/40 backdrop-blur-xs t-modal-backdrop ${
          animating ? 'is-open' : 'is-closing'
        }`}
      />

      {/* 弹窗实体 */}
      <div
        className={`relative z-10 bg-background border border-border shadow-2xl rounded-2xl max-w-md w-full p-6 select-none t-modal-surface ${
          animating ? 'is-open' : 'is-closing'
        }`}
      >
        <div className="flex items-start gap-3.5">
          {variant === 'destructive' ? (
            <div className="w-9 h-9 rounded-full bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <HelpCircle className="w-5 h-5" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground leading-tight">{title}</h3>
            <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed">{description}</p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-input bg-background hover:bg-muted text-foreground transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={async () => {
              await onConfirm();
            }}
            disabled={loading}
            className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
              variant === 'destructive'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {loading ? '处理中...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
