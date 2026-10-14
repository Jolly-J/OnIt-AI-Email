import React from 'react';

export type MailProviderType =
  | 'aliyun_enterprise'
  | 'aliyun_personal'
  | 'qq'
  | 'tencent_enterprise'
  | '163'
  | '126'
  | 'custom'
  | string;

interface MailProviderLogoProps {
  provider?: MailProviderType;
  emailAddress?: string;
  imapHost?: string;
  className?: string;
}

/**
 * 智能推导邮箱服务商归属
 */
export function resolveProvider(
  provider?: string,
  emailAddress?: string,
  imapHost?: string
): 'qq' | 'tencent_enterprise' | '163' | '126' | 'aliyun' | 'custom' {
  const p = (provider || '').toLowerCase();
  const email = (emailAddress || '').toLowerCase();
  const host = (imapHost || '').toLowerCase();

  // 1. 腾讯企业邮 / 微信企邮
  if (p === 'tencent_enterprise' || host.includes('exmail.qq.com')) {
    return 'tencent_enterprise';
  }

  // 2. QQ 个人邮箱
  if (p === 'qq' || email.endsWith('@qq.com') || host.includes('qq.com')) {
    return 'qq';
  }

  // 3. 网易 163
  if (p === '163' || email.endsWith('@163.com') || host.includes('163.com')) {
    return '163';
  }

  // 4. 网易 126
  if (p === '126' || email.endsWith('@126.com') || host.includes('126.com')) {
    return '126';
  }

  // 5. 阿里邮箱 (企业/个人)
  if (
    p.startsWith('aliyun') ||
    email.endsWith('@aliyun.com') ||
    host.includes('aliyun.com') ||
    host.includes('qiye.aliyun.com')
  ) {
    return 'aliyun';
  }

  return 'custom';
}

const PROVIDER_META: Record<string, { src: string; alt: string }> = {
  qq: {
    src: '/providers/qq.svg',
    alt: 'QQ 邮箱',
  },
  tencent_enterprise: {
    src: '/providers/tencent_enterprise.svg',
    alt: '腾讯企业邮',
  },
  '163': {
    src: '/providers/netease.svg',
    alt: '网易 163 邮箱',
  },
  '126': {
    src: '/providers/netease.svg',
    alt: '网易 126 邮箱',
  },
  aliyun: {
    src: '/providers/aliyun.svg',
    alt: '阿里邮箱',
  },
  custom: {
    src: '/providers/custom.svg',
    alt: '自定义企业邮箱',
  },
};

/**
 * 邮箱服务商官方矢量 Logo 组件（基于本地静态资源目录）
 */
export const MailProviderLogo: React.FC<MailProviderLogoProps> = ({
  provider,
  emailAddress,
  imapHost,
  className = 'w-4 h-4',
}) => {
  const key = resolveProvider(provider, emailAddress, imapHost);
  const meta = PROVIDER_META[key] || PROVIDER_META.custom;

  return (
    <img
      src={meta.src}
      alt={meta.alt}
      className={`${className} object-contain select-none shrink-0`}
      loading="lazy"
      draggable={false}
    />
  );
};
