/// <reference types="vite/client" />

interface Window {
  assistantDesktop?: {
    isDesktop: boolean;
    /** 由主进程处理：显示或创建主窗口 */
    openMainWindow?: () => void;
    /** 浮标窗：相对移动像素（仅 Electron） */
    floatDragDelta?: (dx: number, dy: number) => void;
  };
}

interface ImportMetaEnv {
  readonly VITE_DEPLOY_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
