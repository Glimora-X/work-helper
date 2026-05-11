import {contextBridge} from 'electron';

contextBridge.exposeInMainWorld('assistantDesktop', {
  isDesktop: true,
});
