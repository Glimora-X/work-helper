/**
 * Electron 小窗 /electron-float 的页面内容。
 * 外观样式在 `src/index.css` 中搜索 `.float-dock-`（与透明窗口根样式 `electron-float-mode` 一起维护）。
 * 拖动：pointer + `floatDragDelta` IPC；仅拖拽把手负责移动悬浮窗。
 * 命令面板：点主按钮打开；「主窗口」为标题栏旁次级文字入口。
 */
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Play, Plus, Rocket} from 'lucide-react';
import {
  addPlainTextTodoToToday,
  countTodayOpenTodos,
  DAILY_TODOS_STORAGE_KEY,
} from '../lib/daily-todos-storage';
import {extractJiraAndBranch} from '../lib/float-command/deploy-parse-extract';
import {
  type DeployTemplateLike,
  type DeployTemplateConfidence,
  resolveDeployTemplates,
} from '../lib/float-command/deploy-template-resolve';
import {FLOAT_DEPLOY_SESSION_KEY, type FloatDeployConfirmedPayload} from '../lib/float-command/float-deploy-payload';
import {
  readDeployRecentIdsForResolve,
  readStartupRecentIds,
  recordDeployTemplateUsed,
  recordStartupProfileUsed,
} from '../lib/float-command/recent';
import {
  type StartupProfileLike,
  type StartupResolveConfidence,
  resolveStartupProfiles,
} from '../lib/float-command/startup-resolve';
import {INITIAL_PROFILES} from './Startup';

const DRAG_THRESHOLD_PX = 6;

const TAB_FIELD = {
  todo: {
    kicker: '记录到今日清单',
    label: '一句话写下待办，回车即可提交',
    placeholder: '今天要做的…',
    hint: '写入今日清单；重复内容会提示。',
  },
  deploy: {
    kicker: '生成部署草稿',
    label: '模板名、Jira、分支可混在一行',
    placeholder: '如：MDF 或 PROJ-123',
    hint: '优先最近模板；无法命中时列出候选项。Shift+Enter 换行。',
  },
  startup: {
    kicker: '匹配启动项',
    label: '输入项目或仓库关键词',
    placeholder: '如：mdf、saas-cc-web',
    hint: '优先最近配置；无法命中时列出候选项。',
  },
} as const;

const TAB_CARDS = [
  {id: 'todo' as const, title: '添加待办', desc: '记录到今日清单', Icon: Plus},
  {id: 'deploy' as const, title: '快速部署', desc: '识别模板与 Jira', Icon: Rocket},
  {id: 'startup' as const, title: '启动项目', desc: '匹配配置并跳转', Icon: Play},
];

const FALLBACK_DEPLOY_TEMPLATES: DeployTemplateLike[] = [
  {id: 'tpl_9', name: 'MDF', nodes: ['mdf', 'saas-cc-web-metapage'], keywords: ['mdf', '低代码', 'metapage']},
  {id: 'tpl_8', name: 'MDF—BIZ', nodes: ['mdf-biz', 'saas-cc-web-metapage'], keywords: ['biz', 'mdf-biz']},
  {id: 'tpl_7', name: 'UI-WEB', nodes: ['mdf-ui-web', 'saas-cc-web-metapage'], keywords: ['ui-web']},
  {id: 'tpl_11', name: 'BIZ-CORE', nodes: ['biz-core', 'saas-cc-web', 'hsy-h5-mainapp'], keywords: ['biz-core', '订单']},
  {
    id: 'tpl_12',
    name: 'SAAS-CC-NODE-METASERVER',
    nodes: ['saas-cc-node-metaserver', 'saas-cc-node'],
    keywords: ['node', 'metaserver'],
  },
];

function loadDeployTemplatesForResolve(): DeployTemplateLike[] {
  try {
    const raw = localStorage.getItem('deploy_templates_v1');
    if (!raw) return [...FALLBACK_DEPLOY_TEMPLATES];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p) || p.length === 0) return [...FALLBACK_DEPLOY_TEMPLATES];
    return p.filter(
      (t): t is DeployTemplateLike =>
        t &&
        typeof t === 'object' &&
        typeof (t as DeployTemplateLike).id === 'string' &&
        typeof (t as DeployTemplateLike).name === 'string' &&
        Array.isArray((t as DeployTemplateLike).nodes)
    );
  } catch {
    return [...FALLBACK_DEPLOY_TEMPLATES];
  }
}

type ResolveUI =
  | {phase: 'input'}
  | {phase: 'pickStartup'; items: StartupProfileLike[]}
  | {phase: 'pickDeploy'; items: DeployTemplateLike[]}
  | {phase: 'previewStartup'; profile: StartupProfileLike; confidence: StartupResolveConfidence}
  | {phase: 'previewDeploy'; template: DeployTemplateLike; confidence: DeployTemplateConfidence};

function confidenceLabelDeploy(c: DeployTemplateConfidence): string {
  if (c === 'high') return '识别结果（高可信）';
  if (c === 'medium') return '识别结果（中可信）';
  return '可能是以下目标（低可信）';
}

function confidenceLabelStartup(c: StartupResolveConfidence): string {
  if (c === 'high') return '识别结果（高可信）';
  if (c === 'medium') return '识别结果（中可信）';
  return '可能是以下目标（低可信）';
}

export default function FloatDock() {
  const [searchParams] = useSearchParams();
  const floatDebug = searchParams.get('floatDebug') === '1';

  const hasDelta = Boolean(window.assistantDesktop?.floatDragDelta);

  const armed = useRef(false);
  const dragging = useRef(false);
  const last = useRef({x: 0, y: 0});
  const moveAccum = useRef(0);
  const downTarget = useRef<HTMLElement | null>(null);
  const lastTapAt = useRef(0);
  const [draggingUi, setDraggingUi] = useState(false);
  const [debugLine, setDebugLine] = useState('');

  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState<'todo' | 'deploy' | 'startup'>('todo');
  const [line, setLine] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [rs, setRs] = useState<ResolveUI>({phase: 'input'});
  const [todoOpenCount, setTodoOpenCount] = useState(countTodayOpenTodos);

  const refreshTodoOpenCount = useCallback(() => {
    setTodoOpenCount(countTodayOpenTodos());
  }, []);

  const profilesForResolve: StartupProfileLike[] = useMemo(() => INITIAL_PROFILES as StartupProfileLike[], []);

  const log = (msg: string) => {
    if (floatDebug) {
      console.info(`[float] ${msg}`);
      setDebugLine(msg);
    }
  };

  const syncFloatSize = useCallback(
    (expanded: boolean) => {
      const fn = window.assistantDesktop?.setFloatWindowSize;
      if (!fn) return;
      if (expanded) {
        /** 取更稳的展开尺寸，避免透明无边框窗在 macOS 上过大时重排异常 */
        fn(floatDebug ? 368 : 338, floatDebug ? 492 : 444);
      } else {
        /** 收起：胶囊内握柄 + 主按钮 + 三行轻文案，须主进程 assistant-float-resize */
        fn(floatDebug ? 108 : 104, floatDebug ? 158 : 148);
      }
    },
    [floatDebug]
  );

  useLayoutEffect(() => {
    syncFloatSize(panelOpen);
  }, [panelOpen, syncFloatSize]);

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      syncFloatSize(panelOpen);
    });
    const timerId = window.setTimeout(() => {
      syncFloatSize(panelOpen);
    }, 80);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
    };
  }, [panelOpen, tab, rs.phase, floatDebug, syncFloatSize]);

  useEffect(() => {
    refreshTodoOpenCount();
    const onStorage = (e: StorageEvent) => {
      if (e.key === DAILY_TODOS_STORAGE_KEY || e.key === null) refreshTodoOpenCount();
    };
    const onFocus = () => refreshTodoOpenCount();
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshTodoOpenCount]);

  useEffect(() => {
    document.documentElement.classList.add('electron-float-mode');
    document.body.classList.add('electron-float-mode');
    if (floatDebug) {
      console.info('[float] floatDebug=1', {
        floatDragDelta: typeof window.assistantDesktop?.floatDragDelta,
        openMainWindow: typeof window.assistantDesktop?.openMainWindow,
        openMainWindowWithPath: typeof window.assistantDesktop?.openMainWindowWithPath,
      });
    }
    return () => {
      document.documentElement.classList.remove('electron-float-mode');
      document.body.classList.remove('electron-float-mode');
    };
  }, [floatDebug]);

  /** dist-electron/main.cjs 未含 assistant-float-resize 时，改 FloatDock 尺寸也不会生效 */
  useEffect(() => {
    if (window.assistantDesktop?.setFloatWindowSize) return;
    console.warn(
      '[FloatDock] 未检测到 setFloatWindowSize：若在浏览器打开本页，窗口尺寸由浏览器决定；桌面版请运行 npm run build:electron，或使用 npm run dev:desktop（启动前会自动编译主进程）。'
    );
  }, []);

  const openMain = useCallback(() => {
    window.assistantDesktop?.openMainWindow?.();
  }, []);

  const closePanel = useCallback(() => {
    syncFloatSize(false);
    setPanelOpen(false);
    setRs({phase: 'input'});
    setLine('');
    setToast(null);
  }, [syncFloatSize]);

  /** 先放大 Electron 窗口再渲染面板，避免 76×76 + overflow:hidden 把面板裁掉 */
  const openCommandPanel = () => {
    syncFloatSize(true);
    setPanelOpen(true);
    setRs({phase: 'input'});
    setToast(null);
  };

  const runResolve = useCallback(() => {
    setToast(null);
    const q = line.trim();
    if (!q) {
      setToast('请先输入内容');
      return;
    }
    if (tab === 'todo') {
      const r = addPlainTextTodoToToday(q);
      if (r.added) {
        setToast('已加入今日待办');
        setLine('');
        refreshTodoOpenCount();
      } else if (r.reason === 'duplicate') {
        setToast('今日已有相同待办');
      } else {
        setToast('未添加');
      }
      return;
    }
    if (tab === 'startup') {
      const res = resolveStartupProfiles(q, profilesForResolve, readStartupRecentIds());
      if (res.type === 'multiple') {
        setRs({phase: 'pickStartup', items: res.candidates});
        return;
      }
      if (res.type === 'none') {
        const sug = res.suggestions || [];
        if (sug.length) {
          setRs({phase: 'pickStartup', items: sug});
          setToast('未直接命中，请从下列项选择');
        } else {
          setToast('没有匹配的启动配置');
        }
        return;
      }
      setRs({phase: 'previewStartup', profile: res.profile, confidence: res.confidence});
      return;
    }
    if (tab === 'deploy') {
      const templates = loadDeployTemplatesForResolve();
      const res = resolveDeployTemplates(q, templates, readDeployRecentIdsForResolve());
      if (res.type === 'multiple') {
        setRs({phase: 'pickDeploy', items: res.candidates});
        return;
      }
      if (res.type === 'none') {
        const sug = res.suggestions;
        if (sug.length) {
          setRs({phase: 'pickDeploy', items: sug});
          setToast('未直接命中，请从下列模板选择');
        } else {
          setToast('没有匹配的部署模板');
        }
        return;
      }
      setRs({phase: 'previewDeploy', template: res.template, confidence: res.confidence});
    }
  }, [tab, line, profilesForResolve, refreshTodoOpenCount]);

  useEffect(() => {
    if (panelOpen) refreshTodoOpenCount();
  }, [panelOpen, refreshTodoOpenCount]);

  useEffect(() => {
    if (!panelOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [panelOpen, closePanel]);

  const confirmStartupOpen = (p: StartupProfileLike) => {
    if (!window.assistantDesktop?.openMainWindowWithPath) {
      setToast('请在桌面版 Electron 中使用');
      return;
    }
    recordStartupProfileUsed(p.id);
    window.assistantDesktop.openMainWindowWithPath(`/startup?profile=${encodeURIComponent(p.id)}`);
    closePanel();
  };

  const confirmDeployOpen = (tpl: DeployTemplateLike, originalCommand: string) => {
    if (!window.assistantDesktop?.openMainWindowWithPath) {
      setToast('请在桌面版 Electron 中使用');
      return;
    }
    const {jira, branch} = extractJiraAndBranch(originalCommand);
    const payload: FloatDeployConfirmedPayload = {
      command: originalCommand,
      projectIds: tpl.nodes,
      parsedJira: jira,
      parsedBranch: branch,
      templateId: tpl.id,
    };
    sessionStorage.setItem(FLOAT_DEPLOY_SESSION_KEY, JSON.stringify(payload));
    recordDeployTemplateUsed(tpl.id);
    window.assistantDesktop?.openMainWindowWithPath?.('/deploy?fromFloat=1');
    closePanel();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).closest('.float-dock-shell')) {
      return;
    }
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
    if (tap && downTarget.current?.closest('.float-dock-shell')) {
      const now = Date.now();
      if (now - lastTapAt.current <= 320) {
        lastTapAt.current = 0;
        log('识别为双击浮标，切换快捷指令');
        if (panelOpen) {
          closePanel();
        } else {
          openCommandPanel();
        }
      } else {
        lastTapAt.current = now;
        log('单击浮标，不触发面板');
      }
    } else {
      log(`结束 (${wasDrag ? '已拖动' : '未拖'})`);
    }
    downTarget.current = null;
  };

  const stopPanelPointer = (e: ReactPointerEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className={`float-dock-root${panelOpen ? ' float-dock-root--panel-open' : ''}${floatDebug ? ' float-dock-root--debug' : ''}${draggingUi ? ' float-dock--dragging' : ''}`}
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

      {panelOpen ? (
        <section
          id="float-dock-panel"
          className="float-dock-panel"
          aria-label="快捷指令面板"
          onPointerDown={stopPanelPointer}
          onPointerMove={stopPanelPointer}
          onPointerUp={stopPanelPointer}
        >
          <div className="float-dock-panel-head">
            <div className="float-dock-panel-head-row">
              <div className="float-dock-panel-title-wrap">
                <h2 className="float-dock-panel-title">快捷指令</h2>
              </div>
              <div className="float-dock-panel-toolbar">
                <button
                  type="button"
                  className="float-dock-panel-link-main"
                  onClick={() => {
                    openMain();
                    closePanel();
                  }}
                >
                  主窗口
                </button>
                <button type="button" className="float-dock-panel-close" onClick={closePanel} aria-label="关闭面板">
                  ×
                </button>
              </div>
            </div>
          </div>

          <nav className="float-dock-action-list" aria-label="快捷操作">
            {TAB_CARDS.map(({id, title, desc, Icon}) => (
              <button
                key={id}
                type="button"
                data-tab={id}
                className={`float-dock-action-card${tab === id ? ' float-dock-action-card--active' : ''}`}
                onClick={() => {
                  setTab(id);
                  setRs({phase: 'input'});
                  setToast(null);
                }}
              >
                <span className="float-dock-action-card-icon" aria-hidden="true">
                  <Icon className="float-dock-action-card-svg" strokeWidth={2} size={16} />
                </span>
                <span className="float-dock-action-card-copy">
                  <strong>{title}</strong>
                  <small>{desc}</small>
                </span>
                {tab === id ? (
                  <span className="float-dock-action-card-badge" aria-hidden="true">
                    当前
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          {rs.phase === 'input' ? (
            <>
              <label className="float-dock-field float-dock-field--segmented">
                <p>
                  <span className="float-dock-field-kicker">{TAB_FIELD[tab].kicker}</span> 
                  <span className="float-dock-field-label">{TAB_FIELD[tab].label}</span>
                </p>
                {tab === 'deploy' ? (
                  <textarea
                    className="float-dock-input float-dock-input--deploy"
                    rows={2}
                    placeholder={TAB_FIELD.deploy.placeholder}
                    value={line}
                    onChange={(e) => setLine(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        runResolve();
                      }
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    className="float-dock-input float-dock-input--line"
                    placeholder={TAB_FIELD[tab].placeholder}
                    value={line}
                    onChange={(e) => setLine(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        runResolve();
                      }
                    }}
                  />
                )}
                <p className="float-dock-field-hint">{TAB_FIELD[tab].hint}</p>
              </label>
              <div className="float-dock-actions float-dock-actions--single">
                <button type="button" className="float-dock-btn float-dock-btn--primary float-dock-btn--main" onClick={runResolve}>
                  {tab === 'todo' ? '加入待办' : tab === 'deploy' ? '生成部署草稿' : '匹配启动项'}
                </button>
              </div>
            </>
          ) : null}

          {rs.phase === 'pickStartup' ? (
            <div className="float-dock-pick">
              <div className="float-dock-pick-title">找到多个启动项，请选择：</div>
              <ul className="float-dock-pick-list">
                {rs.items.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="float-dock-pick-item" onClick={() => setRs({phase: 'previewStartup', profile: p, confidence: 'medium'})}>
                      <span className="float-dock-pick-name">{p.title}</span>
                      <span className="float-dock-pick-sub">{p.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="float-dock-btn float-dock-btn--ghost float-dock-btn--block" onClick={() => setRs({phase: 'input'})}>
                返回
              </button>
            </div>
          ) : null}

          {rs.phase === 'pickDeploy' ? (
            <div className="float-dock-pick">
              <div className="float-dock-pick-title">多个部署模板，请选择：</div>
              <ul className="float-dock-pick-list">
                {rs.items.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="float-dock-pick-item"
                      onClick={() => setRs({phase: 'previewDeploy', template: t, confidence: 'medium'})}
                    >
                      <span className="float-dock-pick-name">{t.name}</span>
                      <span className="float-dock-pick-sub">{t.nodes.join(' → ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="float-dock-btn float-dock-btn--ghost float-dock-btn--block" onClick={() => setRs({phase: 'input'})}>
                返回
              </button>
            </div>
          ) : null}

          {rs.phase === 'previewStartup' ? (
            <div className="float-dock-preview">
              <div className={`float-dock-confidence float-dock-confidence--${rs.confidence}`}>
                {confidenceLabelStartup(rs.confidence)}
              </div>
              <div className="float-dock-chips">
                <span className="float-dock-chip">
                  <em>配置</em> {rs.profile.title}
                </span>
                <span className="float-dock-chip">
                  <em>ID</em> {rs.profile.id}
                </span>
              </div>
              <p className="float-dock-hint">将在启动页选中该配置，需您在页面内再点「启动」。</p>
              {rs.confidence === 'low' ? (
                <p className="float-dock-warn">低可信匹配，请确认是否仍要打开。</p>
              ) : null}
              <div className="float-dock-actions">
                <button type="button" className="float-dock-btn float-dock-btn--ghost" onClick={() => setRs({phase: 'input'})}>
                  返回
                </button>
                <button type="button" className="float-dock-btn float-dock-btn--primary" onClick={() => confirmStartupOpen(rs.profile)}>
                  打开启动页
                </button>
              </div>
            </div>
          ) : null}

          {rs.phase === 'previewDeploy' ? (
            <div className="float-dock-preview">
              <div className={`float-dock-confidence float-dock-confidence--${rs.confidence}`}>
                {confidenceLabelDeploy(rs.confidence)}
              </div>
              <div className="float-dock-chips">
                <span className="float-dock-chip">
                  <em>模板</em> {rs.template.name}
                </span>
                <span className="float-dock-chip">
                  <em>节点</em> {rs.template.nodes.join(', ')}
                </span>
                {extractJiraAndBranch(line).jira ? (
                  <span className="float-dock-chip">
                    <em>Jira</em> {extractJiraAndBranch(line).jira}
                  </span>
                ) : null}
                {extractJiraAndBranch(line).branch ? (
                  <span className="float-dock-chip">
                    <em>分支</em> {extractJiraAndBranch(line).branch}
                  </span>
                ) : null}
              </div>
              <p className="float-dock-hint">将生成部署草稿；请在部署页确认后再执行。</p>
              {rs.confidence === 'low' ? (
                <p className="float-dock-warn">低可信匹配，请确认是否仍要打开。</p>
              ) : null}
              <div className="float-dock-actions">
                <button type="button" className="float-dock-btn float-dock-btn--ghost" onClick={() => setRs({phase: 'input'})}>
                  返回
                </button>
                <button type="button" className="float-dock-btn float-dock-btn--primary" onClick={() => confirmDeployOpen(rs.template, line.trim())}>
                  打开部署页
                </button>
              </div>
            </div>
          ) : null}

          {toast ? <div className="float-dock-toast">{toast}</div> : null}
        </section>
      ) : null}

      <div
        className={`float-dock-shell${panelOpen ? ' float-dock-shell--panel-open' : ''}`}
        title={
          todoOpenCount > 0
            ? `双击打开快捷指令，按住拖动（今日待办 ${todoOpenCount} 项未完成）`
            : '双击打开快捷指令，按住拖动'
        }
        aria-label={
          panelOpen
            ? todoOpenCount > 0
              ? `双击关闭快捷指令，今日待办 ${todoOpenCount} 项未完成`
              : '双击关闭快捷指令'
            : todoOpenCount > 0
              ? `双击打开快捷指令，今日待办 ${todoOpenCount} 项未完成`
              : '双击打开快捷指令'
        }
      >
        <div
          className={`float-dock-core${panelOpen ? ' float-dock-core--active' : ''}`}
          aria-controls="float-dock-panel"
          aria-expanded={panelOpen}
        >
          <span className="float-dock-core-logo">
            <img src="/icon-512@2x.png" alt="" width={42} height={42} draggable={false} />
            {todoOpenCount > 0 ? (
              <span className="float-dock-todo-badge" aria-hidden="true">
                {todoOpenCount > 99 ? '99+' : todoOpenCount}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}
