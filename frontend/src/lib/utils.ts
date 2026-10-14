import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 专为钉钉/内嵌 WebView (包含非 HTTPS 环境) 优化的剪贴板复制工具函数
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false

  // 1. 尝试现代 Clipboard API (当处于 secureContext 时)
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (e) {
      console.warn("navigator.clipboard 写入失败，降级到 execCommand", e)
    }
  }

  // 2. 经典降级方案：document.execCommand('copy')
  try {
    const textArea = document.createElement("textarea")
    textArea.value = text
    textArea.style.position = "fixed"
    textArea.style.left = "-999999px"
    textArea.style.top = "-999999px"
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    const successful = document.execCommand("copy")
    document.body.removeChild(textArea)
    return successful
  } catch (err) {
    console.error("复制到剪贴板失败: ", err)
    return false
  }
}

/**
 * 安全解析时间字符串，兼容 UTC 无时区后缀历史数据与标准 ISO/RFC 格式
 */
export function parseDateSafe(dateStr?: string | null): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed || trimmed === '刚刚') return null;

  // 1. 如果是类似 "2026-09-04T15:30:00" 的 ISO 字符串但缺失时区后缀，补充 'Z' 避免被浏览器错误按本地时间解析
  let normalized = trimmed;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(normalized)) {
    normalized += 'Z';
  }

  const d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;

  // 2. 兜底尝试原生解析
  const fallback = new Date(trimmed);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * 邮件列表时间格式化：精准转换为北京时间极简格式，如 "26.09.03"
 */
export function formatMailListDate(dateStr?: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  if (trimmed === '刚刚') return '刚刚';

  const d = parseDateSafe(trimmed);
  if (!d) {
    // 降级保护：如果字符串以 YYYY-MM-DD 开头，做简单截取
    const dateMatch = trimmed.match(/\d{4}[-/.]\d{2}[-/.]\d{2}/);
    if (dateMatch) {
      const parts = dateMatch[0].split(/[-/.]/);
      return `${parts[0].slice(-2)}.${parts[1]}.${parts[2]}`;
    }
    return trimmed.slice(0, 10);
  }

  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const yy = parts.find((p) => p.type === 'year')?.value || '';
    const mm = parts.find((p) => p.type === 'month')?.value || '';
    const dd = parts.find((p) => p.type === 'day')?.value || '';
    return `${yy}.${mm}.${dd}`;
  } catch {
    return trimmed.slice(0, 10);
  }
}

/**
 * 邮件详情发送时间格式化：精准转换为中文北京时间，如 "2026年9月3日 11:57"
 */
export function formatMailDetailDate(dateStr?: string): string {
  if (!dateStr) return '未知';
  const trimmed = dateStr.trim();
  if (trimmed === '刚刚') return '刚刚';

  const d = parseDateSafe(trimmed);
  if (!d) return trimmed;

  try {
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(d);
    const year = parts.find((p) => p.type === 'year')?.value || '';
    const month = parts.find((p) => p.type === 'month')?.value || '';
    const day = parts.find((p) => p.type === 'day')?.value || '';
    const hour = parts.find((p) => p.type === 'hour')?.value || '';
    const minute = parts.find((p) => p.type === 'minute')?.value || '';
    return `${year}年${month}月${day}日 ${hour}:${minute}`;
  } catch {
    return trimmed;
  }
}

/**
 * 账号最近同步时间：统一转换为北京时间格式，如 "15:30:20"
 */
export function formatSyncTime(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = parseDateSafe(dateStr);
  if (!d) return '';

  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return '';
  }
}

/**
 * 邮件识别语言友好格式化展示
 */
export function formatLanguageLabel(langCode?: string): string {
  if (!langCode) return '';
  const code = langCode.toLowerCase().trim();
  const map: Record<string, string> = {
    zh: '中文',
    'zh-cn': '中文',
    'zh-tw': '繁体中文',
    'zh-hk': '繁体中文',
    en: '英语',
    ja: '日语',
    de: '德语',
    fr: '法语',
    es: '西班牙语',
    ru: '俄语',
    ko: '韩语',
    it: '意大利语',
    pt: '葡萄牙语',
    ar: '阿拉伯语',
  };
  return map[code] || code.toUpperCase();
}

