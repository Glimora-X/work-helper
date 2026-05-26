import PageHeader from '../components/PageHeader';
import { deployApiUrl } from '../lib/deploy-api-url';
import {
  addJiraTodoToToday,
  loadDailyTodos,
  markTodayTodosDoneForJiraKey,
  readTodayJiraIssueKeys,
} from '../lib/daily-todos-storage';
import {
  buildTodosOnlyWeeklyMarkdown,
  collectCompletedTodosFromStore,
  mergeWeeklyMarkdownWithCompletedTodos,
  weekRangeLabelZh,
} from '../lib/weekly-report-todos';
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Clock, Copy, ExternalLink, FileText, Loader2, Mail, RefreshCw, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type JiraStatusPayload = {
  configured: boolean;
  mode: 'none' | 'user_password' | 'user_api_token';
  serverUrl?: string;
  hint?: string;
};

type MailStatusPayload = {
  configured: boolean;
  host?: string;
  port?: number;
  user?: string;
  digestSchedule?: string;
  lookbackHours?: number;
  hint?: string;
};

type MailDigestPayload = {
  markdown: string;
  generatedAt: string | null;
  stats: { total: number; subscribed: number; other: number; lookbackHours: number } | null;
  error?: string;
};

type SummaryPanel = 'jira' | 'weekly' | 'mail';

const SUMMARY_PANELS: { id: SummaryPanel; label: string }[] = [
  { id: 'jira', label: 'Jira 待办' },
  { id: 'weekly', label: '周报草稿' },
  { id: 'mail', label: '未读邮件' },
];

/** 认证失败缓存：防止频繁调用导致 Jira 封号 */
type AuthFailureCache = {
  timestamp: number;
  errorHint: string;
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
  const [weeklyTodosCount, setWeeklyTodosCount] = useState(0);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);
  const [copyDone, setCopyDone] = useState(false);

  // 认证失败缓存：5分钟内不再重复调用
  const [authFailureCache, setAuthFailureCache] = useState<AuthFailureCache | null>(null);
  const AUTH_FAILURE_COOLDOWN = 5 * 60 * 1000; // 5分钟

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

  const [mailStatus, setMailStatus] = useState<MailStatusPayload | null>(null);
  const [mailStatusLoading, setMailStatusLoading] = useState(true);
  const [mailMd, setMailMd] = useState('');
  const [mailGeneratedAt, setMailGeneratedAt] = useState<string | null>(null);
  const [mailStats, setMailStats] = useState<MailDigestPayload['stats']>(null);
  const [mailDigestLoading, setMailDigestLoading] = useState(false);
  const [mailRunLoading, setMailRunLoading] = useState(false);
  const [mailError, setMailError] = useState<string | null>(null);
  const [mailCopyDone, setMailCopyDone] = useState(false);
  const [activePanel, setActivePanel] = useState<SummaryPanel>('jira');
  const [showJiraPopover, setShowJiraPopover] = useState(false);
  const [showMailPopover, setShowMailPopover] = useState(false);

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

  const loadMailStatus = useCallback(async () => {
    setMailStatusLoading(true);
    try {
      const r = await fetch('/api/mail/status');
      const raw = await r.text();
      let j: MailStatusPayload;
      try {
        j = JSON.parse(raw) as MailStatusPayload;
      } catch {
        setMailStatus({
          configured: false,
          hint:
            r.status === 404 || raw.includes('<!DOCTYPE')
              ? 'deploy-api 未加载邮箱模块（多为旧进程仍在运行）。请结束占用 8787/8788 的 deploy-api 后重新执行 npm run dev，并确认项目根 .deploy-api-port 与终端日志端口一致。'
              : `无法解析 /api/mail/status 响应：${raw.slice(0, 120)}`,
        });
        return;
      }
      if (!r.ok) {
        setMailStatus({
          configured: false,
          hint: (j as { error?: string }).error || `HTTP ${r.status}`,
        });
        return;
      }
      setMailStatus(j);
    } catch (e) {
      setMailStatus({
        configured: false,
        hint: `无法连接 /api/mail/status：${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setMailStatusLoading(false);
    }
  }, []);

  const loadMailDigest = useCallback(async () => {
    setMailDigestLoading(true);
    setMailError(null);
    try {
      const r = await fetch('/api/mail/digest/latest');
      const j = (await r.json()) as MailDigestPayload;
      if (!r.ok) {
        setMailError(j.error || `HTTP ${r.status}`);
        return;
      }
      setMailMd(j.markdown || '');
      setMailGeneratedAt(j.generatedAt);
      setMailStats(j.stats);
    } catch (e) {
      setMailError(e instanceof Error ? e.message : String(e));
    } finally {
      setMailDigestLoading(false);
    }
  }, []);

  const runMailDigest = useCallback(async () => {
    setMailRunLoading(true);
    setMailError(null);
    try {
      const r = await fetch('/api/mail/digest/run', { method: 'POST' });
      const j = (await r.json()) as MailDigestPayload;
      if (!r.ok) {
        setMailError(j.error || `HTTP ${r.status}`);
        return;
      }
      setMailMd(j.markdown || '');
      setMailGeneratedAt(j.generatedAt);
      setMailStats(j.stats);
    } catch (e) {
      setMailError(e instanceof Error ? e.message : String(e));
    } finally {
      setMailRunLoading(false);
    }
  }, []);

  const copyMailDigest = useCallback(async () => {
    if (!mailMd) return;
    try {
      await navigator.clipboard.writeText(mailMd);
      setMailCopyDone(true);
      window.setTimeout(() => setMailCopyDone(false), 2000);
    } catch {
      /* ignore */
    }
  }, [mailMd]);

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
      
      // 如果配置正常，清除认证失败缓存
      if (j.configured) {
        setAuthFailureCache(null);
      }
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
    // 检查是否在认证失败冷却期
    if (authFailureCache) {
      const now = Date.now();
      if (now - authFailureCache.timestamp < AUTH_FAILURE_COOLDOWN) {
        setOpenError(`Jira 认证失败，已暂停调用。错误信息：${authFailureCache.errorHint}\n\n请修正 .env 中的 Jira 凭据配置后，点击「全部刷新」重试。`);
        setOpenIssues([]);
        setOpenTotal(0);
        return;
      } else {
        // 冷却期已过，清除缓存
        setAuthFailureCache(null);
      }
    }

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
        // 如果是认证错误，设置冷却缓存
        if (r.status === 503 || (j.error && (j.error.includes('认证') || j.error.includes('auth') || j.error.includes('401')))) {
          setAuthFailureCache({
            timestamp: Date.now(),
            errorHint: j.error || 'Jira 认证失败',
          });
        }
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
  }, [authFailureCache]);

  const applyLocalTodosToWeekly = useCallback(
    (offset: number, jiraMarkdown: string | null, rangeLabel: string, jiraTotal: number) => {
      const completed = collectCompletedTodosFromStore(loadDailyTodos(), offset);
      setWeeklyTodosCount(completed.length);
      setWeeklyTotal(jiraTotal);
      const label = rangeLabel || weekRangeLabelZh(offset);
      setWeeklyLabel(label);
      if (jiraMarkdown) {
        setWeeklyMd(mergeWeeklyMarkdownWithCompletedTodos(jiraMarkdown, completed));
      } else if (completed.length > 0) {
        setWeeklyMd(buildTodosOnlyWeeklyMarkdown(completed, label));
      } else {
        setWeeklyMd('');
      }
    },
    []
  );

  const loadWeekly = useCallback(async (offset: number) => {
    const labelFallback = weekRangeLabelZh(offset);

    // 检查是否在认证失败冷却期
    if (authFailureCache) {
      const now = Date.now();
      if (now - authFailureCache.timestamp < AUTH_FAILURE_COOLDOWN) {
        setWeeklyError(`Jira 认证失败，已暂停调用。错误信息：${authFailureCache.errorHint}\n\n请修正 .env 中的 Jira 凭据配置后，点击「全部刷新」重试。`);
        applyLocalTodosToWeekly(offset, null, labelFallback, 0);
        return;
      }
      setAuthFailureCache(null);
    }

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
        applyLocalTodosToWeekly(offset, null, labelFallback, 0);
        return;
      }
      if (!r.ok) {
        if (r.status === 503 || (j.error && (j.error.includes('认证') || j.error.includes('auth') || j.error.includes('401')))) {
          setAuthFailureCache({
            timestamp: Date.now(),
            errorHint: j.error || 'Jira 认证失败',
          });
        }
        setWeeklyError(j.error || `HTTP ${r.status}`);
        applyLocalTodosToWeekly(offset, null, j.range?.labelZh ?? labelFallback, 0);
        return;
      }
      applyLocalTodosToWeekly(
        offset,
        j.markdown ?? '',
        j.range?.labelZh ?? labelFallback,
        typeof j.total === 'number' ? j.total : 0
      );
    } catch (e) {
      setWeeklyError(e instanceof Error ? e.message : String(e));
      applyLocalTodosToWeekly(offset, null, labelFallback, 0);
    } finally {
      setWeeklyLoading(false);
    }
  }, [applyLocalTodosToWeekly, authFailureCache]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadMailStatus();
    void loadMailDigest();
  }, [loadMailStatus, loadMailDigest]);

  useEffect(() => {
    if (!status?.configured) return;
    // 如果有认证失败缓存，不再调用
    if (authFailureCache) {
      const now = Date.now();
      if (now - authFailureCache.timestamp < AUTH_FAILURE_COOLDOWN) {
        return;
      }
    }
    void loadOpen();
  }, [status?.configured, loadOpen, authFailureCache]);

  useEffect(() => {
    if (!status?.configured) return;
    // 如果有认证失败缓存，不再调用
    if (authFailureCache) {
      const now = Date.now();
      if (now - authFailureCache.timestamp < AUTH_FAILURE_COOLDOWN) {
        return;
      }
    }
    void loadWeekly(weekOffset);
  }, [status?.configured, weekOffset, loadWeekly, authFailureCache]);

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

  const renderJiraSetupBlock = () => {
    if (statusLoading) {
      return (
        <div className="pkmer-card flex items-center gap-3 p-8 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <Loader2 className="w-5 h-5 animate-spin shrink-0" />
          正在检查 Jira 配置…
        </div>
      );
    }
    return (
      <div className="pkmer-card space-y-3 p-8 text-sm" style={{ color: 'var(--text-secondary)' }}>
        {isDeployApiConnectivityHint(status?.hint) ? (
          <>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              无法访问 deploy-api（Jira 状态接口返回了非 JSON）
            </p>
            <p className="text-xs leading-relaxed">
              开发环境默认请使用同源 <code className="font-mono px-1 rounded bg-[color:var(--color-code-inline-bg)]">/api/jira</code>（由 Vite
              代理到本机 deploy-api，端口会读项目根 <code className="font-mono px-1 rounded bg-[color:var(--color-code-inline-bg)]">.deploy-api-port</code>
              ）。若设置了 <code className="font-mono px-1 rounded bg-[color:var(--color-code-inline-bg)]">VITE_DEPLOY_API_BASE</code>，其中的主机与端口必须与当前运行的
              deploy-api 一致（与 <code className="font-mono px-1 rounded bg-[color:var(--color-code-inline-bg)]">DEPLOY_API_PORT</code> 或终端日志、
              <code className="font-mono px-1 rounded bg-[color:var(--color-code-inline-bg)]">.deploy-api-port</code> 对齐），否则会拿到 Vite/HTML 错误页。
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              确认 API 可通后，若仍提示缺少 Jira 变量，再在项目根 <code className="font-mono px-1 rounded bg-[color:var(--color-code-inline-bg)]">.env</code> 中配置凭据（与 MCP{' '}
              <code className="font-mono px-1 rounded bg-[color:var(--color-code-inline-bg)]">chanjet-jira-mcp-new</code> 相同的一组即可）。
            </p>
          </>
        ) : (
          <>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              尚未配置 Jira 凭据
            </p>
            <p>
              <code className="text-xs font-mono px-1 rounded bg-[color:var(--color-code-inline-bg)]">JENKINS_*</code> 只用于部署/自动化，<strong>不能</strong>
              代替 Jira。请在项目根 <code className="text-xs font-mono px-1 rounded bg-[color:var(--color-code-inline-bg)]">.env</code> 中增加与 Cursor MCP{' '}
              <code className="font-mono px-1 rounded bg-[color:var(--color-code-inline-bg)]">chanjet-jira-mcp-new</code> 相同的一套即可：
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
    );
  };

  const panelCount = (id: SummaryPanel): number | null => {
    if (id === 'jira' && openTotal > 0) return openTotal;
    if (id === 'weekly' && weeklyTotal + weeklyTodosCount > 0) {
      return weeklyTotal + weeklyTodosCount;
    }
    if (id === 'mail' && mailStats && mailStats.total > 0) return mailStats.total;
    return null;
  };

  const panelIcon = (id: SummaryPanel) => {
    if (id === 'jira') return ClipboardList;
    if (id === 'weekly') return FileText;
    return Mail;
  };

  return (
    <div className="pkmer-page">
      <div className="pkmer-page-inner pkmer-page-inner--wide pkmer-content-fill">
      <PageHeader
        title="总结与周报"
        subtitle="Jira 待办、周报草稿与未读邮件摘要；使用下方标签切换，避免长页滚动"
        actions={
          <div className="self-center flex flex-wrap items-center justify-end gap-2 text-xs shrink-0 sm:ml-2">
            {statusLoading ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-hairline)] bg-[color:var(--color-shell-bg)] px-2 py-1 pkmer-text-muted">
                <Loader2 className="h-3 w-3 animate-spin" />
                检查配置…
              </span>
            ) : (
              <>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => !status?.configured && setShowJiraPopover((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors ${
                      status?.configured
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 cursor-pointer'
                    }`}
                  >
                    {status?.configured ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <Clock className="h-3 w-3" />
                    )}
                    Jira{' '}
                    {status?.configured
                      ? `已配置 · ${status.mode === 'user_password' ? '用户名+密码' : '用户名+API Token'}`
                      : '未配置'}
                  </button>
                  {showJiraPopover && !status?.configured ? (
                    <div className="absolute right-0 top-full mt-2 w-80 p-3 bg-[color:var(--color-shell-bg)] border border-[color:var(--color-hairline)] rounded-lg shadow-lg z-50">
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-amber-700">Jira 未配置</p>
                        <p className="text-[11px] pkmer-text-body">
                          待办与周报需在项目根 <code className="font-mono">.env</code> 或「设置」中配置{' '}
                          <code className="font-mono">JIRA_*</code> 凭据（与 MCP chanjet-jira 相同）。
                        </p>
                        {status?.hint ? (
                          <p className="text-[10px] font-mono whitespace-pre-wrap break-all text-red-600">{status.hint}</p>
                        ) : null}
                        <div className="pt-2 border-t border-[color:var(--color-hairline)]">
                          <p className="text-[10px] pkmer-text-muted mb-1">仍可使用:</p>
                          <ul className="text-[10px] space-y-1">
                            <li className="flex items-start gap-1">
                              <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0 mt-0.5" />
                              <span>「未读邮件」Tab（独立 IMAP 配置）</span>
                            </li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => !mailStatus?.configured && setShowMailPopover((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors ${
                      mailStatusLoading
                        ? 'border-[color:var(--color-hairline)] bg-[color:var(--color-shell-bg)] pkmer-text-muted'
                        : mailStatus?.configured
                          ? 'border-green-200 bg-green-50 text-green-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 cursor-pointer'
                    }`}
                  >
                    {mailStatusLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : mailStatus?.configured ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <ShieldAlert className="h-3 w-3" />
                    )}
                    邮箱{' '}
                    {mailStatusLoading
                      ? '检查中…'
                      : mailStatus?.configured
                        ? `已配置 · ${mailStatus.user ?? ''}`
                        : '未配置'}
                  </button>
                  {showMailPopover && !mailStatus?.configured && !mailStatusLoading ? (
                    <div className="absolute right-0 top-full mt-2 w-80 p-3 bg-[color:var(--color-shell-bg)] border border-[color:var(--color-hairline)] rounded-lg shadow-lg z-50">
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-amber-700">阿里邮箱 IMAP 未配置</p>
                        <p className="text-[11px] pkmer-text-body">
                          在「设置」或 <code className="font-mono">.env</code> 中配置{' '}
                          <code className="font-mono">MAIL_IMAP_USER</code> 与{' '}
                          <code className="font-mono">MAIL_IMAP_PASSWORD</code>（三方客户端安全密码）。
                        </p>
                        {mailStatus?.hint ? (
                          <p className="text-[10px] font-mono whitespace-pre-wrap break-all text-red-600">{mailStatus.hint}</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                {status?.configured ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthFailureCache(null);
                      setShowJiraPopover(false);
                      setShowMailPopover(false);
                      void loadStatus();
                      void loadOpen();
                      void loadWeekly(weekOffset);
                      void loadMailStatus();
                      void loadMailDigest();
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-hairline)] bg-[color:var(--color-shell-bg)] px-2 py-1 transition-colors hover:border-[color:var(--border-medium)] pkmer-text-secondary"
                  >
                    <RefreshCw className="h-3 w-3" />
                    全部刷新
                  </button>
                ) : null}
              </>
            )}
          </div>
        }
      />

      <div className="summary-panel-tabs" role="tablist" aria-label="总结分区">
        {SUMMARY_PANELS.map(({ id, label }) => {
          const Icon = panelIcon(id);
          const badge = panelCount(id);
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activePanel === id}
              className={`summary-panel-tab${activePanel === id ? ' summary-panel-tab--active' : ''}`}
              onClick={() => setActivePanel(id)}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
              {label}
              {badge != null ? <span className="summary-panel-tab__badge">{badge}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-2 pr-1">
          {activePanel === 'jira' && (statusLoading || !status?.configured ? (
            renderJiraSetupBlock()
          ) : (
          <section className="pkmer-card overflow-hidden">
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
                        className="w-full text-left px-3 py-2 hover:bg-[color:var(--color-code-inline-bg)] transition-colors"
                        onClick={addToTodayFromMenu}
                      >
                        加入今日待办
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="w-full text-left px-3 py-2 hover:bg-[color:var(--color-code-inline-bg)] transition-colors disabled:opacity-50 inline-flex items-center gap-2"
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
          ))}

          {activePanel === 'weekly' && (statusLoading || !status?.configured ? (
            renderJiraSetupBlock()
          ) : (
          <section className="pkmer-card overflow-hidden">
            <div
              className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b"
              style={{ borderColor: 'var(--border-light)', background: 'var(--bg-secondary)' }}
            >
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  周报草稿（Jira + 本周已完成待办）
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  汇总所选自然周内 Jira 更新过的指派工单，以及 Tasks 页中该周已勾选的每日待办，生成 Markdown 草稿。
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
                  {weeklyLabel}
                  {weeklyTotal > 0 || weeklyTodosCount > 0
                    ? ` · Jira ${weeklyTotal} 条 · 待办 ${weeklyTodosCount} 条`
                    : null}
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
                  className="text-xs leading-relaxed whitespace-pre-wrap font-mono rounded-xl p-4 overflow-auto border"
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
          ))}

          {activePanel === 'mail' && (
      <section className="pkmer-card overflow-hidden">
        <div
          className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b"
          style={{ borderColor: 'var(--border-light)', background: 'var(--bg-secondary)' }}
        >
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 shrink-0" style={{ color: 'var(--primary)' }} />
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                未读邮件摘要（阿里企业邮箱）
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                仅汇总未读邮件；按 config/mail-subscriptions.json 订阅规则筛选，默认每日 {mailStatus?.digestSchedule ?? '08:00'} 自动生成。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                void loadMailStatus();
                void loadMailDigest();
              }}
              className="text-xs inline-flex items-center gap-1"
              style={{ color: 'var(--primary)' }}
            >
              {mailDigestLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              刷新
            </button>
            <button
              type="button"
              onClick={() => void runMailDigest()}
              disabled={!mailStatus?.configured || mailRunLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40"
              style={{
                borderColor: 'var(--secondary)',
                color: 'var(--secondary)',
                background: 'color-mix(in srgb, var(--secondary) 8%, transparent)',
              }}
            >
              {mailRunLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              立即生成
            </button>
            <button
              type="button"
              onClick={() => void copyMailDigest()}
              disabled={!mailMd}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40"
              style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
            >
              <Copy className="w-3.5 h-3.5" />
              {mailCopyDone ? '已复制' : '复制 Markdown'}
            </button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          {mailStatusLoading ? (
            <p className="text-sm flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
              <Loader2 className="w-4 h-4 animate-spin" /> 检查邮箱配置…
            </p>
          ) : !mailStatus?.configured ? (
            <div className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {mailStatus?.hint ? '邮箱接口不可用' : '尚未配置阿里邮箱 IMAP'}
              </p>
              {mailStatus?.hint ? (
                <p className="text-xs leading-relaxed whitespace-pre-wrap">{mailStatus.hint}</p>
              ) : (
                <>
                  <p className="text-xs leading-relaxed">
                    「设置」与项目根 <code className="font-mono px-1 rounded bg-[color:var(--color-code-inline-bg)]">.env</code>{' '}
                    是<strong>同一套配置</strong>（设置页会写入 .env）。需同时配置{' '}
                    <code className="font-mono px-1 rounded bg-[color:var(--color-code-inline-bg)]">MAIL_IMAP_USER</code> 与{' '}
                    <code className="font-mono px-1 rounded bg-[color:var(--color-code-inline-bg)]">MAIL_IMAP_PASSWORD</code>
                    （阿里邮箱<strong>三方客户端安全密码</strong>，不是网页登录密码）。
                  </p>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    修改 .env 后须<strong>重启 deploy-api</strong>（重新 npm run dev）才会生效。
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                已连接 {mailStatus.user} · {mailStatus.host}:{mailStatus.port}
                {mailGeneratedAt
                  ? ` · 上次生成 ${new Date(mailGeneratedAt).toLocaleString('zh-CN')}`
                  : ' · 尚无缓存摘要'}
                {mailStats
                  ? ` · 未读 ${mailStats.total} 封，订阅命中 ${mailStats.subscribed} 封`
                  : ''}
              </p>
              {mailError ? (
                <p className="text-sm" style={{ color: 'var(--danger)' }}>
                  {mailError}
                </p>
              ) : mailDigestLoading && !mailMd ? (
                <p className="text-sm flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载中…
                </p>
              ) : (
                <pre
                  className="text-xs leading-relaxed whitespace-pre-wrap font-mono rounded-xl p-4 overflow-auto border"
                  style={{
                    borderColor: 'var(--border-light)',
                    background: 'var(--neutral-50)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {mailMd || '（尚无摘要，点击「立即生成」拉取未读邮件）'}
                </pre>
              )}
            </>
          )}
        </div>
      </section>
          )}
      </div>
      </div>
    </div>
  );
}
