import { useState, useEffect } from 'react';

export interface ResponsiveState {
  isMobile: boolean;        // 直板机、折叠屏折叠外屏 (< 600px，或窄长直板机)
  isFoldable: boolean;      // 折叠屏展开态 (宽 600px~768px 且呈方屏宽高比，或支持双屏特性)
  isTablet: boolean;        // 平板 / 大折叠屏横屏 (768px ~ 1180px)
  isDesktop: boolean;       // 电脑端 (>= 1180px)
  isNarrowMobile: boolean;  // 极窄屏 (< 360px)
  isDingTalk: boolean;      // 是否在钉钉容器内
}

export function useResponsive(): ResponsiveState {
  const getResponsiveState = (): ResponsiveState => {
    if (typeof window === 'undefined') {
      return {
        isMobile: false,
        isFoldable: false,
        isTablet: false,
        isDesktop: true,
        isNarrowMobile: false,
        isDingTalk: false,
      };
    }

    const width = window.innerWidth;
    const height = window.innerHeight;
    const ua = navigator.userAgent || '';
    const isDingTalk = /DingTalk/i.test(ua);

    // 屏幕宽高比（折叠屏展开态呈方屏特征，宽高比通常在 0.65 ~ 1.5 之间）
    const aspectRatio = height > 0 ? width / height : 1;

    // 现代折叠屏/双屏硬件媒介特性检测
    const hasFoldFeature =
      (typeof window.matchMedia === 'function' &&
        (window.matchMedia('(horizontal-viewport-segments: 2)').matches ||
          window.matchMedia('(screen-spanning: single-fold-vertical)').matches ||
          window.matchMedia('(spanning: single-fold-vertical)').matches)) ||
      false;

    // 折叠屏展开态判定：
    // 1. 命中折叠屏硬件特性；或
    // 2. 宽度在 600px ~ 767px 之间，且宽高比符合折叠屏方屏特征 (0.65 ~ 1.5)
    const isFoldable =
      hasFoldFeature ||
      (width >= 600 && width < 768 && aspectRatio >= 0.65 && aspectRatio <= 1.5);

    const isMobile = !isFoldable && width < 768;
    const isTablet = width >= 768 && width < 1180;
    const isDesktop = width >= 1180;
    const isNarrowMobile = width < 360;

    return {
      isMobile,
      isFoldable,
      isTablet,
      isDesktop,
      isNarrowMobile,
      isDingTalk,
    };
  };

  const [state, setState] = useState<ResponsiveState>(getResponsiveState);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateState = () => {
      const newState = getResponsiveState();
      setState((prev) => {
        // 精确比对布尔值，仅当断点发生实质跃迁时才更新，彻底根绝拉伸窗口过程中的重复渲染
        if (
          prev.isMobile === newState.isMobile &&
          prev.isFoldable === newState.isFoldable &&
          prev.isTablet === newState.isTablet &&
          prev.isDesktop === newState.isDesktop &&
          prev.isNarrowMobile === newState.isNarrowMobile &&
          prev.isDingTalk === newState.isDingTalk
        ) {
          return prev;
        }
        return newState;
      });
    };

    // 监听 resize（折叠屏展开/折叠动作最直接触发 window resize）与屏幕旋转
    window.addEventListener('resize', updateState);
    window.addEventListener('orientationchange', updateState);

    // 补充 matchMedia 监听（现代折叠屏折痕变化媒介）
    const foldMediaQuery =
      typeof window.matchMedia === 'function' &&
      window.matchMedia(
        '(horizontal-viewport-segments: 2), (screen-spanning: single-fold-vertical), (spanning: single-fold-vertical)'
      );
    if (foldMediaQuery && foldMediaQuery.addEventListener) {
      foldMediaQuery.addEventListener('change', updateState);
    }

    return () => {
      window.removeEventListener('resize', updateState);
      window.removeEventListener('orientationchange', updateState);
      if (foldMediaQuery && foldMediaQuery.removeEventListener) {
        foldMediaQuery.removeEventListener('change', updateState);
      }
    };
  }, []);

  return state;
}
