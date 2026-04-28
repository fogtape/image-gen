# image-gen 本轮并行审查 P0-P3 追踪文档

> 适用项目：`/data/data/com.termux/files/home/image-gen`
> 创建日期：2026-04-28（Asia/Shanghai）
> 当前阶段：P3 已完成；CI release gate 热修进行中
> 来源：2026-04-28 并行全面审查（后端/API/安全、前端/UX、测试/构建/产品缺口）
> 维护规则：**每完成一个小步，必须立刻更新本文档对应状态、完成时间、变更证据和验证结果**，避免遗漏。

---

## 0. 状态约定与实时更新规则

### 状态标记

- `⬜ 未开始`：尚未动手。
- `🟡 进行中`：正在实现、验证或补文档。
- `✅ 已完成`：代码、测试、文档均满足完成标准。
- `🔴 阻塞`：需要平台权限、外部 API 行为确认、凭据或设计决策。
- `🟣 延后`：确认不在当前批次处理，但保留问题记录。

### 每完成一个小步必须更新

每个小步都保留这些字段：

- **状态**：从 `⬜` 改成 `🟡` 或 `✅`。
- **完成时间**：填写具体日期时间，例如 `2026-04-28 16:20 CST`。
- **目标**：这个小步要解决什么问题。
- **完成判断**：如何确认这个小步完全完成。
- **变更证据**：列出关键文件、函数、测试或产物。
- **验证结果**：写明运行的命令和通过/失败结果。
- **关联/后续**：如果影响其他步骤，写到这里。

### 推荐推进顺序

1. P0：先修会导致发布产物不可用、SSRF、DoS 的阻塞问题。
2. P1：统一后端/serverless 安全边界和部署行为。
3. P2：修复前端可访问性、状态一致性和移动端体验。
4. P3：补齐测试、文档、工程维护和产品增强。

### 全局验收底线

任一阶段合并前至少运行：

```bash
npm run build
npm test
```

如果改到路由、代理、Docker 或前端模块，还需要按阶段补充专项验证。

---

## 1. 当前基线

### 已确认通过

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 13:37 CST
- **验证命令**：
  ```bash
  npm run build && npm test
  ```
- **验证结果**：162 tests，162 pass，0 fail。
- **补充验证**：模拟 Dockerfile 当前构建上下文时，确认缺少 `frontend/` 会导致 `dist/frontend` 不存在。
- **当前结论**：源码构建和单测通过，但 Docker 产物、安全边界、serverless 行为和前端可访问性仍需继续修复。

---

## 2. 总览看板

| 优先级 | 主题 | 状态 | 当前目标 | 阶段完成判断 |
|---|---|---:|---|---|
| P0 | 阻塞发布和安全封口 | ✅ 已完成 | P0.1-P0.3 已完成 | Docker/安全专项测试与全量测试通过 |
| P1 | 后端、serverless、部署一致性 | ✅ 已完成 | P1.1-P1.9 已完成 | Node/Vercel/Netlify 行为一致且有限制 |
| P2 | 前端可访问性和状态一致性 | ✅ 已完成 | P2.1-P2.10 已完成 | 关键交互可键盘操作，状态不误导用户 |
| P3 | 测试、文档、维护性和功能建议 | ✅ 已完成 | P3.1、P3.3-P3.7 已完成；P3.2 延后到下一轮 E2E | CI/文档/结构能支撑后续迭代 |

## 1.1 CI release gate 热修记录

### CI.1 修复 GitHub Actions 中 timeout 测试被取消

- **状态**：✅ 已完成（本地 release gate 通过，等待远程 Docker Publish 复验）
- **开始时间**：2026-04-28 16:57 CST
- **完成时间**：2026-04-28 16:58 CST
- **目标**：修复 Docker Publish / release gate 中 `npm test` 出现 `cancelledByParent`，导致 `test/image-storage.test.js` 与 `test/proxy-executor.test.js` 后续用例被取消的问题。
- **根因判断**：相关测试用例使用永不 resolve 的 mock `fetch` 来等待生产代码的 timeout abort；但生产 timeout 调用了 `timeout.unref?.()`，在 CI 的 Node test runner 中可能让事件循环提前判定空闲，父测试结束时仍有 pending Promise，于是同文件后续 sibling tests 被标记为 `cancelledByParent`。
- **推荐实现**：
  1. 让真实超时保护保持 event loop ref 状态，确保待决上游请求一定会等到 abort。
  2. 保留 `finally { clearTimeout(timeout) }`，正常快速响应不会留下计时器。
  3. 重跑相关文件和全量 release gate，确认 `cancelled` 归零。
- **完成判断**：
  - `node --test test/image-storage.test.js test/proxy-executor.test.js` 通过，且 `cancelled 0`。
  - `npm run ci:release-gate` 通过。
  - 推送后 Docker Publish 工作流通过。
- **变更证据**：
  - `image-storage.js`：远程图片下载 timeout 不再 `unref()`。
  - `proxy-executor.js`：代理上游 timeout 不再 `unref()`。
- **验证结果**：
  ```bash
  node --check image-storage.js && node --check proxy-executor.js
  node --test test/image-storage.test.js test/proxy-executor.test.js
  npm run ci:release-gate
  ```
  结果：语法检查通过；专项 18 tests，18 pass，0 fail，0 cancelled；release gate 通过，`npm test` 为 202 tests，202 pass，0 fail，0 cancelled，`npm run build` 通过，Docker smoke 因本地无 docker 命令按脚本跳过。
- **关联/后续**：提交并用四号账号推送后，观察远程 Docker Publish 工作流是否通过。

---

# P0：阻塞发布和安全封口

目标：先处理会让发布产物不可用、服务端可被诱导访问内网、异常路径可能打崩进程的问题。

阶段完成判断：

- Docker 构建产物包含 `dist/frontend/*.js`，页面不会因 ES module 404 失效。
- 服务端所有上游 API 地址都经过统一 allowlist、协议和私网拦截策略。
- 畸形 URL 编码不会抛未捕获异常。
- 主路由所有 async handler 都有统一错误兜底。
- P0 专项测试、`npm run build`、`npm test` 通过。

## P0.1 修复 Docker 镜像缺少 `frontend/`

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 13:49 CST
- **目标**：确保 Docker/Compose/自动发布镜像里的前端模块完整，避免浏览器加载 `app.js` 后请求 `./frontend/*.js` 失败。
- **推荐实现**：
  1. 在 `Dockerfile` 的 `RUN npm run build` 前加入 `COPY frontend ./frontend`。
  2. 检查 `.dockerignore`，确保不会把 `frontend/` 排除。
  3. 增加 Docker 构建上下文模拟测试，验证 `dist/frontend/*.js` 存在。
  4. 如果环境有 Docker，再补真实 `docker build` smoke；没有 Docker 时测试要能降级为模拟构建上下文。
- **完成判断**：
  - `Dockerfile` 构建阶段明确复制 `frontend/`。
  - 模拟 Docker 构建上下文后，`dist/frontend/dom.js`、`dist/frontend/http.js`、`dist/frontend/state.js` 等模块存在。
  - `test/docker-packaging.test.js` 或新增测试能捕获“漏复制 frontend”问题。
- **变更证据**：
  - `Dockerfile`：在 `RUN npm run build` 前新增 `COPY frontend ./frontend`。
  - `test/docker-packaging.test.js`：新增 Docker 静态构建阶段模拟测试，按 Dockerfile build 阶段 COPY 输入执行 `scripts/build-static.js`，断言 `dist/frontend/*.js` 存在。
- **验证结果**：
  ```bash
  node --test test/docker-packaging.test.js
  npm run build
  ```
  结果：Docker packaging 3 tests 全部通过；静态构建通过，`Static build written to dist/`。
- **关联/后续**：P3.1 发布门禁仍需继续补真实 Docker 镜像烟测。

## P0.2 封住服务端 SSRF：统一校验 `cfg.apiUrl`

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 13:55 CST
- **目标**：`/api/jobs`、`/api/prompt/enhance` 不能让客户端任意指定服务端访问地址。
- **推荐实现**：
  1. 新增共享函数，例如 `upstream-policy.js` 或复用 `proxy-policy.js`，提供 `resolveAllowedApiBaseUrl(apiUrl, options)`。
  2. 强制要求 `https:`，默认拒绝 `localhost`、`127.0.0.0/8`、私网、链路本地、保留地址。
  3. 默认允许官方/已配置 allowlist host；自定义兼容 API 需要显式配置允许 host。
  4. `server.js` 的 `baseApiUrl()` 和 `prompt-enhancement.js` 的 `baseApiUrl()` 都改走统一校验。
  5. 对错误返回安全、可读的信息，不回显敏感 header 或 key。
- **完成判断**：
  - `http://127.0.0.1:...`、`http://localhost:...`、私网地址会被拒绝。
  - 合法 OpenAI/兼容 API host 在 allowlist 内可通过。
  - `/api/jobs`、`/api/prompt/enhance` 都覆盖测试。
  - 不破坏已有正常生成和提示词增强链路。
- **变更证据**：
  - `proxy-policy.js`：新增 `validateApiBaseUrl()`，对服务端上游 API 地址统一执行协议、私网、本机、allowlist、credentials、query/hash 校验。
  - `server.js`：图片任务上游 `baseApiUrl()` 改走 `validateApiBaseUrl()`，allowlist 来自 resolved runtime config 和环境变量。
  - `server.js`：`/api/prompt/enhance` 调用 `enhancePrompt()` 时传入服务端 allowlist，避免客户端自带任意 allowlist。
  - `prompt-enhancement.js`：提示词增强请求构造改走统一 API 地址校验。
  - `test/proxy-security.test.js`、`test/prompt-enhancement.test.js`、`test/responses-routing.test.js`：新增本机/私网/未 allowlist 地址拒绝和“不触发 fetch”测试。
  - `test/background-job-cancel-api.test.js`：本地取消集成测试显式打开本机开发 allowlist，避免默认策略被误解为允许本机。
- **验证结果**：
  ```bash
  node --check proxy-policy.js
  node --check server.js
  node --check prompt-enhancement.js
  node --test test/proxy-security.test.js test/prompt-enhancement.test.js test/responses-routing.test.js test/background-job-cancel-api.test.js
  ```
  结果：16 tests，16 pass，0 fail。
- **关联/后续**：P1.1 serverless proxy allowlist 文档也要和这里保持一致。

## P0.3 统一路由异常兜底和安全 URL decode

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 14:00 CST
- **目标**：畸形百分号编码路径不会触发未捕获 `URIError`；异步 handler 未捕获异常不会造成请求悬挂或进程退出。
- **推荐实现**：
  1. 新增 `safeDecodeURIComponent(value)`，失败时返回可识别错误。
  2. 对 `/api/jobs/:id`、`/api/images/:id`、`/api/oauth/status/:id` 等路径统一使用安全 decode。
  3. 新增 `dispatch(req, res, handler)` 或 `runHandler(handler)`，统一包装 `Promise.resolve(...).catch(...)`。
  4. 主 `http.createServer()` 外层补同步 try/catch。
  5. 错误响应统一 JSON：`400 Bad Request` 或 `500 Internal Server Error`。
- **完成判断**：
  - 请求 `/api/jobs/%E0%A4%A/cancel` 返回 400，不导致进程异常。
  - 任意 async handler 抛错时能返回 JSON 错误。
  - 没有新增 unhandled rejection。
- **变更证据**：
  - `server.js`：新增 `sendJsonError()`、`dispatchRoute()`、`safeDecodePathComponent()`。
  - `server.js`：主 `http.createServer()` 路由分发改为 `dispatchRoute()` 包装，异步 handler 统一 `.catch()`。
  - `server.js`：`/api/jobs/:id`、`/api/images/:id`、`/api/oauth/status/:id` 等路径参数改用安全 decode，畸形编码返回 400。
  - `test/routing-security.test.js`：新增畸形 URL 编码路径返回 400 且服务继续可用的集成测试。
  - `test/background-job-backend-guardrails.test.js`：新增路由兜底结构断言。
- **验证结果**：
  ```bash
  node --check server.js
  node --test test/routing-security.test.js test/background-job-backend-guardrails.test.js test/static-security.test.js test/storage-history-api.test.js test/background-job-cancel-api.test.js
  ```
  结果：9 tests，9 pass，0 fail。
- **关联/后续**：P1.7 DELETE 空 body 可顺手复用统一 handler。

---

# P1：后端、serverless、部署一致性

目标：让 Node、Vercel、Netlify、Docker 的安全边界和功能说明一致，减少“本地能用、部署坏掉”的情况。

阶段完成判断：

- Serverless proxy 和 Node proxy 都有上游超时、响应大小限制和一致错误结构。
- Netlify OAuth 图片接口也受请求体和参考图大小限制。
- OAuth session 写入安全、原子，不把短期敏感结果持久化。
- Serverless 初始化没有本地文件写副作用。
- CORS、DELETE、平台 handler 行为清楚且有测试覆盖。

## P1.1 抽共享 proxy executor，补齐 serverless 超时和响应大小限制

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 14:11 CST
- **目标**：`server.js`、`api/proxy.js`、`netlify/functions/proxy.js` 使用同一套代理执行限制。
- **推荐实现**：
  1. 新增 `proxy-executor.js`。
  2. 统一目标校验、header 清理、请求体图片限制、上游 timeout、响应大小限制、SSE 累计字节限制。
  3. Node/Vercel/Netlify 只保留平台适配层。
  4. 统一错误码：目标拒绝 403，payload 太大 413，上游超时 504，上游失败 502。
- **完成判断**：
  - Vercel/Netlify proxy 不再直接 `await resp.text()` 无上限。
  - SSE 也有累计字节上限和超时。
  - 相关 mock fetch 测试覆盖 timeout、超大响应、正常 JSON、SSE。
- **变更证据**：
  - `proxy-executor.js`：新增共享 `ProxyRequestError`、`getProxyExecutionLimits()`、`prepareProxyRequest()`、`runProxyUpstream()`，统一目标校验、危险 header 清理、请求体图片限制、上游 timeout、响应大小限制、SSE 累计字节限制。
  - `server.js`：`handleProxy()` 改为复用共享 executor；Node/Docker 继续通过 `buildProxyMultipartFormData()` 支持 multipart；SSE 使用上游 status/content-type。
  - `api/proxy.js`、`netlify/functions/proxy.js`：仅保留平台适配层，复用共享 executor；serverless multipart 显式返回不支持，不再静默丢 body；不再直接 `await resp.text()` 无上限读取上游响应。
  - `proxy-policy.js`：`getProxyAllowedHosts()` 自动纳入 `IMAGE_GEN_DEFAULT_API_URL` 的 host，保持 Node/Vercel/Netlify 默认 API allowlist 一致。
  - `request-limits.js`：multipart 限制纳入顶层 `mask` / `maskImageBase64`。
  - `Dockerfile`、`test/docker-packaging.test.js`：Docker 运行态复制并断言 `proxy-executor.js`，避免容器启动时 `ERR_MODULE_NOT_FOUND`。
  - `test/proxy-executor.test.js`：新增正常 JSON、content-length 超限、流式读取累计超限、SSE 预检/累计超限、timeout=504、serverless multipart 拒绝、JSON `Content-Type` 去重、multipart mask 限制等行为测试。
  - `test/proxy-security.test.js`：更新 serverless proxy 静态断言，改为验证共享 executor 持有统一策略和 Vercel SSE 状态透传。
- **验证结果**：
  ```bash
  node --check proxy-executor.js proxy-policy.js request-limits.js server.js api/proxy.js test/proxy-executor.test.js test/proxy-security.test.js test/docker-packaging.test.js
  node --test test/proxy-executor.test.js test/proxy-security.test.js test/request-limits.test.js test/docker-packaging.test.js
  npm run build
  npm test
  ```
  结果：专项 17 tests 全部通过；静态构建通过；全量 177 tests，177 pass，0 fail。
- **关联/后续**：P3.2 README 环境变量清单要同步新增 proxy 超时/大小配置。

## P1.2 远程图片下载逐跳校验重定向

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 14:21 CST
- **目标**：远程图片 URL 不能通过 30x 重定向绕到本机、私网或非 HTTPS 地址。
- **推荐实现**：
  1. `fetch(..., { redirect: 'manual' })`。
  2. 每次遇到 `Location` 都重新执行 `validateRemoteImageUrl()`。
  3. 限制最大重定向次数，例如 5 次。
  4. 保留现有 content-type、content-length、流式读取大小、timeout 限制。
- **完成判断**：
  - HTTPS 图片直连仍成功。
  - HTTPS → 私网/localhost 重定向被拒绝。
  - HTTPS → HTTP 重定向被拒绝。
  - 重定向循环或超过次数返回可读错误。
- **变更证据**：
  - `image-storage.js`：`bufferFromUrl()` 改用 `fetch(..., { redirect: 'manual' })`，遇到 `301/302/303/307/308` 时解析相对/绝对 `Location`，每一跳重新执行 `validateRemoteImageUrl()`，并通过 `IMAGE_GEN_REMOTE_IMAGE_MAX_REDIRECTS` 限制跳转次数。
  - `image-storage.js`：最终响应继续执行 `resp.ok`、`content-type` 白名单、`content-length`、流式读取大小和 timeout 限制。
  - `openai-oauth-image.js`：OAuth 图片 `downloadBytes()` 同步改为 HTTPS/非本机校验、手动逐跳重定向、content-type 白名单、流式大小限制；从 ChatGPT 同源跳转到第三方时重新计算 headers，避免跨 origin 继续携带 Authorization；data URL / b64JSON 也受 `MAX_DOWNLOAD_BYTES` 限制。
  - `test/image-storage.test.js`：新增 HTTPS 相对跳转成功、跳转到私网/HTTP 被拒绝、缺少 Location、超过最大跳转次数测试。
  - `test/openai-oauth-image.test.js`：新增 OAuth 图片下载跳转、跨 origin 不带 Authorization、协议/私网/content-type/大小限制测试。
- **验证结果**：
  ```bash
  node --check image-storage.js openai-oauth-image.js test/image-storage.test.js test/openai-oauth-image.test.js
  node --test test/image-storage.test.js test/openai-oauth-image.test.js
  npm run build
  npm test
  ```
  结果：专项 22 tests 全部通过；静态构建通过；全量 179 tests，179 pass，0 fail。
- **关联/后续**：DNS 解析与重绑定防护仍可作为后续增强项追加；前端/后端参考图 MIME 收紧可放入 P2/P3 或单独安全增强项。

## P1.3 OAuth session 原子写入并避免敏感结果落盘

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 14:27 CST
- **目标**：OAuth 会话文件不会因为并发/中断写入损坏，也不会持久化 access token/refresh token 等短期敏感结果。
- **推荐实现**：
  1. `saveOAuthSessions()` 改为写临时文件再 rename。
  2. 序列化前过滤 `session.result` 或其中 token 字段。
  3. 成功结果保存在内存 map，轮询成功后立即删除。
  4. `loadOAuthSessions()` 遇到坏 JSON 时备份坏文件并重置为空，避免每次启动重复 warn。
- **完成判断**：
  - `.oauth-sessions.json` 不包含 access token/refresh token 字段。
  - 模拟截断 JSON 后启动能自动备份/恢复。
  - 并发保存不会产生非法 JSON。
- **变更证据**：
  - `server.js`：OAuth session 文件路径支持 `IMAGE_GEN_OAUTH_SESSION_FILE`，便于隔离测试和部署覆盖。
  - `server.js`：新增 `writeOAuthSessionsAtomic()`，写临时文件、`fsync` 后 `rename`，并清理临时文件。
  - `server.js`：新增 `sanitizeOAuthSessionForDisk()` / `sanitizeOAuthPersistedValue()`，落盘前过滤 `result` 和 token-like 字段；`status=success` 的会话只保留在内存，不持久化到 `.oauth-sessions.json`。
  - `server.js`：`loadOAuthSessions()` 加载历史文件时也过滤旧的敏感字段；坏 JSON 会备份为 `.corrupt.*` 并重置为空文件。
  - `test/oauth-session-store.test.js`：新增成功结果/token 不落盘、无原子写临时文件残留、坏 JSON 备份并重置测试。
- **验证结果**：
  ```bash
  node --check server.js test/oauth-session-store.test.js
  node --test test/oauth-session-store.test.js
  npm run build
  npm test
  ```
  结果：OAuth session 专项 7 tests 全部通过；静态构建通过；全量 181 tests，181 pass，0 fail。
- **关联/后续**：前端 OAuth 轮询取消、去重和按钮防重入仍按 P2.8 处理。

## P1.4 Serverless 配置初始化去除本地文件副作用

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 14:40 CST
- **目标**：Vercel/Netlify 等只读或临时文件系统环境中，初始化配置服务不创建/读取本地 `config/.env`。
- **推荐实现**：
  1. `createConfigService({ isServerless: true })` 跳过 `ensureConfigFiles()`。
  2. serverless 模式只使用 `process.env` 和默认配置。
  3. 本地 Node/Docker 模式保留 `.env` 创建、读取、watch。
  4. 增加单测确认 serverless 初始化不写文件。
- **完成判断**：
  - serverless 测试环境下不会创建 `config/.env`。
  - 本地模式仍能创建模板和读取配置。
  - 保存配置在 serverless 模式不写磁盘。
- **变更证据**：
  - `config-service.js`：`createConfigService({ isServerless: true })` 不再执行 `ensureConfigFiles()`，初始化不创建 `config/`、`.env.example` 或 `.env`。
  - `config-service.js`：serverless 模式下 `currentEnv` 与 `refreshFromDisk()` 不再读取本地 `.env`，只合并默认配置与 `process.env`。
  - `config-service.js`：本地 Node/Docker 模式保留 `ensureConfigFiles()`、`.env` 读取和 watcher；`setRuntimeConfig()` 仍只在非 serverless 写入本地 `.env`。
  - `config-service.js`：支持 `IMAGE_GEN_CONFIG_DIR` / `IMAGE_GEN_ENV_FILE` 覆盖路径，方便隔离测试和特殊部署。
  - `test/config-admin-security.test.js`：新增隔离子进程测试，确认 serverless 初始化和保存配置均不创建配置目录或 `.env` 文件。
- **验证结果**：
  ```bash
  node --check config-service.js test/config-admin-security.test.js
  node --test test/config-admin-security.test.js test/config-runtime-security.test.js test/platform-handler-config.test.js
  npm run build
  npm test
  ```
  结果：配置/serverless 专项 6 tests 全部通过；静态构建通过；全量 182 tests，182 pass，0 fail。
- **关联/后续**：README 要说明 serverless 配置来源是环境变量。

## P1.5 Netlify OAuth 生图补请求体和参考图限制

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:00 CST
- **目标**：Netlify `/api/oauth/images` 与 Node 路径拥有一致的请求体、参考图和 mask 限制。
- **推荐实现**：
  1. 抽共享 `validateImagePayloadLimits()`。
  2. Netlify 函数解析 JSON 前先检查 `event.body` 字节长度。
  3. 解析后检查 `refImagesBase64`、`maskBase64`、嵌套 data image。
  4. 错误返回 413 和清晰提示。
- **完成判断**：
  - 超大 body 在 Netlify 函数直接 413。
  - 超大单张参考图/总参考图在 Netlify 函数 413。
  - 正常小请求不受影响。
- **变更证据**：
  - `request-limits.js`：新增 `getImageJobBodyLimitBytes()`、`assertTextBodyWithinLimit()`、`validateImagePayloadLimits()`，把 body 限制和嵌套 data image 限制抽成共享能力。
  - `netlify/functions/oauth-images.js`：JSON 解析前先按 `IMAGE_GEN_IMAGE_JOB_BODY_LIMIT_BYTES` 检查 `event.body` 字节数；解析后检查 `refImagesBase64`、`maskImageBase64` 以及嵌套 data image；超限返回 413 且不回显大图内容。
  - `test/netlify-oauth-limits.test.js`：新增 Netlify OAuth images 超大 body、超大参考图、超大 mask 返回 413，以及非法 JSON 仍返回 400 的测试。
- **验证结果**：
  ```bash
  node --check request-limits.js netlify/functions/oauth-images.js test/netlify-oauth-limits.test.js
  node --test test/netlify-oauth-limits.test.js test/request-limits.test.js
  npm run build
  npm test
  ```
  结果：Netlify/request limit 专项 3 tests 全部通过；静态构建通过；全量 184 tests，184 pass，0 fail。
- **关联/后续**：可在 P3.3 README 中补充 Netlify OAuth body/ref image 限制环境变量说明。

## P1.6 收紧 CORS 并保留本地开发可用性

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:07 CST
- **目标**：避免全局 `Access-Control-Allow-Origin: *` 与管理接口、本地免 token 开关组合扩大攻击面。
- **推荐实现**：
  1. 支持 `IMAGE_GEN_ALLOWED_ORIGINS`。
  2. 默认同源或本机开发 origin；明确配置后才允许其他 origin。
  3. 管理接口优先要求 admin token；本地 insecure 开关只用于临时开发。
  4. OPTIONS 响应跟随实际 origin 策略。
- **完成判断**：
  - 未配置 allowlist 时，陌生 Origin 不获得宽松 CORS。
  - 合法本机/配置 Origin 正常。
  - 不影响前端同源访问。
- **变更证据**：
  - `server.js`：新增 `IMAGE_GEN_ALLOWED_ORIGINS` 解析、同源检测、本机开发 origin 检测和 `applyCorsHeaders()`。
  - `server.js`：主服务不再全局返回 `Access-Control-Allow-Origin: *`；陌生 `Origin` 不返回 ACAO；同源、本机开发 origin、显式配置 origin 才反射允许。
  - `server.js`：移除 `/api/proxy` 和 `/api/oauth/images/stream` 内部重复写入的 `Access-Control-Allow-Origin: *`，避免覆盖主 CORS 策略。
  - `test/cors-policy.test.js`：新增陌生 Origin 不放行、配置 Origin 放行、本机开发 Origin 放行、同源 Origin 放行测试。
- **验证结果**：
  ```bash
  node --check server.js test/cors-policy.test.js
  node --test test/cors-policy.test.js test/storage-history-api.test.js test/proxy-security.test.js
  npm run build
  npm test
  ```
  结果：CORS/相关回归专项 6 tests 全部通过；静态构建通过；全量 185 tests，185 pass，0 fail。
- **关联/后续**：README 高级安全配置需同步；Vercel/Netlify 函数仍保留各自 CORS 适配，后续可继续统一 serverless CORS helper。

## P1.7 DELETE 图片接口支持空 body 管理鉴权

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:14 CST
- **目标**：`DELETE /api/images/:id` 可以只通过 header admin token 执行，不强制 JSON body。
- **推荐实现**：
  1. 读取 DELETE body 时允许空 body。
  2. `requireConfigAdmin()` 支持 `parsedBody = {}`。
  3. 保留 body 传 adminToken 的兼容能力。
  4. 增加无 body + header token 测试。
- **完成判断**：
  - `DELETE` 空 body + 正确 header 成功。
  - 无 token/错 token 仍拒绝。
  - 旧前端调用不受影响。
- **变更证据**：
  - `server.js`：`readJsonBody()` 新增 `allowEmpty` / `emptyValue` 选项，保持默认空 body 兼容 `{}`，并让空白 body 不再进入 `JSON.parse()`。
  - `server.js`：`handleDeleteStoredImage()` 显式以 `{ allowEmpty: true, emptyValue: {} }` 读取 DELETE 请求体，支持空 body 只用 header token 鉴权。
  - `test/storage-history-api.test.js`：补 P1.7 回归用例，覆盖 DELETE 空 body + header token 成功、空 body 无 token/错 token 拒绝、旧 body `adminToken` 兼容。
- **验证结果**：
  ```bash
  node --check server.js test/storage-history-api.test.js
  node --test test/storage-history-api.test.js test/storage-security.test.js
  ```
  结果：专项 2 tests，2 pass，0 fail；`npm run build` 通过；`npm test` 通过，全量 185 tests，185 pass，0 fail。
- **关联/后续**：可和 P0.3 统一 dispatch 一起处理。

## P1.8 EdgeOne check 改成无副作用或明确副作用

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:17 CST
- **目标**：平台“检查”动作不应执行疑似写操作，避免误修改环境变量。
- **推荐实现**：
  1. 优先查 EdgeOne 是否有只读项目/环境变量查询 API。
  2. 如果有，`check()` 改用只读 API。
  3. 如果没有，把当前行为从 `check()` 移到 `sync()` 或在 UI 明示“会尝试写入”。
  4. 平台 handler 测试覆盖 action 名称。
- **完成判断**：
  - `check()` 不再调用 `ModifyPagesProjectEnvs`，或 UI 明确提示副作用。
  - `sync()` 仍可执行环境变量同步。
  - 测试覆盖防止回归。
- **变更证据**：
  - `handlers/edgeone-handler.js`：`check()` 改为仅执行本地参数完整性校验，返回 `remoteWrite: false`，不再调用 `ModifyPagesProjectEnvs`。
  - `handlers/edgeone-handler.js`：实际云端环境变量更新仍保留在 `sync()`，职责边界更清晰。
  - `test/platform-handler-config.test.js`：新增 EdgeOne check/sync 行为测试，断言 check 不触发 fetch，sync 才调用 `ModifyPagesProjectEnvs`。
- **验证结果**：
  ```bash
  node --check handlers/edgeone-handler.js test/platform-handler-config.test.js
  node --test test/platform-handler-config.test.js
  ```
  结果：平台 handler 专项 3 tests，3 pass，0 fail；`npm run build` 通过；`npm test` 通过，全量 186 tests，186 pass，0 fail。
- **关联/后续**：平台 API 调用 timeout 在 P1.9 处理；README 需要说明 EdgeOne 检查只验证本地参数，云端写入由同步动作执行。

## P1.9 平台 handler 外部 API 调用加统一 timeout

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:20 CST
- **目标**：Vercel、Netlify、Cloudflare、EdgeOne 的平台 API 卡住时不会长期占用管理请求。
- **推荐实现**：
  1. 抽 `fetchJsonWithTimeout()` / `postJsonWithTimeout()`。
  2. 默认 10-30 秒超时，可通过环境变量调整。
  3. 超时返回可诊断错误，不泄露 token。
  4. 所有 handler 复用。
- **完成判断**：
  - mock fetch 永不返回时，handler 在超时后失败。
  - 错误信息不包含 token。
  - 现有平台测试通过。
- **变更证据**：
  - `handlers/platform-fetch.js`：新增共享 `fetchJsonWithTimeout()`、`getPlatformApiTimeoutMs()` 和 `redactMessage()`，默认平台 API 超时 15 秒，可通过 `IMAGE_GEN_PLATFORM_API_TIMEOUT_MS` 调整并限制在 1-120 秒。
  - `handlers/vercel-handler.js`、`handlers/netlify-handler.js`、`handlers/cloudflare-handler.js`：平台 HTTP JSON 请求统一复用 timeout helper。
  - `handlers/edgeone-handler.js`：EdgeOne 写入/部署请求复用 timeout helper，并对 EdgeOne 业务错误执行 token 脱敏。
  - `test/platform-fetch.test.js`：新增超时、安全错误脱敏、环境变量边界测试。
  - `test/platform-handler-config.test.js`：继续覆盖平台 handler 不回显 token 和 EdgeOne check/sync 边界。
- **验证结果**：
  ```bash
  node --check handlers/platform-fetch.js handlers/vercel-handler.js handlers/netlify-handler.js handlers/cloudflare-handler.js handlers/edgeone-handler.js test/platform-fetch.test.js test/platform-handler-config.test.js
  node --test test/platform-fetch.test.js test/platform-handler-config.test.js
  ```
  结果：平台 timeout 专项 6 tests，6 pass，0 fail；`npm run build` 通过；`npm test` 通过，全量 189 tests，189 pass，0 fail。
- **关联/后续**：README 高级环境变量补充平台 timeout。

---

# P2：前端可访问性、状态一致性和移动端体验

目标：让核心交互对键盘、读屏和小屏用户可用，并消除保存/登录状态串扰。

阶段完成判断：

- 关键表单控件有程序化 label 或稳定可访问名称。
- 自定义控件有键盘操作、焦点样式和选中状态语义。
- 保存设置失败不会造成用户误判。
- OAuth 登录轮询不会重复添加账号或串扰状态。
- 移动端 320-360px 不出现关键操作横向溢出。

## P2.1 修复 switch checkbox 被 `display:none` 导致不可达

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:49 CST
- **目标**：设置页所有自定义开关可被键盘聚焦和读屏识别。
- **推荐实现**：
  1. 将 `.switch-label input { display: none; }` 改为 visually-hidden 样式。
  2. 给 `input:focus-visible + .switch` 增加明显焦点环。
  3. 必要时给说明文字加 `aria-describedby`。
- **完成判断**：
  - Tab 可以聚焦到开关。
  - Space 可以切换。
  - 焦点可见。
  - 现有开关视觉不破坏。
- **变更证据**：
  - `style.css`：`.switch-label input` 从 `display:none` 改为 1px/透明的 visually-hidden 方案，保留原生 checkbox 可聚焦和可切换能力。
  - `style.css`：新增 `.switch-label input:focus-visible + .switch` 焦点环。
- **验证结果**：
  ```bash
  node --check app.js test/accessibility-ui.test.js
  node --test test/accessibility-ui.test.js test/settings-ui.test.js test/reference-images.test.js
  ```
  结果：可访问性/设置/参考图专项 23 tests，23 pass，0 fail；`npm run build` 通过；`npm test` 通过，全量 193 tests，193 pass，0 fail。
- **关联/后续**：P2.4 统一焦点样式已同批完成。

## P2.2 上传参考图和 mask 改为真实按钮触发 file input

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:49 CST
- **目标**：上传入口键盘可达，读屏名称清晰。
- **推荐实现**：
  1. 将 label 图标入口改成 `<button type="button">`。
  2. 隐藏的 file input 保留，但由按钮 click 触发。
  3. 按钮提供 `aria-label` 和焦点样式。
  4. 保留现有文件选择、多选、mask 预览逻辑。
- **完成判断**：
  - Tab 可到上传按钮。
  - Enter/Space 能打开文件选择。
  - 读屏能读出“上传参考图”“上传 mask”。
  - 参考图和 mask 测试通过。
- **变更证据**：
  - `index.html`：参考图和 mask 上传入口从 `label.tool-btn` 改为真实 `<button type="button">`，分别提供明确 `aria-label`；file input 保持 hidden。
  - `app.js`：新增上传按钮 click handler，分别触发 `#refImage.click()` 和 `#maskImage.click()`，保留原有 onchange 处理链路。
  - `style.css`：`.tool-btn` 补 button 默认样式归零和焦点样式。
- **验证结果**：
  ```bash
  node --check app.js test/accessibility-ui.test.js
  node --test test/accessibility-ui.test.js test/settings-ui.test.js test/reference-images.test.js
  ```
  结果：可访问性/设置/参考图专项 23 tests，23 pass，0 fail；`npm run build` 通过；`npm test` 通过，全量 193 tests，193 pass，0 fail。
- **关联/后续**：功能增强里的拖拽/粘贴上传可放 P3。

## P2.3 分段控件补 ARIA 状态和方向键操作

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:49 CST
- **目标**：质量、背景等分段控件不只依赖视觉 `.active`。
- **推荐实现**：
  1. 容器加 `role="group"` 和 label。
  2. 按钮加 `aria-pressed="true|false"`。
  3. `applySegmentDefault()` 和点击逻辑同步更新 `aria-pressed`。
  4. 增加左右方向键切换。
- **完成判断**：
  - 选中按钮有 `aria-pressed="true"`。
  - 方向键能切换同组按钮。
  - 鼠标点击、默认值应用不受影响。
- **变更证据**：
  - `index.html`：质量/背景 `.seg` 增加 `role="group"` 和 `aria-labelledby`；按钮补 `type="button"` 与 `aria-pressed` 初始状态。
  - `app.js`：新增 `setSegmentValue()`，点击和默认值应用统一同步 `.active` 与 `aria-pressed`。
  - `app.js`：新增 `handleSegmentKeydown()`，支持 ArrowLeft/ArrowRight/ArrowUp/ArrowDown/Home/End 切换并移动焦点。
- **验证结果**：
  ```bash
  node --check app.js test/accessibility-ui.test.js
  node --test test/accessibility-ui.test.js test/settings-ui.test.js test/reference-images.test.js
  ```
  结果：可访问性/设置/参考图专项 23 tests，23 pass，0 fail；`npm run build` 通过；`npm test` 通过，全量 193 tests，193 pass，0 fail。
- **关联/后续**：当前保留 button 分段控件实现，暂不切换为 radio。

## P2.4 补齐图标按钮可访问名称和统一焦点样式

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:49 CST
- **目标**：设置、显示/隐藏 key、账号编辑/删除等图标按钮有稳定可访问名称，键盘焦点可见。
- **推荐实现**：
  1. 给静态图标按钮补 `aria-label`。
  2. SVG 加 `aria-hidden="true"`。
  3. 显示/隐藏 Key 按钮同步 `aria-pressed` 和动态 label。
  4. 统一 `.btn`、`.topbar-btn`、`.tool-btn`、`.seg button` 的 `:focus-visible` 样式。
- **完成判断**：
  - 关键图标按钮不只依赖 `title`。
  - 键盘焦点在主操作上清晰可见。
  - accessibility 测试覆盖新增断言。
- **变更证据**：
  - `index.html`：顶部设置按钮新增 `aria-label="打开设置"`，SVG 标记 `aria-hidden="true"`。
  - `index.html`：显示/隐藏 API Key 按钮新增 `type="button"`、`aria-label`、`aria-pressed`，SVG 标记 `aria-hidden="true"`。
  - `app.js`：`#toggleEditKey` 点击时同步 `aria-pressed`、动态 `aria-label` 和 `title`。
  - `style.css`：统一 `.btn`、`.topbar-btn`、`.tool-btn`、`.seg button`、`.icon-btn-sm`、`.switcher-btn` 的 `:focus-visible` 焦点环。
- **验证结果**：
  ```bash
  node --check app.js test/accessibility-ui.test.js
  node --test test/accessibility-ui.test.js test/settings-ui.test.js test/reference-images.test.js
  ```
  结果：可访问性/设置/参考图专项 23 tests，23 pass，0 fail；`npm run build` 通过；`npm test` 通过，全量 193 tests，193 pass，0 fail。
- **关联/后续**：P3.5 可继续封装 `createIconButton()`，收敛动态按钮 SVG。

## P2.5 表单 label 与主提示词输入框补程序化关联

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:49 CST
- **目标**：主 prompt、尺寸、格式、风格、类型等输入控件都有明确 label。
- **推荐实现**：
  1. 给 prompt textarea 加可见或 sr-only label。
  2. `formatSelect`、`styleSelect`、`typeSelect` 的 label 加 `for`。
  3. 自定义尺寸 trigger 加 `aria-labelledby` 或 `aria-label`。
  4. 选中尺寸变化时同步可读值。
- **完成判断**：
  - 所有关联控件能通过 label 定位。
  - 不依赖 placeholder 作为唯一名称。
  - 现有 UI 布局不破坏。
- **变更证据**：
  - `index.html`：为主提示词 textarea 新增 `.sr-only` 的 `<label for="prompt">图片提示词</label>`。
  - `style.css`：新增 `.sr-only` 可访问隐藏样式。
  - `index.html`：`formatSelect`、`styleSelect`、`typeSelect` 的 label 补 `for` 关联。
  - `test/accessibility-ui.test.js`：新增 P2 可访问性批量回归断言。
- **验证结果**：
  ```bash
  node --check app.js test/accessibility-ui.test.js
  node --test test/accessibility-ui.test.js test/settings-ui.test.js test/reference-images.test.js
  ```
  结果：可访问性/设置/参考图专项 23 tests，23 pass，0 fail；`npm run build` 通过；`npm test` 通过，全量 193 tests，193 pass，0 fail。
- **关联/后续**：后续真实浏览器 E2E 可用 label 定位这些控件。

## P2.6 设置保存改为两阶段提交或明确双状态

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:24 CST
- **目标**：服务端保存失败时，不出现“本地已保存但用户以为全部失败/全部成功”的混乱状态。
- **推荐实现**：
  1. 先读取 `nextAppSettings` 和 `nextServerConfig`，不立即写 localStorage。
  2. 服务端保存成功后再提交本地设置。
  3. 如果决定允许部分成功，UI 必须明确提示“本地偏好已保存，服务端配置失败”。
  4. 失败时不要关闭设置弹窗。
- **完成判断**：
  - mock 服务端保存失败时，localStorage 不被意外写入，或 UI 明确显示部分成功。
  - 服务端保存成功时，本地和服务端状态同步。
  - 测试覆盖失败和成功两条路径。
- **变更证据**：
  - `app.js`：`saveSettingsFromForm()` 改为先读取 `nextAppSettings` / `nextServerConfig`，等待 `saveServerRuntimeConfig(nextServerConfig)` 成功后才写入 `state.appSettings` 和 `localStorage`。
  - `test/settings-ui.test.js`：新增两阶段提交静态回归测试，断言本地偏好提交发生在服务端保存成功之后。
- **验证结果**：
  ```bash
  node --check app.js test/settings-ui.test.js
  node --test test/settings-ui.test.js test/config-runtime-settings.test.js test/platform-handler-config.test.js
  ```
  结果：设置/配置专项 17 tests，17 pass，0 fail；`npm run build` 通过；`npm test` 通过，全量 191 tests，191 pass，0 fail。
- **关联/后续**：P2.7 masked deploy 字段已同批处理，确保不误删。

## P2.7 masked deploy 字段保存时不误删已有配置

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:24 CST
- **目标**：用户打开设置后直接保存，不会清掉已配置的 deploy account/project/token。
- **推荐实现**：
  1. 填表时对 masked 字段设置 `data-has-existing="true"`。
  2. 读表单时：空值 + has existing 表示保留，不 delete。
  3. 只有用户输入新值或点击显式“清除配置”才修改/删除。
  4. 保存 payload 继续避免回显敏感值。
- **完成判断**：
  - 已配置占位字段空输入保存后，服务端配置仍保留。
  - 显式清除可以删除。
  - 输入新值可以覆盖。
- **变更证据**：
  - `app.js`：新增 `setExistingSecretHint()`，对 masked `deployAccountId`、`deployProjectId` 以及 `apiTokenConfigured` 的 `deployApiToken` 设置 `data-has-existing="true"` 和“留空保存会保留”的占位提示。
  - `app.js`：新增 `assignDeployFieldFromInput()`，空值 + `data-has-existing="true"` 表示保留字段；输入新值才覆盖；无现有值且为空才从 payload 删除。
  - `test/settings-ui.test.js`：新增 masked deploy 字段保留/覆盖/删除策略静态断言。
- **验证结果**：
  ```bash
  node --check app.js test/settings-ui.test.js
  node --test test/settings-ui.test.js test/config-runtime-settings.test.js test/platform-handler-config.test.js
  ```
  结果：设置/配置专项 17 tests，17 pass，0 fail；`npm run build` 通过；`npm test` 通过，全量 191 tests，191 pass，0 fail。
- **关联/后续**：后续可增加显式“清除平台配置”按钮；当前推荐实现优先防误删。

## P2.8 OAuth 轮询支持取消、去重和登录按钮防重入

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:31 CST
- **目标**：多次点击登录、手动完成登录、取消登录时不会重复添加账号或状态串扰。
- **推荐实现**：
  1. 在 state 中保存 `oauthPollTimer`、`oauthPollSessionId`、`oauthPollGeneration`。
  2. 启动新登录前取消旧 timer。
  3. 成功、失败、超时、手动 exchange 成功、重置时都清理 timer。
  4. 登录进行中禁用 `oauthLoginBtn` 或显示明确状态。
- **完成判断**：
  - 连续启动两次登录，只保留最后一次轮询。
  - 手动 exchange 成功后旧轮询不会再次添加账号。
  - 超时/失败后按钮恢复。
- **变更证据**：
  - `frontend/state.js`：新增 `oauthPollTimer`、`oauthPollSessionId`、`oauthPollGeneration`、`oauthLoginInProgress`、`oauthCompletedKeys`。
  - `app.js`：新增 `clearOAuthPolling()`、`beginOAuthPolling()`、`isCurrentOAuthPoll()`、`scheduleOAuthPoll()` 和 `setOAuthLoginBusy()`。
  - `app.js`：`startOAuth()` 启动前清理旧轮询并设置登录 busy，防止连续点击重复发起。
  - `app.js`：`pollOAuthStatus()` 每次处理前校验 session/generation，成功、失败、超时都会清理轮询并恢复按钮。
  - `app.js`：`finishOAuthWithCode()` 手动 exchange 前清理旧轮询，避免旧轮询成功后重复添加账号。
  - `app.js`：`addOAuthAccountFromResult()` 增加 `oauthCompletedKeys` 幂等保护，按 account/email/session/token 可识别键防重复添加。
  - `test/oauth-connection-ui.test.js`：新增 OAuth 轮询防重入、取消、generation guard、按钮 busy、幂等保护静态回归测试。
- **验证结果**：
  ```bash
  node --check app.js frontend/state.js test/oauth-connection-ui.test.js
  node --test test/oauth-connection-ui.test.js api/oauth/test.js
  ```
  结果：OAuth UI/后端显式路由专项 8 tests，8 pass，0 fail；`npm run build` 通过；`npm test` 通过，全量 192 tests，192 pass，0 fail。
- **关联/后续**：P1.3 后端 session 安全已完成；后续可补真实浏览器 E2E 覆盖连续点击和手动 exchange。

## P2.9 历史诊断面板去除服务端数据 `innerHTML` 拼接

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:37 CST
- **目标**：诊断面板渲染 trace 字段时不再用模板字符串直接写 `innerHTML`。
- **推荐实现**：
  1. 用 `document.createElement()` 创建 row、label、value。
  2. 文本统一通过 `textContent`。
  3. `title` 通过 `setAttribute()` 或属性赋值设置。
  4. 保留空值、长文本截断和样式。
- **完成判断**：
  - 特殊字符 `<script>`、引号、尖括号只作为文本显示。
  - 面板布局不变。
  - 新增测试覆盖 HTML 字符输入。
- **变更证据**：
  - `app.js`：`renderStorageDiagnostics()` 空状态从 `panel.innerHTML = ''` 改为 `panel.replaceChildren()`。
  - `app.js`：诊断标题、列表、label、value 全部使用 `document.createElement()` 创建，服务端 trace 字段通过 `textContent` 和 `title` 属性赋值，不再拼接 HTML 字符串。
  - `test/diagnostics-ui.test.js`：新增诊断面板 DOM 安全渲染静态断言，确保函数内不再使用 `innerHTML` / rows 模板拼接。
- **验证结果**：
  ```bash
  node --check app.js test/diagnostics-ui.test.js test/history-trace-metadata.test.js
  node --test test/diagnostics-ui.test.js test/history-trace-metadata.test.js test/history-ui.test.js
  ```
  结果：诊断/历史专项 3 tests，3 pass，0 fail；`npm run build` 通过；`npm test` 通过，全量 192 tests，192 pass，0 fail。
- **关联/后续**：P3.5 可继续收敛其他 `innerHTML`，但本项已封住服务端 trace 数据直拼。

## P2.10 修复移动端顶部栏和后台任务 banner 溢出

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:53 CST
- **目标**：320-360px 小屏下，顶部栏和后台任务操作不横向溢出。
- **推荐实现**：
  1. `.topbar-left`、`.logo span` 增加 `min-width: 0`、ellipsis 或小屏隐藏文字。
  2. `.topbar-right` 保持可见，不被挤出。
  3. 小屏下 `.active-job-banner` 改为 column 或允许 actions wrap。
  4. 三个后台任务按钮在小屏可换行或垂直排列。
- **完成判断**：
  - 360px 断言通过。
  - 320px 人工或自动截图无横向滚动。
  - 按钮点击区域仍足够。
- **变更证据**：
  - `style.css`：顶部栏左右容器、logo 和账号切换按钮补 `min-width: 0`；logo 文本补 ellipsis；600px 下后台任务 banner 改列布局并允许 actions wrap；360px 下隐藏 logo 文本、后台任务按钮纵向全宽排列。
  - `test/css-layout.test.js`：新增 320-360px 顶部栏与后台任务 banner 溢出兜底静态 CSS 断言。
- **验证结果**：
  - 专项通过：`node --test test/css-layout.test.js test/accessibility-ui.test.js test/background-job-ui-state.test.js`，14 tests，14 pass，0 fail。
  - 全量通过：`npm run build && npm test`，194 tests，194 pass，0 fail。
- **关联/后续**：P3.2 Playwright 可加入真实截图。

---

# P3：测试、文档、维护性和功能建议

目标：把本轮发现的问题固化到测试、文档和工程结构里，降低后续回归概率，并规划下一批产品增强。

阶段完成判断：

- 发布流程有足够门禁，坏 Docker/静态产物不会推送。
- README 和追踪文档与代码状态一致。
- 环境变量、Node 版本、serverless 差异写清楚。
- 前后端大型文件拆分有明确计划和首批落地。
- 产品增强有可执行的 P4 路线。

## P3.1 增加发布质量门禁和 Docker 烟测

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 15:56 CST
- **目标**：自动发布镜像前先证明测试、构建、Docker 产物都可用。
- **推荐实现**：
  1. Docker 发布工作流 build/push 前运行 `npm ci`、`npm test`、`npm run build`。
  2. Docker build 后检查容器内 `/app/dist/index.html`、`/app/dist/app.js`、`/app/dist/frontend/*.js`。
  3. 如 CI 支持，启动容器请求首页和关键模块。
- **完成判断**：
  - 测试失败不会推镜像。
  - 缺 `frontend/` 这类产物问题能被 CI 捕获。
  - README 发版说明同步。
- **变更证据**：
  - `package.json`：新增 `test:docker:packaging`、`smoke:docker`、`ci:release-gate` 发布门禁脚本。
  - `scripts/docker-smoke-test.mjs`：新增 Docker build/run/HTTP smoke；非 CI 且 Docker 不可用时跳过，CI 或 `REQUIRE_DOCKER_SMOKE=1` 时失败。
  - `.github/workflows/docker-publish.yml`：发布流程改为先 Node 安装依赖和 `npm run ci:release-gate`，通过后再 Docker Hub 登录和多架构 push。
  - `test/docker-packaging.test.js`：新增脚本入口、smoke 回退行为和 workflow 顺序静态断言。
- **验证结果**：
  - 专项通过：`node --check scripts/docker-smoke-test.mjs && node --test test/docker-packaging.test.js && npm run smoke:docker`；Docker packaging 5 tests，5 pass，0 fail；本机无 Docker 时 `npm run smoke:docker` 按预期输出 SKIP 并退出 0。
  - 全量通过：`npm run build && npm test`，196 tests，196 pass，0 fail。
- **关联/后续**：依赖 P0.1 修复 Docker 构建输入；CI 发布环境通过 `REQUIRE_DOCKER_SMOKE=1` 强制真实 Docker smoke。

## P3.2 引入真实浏览器 E2E 和移动端截图检查

- **状态**：⬜ 未开始
- **完成时间**：待填写
- **目标**：覆盖当前正则/单测难以发现的真实页面加载、键盘路径和移动端布局问题。
- **推荐实现**：
  1. 引入 Playwright 或等价 E2E 工具。
  2. 覆盖首页加载 ES modules、设置弹窗、生成按钮、历史管理、对比模式。
  3. 覆盖 360px 和 320px 视口截图/无横向滚动断言。
  4. OAuth 使用 mock，不依赖真实外部登录。
- **完成判断**：
  - 真实浏览器能加载首页，无 module 404。
  - 关键按钮可键盘操作。
  - 小屏无横向溢出。
- **变更证据**：待填写。
- **验证结果**：待填写。
- **关联/后续**：P2 完成后补 E2E 更有效。

## P3.3 更新 README 环境变量、serverless 差异和 Node 版本要求

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 16:00 CST
- **目标**：自托管和云部署用户能按文档配置代理 allowlist、超时、大小限制、队列、OAuth session、Node 版本等关键项。
- **推荐实现**：
  1. README 增加“高级/安全环境变量”小节。
  2. 补充 proxy allowlist、proxy timeout、proxy response bytes、远程图片下载、任务队列、OAuth session secret、本地 insecure admin 开关。
  3. 说明 Node 与 Vercel/Netlify 获取配置/allowlist 的差异。
  4. `package.json` 增加 `engines.node`，README 快速开始写最低 Node 版本。
  5. Vercel/EdgeOne 安装命令优先改 `npm ci`。
- **完成判断**：
  - README 环境变量表覆盖本轮涉及的安全/性能变量。
  - 没有真实 token、key、cookie 示例。
  - Node 版本约束明确。
  - 云平台安装命令和 lockfile 策略一致。
- **变更证据**：
  - `package.json`：新增 `engines.node >=22`。
  - `README.md`：快速开始和 Node 部署改推荐 `npm ci`；补 Node 22 要求；自动化测试补 `npm run ci:release-gate` 和 Docker smoke 回退/强制策略；环境变量清单补高级/安全变量与 serverless 行为差异；Docker Hub 发布说明补测试/构建/smoke 通过后再登录推送。
  - `test/docker-packaging.test.js`：新增 README 发布门禁和 Node 版本说明断言。
- **验证结果**：
  - 专项通过：`node --test test/docker-packaging.test.js test/cloud-deploy.test.js`，16 tests，16 pass，0 fail。
  - 全量通过：`npm run build && npm test`，197 tests，197 pass，0 fail。
- **关联/后续**：可加文档一致性检查脚本。

## P3.4 更新本追踪文档和旧 P0-P3 文档状态

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 16:03 CST
- **目标**：避免旧文档顶部“当前阶段”和风险备忘误导后续接手者。
- **推荐实现**：
  1. 更新 `docs/p0-p3-tracking.md` 顶部当前阶段为已验收/进入后续规划。
  2. 风险备忘拆成“已关闭风险 / 仍需复查风险 / 新发现风险”。
  3. 将本轮文档链接加到旧文档顶部或 docs 索引位置。
  4. 本文档每完成一步实时更新。
- **完成判断**：
  - 旧文档不再显示 P3.7 进行中这类过期状态。
  - 本轮新发现风险能从旧文档跳转到本文档。
  - 文档状态和测试结果一致。
- **变更证据**：
  - `docs/p0-p3-tracking.md`：顶部当前阶段改为“旧版 P0-P3 已完成归档”，并链接 `docs/audit-p0-p3-tracking-2026-04-28.md`；总览 P3 改为已完成归档；风险备忘拆为“已关闭风险 / 仍需复查风险 / 新发现风险”。
  - `docs/audit-p0-p3-tracking-2026-04-28.md`：记录 P3.4 完成状态和验证结果。
- **验证结果**：
  - 文档专项检查：`grep -n "P3 |\|当前阶段\|P3\.7 多模型/多账号对比生成进行中" docs/p0-p3-tracking.md`，确认顶部不再显示旧 P3.7 进行中，总览 P3 为已完成。
  - 回归专项通过：`node --test test/docker-packaging.test.js test/cloud-deploy.test.js`，16 tests，16 pass，0 fail。
- **关联/后续**：P3.3 README 已补发布/环境变量说明；后续新风险只写入本文档。

## P3.5 继续前后端模块化，降低维护成本

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 16:08 CST
- **目标**：降低 `app.js`、`server.js` 的认知负担，减少后续功能互相踩踏。
- **推荐实现**：
  1. 前端优先拆 `settings.js`、`history-ui.js`、`compare-mode.js`、`backup.js`、`reference-images.js`。
  2. 后端优先拆 routes：`config`、`storage`、`oauth`、`jobs`、`proxy`。
  3. 每次只拆一个低耦合边界，保持测试通过。
  4. 顺手封装 `createIconButton()` 和确认弹窗组件。
- **完成判断**：
  - 每个模块有清晰输入输出。
  - 现有测试通过。
  - `app.js` 和 `server.js` 行数逐步下降。
  - 不引入循环依赖。
- **变更证据**：
  - `frontend/ui-actions.js`：新增 `createButton()`、`createIconButton()`、`confirmAction()`，收敛动态按钮创建和 icon button aria/svg 处理。
  - `app.js`：历史卡片复制/重新生成/作参考/收藏/删除按钮改用 `createButton()`；账号编辑/删除图标按钮改用 `createIconButton()`；删除确认经由 `confirmAction()` 统一入口。
  - `test/frontend-modules.test.js`：新增 `frontend/ui-actions.js` 模块存在、导入和 `createIconButton` 不再堆在 `app.js` 的断言。
  - `test/history-ui.test.js`：补历史操作按钮使用公共 helper 与删除确认入口断言。
- **验证结果**：
  - 专项通过：`node --check app.js frontend/ui-actions.js && node --test test/frontend-modules.test.js test/history-ui.test.js test/history-regenerate-ui.test.js test/accessibility-ui.test.js`，9 tests，9 pass，0 fail。
  - 全量通过：`npm run build && npm test`，197 tests，197 pass，0 fail。
- **关联/后续**：P3.6 可继续基于 `confirmAction()` 替换为真实统一确认弹窗；后续可按同样方式拆 `settings.js`、`history-ui.js`。

## P3.6 统一确认弹窗、错误摘要和 reduced motion

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 16:14 CST
- **目标**：删除/清理/平台操作等危险操作不再依赖原生 `confirm/alert`，错误提示更可恢复。
- **推荐实现**：
  1. 基于 `frontend/dialog-a11y.js` 做统一确认弹窗。
  2. 替换删除模板、删除历史图片、清理数据、平台操作中的 `confirm/alert`。
  3. `showError()` 同步填充页面内持久错误摘要，或删除死 UI `#errorMsg`。
  4. 增加 `prefers-reduced-motion: reduce` 样式。
- **完成判断**：
  - 危险操作有统一二次确认和焦点管理。
  - 错误弹窗关闭后仍有可见/可读错误摘要，或 UI 无死节点。
  - reduced motion 下动画/transition 明显减少。
- **变更证据**：
  - `frontend/error-dialog.js`：新增 `setPersistentErrorSummary()`，`showError()` 同步写入页面内 `#errorMsg` 持久错误摘要。
  - `frontend/ui-actions.js`：新增 `notifyAction()`；保留 `confirmAction()` 作为后续统一确认弹窗切换入口。
  - `app.js`：模板删除、清理图片/全部数据和账号/历史删除统一走 `confirmAction()`；平台 check/sync/deploy 成功反馈从原生 `alert()` 改为页面内 `notifyAction()`。
  - `style.css`：新增 `prefers-reduced-motion: reduce`，降低 animation/transition 和滚动动画。
  - `test/accessibility-ui.test.js`：补持久错误摘要、无原生 `alert()`、reduced motion 断言。
- **验证结果**：
  - 专项通过：`node --check app.js frontend/error-dialog.js frontend/ui-actions.js && node --test test/accessibility-ui.test.js test/frontend-modules.test.js test/history-ui.test.js test/settings-ui.test.js`，20 tests，20 pass，0 fail。
  - 全量通过：`npm run build && npm test`，198 tests，198 pass，0 fail。
- **关联/后续**：下一步可把 `confirmAction()` 从原生 `window.confirm` 替换为基于 `frontend/dialog-a11y.js` 的异步确认弹窗。

## P3.7 产品增强路线：编辑、队列、历史和诊断

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 16:17 CST
- **目标**：把本次审查发现的功能缺口整理成可执行 P4 backlog。
- **推荐实现**：
  1. 完整 canvas 编辑器：mask 绘制、裁剪、局部重绘预览。
  2. 上传增强：拖拽、粘贴图片、移动端拍照入口说明。
  3. 队列面板：排队、取消、重试、批量任务进度。
  4. 历史增强：分组、分页、标签、按模型/账号筛选。
  5. 对比模式增强：每个账号/模型独立进度和结果报告导出。
  6. 诊断增强：一键复制错误信息/诊断信息。
  7. 统计增强：生成成本、耗时、成功率。
- **完成判断**：
  - 每个功能有目标用户、验收标准和优先级。
  - 不与 P0-P2 修复混在同一个 PR 内。
  - README 或 docs 有 P4 规划入口。
- **变更证据**：
  - `docs/p4-product-roadmap.md`：新增 P4 backlog，覆盖局部编辑/画布、上传增强、队列面板、历史增强、对比报告导出、诊断增强、统计面板；每项包含目标用户、优先级、推荐实现和验收标准。
  - `README.md`：新增“产品路线”小节，链接本轮 P0-P3 追踪文档和 P4 产品路线。
  - `test/product-roadmap.test.js`：新增 P4 路线结构和 README 链接断言。
- **验证结果**：
  - 专项通过：`node --test test/product-roadmap.test.js test/docker-packaging.test.js`，8 tests，8 pass，0 fail。
  - 全量通过：`npm run build && npm test`，200 tests，200 pass，0 fail。
- **关联/后续**：P0-P3 已完成；P3.2 真实浏览器 E2E 作为下一轮工程增强单独落地更合适。

---

## 3. 实时进度日志

- 2026-04-28 13:37 CST：完成本轮并行审查汇总；确认 `npm run build && npm test` 通过，162 tests pass；确认 Docker 模拟构建上下文缺少 `dist/frontend`。
- 2026-04-28 13:40 CST：创建本文档；将本轮 P0-P3 问题拆为可追踪小步，所有修复项初始状态为 `⬜ 未开始`。
- 2026-04-28 13:47 CST：开始 P0.1，目标是修复 Docker 构建阶段未复制 `frontend/` 导致镜像前端模块缺失的问题。
- 2026-04-28 13:49 CST：完成 P0.1；Docker 构建阶段已复制 `frontend/`，并新增模拟 Docker 静态构建产物测试；`node --test test/docker-packaging.test.js` 与 `npm run build` 通过。
- 2026-04-28 13:50 CST：开始 P0.2，目标是统一校验服务端使用的 `cfg.apiUrl`，防止 `/api/jobs` 和 `/api/prompt/enhance` 被用作 SSRF 出口。
- 2026-04-28 13:55 CST：完成 P0.2；新增统一 API base URL 校验，`/api/jobs` 和 `/api/prompt/enhance` 均拒绝未 allowlist 的本机/私网/非 HTTPS 地址；定向语法检查和 16 个相关测试通过。
- 2026-04-28 13:56 CST：开始 P0.3，目标是让畸形 URL 编码返回 400，并让主路由所有异步 handler 统一捕获异常。
- 2026-04-28 14:00 CST：完成 P0.3；主路由已统一异步兜底，路径参数使用安全 decode；畸形编码路径集成测试和相关回归测试通过。
- 2026-04-28 14:03 CST：完成 P0 阶段总验收；`npm run build && npm test` 通过，全量 168 tests，168 pass，0 fail；下一步进入 P1.1。
- 2026-04-28 14:04 CST：开始 P1.1，目标是抽共享代理执行器，让 Node/Vercel/Netlify 都具备上游超时和响应大小限制。
- 2026-04-28 14:03 CST：P1.1 语法检查通过：`node --check proxy-executor.js server.js api/proxy.js netlify/functions/proxy.js` 均无错误；专项测试发现 `test/proxy-security.test.js` 仍按旧实现断言 serverless 文件直接引入 `request-limits.js`，需要改为断言共享 `proxy-executor.js` 持有统一策略，并补执行器超时/限流测试。
- 2026-04-28 14:05 CST：P1.1 已修复静态断言并新增 `test/proxy-executor.test.js`；覆盖 content-length 超限、流式 JSON 超限、SSE 超限、timeout=504、serverless multipart 显式拒绝；`node --test test/proxy-executor.test.js test/proxy-security.test.js test/request-limits.test.js` 通过，10 tests pass。
- 2026-04-28 14:05 CST：并行审查补充发现 P1.1 仍需封口：Docker 运行态需复制 `proxy-executor.js`；SSE 需在提交响应头前预检超大 `content-length`；serverless allowlist 需纳入 `IMAGE_GEN_DEFAULT_API_URL`；JSON 代理需去掉重复大小写 `Content-Type`；multipart/mask 限制需进入共享 executor。
- 2026-04-28 14:10 CST：P1.1 补充封口完成：Docker 复制 `proxy-executor.js`；SSE 在 `onStreamStart` 前预检 `content-length`；Vercel/Node SSE 使用上游 status/content-type；allowlist 自动纳入 `IMAGE_GEN_DEFAULT_API_URL`；JSON 代理去重 `Content-Type`；multipart 无 fields 也显式处理并检查顶层 mask；专项语法检查和 17 个相关测试通过。
- 2026-04-28 14:11 CST：P1.1 完成并通过全量验收：`npm run build` 成功，`npm test` 通过，全量 177 tests，177 pass，0 fail；当前阶段推进到 P1.2。
- 2026-04-28 14:11 CST：开始 P1.2，目标是让服务端远程图片下载对每一跳 30x 重定向重新校验 URL，避免初始 HTTPS 图片 URL 跳转到本机/私网/HTTP。
- 2026-04-28 14:16 CST：P1.2 已完成 `image-storage.js` 远程图片下载逐跳重定向校验：`fetch(..., redirect: 'manual')`，每跳重新 `validateRemoteImageUrl()`，限制最大跳转次数，保留类型/大小/超时限制；`node --test test/image-storage.test.js` 通过，9 tests pass。
- 2026-04-28 14:21 CST：P1.2 同步封住 OAuth 图片下载链路：`downloadBytes()` 改为 HTTPS/非本机校验、手动重定向逐跳校验、跨 origin 不携带 ChatGPT Authorization、content-type 白名单、流式大小限制，并限制 data URL / b64JSON 大小；`node --test test/image-storage.test.js test/openai-oauth-image.test.js` 通过，22 tests pass。
- 2026-04-28 14:21 CST：P1.2 完成并通过全量验收：`npm run build` 成功，`npm test` 通过，全量 179 tests，179 pass，0 fail；当前阶段推进到 P1.3。
- 2026-04-28 14:21 CST：开始 P1.3，目标是让 OAuth session 文件原子写入，并避免 access/refresh token 或成功结果持久化落盘。
- 2026-04-28 14:25 CST：P1.3 已完成核心存储修复：OAuth session 保存改为临时文件写入、fsync、rename；持久化前过滤 `result` 和 token-like 字段，`status=success` 只保留在内存不落盘；坏 JSON 启动加载时会备份为 `.corrupt.*` 并重置为空；`node --test test/oauth-session-store.test.js` 通过，7 tests pass。
- 2026-04-28 14:27 CST：P1.3 完成并通过全量验收：`npm run build` 成功，`npm test` 通过，全量 181 tests，181 pass，0 fail；当前阶段推进到 P1.4。
- 2026-04-28 14:27 CST：开始 P1.4，目标是让 Vercel/Netlify 等 serverless 初始化配置时不创建/依赖本地 `config/.env` 文件副作用。
- 2026-04-28 14:39 CST：P1.4 已完成核心修复：`createConfigService({ isServerless: true })` 不再执行 `ensureConfigFiles()`，不读写本地 `.env`，`refreshFromDisk()` 在 serverless 下只取环境变量，`setRuntimeConfig()` 仍不写磁盘；新增隔离子进程测试验证 serverless 初始化和保存均不创建配置目录；专项 6 tests pass。
- 2026-04-28 14:40 CST：P1.4 完成并通过全量验收：`npm run build` 成功，`npm test` 通过，全量 182 tests，182 pass，0 fail；当前阶段推进到 P1.5。
- 2026-04-28 14:40 CST：开始 P1.5，目标是让 Netlify `/api/oauth/images` 与 Node 路径一样具备请求体、参考图和 mask 大小限制。
- 2026-04-28 14:59 CST：P1.5 已完成核心限制：`request-limits.js` 抽出 `getImageJobBodyLimitBytes()`、`assertTextBodyWithinLimit()`、`validateImagePayloadLimits()`；Netlify OAuth images 在 JSON 解析前检查 body 字节数，解析后检查嵌套 data image/参考图/mask，超限返回 413 且不回显大图内容；专项 3 tests pass。
- 2026-04-28 15:00 CST：P1.5 完成并通过全量验收：`npm run build` 成功，`npm test` 通过，全量 184 tests，184 pass，0 fail；当前阶段推进到 P1.6。
- 2026-04-28 15:00 CST：开始 P1.6，目标是去掉 Node 主服务全局 `Access-Control-Allow-Origin: *`，改为同源/本机/配置 allowlist 策略。
- 2026-04-28 15:05 CST：P1.6 已完成 Node 主服务 CORS 收紧：新增 `IMAGE_GEN_ALLOWED_ORIGINS` 解析和同源/本机开发 origin 反射策略；陌生 Origin 不再获得 `Access-Control-Allow-Origin`；移除 `/api/proxy` 与 OAuth SSE handler 内部重复 `*`；专项 6 tests pass。
- 2026-04-28 15:07 CST：P1.6 完成并通过全量验收：`npm run build` 成功，`npm test` 通过，全量 185 tests，185 pass，0 fail；当前阶段推进到 P1.7。
- 2026-04-28 15:07 CST：开始 P1.7，目标是让 `DELETE /api/images/:id` 支持空 body + header admin token，同时保留旧 body token 兼容。
- 2026-04-28 15:13 CST：P1.7 先补测试用例，明确空 body + header token 为目标行为，同时保留旧 body `adminToken` 兼容路径；实现尚未修改。
- 2026-04-28 15:13 CST：P1.7 实现完成：`readJsonBody()` 增加空 body 选项，DELETE 单图删除显式允许空 body；专项 `node --check` 与 `node --test test/storage-history-api.test.js test/storage-security.test.js` 通过 2/2。
- 2026-04-28 15:13 CST：P1.7 静态构建验证通过：`npm run build` 成功生成 `dist/`；下一步运行全量 `npm test`。
- 2026-04-28 15:14 CST：P1.7 全量验收完成：`npm test` 通过，全量 185 tests，185 pass，0 fail；当前阶段推进到 P1.8。
- 2026-04-28 15:15 CST：开始 P1.8，选择推荐实现为 EdgeOne `check()` 只做本地参数/鉴权配置存在性校验，不再调用疑似写接口；实际环境变量同步仍保留在 `sync()`。
- 2026-04-28 15:16 CST：P1.8 实现与专项验证完成：EdgeOne `check()` 不再发起云端写请求，`sync()` 继续调用 `ModifyPagesProjectEnvs`；`node --check` 与 `node --test test/platform-handler-config.test.js` 通过 3/3。
- 2026-04-28 15:17 CST：P1.8 全量验收完成：`npm run build` 成功，`npm test` 通过，全量 186 tests，186 pass，0 fail；当前阶段推进到 P1.9。
- 2026-04-28 15:17 CST：开始 P1.9，目标是把 Vercel/Netlify/Cloudflare/EdgeOne handler 的外部 fetch 统一加 AbortController timeout，并保证错误不回显 token。
- 2026-04-28 15:19 CST：P1.9 实现与专项验证完成：新增 `handlers/platform-fetch.js`，Vercel/Netlify/Cloudflare/EdgeOne handler 统一使用 timeout fetch；专项 `node --check` 与 `node --test test/platform-fetch.test.js test/platform-handler-config.test.js` 通过 6/6。
- 2026-04-28 15:20 CST：P1.9 全量验收完成：`npm run build` 成功，`npm test` 通过，全量 189 tests，189 pass，0 fail；P1 阶段全部完成，按并行复核结论推进到 P2.6/P2.7 设置保存一致性与 masked deploy 字段保留。
- 2026-04-28 15:24 CST：P2.6/P2.7 核心实现与专项验证完成：设置保存改为服务端成功后再提交本地偏好；masked deploy 字段空值保存默认保留，输入新值才覆盖；专项 `node --check` 与 `node --test test/settings-ui.test.js test/config-runtime-settings.test.js test/platform-handler-config.test.js` 通过 17/17。
- 2026-04-28 15:25 CST：P2.6/P2.7 全量验收完成：`npm run build` 成功，`npm test` 通过，全量 191 tests，191 pass，0 fail；当前阶段推进到 P2.8 OAuth 轮询防重入。
- 2026-04-28 15:31 CST：P2.8 核心实现与专项验证完成：新增 OAuth 轮询 timer/generation/session guard、登录按钮 busy 状态、手动 exchange 清理旧轮询和账号添加幂等保护；专项 `node --check` 与 `node --test test/oauth-connection-ui.test.js api/oauth/test.js` 通过 8/8。
- 2026-04-28 15:32 CST：P2.8 全量验收完成：`npm run build` 成功，`npm test` 通过，全量 192 tests，192 pass，0 fail；当前阶段推进到 P2.9 历史诊断面板 DOM 安全渲染。
- 2026-04-28 15:37 CST：P2.9 核心实现与专项验证完成：`renderStorageDiagnostics()` 改为 `createElement` / `textContent` / `replaceChildren` 渲染服务端 trace，专项 `node --check` 与 `node --test test/diagnostics-ui.test.js test/history-trace-metadata.test.js test/history-ui.test.js` 通过 3/3。
- 2026-04-28 15:38 CST：P2.9 全量验收完成：`npm run build` 成功，`npm test` 通过，全量 192 tests，192 pass，0 fail；当前阶段推进到 P2.1-P2.5 前端可访问性批量修复。
- 2026-04-28 15:49 CST：P2.1-P2.5 核心实现与专项验证完成：switch 改为可聚焦隐藏、上传入口改真实按钮、分段控件补 ARIA/方向键、图标按钮补可访问名称、prompt/select label 补齐；专项 `node --check` 与 `node --test test/accessibility-ui.test.js test/settings-ui.test.js test/reference-images.test.js` 通过 23/23。
- 2026-04-28 15:51 CST：P2.1-P2.5 全量验收完成：`npm run build` 成功，`npm test` 通过，全量 193 tests，193 pass，0 fail；当前阶段推进到 P2.10 移动端顶部栏和后台任务 banner 溢出修复。
- 2026-04-28 15:52 CST：P2.10 核心实现与专项验证完成：顶部栏/logo/账号切换器补收缩兜底，后台任务 banner 在 600px 下改列布局、360px 下按钮纵向全宽；专项 `node --test test/css-layout.test.js test/accessibility-ui.test.js test/background-job-ui-state.test.js` 通过，14 tests，14 pass，0 fail；下一步运行全量 `npm run build` 与 `npm test`。
- 2026-04-28 15:53 CST：P2.10 全量验收完成：`npm run build` 成功，`npm test` 通过，全量 194 tests，194 pass，0 fail；P2 阶段全部完成，当前阶段推进到 P3.1 发布质量门禁和 Docker 烟测。
- 2026-04-28 15:54 CST：P3.1 核心实现与专项验证完成：新增 `scripts/docker-smoke-test.mjs`、`package.json` 发布门禁脚本，Docker 发布 workflow 改为先 `npm ci`/`npm run ci:release-gate` 再登录和 push；扩展 `test/docker-packaging.test.js` 检查脚本入口、烟测回退和 workflow 顺序；专项 `node --check scripts/docker-smoke-test.mjs && node --test test/docker-packaging.test.js && npm run smoke:docker` 通过，其中本机无 Docker 时 smoke 按预期 SKIP。下一步运行全量 `npm run build && npm test`。
- 2026-04-28 15:56 CST：P3.1 全量验收完成：`npm run build` 成功，`npm test` 通过，全量 196 tests，196 pass，0 fail；当前阶段推进到 P3.3 README 环境变量、serverless 差异和 Node 版本要求。
- 2026-04-28 16:00 CST：P3.3 实现与全量验收完成：`package.json` 补 Node 22 engines；`README.md` 补 `npm ci`、发布门禁、Docker smoke、 高级/安全环境变量、serverless 差异和 Docker Hub 发布前门禁说明；`test/docker-packaging.test.js` 补 README/engines 断言；专项 16 tests 全通过，`npm run build && npm test` 全量 197 tests，197 pass，0 fail；当前阶段推进到 P3.4 文档状态去陈旧化。
- 2026-04-28 16:03 CST：P3.4 完成旧追踪文档去陈旧化：`docs/p0-p3-tracking.md` 顶部改为归档并链接本文档，总览 P3 改为已完成，风险备忘拆为已关闭/仍需复查/新发现；专项 `node --test test/docker-packaging.test.js test/cloud-deploy.test.js` 通过 16 tests，16 pass，0 fail；当前阶段推进到 P3.5 模块化。
- 2026-04-28 16:06 CST：P3.5 首批模块化核心实现与专项验证完成：新增 `frontend/ui-actions.js`，将动态按钮与图标按钮创建、删除确认入口从 `app.js` 抽出；历史操作按钮和账号编辑/删除图标按钮已迁移；专项 `node --check app.js frontend/ui-actions.js && node --test test/frontend-modules.test.js test/history-ui.test.js test/history-regenerate-ui.test.js test/accessibility-ui.test.js` 通过 9 tests，9 pass，0 fail；下一步运行全量验证。
- 2026-04-28 16:08 CST：P3.5 全量验收完成：`npm run build` 成功，`npm test` 通过，全量 197 tests，197 pass，0 fail；当前阶段推进到 P3.6 统一确认弹窗、错误摘要和 reduced motion。
- 2026-04-28 16:11 CST：P3.6 核心实现与专项验证完成：`showError()` 同步页面内持久错误摘要；平台操作成功反馈去掉原生 `alert()`；删除/清理/模板确认统一走 `confirmAction()` 入口；CSS 补 `prefers-reduced-motion: reduce`；专项 `node --check app.js frontend/error-dialog.js frontend/ui-actions.js && node --test test/accessibility-ui.test.js test/frontend-modules.test.js test/history-ui.test.js test/settings-ui.test.js` 通过 20 tests，20 pass，0 fail；下一步运行全量验证。
- 2026-04-28 16:14 CST：P3.6 全量验收完成：`npm run build` 成功，`npm test` 通过，全量 198 tests，198 pass，0 fail；当前阶段推进到 P3.7 产品增强路线。
- 2026-04-28 16:17 CST：P3.7 产品增强路线完成：新增 `docs/p4-product-roadmap.md` 和 `test/product-roadmap.test.js`，README 补产品路线入口；专项 `node --test test/product-roadmap.test.js test/docker-packaging.test.js` 通过 8 tests，8 pass，0 fail；`npm run build && npm test` 全量 200 tests，200 pass，0 fail；P3 阶段完成，P3.2 真实浏览器 E2E 延后为下一轮独立工程增强。

---

## 4. 本轮审查关键证据索引

- Docker 缺前端模块：`Dockerfile:10-12`、`app.js:12-36`、`scripts/build-static.js:7-20`。
- 服务端 `cfg.apiUrl` 未统一校验：`server.js:903-906`、`server.js:1250`、`server.js:1302`、`prompt-enhancement.js:79`、`prompt-enhancement.js:91`。
- 路由 decode 和 async 兜底不足：`server.js:1862-1932`。
- Serverless proxy 缺限制：`api/proxy.js:47-65`、`netlify/functions/proxy.js:50-55`。
- OAuth session 写入和敏感结果落盘：`server.js:207-231`、`server.js:292-294`、`server.js:594-599`。
- 远程图片下载重定向风险：`image-storage.js:229-292`。
- Netlify OAuth 限制不一致：`netlify/functions/oauth-images.js:17-23`。
- EdgeOne check 疑似写操作：`handlers/edgeone-handler.js:27-30`。
- 前端可访问性候选：`style.css:211`、`index.html:497`、`index.html:501-506`、`index.html:588-614`、`index.html:618`、`index.html:651`、`index.html:665`。
- 设置保存和 masked deploy 字段：`app.js:848-887`、`app.js:962-975`。
- OAuth 轮询去重：`app.js:2285-2343`。
- 历史诊断 `innerHTML`：`app.js:986-1010`。
