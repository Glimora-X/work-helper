/// <reference types="vite/client" />

interface Window {
  assistantDesktop?: {
    isDesktop: boolean;
    /** 由主进程处理：显示或创建主窗口 */
    openMainWindow?: () => void;
    /** 打开主窗并导航到给定路径（如 `/deploy?fromFloat=1`） */
    openMainWindowWithPath?: (path: string) => void;
    /** 浮标窗：相对移动像素（仅 Electron） */
    floatDragDelta?: (dx: number, dy: number) => void;
    /** 浮标窗设置宽高（Electron） */
    setFloatWindowSize?: (width: number, height: number) => void;
  };
}

interface ImportMetaEnv {
  readonly VITE_DEPLOY_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
