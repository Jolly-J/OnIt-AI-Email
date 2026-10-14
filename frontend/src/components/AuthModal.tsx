import React, { useState, useEffect, useRef } from 'react';
import * as dd from 'dingtalk-jsapi';
import { api, User } from '../lib/api';
import { ShieldAlert, RefreshCw, LoaderCircle, QrCode, Sparkles } from 'lucide-react';

const DINGTALK_CLIENT_ID = String(
  import.meta.env.VITE_DINGTALK_CLIENT_ID || ''
).trim();

const DINGTALK_CORP_ID = String(
  import.meta.env.VITE_DINGTALK_CORP_ID || ''
).trim();

interface AuthModalProps {
  onSuccess: (user: User) => void;
  isOpening?: boolean;
}

function isDingTalkEnvironment(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /DingTalk/i.test(navigator.userAgent);
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-dd-src="${src}"]`) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.ddSrc = src;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.body.appendChild(script);
  });
}

export const AuthModal: React.FC<AuthModalProps> = ({ onSuccess, isOpening = false }) => {
  const [internalLoading, setInternalLoading] = useState(false);
  const [qrLoading, setQrLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verifyingText, setVerifyingText] = useState('正在进行身份验证...');
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState('');
  const [mockEnabled, setMockEnabled] = useState(false);
  const [mockLoading, setMockLoading] = useState(false);
  const [hasClientId, setHasClientId] = useState<boolean | null>(null);

  const processedCodeRef = useRef<string | null>(null);
  const qrInitializedRef = useRef<boolean>(false);
  const isDingTalk = isDingTalkEnvironment();

  // Mock 模式一键免钉钉体验登录
  const performMockLogin = async () => {
    setMockLoading(true);
    setError(null);
    setAccessDenied(false);
    try {
      const res = await api.auth.mockLogin();
      localStorage.setItem('email_agent_token', res.access_token);
      onSuccess(res.user);
    } catch (err: any) {
      setError(err.message || '演示体验登录失败，请刷新重试');
    } finally {
      setMockLoading(false);
    }
  };

  // 1. 钉钉客户端内免登流程
  const performInternalLogin = async () => {
    setInternalLoading(true);
    setError(null);
    setAccessDenied(false);

    try {
      let corpId = DINGTALK_CORP_ID;
      try {
        const cfg = await api.dingtalk.getConfig();
        if (cfg.corp_id) corpId = cfg.corp_id;
      } catch {}

      let waited = 0;
      while (!dd.runtime?.permission?.requestAuthCode && waited < 4000) {
        await new Promise((r) => setTimeout(r, 200));
        waited += 200;
      }

      const res = await dd.runtime.permission.requestAuthCode({
        corpId: corpId,
      });

      const authCode = res.code;
      if (!authCode) throw new Error('未能从钉钉客户端获取授权码');

      setVerifying(true);
      setVerifyingText('正在核验员工身份与系统使用权限...');
      const loginRes = await api.dingtalk.login({
        code: authCode,
        mode: 'internal',
      });

      localStorage.setItem('email_agent_token', loginRes.access_token);
      onSuccess(loginRes.user);
    } catch (err: any) {
      const msg = err.message || '钉钉免登失败';
      if (msg.includes('权限') || msg.includes('开通') || msg.includes('未获得') || msg.includes('403')) {
        setAccessDenied(true);
        setAccessDeniedMessage(msg);
      } else {
        setError(msg);
      }
    } finally {
      setInternalLoading(false);
      setVerifying(false);
    }
  };

  // 2. 外部浏览器二维码扫码登录（容器常驻 DOM，不随 loading 销毁）
  const initQrLogin = async () => {
    setQrLoading(true);
    setError(null);
    setAccessDenied(false);

    try {
      let clientId = DINGTALK_CLIENT_ID;
      let corpId = DINGTALK_CORP_ID;
      let isMock = false;
      try {
        const cfg = await api.dingtalk.getConfig();
        if (cfg.client_id) clientId = cfg.client_id;
        if (cfg.corp_id) corpId = cfg.corp_id;
        if (cfg.mock_enabled) isMock = true;
      } catch {}

      setMockEnabled(isMock);
      const hasConfig = Boolean(clientId);
      setHasClientId(hasConfig);

      // 若未配置钉钉 Client ID，直接启用 Mock 体验模式，不加载外部钉钉脚本
      if (!hasConfig) {
        setMockEnabled(true);
        setQrLoading(false);
        return;
      }

      await loadScript('/ddlogin.js');
      const DTFrameLogin = (window as any).DTFrameLogin;
      if (typeof DTFrameLogin !== 'function') {
        throw new Error('钉钉扫码组件初始化异常');
      }

      const redirectUri = encodeURIComponent(`${window.location.origin}/auth/callback`);

      // 确保在下一帧 DOM 完全就绪时挂载
      requestAnimationFrame(() => {
        const container = document.getElementById('dingtalk-qr-container');
        if (!container) {
          setError('二维码容器挂载失败，请刷新页面重试');
          setQrLoading(false);
          return;
        }

        DTFrameLogin(
          { id: 'dingtalk-qr-container', width: 300, height: 300 },
          {
            redirect_uri: redirectUri,
            client_id: clientId,
            scope: 'openid corpid',
            response_type: 'code',
            state: 'login',
            prompt: 'consent',
            corpId: corpId || undefined,
          },
          async (loginResult: { redirectUrl: string }) => {
            try {
              const url = new URL(loginResult.redirectUrl);
              const authCode = url.searchParams.get('authCode') || url.searchParams.get('code');
              if (!authCode || processedCodeRef.current === authCode) return;
              processedCodeRef.current = authCode;

              setVerifying(true);
              setVerifyingText('扫码授权成功，正在核验员工使用权限...');
              setError(null);

              const loginRes = await api.dingtalk.login({
                code: authCode,
                mode: 'qr',
              });

              localStorage.setItem('email_agent_token', loginRes.access_token);
              onSuccess(loginRes.user);
            } catch (err: any) {
              const msg = err.message || '登录验证失败';
              if (msg.includes('权限') || msg.includes('开通') || msg.includes('未获得') || msg.includes('403')) {
                setAccessDenied(true);
                setAccessDeniedMessage(msg);
              } else {
                setError(msg);
              }
              processedCodeRef.current = null;
            } finally {
              setVerifying(false);
            }
          },
          (errMsg: string) => {
            setError(errMsg || '二维码加载失败，请刷新重试');
            setQrLoading(false);
          }
        );

        setQrLoading(false);
        qrInitializedRef.current = true;
      });
    } catch (err: any) {
      setError(err.message || '加载登录模块失败');
      setQrLoading(false);
    }
  };

  useEffect(() => {
    if (isDingTalk) {
      performInternalLogin();
    } else {
      initQrLogin();
    }
  }, [isDingTalk]);

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-100 p-4 select-none will-change-transform shadow-[0_35px_60px_-15px_rgba(0,0,0,0.3)] transition-transform duration-[750ms] ${
        isOpening ? '-translate-y-full pointer-events-none' : 'translate-y-0'
      }`}
      style={{
        transitionTimingFunction: 'cubic-bezier(0.7, 0, 0.25, 1)',
      }}
    >
      <div className="w-full max-w-[430px] bg-card rounded-2xl border shadow-xl p-6 sm:p-8 flex flex-col items-center text-center overflow-hidden">
        {/* 顶部 Brand */}
        <div className="mb-4 flex flex-col items-center">
          <img
            src="/zhiliao_logo_full.webp"
            alt="知了 OnIt"
            className="h-10 w-auto max-w-[150px] object-contain mb-3"
          />
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            企业智能邮件工作台
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            钉钉统一身份认证 · 安全多邮箱协同
          </p>
        </div>

        {/* 状态 1：权限准入被拒绝拦截（未授权阻断页面） */}
        {accessDenied ? (
          <div className="w-full bg-destructive/5 border border-destructive/20 rounded-xl p-5 text-center flex flex-col items-center my-2">
            <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-3">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-destructive mb-1.5">
              访问受限 · 暂无使用权限
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-4">
              {accessDeniedMessage || '您的钉钉账号已通过认证，但企业管理员尚未为您开通本系统的使用授权。请联系公司管理员在后台为您激活开通权限后再试。'}
            </p>
            <div className="flex gap-2 w-full">
              <button
                onClick={() => {
                  processedCodeRef.current = null;
                  if (isDingTalk) {
                    performInternalLogin();
                  } else {
                    initQrLogin();
                  }
                }}
                className="flex-1 py-2 px-3 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5 shadow-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>重新核验</span>
              </button>
            </div>
          </div>
        ) : isDingTalk ? (
          /* 状态 2：钉钉客户端端内环境（自动免登或重试） */
          <div className="w-full my-6 flex flex-col items-center">
            {internalLoading || verifying ? (
              <div className="my-6 flex flex-col items-center justify-center">
                <LoaderCircle className="w-10 h-10 text-primary animate-spin mb-4" />
                <p className="text-sm font-medium text-foreground">
                  {verifying ? verifyingText : '检测到钉钉环境，正在免登中...'}
                </p>
                <p className="text-xs text-muted-foreground mt-1.5">正在建立安全会话信道...</p>
              </div>
            ) : (
              <>
                {error && (
                  <div className="w-full mb-4 p-3 text-xs text-destructive bg-destructive/10 rounded-lg border border-destructive/20 text-left">
                    {error}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mb-4">已检测到企业钉钉客户端环境</p>
                <button
                  onClick={performInternalLogin}
                  className="w-full py-2.5 px-4 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-all shadow-xs flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>重试钉钉一键免登</span>
                </button>
              </>
            )}
          </div>
        ) : hasClientId === false ? (
          /* 状态 3：未配置钉钉开放平台凭据，自动进入 Mock 快速体验通道 */
          <div className="w-full flex flex-col items-center py-2">
            {error && (
              <div className="w-full mb-3 p-2.5 text-xs text-destructive bg-destructive/10 rounded-lg border border-destructive/20 text-left">
                {error}
              </div>
            )}
            <div className="w-13 h-13 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-3 border border-indigo-500/20 shadow-xs">
              <Sparkles className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">
              开源演示与快速体验
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[280px] mb-5">
              系统当前未配置企业钉钉应用凭据，已为您自动就绪演示体验模式，点击下方按钮即可一键登录。
            </p>
            <button
              type="button"
              onClick={performMockLogin}
              disabled={mockLoading}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-sm font-medium rounded-xl shadow-md shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {mockLoading ? (
                <LoaderCircle className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              <span>一键进入演示工作台</span>
            </button>
            <p className="text-[11px] text-muted-foreground/70 mt-3">
              内置模拟业务邮件 · 支持 AI 拟稿与会议排期体验
            </p>
          </div>
        ) : (
          /* 状态 4：已配置钉钉开放平台，展示扫码二维码，并提供备选快速体验 */
          <div className="w-full flex flex-col items-center">
            {error && (
              <div className="w-full mb-3 p-2.5 text-xs text-destructive bg-destructive/10 rounded-lg border border-destructive/20 text-left">
                {error}
              </div>
            )}

            <div className="relative flex items-center justify-center min-w-[300px] min-h-[300px]">
              {/* 二维码挂载目标节点：常驻 DOM，确保 DTFrameLogin 任何时刻都能获取 */}
              <div
                id="dingtalk-qr-container"
                className="w-[300px] h-[300px] flex items-center justify-center overflow-hidden"
              />

              {/* 加载或验证遮罩浮层 */}
              {(qrLoading || verifying) && (
                <div className="absolute inset-0 bg-white/90 backdrop-blur-xs rounded-xl flex flex-col items-center justify-center z-10">
                  <LoaderCircle className="w-8 h-8 text-primary animate-spin mb-2.5" />
                  <p className="text-xs font-medium text-foreground">
                    {verifying ? verifyingText : '正在加载钉钉扫码组件...'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
              <QrCode className="w-3.5 h-3.5 text-primary" />
              <span>请使用手机钉钉扫一扫登录</span>
            </div>

            {mockEnabled && (
              <button
                type="button"
                onClick={performMockLogin}
                disabled={mockLoading}
                className="mt-3 text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer transition-colors"
              >
                {mockLoading ? <LoaderCircle className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                <span>或以演示管理员直接登录体验</span>
              </button>
            )}
          </div>
        )}

        {/* 底部保障提示 */}
        <div className="mt-6 pt-4 border-t w-full flex items-center justify-center text-xs text-muted-foreground/60 tracking-wider">
          AI 企业邮件协同工作台
        </div>
      </div>
    </div>
  );
};
