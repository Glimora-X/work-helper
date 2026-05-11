/// <reference types="vite/client" />

interface Window {
  assistantDesktop?: {
    isDesktop: boolean;
    /** 由主进程处理：显示或创建主窗口 */
    openMainWindow?: () => void;
  };
}

interface ImportMetaEnv {
  readonly VITE_DEPLOY_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
