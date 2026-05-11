import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('assistantDesktop', {
  isDesktop: true,
  openMainWindow: () => {
    ipcRenderer.send('assistant:open-main');
  },
  /** 浮标窗用：相对移动（主进程 setPosition），绕过 macOS panel+透明下 drag 区域失效 */
  floatDragDelta: (dx: number, dy: number) => {
    ipcRenderer.send('assistant-float-drag', {dx, dy});
  },
});
