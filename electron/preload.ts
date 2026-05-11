import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('assistantDesktop', {
  isDesktop: true,
  openMainWindow: () => {
    ipcRenderer.send('assistant:open-main');
  },
});
