import { searchKnowledge, type KnowledgeHit } from './knowledge-search';
import { scanLocalModels } from './local-models';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type AssistantProvider = 'ollama' | 'gemini' | 'openai';

export interface AssistantChatRequestBody {
  messages: ChatMessage[];
  provider: AssistantProvider;
  model: string;
  retrieveKnowledge?: boolean;
  ollamaBase?: string;
}

export interface AssistantChatResponse {
  reply: string;
  knowledgeHits: KnowledgeHit[];
  warnings: string[];
}

const SYSTEM_ZH = `你是企业内部「工作助手」对话智能体。请用简体中文回答。
要求：条理清晰，先结论后要点；若下方提供了「知识库片段」，须优先依据片段做归纳与引用说明；若片段不足以回答，须明确说明并给出可执行的下一步建议。不要编造片段中不存在的事实。`;

function buildKnowledgeBlock(hits: KnowledgeHit[]): string {
  if (hits.length === 0) return '';
  const parts = hits.map((h, i) => {
    return `### 片段 ${i + 1}：${h.title}\n来源：${h.source}\n${h.excerpt}`;
  });
  return `## 知识库片段（检索结果）\n\n${parts.join('\n\n')}`;
}

function lastUserContent(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].content.trim()) {
      return messages[i].content.trim();
    }
  }
  return '';
}

async function ollamaChat(
  base: string,
  model: string,
  messages: { role: string; content: string }[]
): Promise<string> {
  const url = `${base.replace(/\/$/, '')}/api/chat`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 120_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: ac.signal,
    });
    const json = (await res.json()) as { message?: { content?: string }; error?: string };
    if (!res.ok) {
      throw new Error(json.error || `Ollama HTTP ${res.status}`);
    }
    const text = json.message?.content?.trim();
    if (!text) throw new Error('Ollama 返回空内容');
    return text;
  } finally {
    clearTimeout(t);
  }
}

async function openaiChat(model: string, system: string, dialogue: ChatMessage[]): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('未配置 OPENAI_API_KEY');

  const apiModel = model.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const base = (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = `${base}/chat/completions`;

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: system },
    ...dialogue.map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 120_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: apiModel, messages }),
      signal: ac.signal,
    });
    const data = (await res.json()) as {
      error?: { message?: string };
      choices?: { message?: { content?: string } }[];
    };
    if (!res.ok) {
      throw new Error(data.error?.message || `OpenAI HTTP ${res.status}`);
    }
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('GPT 返回空内容');
    return text;
  } finally {
    clearTimeout(t);
  }
}

async function geminiGenerate(
  model: string,
  systemInstruction: string,
  turns: ChatMessage[]
): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('未配置 GEMINI_API_KEY');

  const contents: { role: string; parts: { text: string }[] }[] = [];
  for (const m of turns) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const role = m.role === 'assistant' ? 'model' : 'user';
    contents.push({ role, parts: [{ text: m.content }] });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 120_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
      }),
      signal: ac.signal,
    });
    const data = (await res.json()) as {
      error?: { message?: string };
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    if (!res.ok) {
      throw new Error(data.error?.message || `Gemini HTTP ${res.status}`);
    }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')?.trim();
    if (!text) throw new Error('Gemini 返回空内容');
    return text;
  } finally {
    clearTimeout(t);
  }
}

export async function runAssistantChat(body: AssistantChatRequestBody): Promise<AssistantChatResponse> {
  const warnings: string[] = [];
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = lastUserContent(msgs);
  let knowledgeHits: KnowledgeHit[] = [];

  if (body.retrieveKnowledge && lastUser) {
    const kr = await searchKnowledge(lastUser);
    knowledgeHits = kr.hits;
    warnings.push(...kr.warnings);
  }

  const kbBlock = buildKnowledgeBlock(knowledgeHits);
  const systemFull = kbBlock ? `${SYSTEM_ZH}\n\n${kbBlock}` : SYSTEM_ZH;

  const ollamaBase = (
    body.ollamaBase?.trim() ||
    process.env.OLLAMA_HOST?.trim() ||
    'http://127.0.0.1:11434'
  ).replace(/\/$/, '');

  const dialogue = msgs.filter((m) => m.role === 'user' || m.role === 'assistant');

  if (body.provider === 'ollama') {
    const model = body.model?.trim() || 'llama3:latest';
    const ollamaMessages: { role: string; content: string }[] = [
      { role: 'system', content: systemFull },
      ...dialogue.map((m) => ({ role: m.role, content: m.content })),
    ];
    const reply = await ollamaChat(ollamaBase, model, ollamaMessages);
    return { reply, knowledgeHits, warnings };
  }

  if (body.provider === 'openai') {
    const openaiModel = body.model?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
    const reply = await openaiChat(openaiModel, systemFull, dialogue);
    return { reply, knowledgeHits, warnings };
  }

  const gemModel = body.model?.trim() || process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash';
  const reply = await geminiGenerate(gemModel, systemFull, dialogue);
  return { reply, knowledgeHits, warnings };
}

export function listOllamaModelOptions(): { name: string }[] {
  const { models } = scanLocalModels();
  const names = new Set<string>();
  for (const m of models) {
    if (m.source === 'ollama-cli' || m.source === 'ollama-manifest') {
      names.add(m.name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN')).map((name) => ({ name }));
}
