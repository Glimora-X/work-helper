<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/09cc7119-e39d-4a69-a312-3e5a2f32ac6b

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Jenkins 部署配置说明

项目通过 `config/deploy-projects.json` 配置 Jenkins 部署任务。

### 1. 路径生成逻辑
系统会自动拼接 `jenkinsBaseUrl` 和 `jobPath` 来生成最终的 Jenkins 任务 URL。

- **基础 URL**: 取自 `defaults.jenkinsBaseUrl` 或项目内的 `jenkinsBaseUrl`。
- **任务路径**: `jobPath` 定义了任务在 Jenkins 中的位置。
- **生成规则**: `jenkinsBaseUrl + /job/ + jobPath`。如果 `jobPath` 包含层级（如 `folder/job`），系统会自动在层级间插入 `/job/`。

#### 示例
若要连接到：`https://jenkins.rd.chanjet.com/job/BUILD-to-HSY_PRETEST__saas-cc-web`

配置如下：
```json
{
  "defaults": {
    "jenkinsBaseUrl": "https://jenkins.rd.chanjet.com"
  },
  "projects": {
    "saas-cc-web": {
      "jobPath": "BUILD-to-HSY_PRETEST__saas-cc-web"
    }
  }
}
```

### 2. 连接与认证
- **认证**: 使用 Basic Auth (用户名 + API Token)。
- **安全**: 系统会自动获取并携带 `Jenkins-Crumb` (CSRF Token)。
- **触发**: 通过 POST 请求触发 `/buildWithParameters` 或 `/build` 接口。

