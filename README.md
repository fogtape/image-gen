# AI Image Generator

支持 OpenAI 兼容 API 的图片生成工具。

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
npx serve . -p 3000
```

直接用浏览器打开 `index.html` 也可以（不使用代理功能时）。

### Vercel

```bash
npm i -g vercel
cd image-gen
vercel
```

或在 Vercel 控制台导入 Git 仓库，无需任何配置。

### Netlify

```bash
npm i -g netlify-cli
cd image-gen
netlify deploy --prod
```

或在 Netlify 控制台拖拽上传项目文件夹。

## 代理说明

如果 API 不支持 CORS（浏览器跨域），可在设置中开启「使用代理」。代理功能需要部署到 Vercel 或 Netlify 才能使用，本地直接打开 HTML 时不可用。
