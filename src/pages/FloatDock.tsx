import {useEffect} from 'react';
import './FloatDock.css';

export default function FloatDock() {
  useEffect(() => {
    document.documentElement.classList.add('electron-float-mode');
    document.body.classList.add('electron-float-mode');
    return () => {
      document.documentElement.classList.remove('electron-float-mode');
      document.body.classList.remove('electron-float-mode');
    };
  }, []);

  const openMain = () => {
    window.assistantDesktop?.openMainWindow?.();
  };

  return (
    <div className="float-dock-root">
      <div className="float-dock-ring">
        <button
          type="button"
          className="float-dock-hit"
          aria-label="打开助手主窗口"
          onClick={openMain}
        >
          <img src="/app-logo-square.png" alt="" draggable={false} />
        </button>
      </div>
    </div>
  );
}
