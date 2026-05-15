/** 用于别名、标题、部署模板名的宽松匹配 */
export function normalizeCommandText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[［【]/g, '[')
    .replace(/[］】]/g, ']');
}

export function stripDeployVerbs(raw: string): string {
  let s = normalizeCommandText(raw);
  s = s.replace(/^(部署|发版|发布|发到|发)\s*/i, '').trim();
  return s;
}

export function stripStartupVerbs(raw: string): string {
  let s = normalizeCommandText(raw);
  s = s.replace(/^(启动|打开|运行|开)\s*/i, '').trim();
  return s;
}
