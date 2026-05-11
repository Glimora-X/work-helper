import PageHeader from '../components/PageHeader';
import { deployApiUrl } from '../lib/deploy-api-url';
import { ChevronLeft, ChevronRight, ClipboardList, Copy, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

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
            <div className="p-6">
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
                    return (
                      <li
                        key={row.key}
                        className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border px-4 py-3 text-sm"
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
                      </li>
                    );
                  })}
                </ul>
              )}
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
