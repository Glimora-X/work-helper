/** 浮标确认后写入，Deployment 页挂载时消费并删除 */
export const FLOAT_DEPLOY_SESSION_KEY = 'float_deploy_confirmed_draft_v1';

export type FloatDeployConfirmedPayload = {
  /** 原始指令，便于部署页展示与二次编辑 */
  command: string;
  projectIds: string[];
  parsedJira: string | null;
  parsedBranch: string | null;
  templateId?: string;
};
