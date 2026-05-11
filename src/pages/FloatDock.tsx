/**
 * Electron 小窗 /electron-float 的页面内容。
 * 外观样式在 `src/index.css` 中搜索 `.float-dock-`（与透明窗口根样式 `electron-float-mode` 一起维护）。
 * 拖动：macOS 上 `type:panel` + 透明无边框时 `-webkit-app-region: drag` 常无效，故用 pointer + `floatDragDelta` IPC。
 */
import {useEffect, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';

export default function FloatDock() {
  const dragging = useRef(false);
  const last = useRef({x: 0, y: 0});
  const [draggingUi, setDraggingUi] = useState(false);

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

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!window.assistantDesktop?.floatDragDelta) return;
    if ((e.target as HTMLElement).closest('button.float-dock-hit')) return;
    dragging.current = true;
    setDraggingUi(true);
    last.current = {x: e.screenX, y: e.screenY};
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    if (e.buttons !== 1) return;
    const dx = e.screenX - last.current.x;
    const dy = e.screenY - last.current.y;
    last.current = {x: e.screenX, y: e.screenY};
    if ((dx || dy) && window.assistantDesktop?.floatDragDelta) {
      window.assistantDesktop.floatDragDelta(dx, dy);
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    setDraggingUi(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 未 capture 时忽略 */
    }
  };

  return (
    <div
      className={`float-dock-root${draggingUi ? ' float-dock--dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
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
