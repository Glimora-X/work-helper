/** 与部署页指令解析规则保持一致，供浮标预览与主窗共用 */
export function extractJiraAndBranch(cmd: string): { jira: string | null; branch: string | null } {
  const tempJiraMatch = cmd.match(/([a-zA-Z]+-\d+)/);
  const tempBranchMatch =
    cmd.match(/(?:branch|b|分支)[:\s]+([^\s]+)/i) || cmd.match(/(feature\/[^\s]+|bugfix\/[^\s]+|hotfix\/[^\s]+)/i);
  return {
    jira: tempJiraMatch ? tempJiraMatch[1].toUpperCase() : null,
    branch: tempBranchMatch ? tempBranchMatch[1] : null,
  };
}
