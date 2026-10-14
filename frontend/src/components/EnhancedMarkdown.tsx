import React from 'react';

interface EnhancedMarkdownProps {
  content: string;
  className?: string;
}

/**
 * 行内元素解析器：
 * 专门针对中文商业信函进行高容错优化，完美攻克 **： xxxxx **、**标点紧贴**、多空格等非标 GFM 导致的加粗失效
 */
function parseInline(text: string): React.ReactNode[] {
  if (!text) return [];

  // 匹配优先顺序：
  // 1. 行内代码：`...`
  // 2. 粗斜体：***...***
  // 3. 粗体：**...** 或 __...__ (支持内部包含中文标点 ：，。、以及任意空格)
  // 4. 删除线：~~...~~
  // 5. 斜体：*...* 或 _..._
  // 6. 链接：[text](url)
  const tokenRegex = /(\*\*\*[^*]+?\*\*\*|\*\*(?:[^*]|\*(?!\*))+?\*\*|__(?:[^_]|_(?!_))+?__|`[^`\n]+?`|~~[^~]+?~~|(?<!\*)\*(?:[^*]|\*(?!\*))+?\*(?!\*)|\[[^\]]+\]\([^\)\s]+\))/g;

  const parts = text.split(tokenRegex);
  const elements: React.ReactNode[] = [];

  parts.forEach((part, index) => {
    if (!part) return;

    // 粗斜体
    if (part.startsWith('***') && part.endsWith('***') && part.length >= 6) {
      const inner = part.slice(3, -3);
      elements.push(
        <strong key={index} className="font-bold text-foreground">
          <em className="italic">{parseInline(inner)}</em>
        </strong>
      );
      return;
    }

    // 粗体：**...** 或 __...__
    if ((part.startsWith('**') && part.endsWith('**') && part.length >= 4) ||
        (part.startsWith('__') && part.endsWith('__') && part.length >= 4)) {
      const inner = part.slice(2, -2);
      elements.push(
        <strong key={index} className="font-bold text-foreground tracking-tight">
          {parseInline(inner)}
        </strong>
      );
      return;
    }

    // 删除线：~~...~~
    if (part.startsWith('~~') && part.endsWith('~~') && part.length >= 4) {
      const inner = part.slice(2, -2);
      elements.push(
        <del key={index} className="line-through text-muted-foreground">
          {parseInline(inner)}
        </del>
      );
      return;
    }

    // 行内代码：`...`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const code = part.slice(1, -1);
      elements.push(
        <code
          key={index}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-muted/80 text-primary font-mono text-[12px] border border-border/40 select-all"
        >
          {code}
        </code>
      );
      return;
    }

    // 斜体：*...*
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      const inner = part.slice(1, -1);
      elements.push(
        <em key={index} className="italic text-foreground/90">
          {parseInline(inner)}
        </em>
      );
      return;
    }

    // 超链接：[text](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^\)\s]+)\)$/);
    if (linkMatch) {
      elements.push(
        <a
          key={index}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          {linkMatch[1]}
        </a>
      );
      return;
    }

    // 普通文本
    elements.push(<React.Fragment key={index}>{part}</React.Fragment>);
  });

  return elements;
}

export const EnhancedMarkdown: React.FC<EnhancedMarkdownProps> = ({ content, className = '' }) => {
  if (!content) return null;

  // 1. 块级预切分：提取代码块
  const rawLines = content.split('\n');
  const blocks: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];

  let currentParagraphLines: string[] = [];

  const flushParagraph = () => {
    if (currentParagraphLines.length === 0) return;

    // 检查当前段落是否是纯列表
    const lines = [...currentParagraphLines];
    currentParagraphLines = [];

    // 判断是否有列表项
    const isUnordered = lines.every((l) => /^\s*[-*•]\s+/.test(l));
    const isOrdered = lines.every((l) => /^\s*\d+[\.、]\s+/.test(l));

    if (isUnordered) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="my-1.5 pl-4 list-disc space-y-1 text-inherit">
          {lines.map((line, liIdx) => {
            const itemText = line.replace(/^\s*[-*•]\s+/, '');
            return <li key={liIdx} className="leading-relaxed">{parseInline(itemText)}</li>;
          })}
        </ul>
      );
      return;
    }

    if (isOrdered) {
      blocks.push(
        <ol key={`ol-${blocks.length}`} className="my-1.5 pl-4 list-decimal space-y-1 text-inherit">
          {lines.map((line, liIdx) => {
            const itemText = line.replace(/^\s*\d+[\.、]\s+/, '');
            return <li key={liIdx} className="leading-relaxed">{parseInline(itemText)}</li>;
          })}
        </ol>
      );
      return;
    }

    // 混合文本段落：多行通过 <br/> 连贯连接
    blocks.push(
      <p key={`p-${blocks.length}`} className="leading-relaxed whitespace-pre-wrap">
        {lines.map((line, lineIdx) => (
          <React.Fragment key={lineIdx}>
            {parseInline(line)}
            {lineIdx < lines.length - 1 && <br />}
          </React.Fragment>
        ))}
      </p>
    );
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // 代码块标记检测
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        flushParagraph();
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim();
        codeBlockLines = [];
      } else {
        // 代码块闭合
        inCodeBlock = false;
        blocks.push(
          <div key={`code-${blocks.length}`} className="my-2 rounded-lg bg-muted/60 border overflow-x-auto text-[12px]">
            {codeBlockLang && (
              <div className="px-3 py-1 bg-muted/90 border-b text-[11px] font-mono text-muted-foreground">
                {codeBlockLang}
              </div>
            )}
            <pre className="p-3 font-mono leading-normal text-foreground">
              <code>{codeBlockLines.join('\n')}</code>
            </pre>
          </div>
        );
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // 标题检测 (#, ##, ###)
    const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      flushParagraph();
      const level = headerMatch[1].length;
      const text = headerMatch[2];
      const headingClass =
        level === 1
          ? 'text-base font-bold my-2 text-foreground'
          : level === 2
          ? 'text-[14px] font-bold my-1.5 text-foreground'
          : 'text-[13px] font-semibold my-1 text-foreground';

      blocks.push(
        <div key={`h-${blocks.length}`} className={headingClass}>
          {parseInline(text)}
        </div>
      );
      continue;
    }

    // 引用块检测 (> ...)
    if (line.startsWith('>')) {
      flushParagraph();
      const quoteText = line.replace(/^>\s?/, '');
      blocks.push(
        <blockquote
          key={`quote-${blocks.length}`}
          className="border-l-2 border-primary/50 pl-3 my-1.5 text-muted-foreground italic"
        >
          {parseInline(quoteText)}
        </blockquote>
      );
      continue;
    }

    // 空行分段
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    currentParagraphLines.push(line);
  }

  // 刷出最后的段落或未闭合的代码块
  if (inCodeBlock && codeBlockLines.length > 0) {
    blocks.push(
      <pre key={`code-${blocks.length}`} className="p-3 my-2 rounded-lg bg-muted/60 border font-mono text-[12px] leading-normal text-foreground overflow-x-auto">
        <code>{codeBlockLines.join('\n')}</code>
      </pre>
    );
  } else {
    flushParagraph();
  }

  return <div className={`space-y-2 select-text ${className}`}>{blocks}</div>;
};
