# Dottie-Assistant

本地工作助手：Jenkins 部署触发、Jira 联动、自动化与待办等能力；前端为 **React + Vite**，桌面端为 **Electron**，部署相关逻辑在 **Express（deploy-api）** 中执行，避免把令牌暴露给浏览器。

## 环境要求

- **Node.js**：建议 **22**（`npm run dev` 等脚本会通过 nvm 切到 22；未使用 nvm 时请自行保证版本一致）。
- **操作系统**：当前 `dev` / `dist` 脚本偏 **macOS**（bash + nvm 路径）；其它平台需按需调整脚本或手动执行等价命令。

## 快速开始

1. 安装依赖：

   ```bash
   npm install
   ```

2. 在项目根目录准备环境变量：复制 [.env.example](.env.example) 为 `.env` 或 `.env.local`（Vite 会加载根目录下的标准 env 文件），至少配置：

   - **`GEMINI_API_KEY`**：调用 Gemini 时使用。
   - **Jenkins**：`JENKINS_USER`、`JENKINS_TOKEN`（服务端使用，勿提交仓库）。
   - 按需配置 **Jira**、知识库、GPT/Ollama 等（见 `.env.example` 内注释）。

3. 启动开发：

   | 命令 | 说明 |
   |------|------|
   | `npm run dev` | 并行启动 Vite（默认 `:3000`）与 deploy-api（默认 `8787`，端口冲突时会写入根目录 `.deploy-api-port`，代理会跟读）。 |
   | `npm run dev:desktop` | 桌面开发：Vite + deploy-api + Electron（会等待前端与 `/api/deploy/health` 就绪）。 |
   | `npm run dev:vite-only` | 仅前端，不启 deploy-api。 |

4. 类型检查与测试：

   ```bash
   npm run lint
   npm test
   ```

## Jenkins 与项目映射

任务列表与默认分支等由 [config/deploy-projects.json](config/deploy-projects.json) 维护。

### URL 如何拼接

- **基础地址**：`defaults.jenkinsBaseUrl`，或项目级覆盖的 `jenkinsBaseUrl`。
- **任务路径**：各项目的 `jobPath`（Jenkins 中的 job 名或层级路径）。
- **规则**：在基础 URL 后按 Jenkins 路径规则插入 `/job/`；若 `jobPath` 含多级（如 `folder/sub/job`），会在段之间自动补上 `/job/`。

示例：访问  
`https://jenkins.rd.chanjet.com/job/BUILD-to-HSY_PRETEST__saas-cc-web`  
对应配置片段：

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

### 连接与安全

- **认证**：HTTP Basic（用户名 + API Token）。
- **CSRF**：请求前会获取并携带 `Jenkins-Crumb`。
- **触发**：向 `/buildWithParameters` 或 `/build` 发起 POST。

未配置 Jenkins 凭据时，相关接口会返回 **503**（见 `.env.example` 说明）。

## 桌面端构建与分发

先执行 `build:desktop`（Vite 打客户端包 + 编译 Electron 主进程），再由 electron-builder 产出安装介质。

| 命令 | 行为 |
|------|------|
| `npm run dist:dir` | `electron-builder --dir --mac`：生成 `release/` 下目录（如 `mac-arm64`），适合本机调试。 |
| `npm run dist` | `electron-builder --mac zip`：**仅打 zip**，便于分发；比 dir 慢。 |

说明：`package.json` 里 `build.mac.target` 默认只有 `["dir"]`，是为了避免单次构建同时产出多种目标；**zip 由 `npm run dist` 显式传入 `--mac zip` 完成**。若需要「一次打出 dir + zip」，可自行增加脚本，例如：`electron-builder --mac dir zip`。

**习惯用法**：日常调试用 `npm run dist:dir`；对外发安装包用 `npm run dist`。

### 桌面包与环境变量

打包后的应用 **不会** 自动读取开发机「项目根 `.env`」。deploy-api 按以下顺序查找配置文件：

1. `ASSISTANT_DOTENV_PATH`（Electron 默认：`~/Library/Application Support/Dottie-Assistant/.env`）
2. `DEPLOY_API_DOTENV`（若设置）
3. 开发态项目根 `.env`

**阿里企业邮箱**（总结页「未读邮件」）需在上述生效路径中配置 `MAIL_IMAP_USER` 与 `MAIL_IMAP_PASSWORD`（阿里邮箱 **三方客户端安全密码**）。可在应用内 **设置 → Jenkins / Jira / Wiki（.env）** 填写并「合并写入」；展开「路径详情」可确认读写路径。保存后服务端会热加载；若仍提示未配置，请完全退出应用后重开。

## 其它

- 更细的环境变量说明（Jira 前缀、代理、桌面包 `.env` 路径等）见 [.env.example](.env.example)。
- 可选部署配置路径：`DEPLOY_PROJECT_CONFIG_PATH`（默认 `config/deploy-projects.json`）。
