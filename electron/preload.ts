import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('assistantDesktop', {
  isDesktop: true,
  openMainWindow: () => {
    ipcRenderer.send('assistant:open-main');
  },
  /** 打开主窗并加载 SPA 子路径（须以 / 开头，可含 query） */
  openMainWindowWithPath: (path: string) => {
    ipcRenderer.send('assistant:open-main-path', {path});
  },
  /** 浮标窗用：相对移动（主进程 setPosition），绕过 macOS panel+透明下 drag 区域失效 */
  floatDragDelta: (dx: number, dy: number) => {
    ipcRenderer.send('assistant-float-drag', {dx, dy});
  },
  /** 浮标窗展开命令面板时调整尺寸 */
  setFloatWindowSize: (width: number, height: number) => {
    ipcRenderer.send('assistant-float-resize', {width, height});
  },
});
