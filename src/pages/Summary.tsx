import PageHeader from '../components/PageHeader';
import { deployApiUrl } from '../lib/deploy-api-url';
import {
  addJiraTodoToToday,
  markTodayTodosDoneForJiraKey,
  readTodayJiraIssueKeys,
} from '../lib/daily-todos-storage';
import { ChevronLeft, ChevronRight, ClipboardList, Copy, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type JiraStatusPayload = {
  configured: boolean;
  mode: 'none' | 'user_password' | 'user_api_token';
  serverUrl?: string;
  hint?: string;
};

type JiraIssueRow = {
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    issuetype?: { name?: string };
    priority?: { name?: string };
    project?: { key?: string };
    updated?: string;
  };
};

function browseUrl(serverUrl: string | undefined, issueKey: string): string {
  if (!serverUrl) return '#';
  const base = serverUrl.replace(/\/$/, '');
  return `${base}/browse/${encodeURIComponent(issueKey)}`;
}

/** 返回 HTML/连错端口/代理 502 时常见：与「未在 .env 配 Jira」区分展示 */
function isDeployApiConnectivityHint(hint?: string): boolean {
  if (!hint) return false;
  return (
    hint.includes('无法解析 API 响应') ||
    hint.includes('无法连接 ') ||
    hint.includes('<!DOCTYPE') ||
    (hint.includes('请求失败 HTTP') &&
      (hint.includes('deploy-api') || hint.includes('HTML 404') || hint.includes('127.0.0.1')))
  );
}

export default function Summary() {
  const [status, setStatus] = useState<JiraStatusPayload | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [openIssues, setOpenIssues] = useState<JiraIssueRow[]>([]);
  const [openTotal, setOpenTotal] = useState(0);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const [weekOffset, setWeekOffset] = useState(0);
  const [weeklyMd, setWeeklyMd] = useState('');
  const [weeklyLabel, setWeeklyLabel] = useState('');
  const [weeklyTotal, setWeeklyTotal] = useState(0);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);
  const [copyDone, setCopyDone] = useState(false);

  const [issueMenu, setIssueMenu] = useState<{
    x: number;
    y: number;
    issueKey: string;
    summary: string;
  } | null>(null);
  const issueMenuRef = useRef<HTMLDivElement | null>(null);
  const [issueActionHint, setIssueActionHint] = useState<string | null>(null);
  const [submitTestKey, setSubmitTestKey] = useState<string | null>(null);
  const [todayJiraKeys, setTodayJiraKeys] = useState(() => readTodayJiraIssueKeys());

  const refreshTodayJiraKeys = useCallback(() => {
    setTodayJiraKeys(readTodayJiraIssueKeys());
  }, []);

  useEffect(() => {
    refreshTodayJiraKeys();
  }, [refreshTodayJiraKeys]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') refreshTodayJiraKeys();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshTodayJiraKeys]);

  useLayoutEffect(() => {
    if (!issueMenu) return;
    const el = issueMenuRef.current;
    if (!el) return;
    const pad = 8;
    let left = issueMenu.x;
    let top = issueMenu.y;
    const rect = el.getBoundingClientRect();
    if (left + rect.width > window.innerWidth - pad) {
      left = window.innerWidth - rect.width - pad;
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = window.innerHeight - rect.height - pad;
    }
    left = Math.max(pad, left);
    top = Math.max(pad, top);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [issueMenu]);

  useEffect(() => {
    if (!issueMenu) return;
    const close = (e: MouseEvent) => {
      if (issueMenuRef.current?.contains(e.target as Node)) return;
      setIssueMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIssueMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [issueMenu]);

  useEffect(() => {
    if (!issueActionHint) return;
    const t = window.setTimeout(() => setIssueActionHint(null), 4200);
    return () => clearTimeout(t);
  }, [issueActionHint]);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const url = deployApiUrl('jira', '/status');
      const r = await fetch(url);
      const raw = await r.text();
      let j: JiraStatusPayload;
      try {
        j = JSON.parse(raw) as JiraStatusPayload;
      } catch {
        setStatus({
          configured: false,
          mode: 'none',
          hint: `无法解析 API 响应（${url}）。若使用直连地址，请核对 VITE_DEPLOY_API_BASE 与 deploy-api 端口；响应开头：${raw.slice(0, 80)}`,
        });
        return;
      }
      if (!r.ok) {
        const errBody = j as { hint?: string; error?: string };
        const detail = errBody.hint || errBody.error || raw.slice(0, 160);
        setStatus({
          configured: false,
          mode: 'none',
          hint: `请求失败 HTTP ${r.status}：${detail}`,
        });
        return;
      }
      setStatus(j);
    } catch (e) {
      setStatus({
        configured: false,
        mode: 'none',
        hint: `无法连接 ${deployApiUrl('jira', '/status')}：${e instanceof Error ? e.message : String(e)}。请确认已执行 npm run dev（含 deploy-api），或与部署页一致设置 VITE_DEPLOY_API_BASE。`,
      });
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadOpen = useCallback(async () => {
    setOpenLoading(true);
    setOpenError(null);
    try {
      const url = deployApiUrl('jira', '/my-open?max=80');
      const r = await fetch(url);
      const raw = await r.text();
      let j: { issues?: JiraIssueRow[]; total?: number; error?: string };
      try {
        j = JSON.parse(raw) as typeof j;
      } catch {
        setOpenError(
          `无法解析响应（${url}）。开头：${raw.slice(0, 120)}${raw.length > 120 ? '…' : ''}`
        );
        setOpenIssues([]);
        setOpenTotal(0);
        return;
      }
      if (!r.ok) {
        setOpenError(j.error || `HTTP ${r.status}`);
        setOpenIssues([]);
        setOpenTotal(0);
        return;
      }
      setOpenIssues(j.issues ?? []);
      setOpenTotal(typeof j.total === 'number' ? j.total : 0);
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e));
      setOpenIssues([]);
      setOpenTotal(0);
    } finally {
      setOpenLoading(false);
    }
  }, []);

  const loadWeekly = useCallback(async (offset: number) => {
    setWeeklyLoading(true);
    setWeeklyError(null);
    try {
      const url = deployApiUrl('jira', `/weekly?weekOffset=${offset}`);
      const r = await fetch(url);
      const raw = await r.text();
      let j: {
        markdown?: string;
        range?: { labelZh?: string };
        total?: number;
        error?: string;
      };
      try {
        j = JSON.parse(raw) as typeof j;
      } catch {
        setWeeklyError(
          `无法解析响应（${url}）。开头：${raw.slice(0, 120)}${raw.length > 120 ? '…' : ''}`
        );
        setWeeklyMd('');
        setWeeklyLabel('');
        setWeeklyTotal(0);
        return;
      }
      if (!r.ok) {
        setWeeklyError(j.error || `HTTP ${r.status}`);
        setWeeklyMd('');
        setWeeklyLabel('');
        setWeeklyTotal(0);
        return;
      }
      setWeeklyMd(j.markdown ?? '');
      setWeeklyLabel(j.range?.labelZh ?? '');
      setWeeklyTotal(typeof j.total === 'number' ? j.total : 0);
    } catch (e) {
      setWeeklyError(e instanceof Error ? e.message : String(e));
      setWeeklyMd('');
      setWeeklyLabel('');
      setWeeklyTotal(0);
    } finally {
      setWeeklyLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!status?.configured) return;
    void loadOpen();
  }, [status?.configured, loadOpen]);

  useEffect(() => {
    if (!status?.configured) return;
    void loadWeekly(weekOffset);
  }, [status?.configured, weekOffset, loadWeekly]);

  const addToTodayFromMenu = useCallback(() => {
    if (!issueMenu) return;
    const key = issueMenu.issueKey;
    const { added } = addJiraTodoToToday(key, issueMenu.summary);
    setIssueMenu(null);
    refreshTodayJiraKeys();
    if (added) setIssueActionHint(`已将 ${key} 加入今日待办`);
  }, [issueMenu, refreshTodayJiraKeys]);

  const submitTestFromMenu = useCallback(async () => {
    if (!issueMenu) return;
    const key = issueMenu.issueKey;
    setSubmitTestKey(key);
    try {
      const url = deployApiUrl('jira', `/issue/${encodeURIComponent(key)}/submit-test`);
      const r = await fetch(url, { method: 'POST' });
      const raw = await r.text();
      let j: {
        ok?: boolean;
        error?: string;
        transitionName?: string;
      };
      try {
        j = JSON.parse(raw) as typeof j;
      } catch {
        setIssueActionHint(`提测失败：响应无法解析（HTTP ${r.status}）`);
        setIssueMenu(null);
        return;
      }
      if (!r.ok || !j.ok) {
        const detail = j.error || raw.slice(0, 200);
        setIssueActionHint(`提测失败：${detail}`);
        setIssueMenu(null);
        return;
      }
      const n = markTodayTodosDoneForJiraKey(key);
      setIssueMenu(null);
      refreshTodayJiraKeys();
      void loadOpen();
      const trans = j.transitionName ? `（${j.transitionName}）` : '';
      setIssueActionHint(
        n > 0 ? `已提测 ${key}${trans}，并将今日 ${n} 条关联待办标为已完成` : `已提测 ${key}${trans}`
      );
    } catch (e) {
      setIssueActionHint(`提测失败：${e instanceof Error ? e.message : String(e)}`);
      setIssueMenu(null);
    } finally {
      setSubmitTestKey(null);
    }
  }, [issueMenu, loadOpen, refreshTodayJiraKeys]);

  const copyWeekly = async () => {
    if (!weeklyMd) return;
    try {
      await navigator.clipboard.writeText(weeklyMd);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    } catch {
      setCopyDone(false);
    }
  };

  const serverUrl = status?.serverUrl;

  return (
    <div className="p-8 md:p-12 max-w-6xl mx-auto">
      <PageHeader
        title="总结与周报"
        subtitle="拉取 Jira 指派给你的待办，并按自然周生成周报草稿（与 MCP chanjet-jira 同源配置）"
      />

      {statusLoading ? (
        <div className="artistic-card p-8 flex items-center gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <Loader2 className="w-5 h-5 animate-spin shrink-0" />
          正在检查 Jira 配置…
        </div>
      ) : !status?.configured ? (
        <div className="artistic-card p-8 space-y-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {isDeployApiConnectivityHint(status?.hint) ? (
            <>
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                无法访问 deploy-api（Jira 状态接口返回了非 JSON）
              </p>
              <p className="text-xs leading-relaxed">
                开发环境默认请使用同源 <code className="font-mono px-1 rounded bg-neutral-100">/api/jira</code>（由 Vite
                代理到本机 deploy-api，端口会读项目根 <code className="font-mono px-1 rounded bg-neutral-100">.deploy-api-port</code>
                ）。若设置了 <code className="font-mono px-1 rounded bg-neutral-100">VITE_DEPLOY_API_BASE</code>，其中的主机与端口必须与当前运行的
                deploy-api 一致（与 <code className="font-mono px-1 rounded bg-neutral-100">DEPLOY_API_PORT</code> 或终端日志、
                <code className="font-mono px-1 rounded bg-neutral-100">.deploy-api-port</code> 对齐），否则会拿到 Vite/HTML 错误页。
              </p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                确认 API 可通后，若仍提示缺少 Jira 变量，再在项目根 <code className="font-mono px-1 rounded bg-neutral-100">.env</code> 中配置凭据（与 MCP{' '}
                <code className="font-mono px-1 rounded bg-neutral-100">chanjet-jira-mcp-new</code> 相同的一组即可）。
              </p>
            </>
          ) : (
            <>
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                尚未配置 Jira 凭据
              </p>
              <p>
                <code className="text-xs font-mono px-1 rounded bg-neutral-100">JENKINS_*</code> 只用于部署/自动化，<strong>不能</strong>
                代替 Jira。请在项目根 <code className="text-xs font-mono px-1 rounded bg-neutral-100">.env</code> 中增加与 Cursor MCP{' '}
                <code className="text-xs font-mono px-1 rounded bg-neutral-100">chanjet-jira-mcp-new</code> 相同的一套即可：
              </p>
              <ul className="list-disc pl-5 space-y-1 text-xs leading-relaxed">
                <li>
                  <code className="font-mono">JIRA_SERVER_URL</code> + <code className="font-mono">JIRA_USERNAME</code> +{' '}
                  <code className="font-mono">JIRA_PASSWORD</code>（登录密码或 PAT）
                </li>
                <li>
                  或 <code className="font-mono">JIRA_SERVER_URL</code> + <code className="font-mono">JIRA_USERNAME</code> +{' '}
                  <code className="font-mono">JIRA_API_TOKEN</code>（REST API Token，与部署页 Jira 解析共用）
                </li>
              </ul>
            </>
          )}
          {status?.hint ? (
            <p className="text-xs pt-1 font-mono whitespace-pre-wrap break-all" style={{ color: 'var(--danger)' }}>
              {status.hint}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-mono uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Jira 已连接 ·{' '}
              {status.mode === 'user_password' ? '用户名+密码' : '用户名+API Token'}
            </span>
            <button
              type="button"
              onClick={() => {
                void loadStatus();
                void loadOpen();
                void loadWeekly(weekOffset);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors"
              style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              全部刷新
            </button>
          </div>

          <section className="artistic-card overflow-hidden">
            <div
              className="flex items-center justify-between gap-4 px-6 py-4 border-b"
              style={{ borderColor: 'var(--border-light)', background: 'var(--bg-secondary)' }}
            >
              <div className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5 shrink-0" style={{ color: 'var(--primary)' }} />
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  我的 Jira 待办
                </h2>
                <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                  {openTotal ? `共 ${openTotal} 条` : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void loadOpen()}
                className="text-xs inline-flex items-center gap-1"
                style={{ color: 'var(--primary)' }}
              >
                {openLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                刷新列表
              </button>
            </div>
            <div className="p-6 relative">
              {issueActionHint ? (
                <p
                  className="text-xs rounded-lg border px-3 py-2 mb-3"
                  style={{
                    borderColor: 'var(--border-light)',
                    background: 'var(--neutral-50)',
                    color: 'var(--text-secondary)',
                  }}
                  role="status"
                >
                  {issueActionHint}
                </p>
              ) : null}
              {openError ? (
                <p className="text-sm" style={{ color: 'var(--danger)' }}>
                  {openError}
                </p>
              ) : openLoading && openIssues.length === 0 ? (
                <p className="text-sm flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载中…
                </p>
              ) : openIssues.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  当前没有指派给你且未解决的工单。
                </p>
              ) : (
                <ul className="space-y-3">
                  {openIssues.map((row) => {
                    const f = row.fields;
                    const st = f?.status?.name ?? '';
                    const pr = f?.project?.key ?? '';
                    const sum = f?.summary ?? '';
                    const inTodayTodo = todayJiraKeys.has(row.key.toUpperCase());
                    return (
                      <li
                        key={row.key}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setIssueMenu({
                            x: e.clientX,
                            y: e.clientY,
                            issueKey: row.key,
                            summary: sum,
                          });
                        }}
                        className="flex flex-wrap items-start justify-between gap-2 rounded-lg border px-4 py-3 text-sm cursor-context-menu"
                        style={{ borderColor: 'var(--border-light)' }}
                      >
                        <div className="min-w-0 flex-1">
                          <a
                            href={browseUrl(serverUrl, row.key)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-xs font-semibold no-underline hover:underline"
                            style={{ color: 'var(--primary)' }}
                          >
                            {row.key}
                            <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
                          </a>
                          <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                            {[pr, st].filter(Boolean).join(' · ')}
                          </span>
                          <p className="mt-1 text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>
                            {sum}
                          </p>
                        </div>
                        {inTodayTodo ? (
                          <span
                            className="shrink-0 text-[11px] font-medium rounded-md px-2 py-1 border self-start whitespace-nowrap"
                            style={{
                              borderColor: 'var(--border-medium)',
                              color: 'var(--secondary)',
                              background: 'color-mix(in srgb, var(--secondary) 10%, transparent)',
                            }}
                            title="该工单已在「每日待办」今天的列表中"
                          >
                            已在今日待办
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {issueMenu
                ? createPortal(
                    <div
                      ref={issueMenuRef}
                      className="fixed z-[10000] min-w-[11rem] rounded-lg border py-1 text-sm shadow-lg"
                      style={{
                        left: issueMenu.x,
                        top: issueMenu.y,
                        borderColor: 'var(--border-medium)',
                        background: 'var(--bg-primary, #fff)',
                        color: 'var(--text-primary)',
                      }}
                      role="menu"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="w-full text-left px-3 py-2 hover:bg-neutral-100 transition-colors"
                        onClick={addToTodayFromMenu}
                      >
                        加入今日待办
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="w-full text-left px-3 py-2 hover:bg-neutral-100 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                        disabled={Boolean(submitTestKey)}
                        onClick={() => void submitTestFromMenu()}
                      >
                        {submitTestKey === issueMenu.issueKey ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />
                        ) : null}
                        提测（Jira 工作流）
                      </button>
                    </div>,
                    document.body
                  )
                : null}
            </div>
          </section>

          <section className="artistic-card overflow-hidden">
            <div
              className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b"
              style={{ borderColor: 'var(--border-light)', background: 'var(--bg-secondary)' }}
            >
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  周报草稿（按周更新过的工单）
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  统计「指派给你」且在所选自然周内发生过更新的工单，并生成 Markdown 草稿。
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  aria-label="上一周"
                  className="p-2 rounded-lg border transition-colors"
                  style={{ borderColor: 'var(--border-medium)' }}
                  onClick={() => setWeekOffset((o) => o - 1)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono px-2 min-w-[10rem] text-center" style={{ color: 'var(--text-secondary)' }}>
                  {weekOffset === 0 ? '本周' : weekOffset === -1 ? '上一周' : `偏移 ${weekOffset} 周`}
                </span>
                <button
                  type="button"
                  aria-label="下一周"
                  disabled={weekOffset >= 0}
                  className="p-2 rounded-lg border transition-colors disabled:opacity-40"
                  style={{ borderColor: 'var(--border-medium)' }}
                  onClick={() => setWeekOffset((o) => Math.min(0, o + 1))}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void copyWeekly()}
                  disabled={!weeklyMd}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40"
                  style={{
                    borderColor: 'var(--secondary)',
                    color: 'var(--secondary)',
                    background: 'color-mix(in srgb, var(--secondary) 8%, transparent)',
                  }}
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copyDone ? '已复制' : '复制 Markdown'}
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {weeklyLabel ? (
                <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                  {weeklyLabel} · 命中 {weeklyTotal} 条
                </p>
              ) : null}
              {weeklyError ? (
                <p className="text-sm" style={{ color: 'var(--danger)' }}>
                  {weeklyError}
                </p>
              ) : weeklyLoading && !weeklyMd ? (
                <p className="text-sm flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                  <Loader2 className="w-4 h-4 animate-spin" /> 生成中…
                </p>
              ) : (
                <pre
                  className="text-xs leading-relaxed whitespace-pre-wrap font-mono rounded-xl p-4 max-h-[min(70vh,520px)] overflow-auto border"
                  style={{
                    borderColor: 'var(--border-light)',
                    background: 'var(--neutral-50)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {weeklyMd || '（无内容）'}
                </pre>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
