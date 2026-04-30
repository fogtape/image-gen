# AI Image Studio

一个轻量的 OpenAI 系图片生成 Web UI，支持文生图、图生图、参考图、历史保存、水印、提示词润色、后台任务和 ChatGPT OAuth 登录。

> 当前项目定位很明确：**目前只支持 OpenAI 系中转或 ChatGPT OAuth 登录**。也就是 OpenAI 兼容接口（`/v1/images/*`、`/v1/responses`）或 ChatGPT OAuth 账号。它不是通用绘图平台，不支持 Midjourney，不支持 Stable Diffusion，不支持 ComfyUI，也不支持非 OpenAI 协议的模型服务。

Docker 镜像：`fogtape/image-gen:latest`

## 适合谁用

- 有 OpenAI 官方 Key 或 OpenAI 兼容中转站的人。
- 想自托管一个简洁图片生成页面的人。
- 想用 ChatGPT OAuth 账号尝试图片生成的人。
- 需要把生成图保存到服务器，并带水印、历史记录、参考图继续生成的人。

## 功能概览

- OpenAI 兼容 Images API：`/v1/images/generations`、`/v1/images/edits`
- OpenAI Responses API 流式生图：`/v1/responses + image_generation`
- ChatGPT OAuth 图片生成流程
- 文生图、图生图、最多 3 张参考图
- 后台生成任务：浏览器切后台后，Node / Docker 后端继续生成
- 图片历史：保存生成结果、收藏、搜索、删除、继续作为参考图
- 水印：自定义文字、时间、相机时间、阴影、半透明底板、位置和字号
- 提示词润色：手动润色或生成前自动润色
- 前置管理员登录：进入前端先输入管理员鉴权，登录后默认拥有全部管理权限
- 独立账号管理：API Key、ChatGPT OAuth、账号保存位置和连接测试都在账号入口配置
- 账号级 API 地址：在每个 API Key 账号里填写“此账号的 API 地址”
- 服务端配置中心：默认模型、尺寸、质量、格式、水印、存储、部署同步等
- 服务端优先账号存储：Node / Docker 加密文件、云平台 Upstash、浏览器 fallback
- 安全导入 / 导出：安全导出不包含 API key、OAuth token、Cookie、session；完整导出必须加密
- Docker / Node / Vercel / Netlify / Cloudflare Pages / EdgeOne Pages 部署

## 重要限制先看

### 只支持 OpenAI 系

支持的接入方式只有两类：

1. **OpenAI 兼容 API Key**
   - API 地址示例：`https://api.openai.com`、`https://your-relay.example`
   - 需要兼容 OpenAI 的 `/v1/images/generations`、`/v1/images/edits` 或 `/v1/responses`
   - 常见模型：`gpt-image-2`、支持 `image_generation` 工具的 Responses 模型

2. **ChatGPT OAuth 登录**
   - 通过浏览器授权 ChatGPT 账号
   - 后端保存必要的 OAuth 账号信息
   - 之后用 ChatGPT 后端图片流程生成

不支持：Midjourney、Stable Diffusion WebUI、ComfyUI、Flux 原生 API、NovelAI、SD API、自定义非 OpenAI 协议接口。

### 云平台后台生图不太好用

云平台可以部署，但后台生图不太好用，原因是 serverless / 静态 Pages 对长任务不友好：

- **Node / Docker**：后台任务体验最好，后端进程持续运行，适合长时间生成。
- **Vercel**：有 Node API，但 serverless 实例不适合跨实例长轮询；项目会尽量在一次请求内同步完成并直接返回结果。
- **Netlify**：只提供部分函数能力，没有完整后台任务。
- **Cloudflare Pages / EdgeOne Pages**：默认是纯静态页面，没有本项目的 Node 后台任务能力，只能浏览器直连；目标 API 还必须支持 CORS。

如果你要稳定使用后台生成、OAuth 后端、图片历史和服务端配置，推荐 **Node / Docker**。如果只是展示页面或轻量使用，云平台可以；如果要长时间后台生图，后台任务不适合长期依赖云平台 serverless。

## 快速开始

要求 Node.js 22 或更高版本。仓库包含 `package-lock.json`，推荐使用 `npm ci` 复现依赖。

```bash
npm ci
npm run build
npm run dev
```

访问：

```text
http://localhost:3000
```

首次使用推荐路径：

1. 打开页面后先进入“管理员登录”，输入管理员鉴权。
2. 登录成功后进入主界面，默认拥有设置保存、账号同步、Upstash 配置和清理等管理权限。
3. 点右上角账号下拉里的“管理账号”，添加 API Key 账号或登录 ChatGPT 账号。
4. API 地址在账号编辑里的“此账号的 API 地址”填写；设置页不再提供服务端默认 API 地址入口。
5. 如需跨浏览器或云平台保存账号，到“账号管理 → 保存位置”选择服务端文件或 Upstash，并点击“测试账号存储”。
6. 点击“测试当前账号连接”，成功后回到首页生成图片。

Node 服务默认从 `dist/` 提供前端静态文件。修改 `index.html`、`app.js`、`style.css` 后，重新运行：

```bash
npm run build
```

## Docker 部署

### 使用 Docker Hub 镜像

```bash
mkdir -p image-gen/config image-gen/data
cd image-gen

cat > docker-compose.yml <<'YAML'
services:
  image-gen:
    image: fogtape/image-gen:latest
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      IMAGE_GEN_DATA_DIR: /app/data
    volumes:
      - ./config:/app/config
      - ./data:/app/data
    restart: unless-stopped
YAML

docker compose up -d
```

打开：

```text
http://服务器IP:3000
```

### 本地构建镜像

```bash
docker build -t image-gen:local .
docker run --rm -p 3000:3000 image-gen:local
```

### 推荐挂载目录

仓库内的 `docker-compose.yml` 已挂载：

- `./config:/app/config`
- `./data:/app/data`

这样可以保证：

- 前端保存服务端配置时，会落到宿主机 `config/.env`
- 服务端账号加密 key 会保存在 `config/.account-store-key`（如果没有通过 env 显式提供）
- API Key / OAuth 账号会加密保存到 `data/accounts.enc.json`
- 服务端 watcher 会检测文件变化
- 配置支持热更新
- 历史图片等数据会持久化到 `data/`

Docker 镜像构建时只复制 `config/.env.example`，不会把本地 `config/.env`、`data/`、`.oauth-sessions.json` 或 `.tmp_*` 临时文件打进镜像。容器首次启动时如果没有挂载自己的 `config/.env`，服务端会按模板生成默认配置。

如果你**没有同时挂载 `config/` 和 `data/`**，那会有几个问题：

1. 容器重建后配置丢失
2. 服务端账号文件或账号加密 key 丢失，导致换浏览器/重建容器后无法复用账号
3. 前端保存配置后即使容器内生效，也不便于长期维护

所以 Docker 场景下，**强烈建议使用 compose 或手动同时挂载 `config/` 与 `data/`**。

存储清理 scope 的含义：

- **清理页面对话**：只清浏览器里的当前提示词、结果区和活动任务记录；当前版本没有服务端 conversation 数据。
- **清理服务端图片**：清理 `data/images/` 和图片索引。
- **清理页面和图片**：清理页面本地状态，并清理服务端图片；不会删除账号配置、`config/.env`、OAuth 会话文件或项目外文件。

## 添加账号

打开页面后先完成前置管理员登录，然后点右上角账号下拉里的“管理账号”。账号管理独立于设置页，专门负责 API Key 账号、ChatGPT OAuth 账号、账号保存位置、迁移和连接测试。

### API Key 账号

填写：

- 账号名称
- 此账号的 API 地址，例如 `https://api.openai.com` 或你的 OpenAI 兼容中转地址
- API Key
- 图片模型，通常是 `gpt-image-2`
- 如果你的中转支持 Responses 生图，可以打开流式模式并填写 Responses 模型

API 地址已经回到账号维度：在“账号 → API Key 账号 → 此账号的 API 地址”中填写。服务端仍保留旧 `IMAGE_GEN_DEFAULT_API_URL` / `providerDefaults.apiUrl` 作为兼容和新账号预填，不再作为新用户主入口。

### ChatGPT OAuth 账号

适合没有 API Key，但想用 ChatGPT 账号授权尝试图片生成的场景。

OAuth token 不会被同步到云平台环境变量。管理员登录且服务端账号存储可用时，OAuth 账号会和 API Key 账号一样优先加密保存到服务端。

### 账号存储模式

- **Node / Docker**：默认使用服务端文件账号存储，写入 `data/accounts.enc.json`；加密 key 来自 `IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY`，未设置时会生成 `config/.account-store-key`。
- **云平台**：设置 `IMAGE_GEN_ACCOUNT_STORE=upstash` 并配置 Upstash REST URL / Token / 账号加密 Key 后，账号写入 Upstash。
- **无服务端账号存储**：自动回退浏览器缓存，旧用户路径不受影响。

Upstash 配置入口在“账号管理 → 保存位置 → 账号存储配置”。保存后不会回显 REST URL、REST Token 或账号加密 Key；可以点击“测试账号存储”确认连接。

浏览器副本会保留作为 fallback，因此服务端同步失败不会阻止你继续生成。服务端账号列表接口只返回脱敏元数据，不会把 API Key、OAuth access token、refresh token 或 Upstash token 回显到前端。

## ChatGPT OAuth 登录流程

OAuth 登录大致流程：

1. 在“账号管理”里切到 **ChatGPT 登录**。
2. 点击登录按钮。
3. 页面请求后端创建 OAuth 会话，后端返回 `授权链接`。
4. 浏览器打开 OpenAI / ChatGPT 的授权页面。
5. 登录并同意授权后，会回跳到一个 localhost 回调地址，例如：

```text
http://localhost:1455/auth/callback?code=...&state=...
```

如果你是在 VPS、Docker、Vercel 或其他远程站点里使用，看到 `localhost` 页面无法访问、打不开、显示无法连接，并不一定是项目出错。这个 localhost 指的是用户当前浏览器设备，不是服务器域名。

遇到这种情况按下面处理：

1. 不要关闭授权失败页。
2. 复制浏览器地址栏里的完整回调链接，或者复制其中的授权码 `code`。
3. 回到 AI Image Studio 的 ChatGPT 登录弹窗。
4. 粘贴完整回调链接或授权码。
5. 点击完成登录。

这一步是为了避免用户误以为“授权链接跳转到无法访问页面就是失败”。只要拿到了 `code` 和 `state`，通常仍然可以回到页面手动完成交换。

## 零配置 Fork 导入部署

如果你只是想快速上线一个页面，可以直接走 **Fork → 导入平台**：

- **Vercel**：Fork 本仓库后，直接 Import Git Repository
- **Cloudflare Pages**：Fork 本仓库后，直接 Connect to Git 导入
- **EdgeOne Pages**：Fork 本仓库后，直接从 Git 仓库导入
- **Netlify**：Fork 本仓库后，直接导入 Git 仓库

这些平台基础页面通常无需配置环境变量即可构建，构建命令是：

```bash
npm run build
```

输出目录：

```text
dist
```

但要注意：纯静态 Pages 只提供前端页面，后台任务、OAuth 后端、服务端代理、服务端配置保存、图片持久化都可能不可用或降级。

## 平台能力矩阵

标记说明：

- ✅：当前实现可用
- ⚠️：可用但有明显降级、前提或生命周期限制
- ❌：该部署形态下当前不可用

| 部署方式 | 静态页面 | 浏览器直连生图 | 服务端代理 `/api/proxy` | OAuth 后端 | 后台任务 | 图片持久化 | 服务端配置保存 | 账号存储 | 平台同步/重部署 | 说明 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Node / VPS | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 服务端文件 | ⚠️ 本地无需远程重部署 | 最完整形态；`config/.env`、`config/.account-store-key` 和 `data/` 可长期保留。 |
| Docker / Compose | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 需挂载 `./data` | ✅ 需挂载 `./config` | ✅ 需挂载 `./data` + `./config` | ⚠️ 本地无需远程重部署 | 推荐使用 compose，避免容器重建后配置、账号和历史丢失。 |
| Vercel | ✅ | ✅ | ✅ | ✅ | ⚠️ serverless 中同步执行并直接返回结果 | ⚠️ serverless 本地文件不可当长期存储 | ⚠️ 当前实例运行态可保存，持久化需同步平台 env 后重部署 | ✅ 配置 Upstash；否则浏览器缓存 | ✅ | 当前最完整的云端 serverless 形态；后台任务不做跨实例长轮询。 |
| Netlify | ✅ | ✅ | ✅ | ⚠️ 仅 `/api/oauth/images`，缺 `start/exchange/status/stream` | ❌ | ❌ | ❌ | ⚠️ 浏览器缓存 | ❌ | 当前只提供 `proxy` 和部分 OAuth 生图函数；配置中心和后台任务需 Node/Vercel 形态。 |
| Cloudflare Pages | ✅ | ✅ 需要目标 API 支持 CORS | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ 浏览器缓存 | ❌ | 当前仓库提供纯静态 Pages 构建；Cloudflare handler 只是在 Node/Vercel 配置中心里管理外部 Worker/Script env。 |
| EdgeOne Pages | ✅ | ✅ 需要目标 API 支持 CORS | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ 浏览器缓存 | ❌ | 当前仓库提供纯静态 Pages 构建；EdgeOne handler 只是在 Node/Vercel 配置中心里调用 Pages API。 |

关键结论：

- 想要完整的配置中心、后台任务、OAuth 后端和图片历史：优先选 **Node / Docker**。
- 想要云端免服务器且功能尽量完整：优先选 **Vercel**，并配置 **Upstash** 作为账号存储。
- 只想快速上线前端页面：**Netlify / Cloudflare Pages / EdgeOne Pages** 可以零配置导入，但要接受后端能力降级。
- 浏览器直连生图依赖目标 API 的 CORS；如果目标 API 不允许跨域，就需要 Node / Docker / Vercel / Netlify 的 `/api/proxy`。

## 云平台说明

### Vercel

仓库已包含 `vercel.json`：

```json
{
  "framework": null,
  "installCommand": "npm install",
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

Vercel 还包含显式 API 路由，用于 `/api/proxy`、OAuth 登录、OAuth 状态查询和 OAuth 图片生成。它是云平台里最接近完整后端体验的形态。

后台任务在 Vercel 上不会像常驻 Node 一样跨实例长轮询。serverless 场景下会尽量在请求内同步执行并返回结果，避免刷新或切后台后轮询到另一个实例导致任务丢失。

### Netlify

仓库已包含 `netlify.toml`，基础静态页面可以直接部署。

当前 Netlify 只提供：

- `/api/proxy` 的 Netlify Functions 代理
- 部分 OAuth 图片函数

不提供完整配置中心、完整 OAuth 登录 start/exchange/status/stream、后台任务和图片持久化。

### Cloudflare Pages

仓库已包含 `wrangler.toml`，指向 `dist`。

Cloudflare Pages 纯静态部署可以展示页面，但没有 Node 后端 API。浏览器直连生图要求目标 OpenAI 兼容 API 支持 CORS。

README 里提到的 Cloudflare 平台配置同步，是 Node/Vercel 配置中心调用 Cloudflare API 管理外部 Worker/Script env，不等于纯 Cloudflare Pages 静态站自动拥有完整后端。

### EdgeOne Pages

仓库已包含 `edgeone.json`，可按 `npm run build` → `dist` 导入。

EdgeOne Pages 纯静态部署同样没有本项目的 Node 后端。项目里的 EdgeOne handler 是 Node/Vercel 配置中心里调用 Pages API 做环境变量和重新部署管理。

## 服务端配置

配置优先级：

1. 系统环境变量
2. `config/.env`
3. 代码默认值

浏览器本地保存：

- 账号兼容副本：服务端账号存储不可用时继续可用
- 当前激活账号
- UI 偏好

服务端配置保存：

- 默认图片模型 / Responses 模型
- 默认尺寸、质量、格式、背景
- 代理开关
- 水印配置
- 存储配置
- 账号存储配置：文件 / Upstash / 浏览器 fallback，以及 Upstash 连接参数
- 提示词润色配置
- 部署平台配置

API 地址已经回到账号维度：在“账号 → API Key 账号 → 此账号的 API 地址”中填写。服务端仍保留旧 `IMAGE_GEN_DEFAULT_API_URL` / `providerDefaults.apiUrl` 作为兼容和新账号预填，不再作为新用户主入口。

在 Node / Docker 中，保存服务端配置会写入 `config/.env` 并热更新。云平台环境变量需要同步后重新部署。

保存服务端配置时会自动执行平台变量同步和重新部署的前提是你开启：

```text
IMAGE_GEN_DEPLOY_AUTO_SYNC=true
IMAGE_GEN_DEPLOY_AUTO_REDEPLOY=true
```

接口响应的 `operations` 会返回每一步同步 / 重新部署结果。

## 常用环境变量

### 基础配置

| 变量名 | 说明 |
|---|---|
| `PORT` | Node / Docker HTTP 监听端口，默认 `3000` |
| `IMAGE_GEN_ADMIN_TOKEN` | 管理口令。保存服务端配置、清理服务端图片、同步云平台变量时建议设置 |
| `IMAGE_GEN_CONFIG_DIR` | 配置目录，默认 `config/` |
| `IMAGE_GEN_ENV_FILE` | 配置文件路径，默认 `IMAGE_GEN_CONFIG_DIR/.env` |
| `IMAGE_GEN_DATA_DIR` | 图片历史目录，Docker 推荐 `/app/data` 并挂载宿主机目录 |
| `IMAGE_GEN_STATIC_DIR` | 静态文件目录，默认 `dist/` |
| `IMAGE_GEN_ACCOUNT_STORE_ENCRYPTION_KEY` | `IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY` 的兼容别名 |
| `UPSTASH_REDIS_REST_URL` | `IMAGE_GEN_UPSTASH_REDIS_REST_URL` 的兼容别名 |
| `UPSTASH_REDIS_REST_TOKEN` | `IMAGE_GEN_UPSTASH_REDIS_REST_TOKEN` 的兼容别名 |

### 默认生成配置

| 变量名 | 说明 |
|---|---|
| `IMAGE_GEN_DEFAULT_API_URL` | 旧版默认 API 地址 / 新账号预填兼容；新用户请在账号编辑里填“此账号的 API 地址” |
| `IMAGE_GEN_DEFAULT_IMAGE_MODEL` | 默认图片模型，通常是 `gpt-image-2` |
| `IMAGE_GEN_DEFAULT_RESPONSES_MODEL` | 默认 Responses 模型 |
| `IMAGE_GEN_DEFAULT_STREAM_MODE` | 是否默认启用 Responses 流式生图 |
| `IMAGE_GEN_DEFAULT_RESPONSES_AUTO_FALLBACK` | Responses 失败后是否自动回退 Images API |
| `IMAGE_GEN_DEFAULT_IMAGE_EDITS_COMPAT_MODE` | 是否启用旧版 multipart 图生图兼容模式 |
| `IMAGE_GEN_FORCE_PROXY` | 是否强制走服务端代理 |
| `IMAGE_GEN_DEFAULT_SIZE` | 默认尺寸，默认 `auto` |
| `IMAGE_GEN_DEFAULT_QUALITY` | 默认质量 |
| `IMAGE_GEN_DEFAULT_FORMAT` | 默认输出格式 |
| `IMAGE_GEN_DEFAULT_BACKGROUND` | 默认背景 |

### 水印、存储、润色

| 变量名 | 说明 |
|---|---|
| `IMAGE_GEN_WATERMARK_ENABLED` | 是否启用水印 |
| `IMAGE_GEN_WATERMARK_TEMPORARY_MODE` | 单次生成水印覆盖策略 |
| `IMAGE_GEN_WATERMARK_MODE` | 水印模式 |
| `IMAGE_GEN_WATERMARK_TEXT` | 水印文本 |
| `IMAGE_GEN_WATERMARK_TIME_FORMAT` | 时间格式 |
| `IMAGE_GEN_WATERMARK_POSITION` | 水印位置 |
| `IMAGE_GEN_WATERMARK_OPACITY` | 透明度 |
| `IMAGE_GEN_WATERMARK_FONT_SIZE` | 字号 |
| `IMAGE_GEN_WATERMARK_COLOR` | 颜色 |
| `IMAGE_GEN_WATERMARK_SHADOW` | 是否启用阴影 |
| `IMAGE_GEN_WATERMARK_BACKGROUND` | 是否启用半透明底板 |
| `IMAGE_GEN_STORAGE_ENABLED` | 是否保存生成图片 |
| `IMAGE_GEN_PROMPT_ENHANCEMENT_ENABLED` | 是否启用提示词润色 |
| `IMAGE_GEN_PROMPT_ENHANCEMENT_RUN_MODE` | `manual` 或 `auto` |
| `IMAGE_GEN_PROMPT_ENHANCEMENT_MODEL` | 润色模型，空值则跟随账号模型 |
| `IMAGE_GEN_PROMPT_ENHANCEMENT_MODE` | 润色风格 |
| `IMAGE_GEN_PROMPT_ENHANCEMENT_LANGUAGE` | 语言偏好 |

### 账号存储 / Upstash

| 变量名 | 说明 |
|---|---|
| `IMAGE_GEN_ACCOUNT_STORE` | `auto` / `file` / `upstash` / `browser`。默认 `auto`：Node / Docker 用文件，serverless 有 Upstash 则用 Upstash，否则浏览器缓存。 |
| `IMAGE_GEN_ACCOUNT_STORE_NAMESPACE` | Upstash / 账号存储命名空间，默认 `image-gen`。 |
| `IMAGE_GEN_ACCOUNT_STORE_FILE` | Node / Docker 账号加密文件路径，默认 `data/accounts.enc.json`。 |
| `IMAGE_GEN_DEPLOYMENT_ID` | 账号存储隔离 ID，默认 `default`；多环境共用 Upstash 时建议显式设置。 |
| `IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY` | 账号存储加密 Key；Upstash 必填，Node / Docker 未填时会生成 `config/.account-store-key`。 |
| `IMAGE_GEN_UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL；配置后不会在 runtime 响应中回显。 |
| `IMAGE_GEN_UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST Token；配置后不会在 runtime 响应中回显。 |

### 云平台配置

| 变量名 | 说明 |
|---|---|
| `IMAGE_GEN_DEPLOY_PLATFORM` | `node` / `vercel` / `netlify` / `cloudflare` / `edgeone` |
| `IMAGE_GEN_DEPLOY_ACCOUNT_ID` | 平台账号 ID，Netlify / Cloudflare 需要 |
| `IMAGE_GEN_DEPLOY_PROJECT_ID` | 平台项目 ID |
| `IMAGE_GEN_DEPLOY_API_TOKEN` | 平台 API Token，不要提交到仓库 |
| `IMAGE_GEN_DEPLOY_AUTO_SYNC` | 保存配置后是否自动同步平台变量 |
| `IMAGE_GEN_DEPLOY_AUTO_REDEPLOY` | 同步后是否自动触发重新部署 |

### 安全与代理

| 变量名 | 说明 |
|---|---|
| `IMAGE_GEN_ALLOWED_ORIGINS` | 额外允许的 CORS 来源，多个 origin 用逗号分隔 |
| `IMAGE_GEN_ALLOW_INSECURE_LOCAL_ADMIN` | 仅本地开发调试用，生产不要开启 |
| `IMAGE_GEN_PROXY_ALLOWED_HOSTS` | 兼容旧配置；当前默认允许公网 HTTPS OpenAI 兼容 API host，但仍拒绝本机 / 私网地址 |
| `IMAGE_GEN_PROXY_ALLOW_LOCAL_HTTP` | 仅本地开发用，是否允许本机 HTTP 代理 |
| `IMAGE_GEN_PROXY_TIMEOUT_MS` | 代理上游请求超时 |
| `IMAGE_GEN_PROXY_MAX_RESPONSE_BYTES` | 代理最大响应字节数 |
| `IMAGE_GEN_JSON_BODY_LIMIT_BYTES` | JSON 请求体上限 |
| `IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES` | 生图任务请求体上限 |
| `IMAGE_GEN_REF_IMAGE_MAX_BYTES` | 单张参考图最大字节数 |
| `IMAGE_GEN_REF_IMAGES_TOTAL_MAX_BYTES` | 多参考图总大小上限 |
| `IMAGE_GEN_REMOTE_IMAGE_MAX_BYTES` | 远程图片下载最大字节数 |
| `IMAGE_GEN_REMOTE_IMAGE_TIMEOUT_MS` | 远程图片下载超时 |
| `IMAGE_GEN_REMOTE_IMAGE_MAX_REDIRECTS` | 远程图片最大重定向次数 |
| `IMAGE_GEN_OAUTH_SESSION_FILE` | OAuth session 文件位置 |
| `IMAGE_GEN_OAUTH_SESSION_SECRET` | serverless stateless OAuth session 加密签名密钥；未配置时会回退使用 `IMAGE_GEN_ADMIN_TOKEN` 派生密钥 |
| `IMAGE_GEN_PLATFORM_API_TIMEOUT_MS` | 平台 API 调用超时 |
| `REQUIRE_DOCKER_SMOKE` | 设为 `1` 时 Docker smoke 不可用会让发布门禁失败 |

### Serverless 行为差异

- **Node / Docker**：会读取并维护本地 `config/.env`，支持 watcher 热更新、后台任务轮询、图片持久化、服务端文件账号存储、完整 `/api/proxy` 和 OAuth 后端。
- **Vercel**：初始化时只读取环境变量，不创建本地配置文件；后台任务在 serverless 中同步完成并直接返回结果。账号长期保存请配置 Upstash，否则回退浏览器缓存。
- **Netlify**：当前只提供 JSON proxy 和部分 OAuth 生图函数；没有完整配置中心、后台任务和图片持久化。
- **Cloudflare Pages / EdgeOne Pages**：默认是静态站点导入；仓库内 handler 主要用于 Node / Vercel 配置中心里管理对应平台环境变量，不等于 Pages 静态站点天然具备完整后端。

## 前端保存 + 云端同步 + 重新部署的工作流

### Node / Docker

1. 前端先完成管理员登录
2. 在“设置”里修改生成、外观、图片存储、部署或备份偏好
3. 点击保存后，支持服务端配置的部署会写入 `config/.env`
4. watcher 自动热更新，无需重启
5. 在“账号管理”里新增/编辑 API Key 或 OAuth 账号
6. 服务端账号存储可用时优先写入 `data/accounts.enc.json`，浏览器副本会保留作为 fallback

### 云平台

1. 前端先完成管理员登录
2. 在“账号管理 → 保存位置”里选择 Upstash，填写 REST URL / Token / 账号加密 Key
3. 填写 `IMAGE_GEN_ACCOUNT_STORE=upstash` 或通过平台环境变量同步保持一致
4. 点击“测试账号存储”确认 Upstash 可用
5. 如需同步部署环境变量，到“设置 → 部署”点击“平台校验”确认 `accountId/projectId/token` 正确
6. 点击“同步环境变量”
7. 如平台需要，点击“触发重新部署”
8. 新部署实例读取最新环境变量，账号继续写入 Upstash；未配置完整时回退浏览器缓存

### 自动模式

如果你打开：

- `IMAGE_GEN_DEPLOY_AUTO_SYNC=true`
- `IMAGE_GEN_DEPLOY_AUTO_REDEPLOY=true`

那么保存服务端配置时会自动执行平台变量同步和重新部署，并在接口响应的 `operations` 里返回每一步结果。

如果你刚开始配置平台 token，建议先关闭自动模式，手动点击“平台校验 / 同步平台变量 / 重新部署”确认成功后再打开。

## 代理说明

如果目标 OpenAI 兼容 API 不支持浏览器 CORS，可以在账号设置里开启代理。

- **Node / Docker**：支持 JSON、SSE 和 multipart 图生图代理，功能最完整。
- **Vercel**：支持 JSON 和 SSE 代理；不支持 multipart 图生图代理，开启旧版 multipart 图生图兼容模式时请关闭代理或改用 Node / Docker。
- **Netlify**：支持 JSON 代理；SSE 会退化为函数响应文本，multipart 图生图代理不支持。
- **纯静态站点**：通常只能浏览器直连，要求目标 API 本身支持跨域。

安全限制：默认拒绝本机、私网、链路本地地址，防止把代理当 SSRF 通道使用。

## 测试与发布门禁

运行测试：

```bash
npm test
```

构建静态文件：

```bash
npm run build
```

管理员登录、独立账号管理与瘦身设置的当前追踪文档见：

- `docs/admin-gate-account-settings-refactor-2026-04-29.md`

发布镜像前门禁：

```bash
npm run ci:release-gate
```

发布 workflow 会先执行 `npm ci` 和 `npm run ci:release-gate`，通过单元测试、静态构建和 Docker smoke 后才登录 Docker Hub 并推送多架构镜像。CI 中设置 `REQUIRE_DOCKER_SMOKE=1`，所以 Docker 构建或容器 HTTP 烟测失败时不会发布镜像。

## Docker Hub / 镜像发布

推送到 `main` 后，GitHub Actions 会构建并推送：

```text
fogtape/image-gen:latest
fogtape/image-gen:sha-<commit>
```

GitHub 仓库需要配置：

```text
DOCKERHUB_USERNAME
DOCKERHUB_TOKEN
```

## 常见问题

### 为什么提示只支持 OpenAI 系？

因为当前前端、后端、代理、后台任务、OAuth 都围绕 OpenAI Images / Responses 设计。非 OpenAI 协议需要单独适配请求体、返回体、错误处理、历史保存和前端参数，不是填一个模型名就能兼容。

### OAuth 授权后跳到 localhost 无法访问，是失败了吗？

不一定。远程部署时看到 localhost 无法访问很常见。复制完整回调链接或授权码，回到 ChatGPT 登录弹窗里粘贴完成即可。

### 为什么云平台后台任务体验不如 Docker？

因为 Vercel / Netlify 这类 serverless 平台请求生命周期短，实例之间不共享内存；Cloudflare Pages / EdgeOne Pages 默认又是纯静态页面。长时间后台生图更适合 Node / Docker 常驻进程。

### 账号到底保存在哪里？

看“账号管理 → 保存位置”：

- Node / Docker 且管理员已登录：优先保存到服务端加密文件。
- 云平台配置 Upstash：优先保存到 Upstash。
- 没有服务端账号存储、接口 404 或配置不完整：继续保存到当前浏览器缓存。

浏览器副本会保留作为 fallback，因此同步失败不会阻止你继续生成。

### Docker 更新后配置或图片丢了怎么办？

检查是否挂载了：

```text
./config:/app/config
./data:/app/data
```

没有挂载时，配置和图片历史可能只在容器内部，重建容器会丢。

### API Key 和 token 应该放哪里？

个人 API Key、OAuth token、平台 token 都不要提交到 Git 仓库。服务端管理口令和平台 token 建议放在 `config/.env` 或平台环境变量里，并限制访问权限。

### Upstash 里会明文保存 API Key 或 OAuth token 吗？

不会。账号存储在写入文件或 Upstash 前会使用 AES-GCM envelope 加密；列表接口和运行时配置接口都只返回脱敏状态，不回显 API Key、OAuth token、Upstash REST Token 或账号加密 Key。

## 产品路线与记录

P0-P3 稳定性、安全、可访问性和发布门禁修复记录：

- `docs/audit-p0-p3-tracking-2026-04-28.md`

下一批产品增强 backlog：

- `docs/p4-product-roadmap.md`
