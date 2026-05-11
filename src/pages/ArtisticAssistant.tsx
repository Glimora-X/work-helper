import {Sparkles} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import PageHeader from '../components/PageHeader';
import './ArtisticAssistant.css';

type ChatRole = 'user' | 'assistant';

type UiMessage = {
  id: string;
  role: ChatRole;
  content: string;
  knowledgeHits?: KnowledgeHit[];
};

type KnowledgeHit = {
  title: string;
  excerpt: string;
  source: string;
  kind: 'local' | 'wiki';
};

type AssistantOptions = {
  geminiConfigured: boolean;
  geminiModel: string;
  openaiConfigured: boolean;
  openaiModel: string;
  ollamaHost: string;
  ollamaModels: {name: string}[];
  knowledge: {
    localConfigured: boolean;
    wikiConfigured: boolean;
    remoteSearchUrlCount: number;
    confluenceConfigured: boolean;
  };
};

type ModelChoice = {provider: 'gemini'} | {provider: 'openai'} | {provider: 'ollama'; model: string};

function parseModelPick(v: string): ModelChoice | null {
  if (!v.trim()) return null;
  if (v === 'gemini') return {provider: 'gemini'};
  if (v === 'openai') return {provider: 'openai'};
  if (v.startsWith('ollama:')) {
    const model = v.slice('ollama:'.length).trim();
    return model ? {provider: 'ollama', model} : null;
  }
  return null;
}

function pickDefaultModel(o: AssistantOptions): string {
  if (o.geminiConfigured) return 'gemini';
  if (o.openaiConfigured) return 'openai';
  if (o.ollamaModels[0]) return `ollama:${o.ollamaModels[0].name}`;
  return '';
}

export default function ArtisticAssistant() {
  const [options, setOptions] = useState<AssistantOptions | null>(null);
  const [optionsErr, setOptionsErr] = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [modelValue, setModelValue] = useState<string>('');
  const [retrieveKb, setRetrieveKb] = useState(true);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [previewHits, setPreviewHits] = useState<KnowledgeHit[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadOptions = useCallback(async () => {
    setOptionsErr(null);
    setOptionsLoading(true);
    try {
      const res = await fetch('/api/assistant/options');
      const json = (await res.json()) as AssistantOptions & {error?: string};
      if (!res.ok) {
        setOptionsErr(json.error || `加载配置失败（${res.status}）`);
        setOptions(null);
        setModelValue('');
        return;
      }
      setOptions(json);
      setModelValue(pickDefaultModel(json) || '');
    } catch (e) {
      setOptionsErr(e instanceof Error ? e.message : String(e));
      setOptions(null);
      setModelValue('');
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const modelChoice = useMemo((): ModelChoice | null => parseModelPick(modelValue), [modelValue]);

  const hasAnyModel = useMemo(() => {
    if (!options) return false;
    return options.geminiConfigured || options.openaiConfigured || options.ollamaModels.length > 0;
  }, [options]);

  const kbHint = useMemo(() => {
    if (optionsLoading) return '正在读取模型与知识库配置…';
    if (!options) return '未能加载配置。';
    const {localConfigured, wikiConfigured, remoteSearchUrlCount, confluenceConfigured} = options.knowledge;
    const n = remoteSearchUrlCount ?? 0;
    if (localConfigured || wikiConfigured || confluenceConfigured) {
      return `知识库：${localConfigured ? '本地目录' : '无本地目录'}；${confluenceConfigured ? 'Wiki（Confluence）全文' : '无 Confluence'}；${n > 0 ? `HTTP 检索 ${n} 路（语雀/自建/CDN 等）` : '无 HTTP 检索'}。`;
    }
    return '知识库尚未配置：ASSISTANT_KB_LOCAL_DIRS、CONFLUENCE_BASE_URL、ASSISTANT_KB_SEARCH_URLS（分号多路）等。';
  }, [options, optionsLoading]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !modelChoice || !options) return;

    setChatErr(null);
    setPreviewHits(null);
    const userMsg: UiMessage = {id: `u-${Date.now()}`, role: 'user', content: text};
    setMessages((m) => [...m, userMsg]);
    setDraft('');
    setLoading(true);

    const apiMessages = [...messages, userMsg].map(({role, content}) => ({role, content}));

    const modelForApi =
      modelChoice.provider === 'ollama'
        ? modelChoice.model
        : modelChoice.provider === 'gemini'
          ? options.geminiModel
          : options.openaiModel;

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          messages: apiMessages,
          provider: modelChoice.provider,
          model: modelForApi,
          retrieveKnowledge: retrieveKb,
          ollamaBase: options.ollamaHost,
        }),
      });
      const json = (await res.json()) as {
        reply?: string;
        knowledgeHits?: KnowledgeHit[];
        warnings?: string[];
        error?: string;
      };
      if (!res.ok) {
        setChatErr(json.error || `对话失败（${res.status}）`);
        return;
      }
      const reply = json.reply?.trim() || '（空回复）';
      const knowledgeHits = json.knowledgeHits ?? [];
      const warnText = json.warnings?.filter(Boolean).join('\n');
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: warnText ? `${reply}\n\n——\n${warnText}` : reply,
          knowledgeHits: knowledgeHits.length ? knowledgeHits : undefined,
        },
      ]);
    } catch (e) {
      setChatErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const previewKnowledge = async () => {
    const text = draft.trim();
    if (!text) return;
    setPreviewLoading(true);
    setPreviewHits(null);
    setChatErr(null);
    try {
      const res = await fetch('/api/knowledge/search', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({query: text}),
      });
      const json = (await res.json()) as {hits?: KnowledgeHit[]; error?: string};
      if (!res.ok) {
        setChatErr(json.error || `检索失败（${res.status}）`);
        return;
      }
      setPreviewHits(json.hits ?? []);
    } catch (e) {
      setChatErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="artistic-assistant">
      <div className="artistic-assistant__inner">
        <PageHeader
          icon={Sparkles}
          title="Artistic Dottie-Assistant"
          subtitle="对话 + 可选知识库检索；模型在下方一项里选好即可（Gemini / GPT / 本机 Ollama）。需运行 deploy-api。"
        />

        {optionsErr ? <p className="artistic-assistant__error">{optionsErr}</p> : null}

        <p className="artistic-assistant__meta">{kbHint}</p>

        {chatErr ? <p className="artistic-assistant__error">{chatErr}</p> : null}

        {previewHits ? (
          <div className="artistic-assistant__preview">
            <h4>检索预览（{previewHits.length} 条）</h4>
            {previewHits.length === 0 ? (
              <p style={{margin: 0}}>无匹配片段。可调整 ASSISTANT_KB_LOCAL_DIRS 或检索词。</p>
            ) : (
              previewHits.slice(0, 8).map((h, i) => (
                <div key={`${h.source}-${i}`} className="artistic-assistant__hit">
                  <div className="artistic-assistant__hit-title">{h.title}</div>
                  <div className="artistic-assistant__hit-path">{h.source}</div>
                  <div>{h.excerpt}</div>
                </div>
              ))
            )}
          </div>
        ) : null}

        <div className="artistic-assistant__messages" role="log" aria-live="polite" aria-relevant="additions">
          {messages.length === 0 ? (
            <div className="artistic-assistant__empty">
              例如提问：「搜索单据记忆的设计」—— 勾选「检索知识库」后，Dottie-Assistant会先在配置的目录与 Wiki 中检索相关片段，再给出归纳总结。
            </div>
          ) : (
            messages.map((msg) => (
              <article
                key={msg.id}
                className={`artistic-assistant__bubble artistic-assistant__bubble--${msg.role}`}
              >
                <div className="artistic-assistant__role">{msg.role === 'user' ? '你' : 'Dottie-Assistant'}</div>
                <div className="artistic-assistant__body">{msg.content}</div>
                {msg.role === 'assistant' && msg.knowledgeHits?.length ? (
                  <details className="artistic-assistant__sources">
                    <summary>本回答参考的知识库片段（{msg.knowledgeHits.length}）</summary>
                    {msg.knowledgeHits.map((h, i) => (
                      <div key={`${h.source}-${i}`} className="artistic-assistant__hit">
                        <div className="artistic-assistant__hit-title">
                          {h.title} <span style={{opacity: 0.7}}>({h.kind})</span>
                        </div>
                        <div className="artistic-assistant__hit-path">{h.source}</div>
                        <div>{h.excerpt}</div>
                      </div>
                    ))}
                  </details>
                ) : null}
              </article>
            ))
          )}
          {loading ? (
            <div className="artistic-assistant__bubble artistic-assistant__bubble--assistant" aria-busy="true">
              <div className="artistic-assistant__role">Dottie-Assistant</div>
              <div className="artistic-assistant__body">正在思考…</div>
            </div>
          ) : null}
        </div>

        <div className="artistic-assistant__composer-wrap">
          <label className="artistic-assistant__label" htmlFor="aa-composer">
            输入消息
          </label>
          <textarea
            id="aa-composer"
            className="artistic-assistant__composer"
            rows={4}
            placeholder="描述你的问题；需要查内部文档时勾选「检索知识库」。"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={loading}
          />
          <div className="artistic-assistant__composer-bar">
            <select
              id="aa-model"
              className="artistic-assistant__select artistic-assistant__select--bar"
              value={optionsLoading ? '' : modelValue}
              onChange={(e) => setModelValue(e.target.value)}
              aria-label="选择模型"
              title="Gemini / GPT（OpenAI）为云端；Ollama · 开头为本机已扫描到的模型。"
              disabled={optionsLoading || (!!options && !hasAnyModel)}
            >
              {optionsLoading ? <option value="">加载中…</option> : null}
              {!optionsLoading && options && !hasAnyModel ? (
                <option value="" disabled>
                  未配置模型（.env：GEMINI_API_KEY / OPENAI_API_KEY / 本机 Ollama）
                </option>
              ) : null}
              {!optionsLoading && options?.geminiConfigured ? (
                <option value="gemini">Gemini · {options.geminiModel}</option>
              ) : null}
              {!optionsLoading && options?.openaiConfigured ? (
                <option value="openai">GPT · {options.openaiModel}</option>
              ) : null}
              {!optionsLoading &&
                (options?.ollamaModels ?? []).map(({name}) => (
                  <option key={name} value={`ollama:${name}`}>
                    Ollama · {name}
                  </option>
                ))}
            </select>
            <div className="artistic-assistant__composer-bar-mid">
              <label
                className="artistic-assistant__check artistic-assistant__check--bar"
                title="发送前用当前输入检索本地目录与 Wiki，并将相关片段注入回答"
              >
                <input type="checkbox" checked={retrieveKb} onChange={(e) => setRetrieveKb(e.target.checked)} />
                检索知识库
              </label>
              <button
                type="button"
                className="artistic-assistant__link-action"
                disabled={previewLoading || optionsLoading || !draft.trim()}
                title="只查知识库是否命中、不调用大模型"
                onClick={() => void previewKnowledge()}
              >
                {previewLoading ? '预览中…' : '命中预览'}
              </button>
            </div>
            <button
              type="button"
              className="artistic-assistant__btn-send artistic-assistant__btn-send--bar"
              disabled={
                loading || optionsLoading || !draft.trim() || !modelChoice || !options || !hasAnyModel
              }
              onClick={() => void send()}
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
