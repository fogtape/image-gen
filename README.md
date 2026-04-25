# AI Image Generator

支持 OpenAI 兼容 API 与 ChatGPT OAuth 的图片生成工具。

Docker 镜像：`fogtape/image-gen:latest`

## 功能

- 支持 `/v1/images/generations` 和 `/v1/responses` 两种端点
- 自定义 API 地址、Key、模型
- 质量（低/中/高）、尺寸、背景透明度、输出格式
- 上传参考图（图生图）
- 连接测试
- 临时覆盖设置
- 图片预览大图、下载
- Ctrl+Enter 快捷生成

## 部署

### 本地运行

```bash
npm install
npm run dev
```

只看纯前端也可以：

```bash
npm run build
npx serve dist -p 3000
```

### Vercel

推荐方式：

1. Fork 本仓库。
2. 在 Vercel 控制台选择 **Add New Project / Import Git Repository**。
3. 选择你 Fork 的仓库并直接 Deploy。

仓库已经带好 `vercel.json`，Vercel 会自动执行：

```text
Build Command: npm run build
Output Directory: dist
```

无需配置环境变量。`/api/*` 会走仓库内的 Vercel Serverless 入口，页面资源只从 `dist` 静态目录发布，避免把浏览器端 `app.js` 当成服务端函数执行。

### Cloudflare Pages

1. Fork 本仓库。
2. 在 Cloudflare Pages 选择 **Create a project / Connect to Git**。
3. 选择你 Fork 的仓库并部署。

仓库已包含 `wrangler.toml`：

```text
pages_build_output_dir = "dist"
```

Cloudflare Pages 会使用 `npm run build` 生成静态文件。无需配置环境变量。

### EdgeOne Pages

1. Fork 本仓库。
2. 在 EdgeOne Pages 控制台选择从 Git 仓库导入。
3. 选择你 Fork 的仓库并部署。

仓库已包含 `edgeone.json`：

```text
Build Command: npm run build
Output Directory: dist
```

无需配置环境变量。

### Netlify

1. Fork 本仓库。
2. 在 Netlify 控制台选择 **Add new site / Import an existing project**。
3. 选择你 Fork 的仓库并部署。

仓库已包含 `netlify.toml`，会自动执行 `npm run build` 并发布 `dist`。

## Docker

本地构建：

```bash
docker build -t image-gen:local .
docker run --rm -p 3000:3000 image-gen:local
```

使用 Docker Compose：

```bash
docker compose up -d
```

以后推送到 `main` 后，GitHub Actions 会自动构建并推送 Docker Hub 镜像：

```text
fogtape/image-gen:latest
fogtape/image-gen:sha-<commit>
```

GitHub 仓库需要配置 Secrets：

```text
DOCKERHUB_USERNAME
DOCKERHUB_TOKEN
```

## 代理说明

如果 API 不支持 CORS（浏览器跨域），可在设置中开启「使用代理」。Vercel / Netlify 这类带 Serverless Functions 的部署可以使用代理；Cloudflare Pages / EdgeOne Pages 静态部署通常走浏览器直连，需所选 API 站点允许跨域。
