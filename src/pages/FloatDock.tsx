/**
 * Electron 小窗 /electron-float 的页面内容。
 * 外观样式在 `src/index.css` 中搜索 `.float-dock-`（与透明窗口根样式 `electron-float-mode` 一起维护）。
 * 拖动：pointer + `floatDragDelta` IPC；从按钮上也可拖（移动超过阈值才算拖，轻点仍打开主窗）。
 * 调试：URL 加 `?floatDebug=1`，或启动 Electron 时设 `ELECTRON_FLOAT_DEBUG=1`（主进程会给浮标 URL 带上该参数并可选开 DevTools）。
 */
import {useEffect, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import {useSearchParams} from 'react-router-dom';

const DRAG_THRESHOLD_PX = 6;

export default function FloatDock() {
  const [searchParams] = useSearchParams();
  const floatDebug = searchParams.get('floatDebug') === '1';

  const hasDelta = Boolean(window.assistantDesktop?.floatDragDelta);

  /** 是否已开始一次指针序列（含可能点击按钮） */
  const armed = useRef(false);
  /** 是否已进入「算作拖动」状态 */
  const dragging = useRef(false);
  const last = useRef({x: 0, y: 0});
  const moveAccum = useRef(0);
  const downTarget = useRef<HTMLElement | null>(null);
  const [draggingUi, setDraggingUi] = useState(false);
  const [debugLine, setDebugLine] = useState('');

  const log = (msg: string) => {
    if (floatDebug) {
      console.info(`[float] ${msg}`);
      setDebugLine(msg);
    }
  };

  useEffect(() => {
    document.documentElement.classList.add('electron-float-mode');
    document.body.classList.add('electron-float-mode');
    if (floatDebug) {
      console.info('[float] floatDebug=1', {
        floatDragDelta: typeof window.assistantDesktop?.floatDragDelta,
        openMainWindow: typeof window.assistantDesktop?.openMainWindow,
      });
    }
    return () => {
      document.documentElement.classList.remove('electron-float-mode');
      document.body.classList.remove('electron-float-mode');
    };
  }, [floatDebug]);

  const openMain = () => {
    window.assistantDesktop?.openMainWindow?.();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!window.assistantDesktop?.floatDragDelta) {
      log('floatDragDelta 缺失（非 Electron 或未加载 preload）→ 无法拖窗');
      return;
    }
    armed.current = true;
    dragging.current = false;
    moveAccum.current = 0;
    downTarget.current = e.target as HTMLElement;
    last.current = {x: e.screenX, y: e.screenY};
    setDraggingUi(false);
    e.currentTarget.setPointerCapture(e.pointerId);
    log(`pointerdown target=${(e.target as HTMLElement).tagName}`);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!armed.current) return;
    const dx = e.screenX - last.current.x;
    const dy = e.screenY - last.current.y;
    last.current = {x: e.screenX, y: e.screenY};
    moveAccum.current += Math.abs(dx) + Math.abs(dy);
    if (!dragging.current && moveAccum.current >= DRAG_THRESHOLD_PX) {
      dragging.current = true;
      setDraggingUi(true);
      log(`进入拖动 (累计位移 ${moveAccum.current.toFixed(0)}px)`);
    }
    if (dragging.current && (dx || dy)) {
      window.assistantDesktop!.floatDragDelta!(dx, dy);
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!armed.current) return;
    const wasDrag = dragging.current;
    const tap = !wasDrag && moveAccum.current < DRAG_THRESHOLD_PX * 2;
    armed.current = false;
    dragging.current = false;
    setDraggingUi(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 未 capture 时忽略 */
    }
    if (tap && downTarget.current?.closest('button.float-dock-hit')) {
      log('识别为点击 → 打开主窗口');
      openMain();
    } else if (tap) {
      log('点击在非按钮区域，不打开主窗口');
    } else {
      log(`结束 (${wasDrag ? '已拖动' : '未拖'})`);
    }
    downTarget.current = null;
  };

  return (
    <div
      className={`float-dock-root${draggingUi ? ' float-dock--dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {floatDebug ? (
        <div className="float-dock-debug" aria-live="polite">
          <div>floatDragDelta: {hasDelta ? 'ok' : '缺失'}</div>
          <div className="float-dock-debug-line">{debugLine || '—'}</div>
        </div>
      ) : null}
      <div className="float-dock-ring">
        <button type="button" className="float-dock-hit" aria-label="打开助手主窗口">
          <img src="/app-logo-square.png" alt="" draggable={false} />
        </button>
      </div>
    </div>
  );
}
