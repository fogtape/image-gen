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
- [配置优先级与保存位置](#配置优先级与保存位置)
- [前端可保存哪些配置](#前端可保存哪些配置)
- [本地 Node 部署](#本地-node-部署)
- [Docker 部署](#docker-部署)
- [云平台部署总览](#云平台部署总览)
- [各云平台参数怎么填](#各云平台参数怎么填)
  - [Vercel](#vercel)
  - [Netlify](#netlify)
  - [Cloudflare](#cloudflare)
  - [EdgeOne Pages](#edgeone-pages)
- [环境变量清单](#环境变量清单)
- [前端保存 + 云端同步 + 重新部署的工作流](#前端保存--云端同步--重新部署的工作流)
- [常见问题](#常见问题)

---

## 快速开始

### 本地运行

```bash
npm install
npm run dev
```

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
npm install
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

### 重要说明
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

### 当前支持的平台字段要求

| 平台 | 需要的字段 |
|---|---|
| Node / Docker | 无额外平台字段 |
| Vercel | `projectId`、`apiToken` |
| Netlify | `accountId`、`projectId`、`apiToken` |
| Cloudflare | `accountId`、`projectId`、`apiToken` |
| EdgeOne Pages | `projectId`、`apiToken` |

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

## Cloudflare

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

那么未来可以进一步扩展为保存后自动同步 / 自动触发部署。

> 当前主流程里，建议你仍然手动点一次，便于观察平台返回结果。

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

- **Node / Docker / Vercel / Netlify**：更适合使用服务端代理
- **纯静态站点**：通常只能浏览器直连，要求目标 API 本身支持跨域

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
