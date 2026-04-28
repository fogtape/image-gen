# AI Image Generator

支持 OpenAI 兼容 API 与 ChatGPT OAuth 的图片生成工具。

Docker 镜像：`fogtape/image-gen:latest`

## 功能

- 支持 OpenAI 兼容 Images API：`/v1/images/generations`、`/v1/images/edits`
- 支持 Responses API 流式生图：`/v1/responses + image_generation`
- 支持文生图、图生图、参考图上传
- 支持手动 API Key 账号与 ChatGPT OAuth 账号
- 支持账号级流式开关、图生图兼容开关、流式失败自动回退
- 支持服务端默认配置中心
- 支持 `config/.env` 持久化与热更新
- 支持前端设置页直接保存服务端配置
- 支持同步云平台环境变量并触发重新部署
- 支持 Docker / Node / Vercel / Netlify / Cloudflare / EdgeOne 部署

---

## 目录

- [快速开始](#快速开始)
- [自动化测试与手工连通性测试](#自动化测试)
- [配置优先级与保存位置](#配置优先级与保存位置)
- [前端可保存哪些配置](#前端可保存哪些配置)
- [本地 Node 部署](#本地-node-部署)
- [Docker 部署](#docker-部署)
- [云平台部署总览](#云平台部署总览)
- [平台能力矩阵](#平台能力矩阵)
- [各云平台参数怎么填](#各云平台参数怎么填)
  - [Vercel](#vercel)
  - [Netlify](#netlify)
  - [Cloudflare Pages](#cloudflare-pages)
  - [EdgeOne Pages](#edgeone-pages)
- [环境变量清单](#环境变量清单)
- [前端保存 + 云端同步 + 重新部署的工作流](#前端保存--云端同步--重新部署的工作流)
- [常见问题](#常见问题)

---

## 快速开始

### 本地运行

要求 Node.js 22 或更高版本；仓库包含 `package-lock.json`，推荐使用 `npm ci` 复现依赖。

```bash
npm ci
npm run build
npm run dev
```

Node 服务默认只从 `dist/` 提供前端静态文件；修改前端资源后需要重新执行 `npm run build`，或显式设置 `IMAGE_GEN_STATIC_DIR` 指向你要服务的静态目录。

默认启动后访问：

```text
http://localhost:3000
```

### 只构建前端静态文件

```bash
npm run build
npx serve dist -p 3000
```

> 仅静态托管时，服务端配置中心、OAuth 后端、后台任务、云平台环境变量同步等功能不会生效。

### 自动化测试

```bash
npm test
```

`npm test` 只运行正式自动化测试目录（`test/*.js` 与 `api/oauth/test.js`），不会执行需要临时凭据的手工连通性脚本。

发布镜像前可运行完整门禁：

```bash
npm run ci:release-gate
```

它会依次执行单元测试、静态构建和 Docker smoke。普通本地环境没有 Docker 时，`npm run smoke:docker` 会跳过；CI 或设置 `REQUIRE_DOCKER_SMOKE=1` 时 Docker 不可用会失败。

### 手工连通性测试

手工脚本放在 `scripts/manual/`，用于你明确需要连真实兼容 API 地址排查时运行。它们依赖本地临时文件：

```text
.tmp_test_base_url
.tmp_test_api_key
```

示例：

```bash
node scripts/manual/auth-check.mjs
node scripts/manual/generate-image.mjs
node scripts/manual/image-routes.mjs
```

不要提交这些 `.tmp_*` 临时文件，也不要把 API Key、token 或完整响应中的敏感内容粘贴到公开日志。

---

## 零配置 Fork 导入部署

如果你只是想快速上线静态前端，可直接走 **Fork → 导入平台** 的方式：

- **Vercel**：Fork 本仓库后，直接 Import Git Repository
- **Cloudflare Pages**：Fork 本仓库后，直接 Connect to Git 导入
- **EdgeOne Pages**：Fork 本仓库后，直接从 Git 仓库导入

这三种方式都可以先完成基础页面部署，初始阶段通常无需配置环境变量；后续若要用服务端配置中心、后台任务、OAuth 后端、环境变量同步与重部署，再按本文后面的平台配置章节补齐。

---

## 配置优先级与保存位置

当前项目的运行时配置优先级是：

1. **系统环境变量**（最高优先级）
2. **`config/.env` 文件**
3. **代码内默认值**

### 浏览器本地保存的内容
以下内容**仍保存在浏览器 localStorage**，不会写进服务端 `.env`：

- 手动添加的账号列表
- API 地址 / API Key / OAuth 账号信息
- 当前激活账号
- 本地 UI 偏好

### 服务端保存的内容
以下内容会通过前端“服务端配置”写入：

- 服务端默认 API 地址
- 默认图片模型 / 默认流式模型
- 默认尺寸 / 质量 / 输出格式 / 背景
- 默认流式开关
- 默认流式失败自动回退
- 默认图生图兼容开关
- 水印配置
- 存储配置
- 提示词增强配置
- 部署平台配置

### 热更新说明
- **Node / Docker（挂载 `config/`）**：修改 `config/.env` 后会自动热更新，无需重启进程。
- **Vercel / Netlify / EdgeOne / Cloudflare**：平台环境变量更新后，通常需要重新部署或等待平台重新加载。

---

## 前端可保存哪些配置

前端设置页新增的是“**服务端默认配置**”，它的目标是：

- 让多个浏览器访问同一实例时，先拿到同一套默认行为
- 让 Docker / VPS / 云平台部署时，配置能持久化
- 让你可以在前端直接修改，再同步到云平台变量

### 适合放到服务端配置里的内容
推荐放到服务端 `.env` / 云平台 env：

- 默认 API 地址
- 默认图片模型 `gpt-image-2`
- 默认流式模型 `gpt-5.4`
- 默认尺寸、质量、格式、背景
- 是否默认启用流式
- 是否默认启用图生图兼容模式
- 是否默认开启流式失败自动回退
- 水印、存储、提示词增强
- 部署平台参数
- 管理口令 `IMAGE_GEN_ADMIN_TOKEN`

### 不建议放到服务端配置里的内容
以下仍建议保留在浏览器本地：

- 用户自己的 API Key
- 用户自己的 OAuth access token / refresh token
- 私人中转站 key
- 个人账号列表

这样更安全，也更符合当前项目结构。

---

## 本地 Node 部署

### 1）准备配置文件

```bash
mkdir -p config
cp config/.env.example config/.env
```

### 2）启动

```bash
npm ci
npm run dev
```

### 3）前端保存配置后会发生什么
在设置页点击“保存服务端配置”后：

- 服务端会写入 `config/.env`
- Node 进程会自动检测变更
- 新配置会热更新生效
- 无需手动重启

### 4）适合什么场景
适合：

- VPS 直接跑 Node
- Termux / Debian / Proot 本地运行
- 需要最简单热更新体验的场景

---

## Docker 部署

### Dockerfile 本地构建

```bash
docker build -t image-gen:local .
docker run --rm -p 3000:3000 image-gen:local
```

### 推荐：Docker Compose

```bash
docker compose up -d
```

当前仓库里的 `docker-compose.yml` 已挂载：

- `./config:/app/config`
- `./data:/app/data`

这意味着：

- 前端保存服务端配置时，会落到宿主机 `config/.env`
- 服务端 watcher 会检测文件变化
- 配置支持热更新
- 历史图片等数据会持久化到 `data/`

存储清理 scope 的含义：

- **清理页面对话**：只清浏览器里的当前提示词、结果区和活动任务记录；当前版本没有服务端 conversation 数据。
- **清理服务端图片**：清理 `data/images/` 和图片索引。
- **清理页面和图片**：清理页面本地状态，并清理服务端图片；不会删除账号配置、`config/.env`、OAuth 会话文件或项目外文件。

### 重要说明
Docker 镜像构建时只复制 `config/.env.example`，不会把本地 `config/.env`、`data/`、`.oauth-sessions.json` 或 `.tmp_*` 临时文件打进镜像。容器首次启动时如果没有挂载自己的 `config/.env`，服务端会按模板生成默认配置。

如果你**没有挂载 `config/`**，那会有两个问题：

1. 容器重建后配置丢失
2. 前端保存配置后即使容器内生效，也不便于长期维护

所以 Docker 场景下，**强烈建议使用 compose 或手动挂载 `config/`**。

---

## 云平台部署总览

这个项目目前支持两类配置持久化模式：

### 模式 A：Node / Docker 本地配置持久化
- 通过 `config/.env` 持久化
- 支持热更新
- 前端保存后立刻落盘

### 模式 B：云平台环境变量持久化
- 通过平台 API 改环境变量
- 前端保存后可再点“同步平台变量”
- 如平台需要，再点“重新部署”
- 这要求当前部署方式本身提供配置管理 API；纯静态 Pages 只能作为前端页面运行，不能在页面内完成平台 env 同步。

### 当前支持的平台字段要求

| 平台 | 需要的字段 |
|---|---|
| Node / Docker | 无额外平台字段 |
| Vercel | `projectId`、`apiToken` |
| Netlify | `accountId`、`projectId`、`apiToken` |
| Cloudflare | `accountId`、`projectId`、`apiToken` |
| EdgeOne Pages | `projectId`、`apiToken` |

---

## 平台能力矩阵

标记说明：

- ✅：当前实现可用。
- ⚠️：可用但有明显降级、前提或生命周期限制。
- ❌：该部署形态下当前不可用。

| 部署方式 | 静态页面 | 浏览器直连生图 | 服务端代理 `/api/proxy` | OAuth 后端 | 后台任务 | 图片持久化 | 服务端配置保存 | 平台同步/重部署 | 说明 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Node / VPS | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ 本地无需远程重部署 | 最完整形态；`config/.env` 和 `data/` 可长期保留。 |
| Docker / Compose | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 需挂载 `./data` | ✅ 需挂载 `./config` | ⚠️ 本地无需远程重部署 | 推荐使用 compose，避免容器重建后配置和历史丢失。 |
| Vercel | ✅ | ✅ | ✅ | ✅ | ⚠️ serverless 中同步执行并直接返回结果 | ⚠️ serverless 本地文件不可当长期存储 | ⚠️ 当前实例运行态可保存，持久化需同步平台 env 后重部署 | ✅ | 当前最完整的云端 serverless 形态；后台任务不做跨实例长轮询。 |
| Netlify | ✅ | ✅ | ✅ | ⚠️ 仅 `/api/oauth/images`，缺 `start/exchange/status/stream` | ❌ | ❌ | ❌ | ❌ | 当前只提供 `proxy` 和部分 OAuth 生图函数；配置中心和后台任务需 Node/Vercel 形态。 |
| Cloudflare Pages | ✅ | ✅ 需要目标 API 支持 CORS | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 当前仓库提供纯静态 Pages 构建；Cloudflare handler 只是在 Node/Vercel 配置中心里管理外部 Worker/Script env。 |
| EdgeOne Pages | ✅ | ✅ 需要目标 API 支持 CORS | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 当前仓库提供纯静态 Pages 构建；EdgeOne handler 只是在 Node/Vercel 配置中心里调用 Pages API。 |

### 关键结论

- 想要完整的配置中心、后台任务、OAuth 后端和图片历史：优先选 **Node / Docker**。
- 想要云端免服务器且功能尽量完整：优先选 **Vercel**。
- 只想快速上线前端页面：**Netlify / Cloudflare Pages / EdgeOne Pages** 可以零配置导入，但要接受后端能力降级。
- 浏览器直连生图依赖目标 API 的 CORS；如果目标 API 不允许跨域，就需要 Node / Docker / Vercel / Netlify 的 `/api/proxy`。

---

## 各云平台参数怎么填

下面重点讲三件事：

1. **前端里要填哪个字段**
2. **这些字段值去哪里找**
3. **前端保存 / 同步 / 重部署是怎么工作的**

---

## Vercel

### 前端需要填写
部署平台选择 `vercel` 后，需要填：

- `Project ID`
- `API Token`

### `Project ID` 去哪里找
在 Vercel 控制台：

1. 打开你的项目
2. 进入 **Settings**
3. 在 **General** 页面找到 **Project ID**

通常是一个形如：

```text
prj_xxxxxxxxxxxxx
```

### `API Token` 去哪里找
在 Vercel 控制台：

1. 点击右上角头像
2. 进入 **Settings**
3. 进入 **Tokens**
4. 创建一个新的 Token

建议给这个 Token 起名，例如：

```text
image-gen-config-sync
```

### 需要什么权限
至少要能：

- 读取项目环境变量
- 写入项目环境变量
- 触发项目重新部署

### 前端保存后的行为
在前端设置页里：

1. 先保存服务端配置
2. 点击“平台校验”
3. 点击“同步平台变量”
4. 点击“重新部署”

项目当前实现会：

- 调用 Vercel API 更新白名单环境变量
- 复用最近一次部署触发一个新的 production 部署

### 适用说明
Vercel 是当前最完整的云端闭环之一，适合：

- 你希望前端改默认配置
- 再同步到 Vercel
- 再从前端一键触发重部署

---

## Netlify

### 前端需要填写
部署平台选择 `netlify` 后，需要填：

- `Account ID`
- `Project ID`
- `API Token`

### `Account ID` 去哪里找
常见方式：

1. 打开 Netlify 控制台
2. 进入团队 / 组织设置
3. 在 URL、API 返回或团队信息里查看 account / team id

如果不方便在 UI 找，也可以通过 Netlify API / CLI 查。

### `Project ID` 去哪里找
`Project ID` 在 Netlify 对应的是 **Site ID**。

获取方式：

1. 打开 Netlify 站点
2. 进入 **Site configuration**
3. 找到 **Site information**
4. 查看 **API ID / Site ID**

### `API Token` 去哪里找
在 Netlify 控制台：

1. 右上角头像
2. **User settings**
3. **Applications**
4. **Personal access tokens**
5. 创建新 token

### 前端保存后的行为
当前实现会：

- 通过 Netlify API 更新站点环境变量
- 调用站点 build 接口触发重新部署

### 说明
Netlify 的 `projectId` 实际填的是站点 ID，不是仓库名。

---

## Cloudflare Pages

### 前端需要填写
部署平台选择 `cloudflare` 后，需要填：

- `Account ID`
- `Project ID`
- `API Token`

### `Account ID` 去哪里找
在 Cloudflare Dashboard：

1. 进入任意站点或账户主页
2. 右侧 / 概览页通常可以看到 **Account ID**

### `Project ID` 填什么
当前实现对 Cloudflare 走的是：

- `workers/scripts/{projectId}/settings`

所以这里的 `projectId` 应理解为：

- **对应 Worker / Script 名称**

如果你未来把它完全切到 Pages 专属 API，再按 Pages 项目 ID / 名称适配。

### `API Token` 去哪里找
在 Cloudflare Dashboard：

1. 右上角头像
2. **My Profile**
3. **API Tokens**
4. 创建 Token

建议至少授予与 Workers 配置相关的权限。

### 当前实现说明
当前项目里 Cloudflare handler 会：

- 读取 Worker settings
- 更新 `plain_text` bindings
- 返回“通常自动生效，无需额外手动部署”

也就是说当前逻辑更偏 **Workers 配置模式**，不是纯 Pages 静态项目模式。

### 适用建议
如果你现在跑的是：

- Cloudflare Workers / Pages Functions / Worker 脚本型部署

这套逻辑是有意义的。  
如果你跑的是**纯 Pages 静态站点**，那它不会像 Node 服务那样具备完整后端能力，这点要区分清楚。

---

## EdgeOne Pages

### 前端需要填写
部署平台选择 `edgeone` 后，需要填：

- `Project ID`
- `API Token`

### `Project ID` 去哪里找
在 EdgeOne Pages 控制台里打开你的项目，通常可以在：

- 项目详情页
- 控制台 URL
- API 返回

找到项目 ID。

### `API Token` 去哪里找
在腾讯云 / EdgeOne 对应的 API 访问管理中创建可调用 Pages API 的 token。

### 当前实现做了什么
当前项目会调用：

- `ModifyPagesProjectEnvs`
- `CreatePagesDeployment`

也就是说：

1. 可同步环境变量
2. 可触发重新部署

### 说明
如果你是中国大陆用户，EdgeOne Pages 往往更适合需要国内访问体验的场景；但前提仍是你的 token 权限要足够。

---

## 环境变量清单

下面是当前配置中心会管理的主要环境变量。

### 服务端默认配置

| 变量名 | 说明 |
|---|---|
| `IMAGE_GEN_ADMIN_TOKEN` | 管理口令。前端调用服务端配置保存/同步/部署接口时使用。建议设置。 |
| `IMAGE_GEN_DEFAULT_API_URL` | 默认 API 地址 |
| `IMAGE_GEN_DEFAULT_IMAGE_MODEL` | 默认图片模型，通常是 `gpt-image-2` |
| `IMAGE_GEN_DEFAULT_RESPONSES_MODEL` | 默认流式模型，通常是 `gpt-5.4` |
| `IMAGE_GEN_DEFAULT_STREAM_MODE` | 是否默认启用流式 |
| `IMAGE_GEN_DEFAULT_RESPONSES_AUTO_FALLBACK` | 流式失败时是否自动回退到 Images API |
| `IMAGE_GEN_DEFAULT_IMAGE_EDITS_COMPAT_MODE` | 是否默认启用图生图兼容模式 |
| `IMAGE_GEN_FORCE_PROXY` | 是否强制通过服务端代理 |
| `IMAGE_GEN_DEFAULT_SIZE` | 默认尺寸 |
| `IMAGE_GEN_DEFAULT_QUALITY` | 默认质量 |
| `IMAGE_GEN_DEFAULT_FORMAT` | 默认输出格式 |
| `IMAGE_GEN_DEFAULT_BACKGROUND` | 默认背景 |

### 水印配置

| 变量名 | 说明 |
|---|---|
| `IMAGE_GEN_WATERMARK_ENABLED` | 是否启用水印 |
| `IMAGE_GEN_WATERMARK_TEMPORARY_MODE` | 水印临时覆盖策略 |
| `IMAGE_GEN_WATERMARK_MODE` | 水印模式 |
| `IMAGE_GEN_WATERMARK_TEXT` | 水印文本 |
| `IMAGE_GEN_WATERMARK_TIME_FORMAT` | 时间格式 |
| `IMAGE_GEN_WATERMARK_POSITION` | 位置 |
| `IMAGE_GEN_WATERMARK_OPACITY` | 透明度 |
| `IMAGE_GEN_WATERMARK_FONT_SIZE` | 字号 |
| `IMAGE_GEN_WATERMARK_COLOR` | 颜色 |
| `IMAGE_GEN_WATERMARK_SHADOW` | 阴影 |
| `IMAGE_GEN_WATERMARK_BACKGROUND` | 背景底板 |

### 存储与提示词增强

| 变量名 | 说明 |
|---|---|
| `IMAGE_GEN_STORAGE_ENABLED` | 是否启用图片存储 |
| `IMAGE_GEN_PROMPT_ENHANCEMENT_ENABLED` | 是否启用提示词增强 |
| `IMAGE_GEN_PROMPT_ENHANCEMENT_RUN_MODE` | 手动 / 自动 |
| `IMAGE_GEN_PROMPT_ENHANCEMENT_MODEL` | 提示词增强模型 |
| `IMAGE_GEN_PROMPT_ENHANCEMENT_MODE` | 优化模式 |
| `IMAGE_GEN_PROMPT_ENHANCEMENT_LANGUAGE` | 语言偏好 |

### 部署平台配置

| 变量名 | 说明 |
|---|---|
| `IMAGE_GEN_DEPLOY_PLATFORM` | `node` / `vercel` / `netlify` / `cloudflare` / `edgeone` |
| `IMAGE_GEN_DEPLOY_ACCOUNT_ID` | 平台账号 ID（Netlify / Cloudflare 需要） |
| `IMAGE_GEN_DEPLOY_PROJECT_ID` | 平台项目 ID |
| `IMAGE_GEN_DEPLOY_API_TOKEN` | 平台 API Token |
| `IMAGE_GEN_DEPLOY_AUTO_SYNC` | 保存后是否自动同步平台变量 |
| `IMAGE_GEN_DEPLOY_AUTO_REDEPLOY` | 同步后是否自动触发重部署 |

### 高级 / 安全环境变量

这些变量通常不需要在前端设置页里频繁修改，适合自托管、Docker、Vercel 或安全加固场景直接通过环境变量配置。

| 变量名 | 默认值 / 范围 | 说明 |
|---|---|---|
| `PORT` | `3000` | Node / Docker HTTP 监听端口。 |
| `IMAGE_GEN_CONFIG_DIR` | `config/` | Node / Docker 配置目录；建议在 Docker 中挂载到宿主机。 |
| `IMAGE_GEN_ENV_FILE` | `IMAGE_GEN_CONFIG_DIR/.env` | 本地配置文件路径。serverless 环境不会创建或依赖该文件。 |
| `IMAGE_GEN_DATA_DIR` | `data/` | 图片历史和持久化文件目录；Docker 中建议挂载。 |
| `IMAGE_GEN_STATIC_DIR` | `dist/` | Node 服务静态资源目录；修改前端后需重新 `npm run build`。 |
| `IMAGE_GEN_ALLOWED_ORIGINS` | 空 | Node API CORS 额外允许来源，多个 origin 用逗号分隔；同源和本机开发来源会自动允许。 |
| `IMAGE_GEN_ALLOW_INSECURE_LOCAL_ADMIN` | `false` | 仅本机开发调试用；未设置管理口令时是否允许本机管理请求。生产环境不要开启。 |
| `IMAGE_GEN_PROXY_ALLOWED_HOSTS` | 自动包含默认 API host | 服务端代理允许访问的上游 host allowlist，逗号分隔。 |
| `IMAGE_GEN_PROXY_ALLOW_LOCAL_HTTP` | `false` | 仅本地开发用；是否允许代理访问本机 HTTP。生产环境不要开启。 |
| `IMAGE_GEN_PROXY_TIMEOUT_MS` | 约 60 秒 | `/api/proxy` 上游请求超时。 |
| `IMAGE_GEN_PROXY_MAX_RESPONSE_BYTES` | 约 50MB | `/api/proxy` 最大响应字节数，覆盖 JSON / 普通流 / SSE。 |
| `IMAGE_GEN_JSON_BODY_LIMIT_BYTES` | 约 2MB | JSON 请求体上限。 |
| `IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES` | 约 25MB | 生图任务 JSON 请求体上限。 |
| `IMAGE_GEN_REF_IMAGE_MAX_BYTES` | 约 10MB | 单张参考图最大字节数。 |
| `IMAGE_GEN_REF_IMAGES_TOTAL_MAX_BYTES` | 约 25MB | 多参考图总大小上限。 |
| `IMAGE_GEN_REMOTE_IMAGE_MAX_BYTES` | 约 20MB | 远程图片下载最大字节数。 |
| `IMAGE_GEN_REMOTE_IMAGE_TIMEOUT_MS` | 约 15 秒 | 远程图片下载超时。 |
| `IMAGE_GEN_REMOTE_IMAGE_MAX_REDIRECTS` | 3 | 远程图片下载最大重定向次数；每一跳都会重新校验协议和地址。 |
| `IMAGE_GEN_OAUTH_SESSION_FILE` | `.oauth-sessions.json` | OAuth session 文件位置；仅保存非 token 状态，成功结果只保留在内存。 |
| `IMAGE_GEN_OAUTH_SESSION_SECRET` | 自动/环境提供 | serverless stateless OAuth session 加密签名密钥；生产建议显式设置高强度随机值。 |
| `IMAGE_GEN_PLATFORM_API_TIMEOUT_MS` | `15000`，限制 1000-120000 | Vercel / Netlify / Cloudflare / EdgeOne 平台 API 调用超时。 |
| `IMAGE_GEN_DOCKER_SMOKE_TAG` | 自动生成 | Docker smoke 测试临时镜像 tag。 |
| `REQUIRE_DOCKER_SMOKE` | `0` | 设为 `1` 时 Docker 不可用会让 `npm run smoke:docker` 失败；发布 CI 已强制开启。 |

### Serverless 行为差异

- **Node / Docker**：会读取并维护本地 `config/.env`，支持 watcher 热更新、后台任务轮询、图片持久化、完整 `/api/proxy` 和 OAuth 后端。
- **Vercel**：初始化时只读取环境变量，不创建本地配置文件；后台任务在 serverless 中同步完成并直接返回结果，适合免服务器但仍需要后端 API 的场景。
- **Netlify**：当前只提供 JSON proxy 和部分 OAuth 生图函数；没有完整配置中心、后台任务和图片持久化。
- **Cloudflare Pages / EdgeOne Pages**：默认是静态站点导入；仓库内 handler 主要用于 Node/Vercel 配置中心里管理对应平台环境变量，不等于 Pages 静态站点天然具备完整后端。

---

## 前端保存 + 云端同步 + 重新部署的工作流

这是当前推荐工作流：

### Node / Docker

1. 前端修改服务端默认配置
2. 点击保存
3. 配置写入 `config/.env`
4. watcher 自动热更新
5. 无需重启

### 云平台

1. 前端修改服务端默认配置
2. 点击保存（先写本地运行态配置）
3. 点击“平台校验”确认 `accountId/projectId/token` 正确
4. 点击“同步平台变量”
5. 如平台需要，点击“重新部署”
6. 新部署实例读取最新环境变量

### 自动模式
如果你打开：

- `IMAGE_GEN_DEPLOY_AUTO_SYNC=true`
- `IMAGE_GEN_DEPLOY_AUTO_REDEPLOY=true`

那么保存服务端配置时会自动执行平台变量同步和重新部署，并在接口响应的 `operations` 里返回每一步结果。

如果你刚开始配置平台 token，建议先关闭自动模式，手动点击“平台校验 / 同步平台变量 / 重新部署”确认成功后再打开。

---

## 常见问题

### 1）为什么前端保存了配置，但浏览器里的账号没变？
因为账号列表和 token 仍保存在浏览器 localStorage，不属于服务端默认配置。

### 2）为什么本地能热更新，云平台不能立刻生效？
因为本地是直接改 `config/.env`，云平台则是改远端环境变量，通常需要平台重新加载或重新部署。

### 3）为什么 Docker 里保存后重建容器配置丢了？
因为你没有挂载 `config/`。请使用：

- `./config:/app/config`
- `./data:/app/data`

### 4）前端改完后，哪些值会被同步到云平台？
只有配置中心白名单里的服务端配置项会同步，不会把用户浏览器本地的账号 key、OAuth token 一起同步上去。

### 5）Cloudflare 为什么说“通常自动生效，无需额外手动部署”？
因为当前实现走的是 Worker settings 风格接口，不完全等同于传统静态站点二次构建流程。

### 6）部署平台 token 应该怎么保管？
建议：

- 用单独 token
- 只授予必要权限
- 只保存在你自己的服务端配置里
- 不要把 token 提交进 Git 仓库

---

## 代理说明

如果 API 不支持 CORS（浏览器跨域），可在设置中开启“使用代理”。

- **Node / Docker**：支持 JSON、SSE 和 multipart 图生图代理，功能最完整。
- **Vercel**：支持 JSON 和 SSE 代理；不支持 multipart 图生图代理，开启“图生图兼容模式（旧版 multipart）”时请关闭代理或改用 Node / Docker。
- **Netlify**：支持 JSON 代理；SSE 会退化为函数响应文本，multipart 图生图代理不支持。
- **纯静态站点**：通常只能浏览器直连，要求目标 API 本身支持跨域

---

## 产品路线

P0-P3 的稳定性、安全、可访问性和发布门禁修复记录见：

- `docs/audit-p0-p3-tracking-2026-04-28.md`

下一批产品增强 backlog 见：

- `docs/p4-product-roadmap.md`

---

## Docker Hub / 镜像发布

推送到 `main` 后，GitHub Actions 会自动构建并推送 Docker Hub 镜像：

```text
fogtape/image-gen:latest
fogtape/image-gen:sha-<commit>
```

GitHub 仓库需配置 Secrets：

```text
DOCKERHUB_USERNAME
DOCKERHUB_TOKEN
```

发布 workflow 会先执行 `npm ci` 和 `npm run ci:release-gate`，通过单元测试、静态构建和 Docker smoke 后才登录 Docker Hub 并推送多架构镜像。CI 中已设置 `REQUIRE_DOCKER_SMOKE=1`，因此 Docker 构建或容器 HTTP 烟测失败时不会发布镜像。
