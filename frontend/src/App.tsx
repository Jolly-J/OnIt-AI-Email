import React from 'react';
import { useResponsive } from '@/lib/useResponsive';
import { DesktopApp } from '@/desktop/DesktopApp';
import { MobileApp } from '@/mobile/MobileApp';

export function App() {
  const { isMobile, isFoldable, isTablet } = useResponsive();

  // 计算最终视图模式：平板、折叠屏及直板机均走独立专享移动端视图体系，电脑端走纯净桌面端
  const isMobileView = isMobile || isFoldable || isTablet;

  return isMobileView ? <MobileApp /> : <DesktopApp />;
}

export default App;

