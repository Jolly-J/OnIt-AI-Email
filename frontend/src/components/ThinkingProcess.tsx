import React, { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

interface ThinkingProcessProps {
  stages?: string[];
  intervalMs?: number;
  className?: string;
}

const DEFAULT_STAGES = [
  '正在分析来信核心诉求与商务背景...',
  '正在比对历史版本，深度研判修改意图...',
  '正在推演沟通策略，权衡技术与报价方案...',
  '正在组织商务公文措辞与敬语规范...',
  '正在校验排版呼吸感与段落结构...',
];

export const ThinkingProcess: React.FC<ThinkingProcessProps> = ({
  stages = DEFAULT_STAGES,
  intervalMs = 2400,
  className = '',
}) => {
  const [currentText, setCurrentText] = useState(stages[0]);
  const [swapState, setSwapState] = useState<'idle' | 'exit' | 'enter-start'>('idle');
  const indexRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      // 阶段 1: 旧文本往上移 + 模糊 + 淡出 (.is-exit)
      setSwapState('exit');

      // 阶段 2: 200ms 后切换文本并瞬间落位至下方准备入场 (.is-enter-start)
      setTimeout(() => {
        indexRef.current = (indexRef.current + 1) % stages.length;
        setCurrentText(stages[indexRef.current]);
        setSwapState('enter-start');

        // 阶段 3: 下一帧恢复默认 transition 回归原位
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setSwapState('idle');
          });
        });
      }, 200);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [stages, intervalMs]);

  const swapClass =
    swapState === 'exit'
      ? 'is-exit'
      : swapState === 'enter-start'
      ? 'is-enter-start'
      : '';

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2 text-[12px] text-muted-foreground bg-muted/40 border border-border/60 rounded-xl w-fit max-w-[92%] h-10 overflow-hidden select-none shadow-2xs animate-in fade-in duration-200 ${className}`}
    >
      {/* 旋转动效图标 */}
      <div className="relative flex items-center justify-center shrink-0 w-4 h-4 text-primary">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      </div>

      {/* 固定视窗：Text states swap (04-text-states-swap.md) */}
      <div className="relative h-5 overflow-hidden flex items-center min-w-[220px] max-w-[360px]">
        <span
          className={`t-text-swap whitespace-nowrap truncate w-full font-medium text-foreground/90 ${swapClass}`}
        >
          {currentText}
        </span>
      </div>
    </div>
  );
};
