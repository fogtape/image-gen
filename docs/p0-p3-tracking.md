# image-gen P0-P3 改进追踪文档

> 适用项目：`/data/data/com.termux/files/home/image-gen`
> 创建日期：2026-04-28（Asia/Shanghai）
> 当前阶段：旧版 P0-P3 已完成归档；最新审查与修复继续追踪见 `docs/audit-p0-p3-tracking-2026-04-28.md`
> 维护规则：**每完成一个小步，必须立刻更新本文档对应状态、完成时间、证据和验证命令结果**，避免遗漏。

> 归档更新：2026-04-28 16:03 CST。本文保留 2026-04-28 08:35-13:23 第一轮 P0-P3 追踪记录；不要再把顶部状态理解为当前正在进行的任务。当前仍在落地的 P3.4+ 项目，以 `docs/audit-p0-p3-tracking-2026-04-28.md` 为准。

---

## 0. 状态约定与实时更新规则

### 状态标记

- `⬜ 未开始`：尚未动手。
- `🟡 进行中`：正在实现或验证。
- `✅ 已完成`：代码、测试、文档均满足完成标准。
- `🔴 阻塞`：需要外部信息、凭据、平台权限或设计决策。
- `🟣 延后`：确认不在当前批次处理。

### 每完成一个小步必须更新的字段

每个小步都保留以下字段：

- **状态**：从 `⬜` 改成 `🟡` 或 `✅`。
- **完成时间**：填写具体日期时间，例如 `2026-04-28 16:20 CST`。
- **变更证据**：列出关键文件和行号，或 commit/hash/测试输出摘要。
- **验证结果**：写明运行的命令和通过/失败结果。
- **后续影响**：如果影响其他步骤，写到“关联/后续”。

### 推荐推进顺序

1. P0：安全封口，先防止泄露、越权和开放代理。
2. P1：测试、部署、文档一致性。
3. P2：存储和后台任务可靠性。
4. P3：产品体验和高级功能。

### 全局验收底线

任一阶段合并前至少满足：

```bash
npm test
npm run build
```

如果后续引入 lint/typecheck，也要加入阶段验收命令。

---

## 1. 总览看板

| 优先级 | 主题 | 状态 | 当前目标 | 阶段完成判断 |
|---|---|---:|---|---|
| P0 | 安全封口 | ✅ 已完成 | P0.1-P0.9 已完成 | P0 安全测试、`npm run build`、`npm test` 通过 |
| P1 | 测试和部署修复 | ✅ 已完成 | P1.1-P1.7 已完成 | 测试稳定，不依赖临时脚本；部署能力矩阵清楚 |
| P2 | 存储和任务可靠性 | ✅ 已完成 | P2.1-P2.7 已完成 | 并发、失败、取消、超时和 scope 测试通过 |
| P3 | 产品功能升级 | ✅ 已完成 | P3.1-P3.10 已完成并归档 | 用户侧功能可用，有 UI 和测试覆盖 |

---

# P0：安全封口

目标：项目可以较安全地自托管；即使误暴露到局域网/公网，也不会默认泄露配置、开放代理、任意读文件或无认证修改配置。

阶段完成判断：

- `/api/config/runtime` 不返回任何原始敏感字段。
- 所有写配置、平台操作、清理数据接口都有后端鉴权。
- 静态文件服务不能读取项目源码、配置、隐藏文件和项目外路径。
- `/api/proxy` 不再是任意 URL 代理。
- 超大请求体/参考图会返回明确错误。
- 安全行为测试覆盖上述路径。
- `npm test`、`npm run build` 通过。

## P0.1 配置 runtime 接口脱敏

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 09:01 CST
- **目标**：普通前端启动只能读取脱敏公开配置，不能拿到 `adminToken`、`deploy.apiToken`、真实平台 token 等敏感值。
- **推荐实现**：
  1. 修改 `server.js` 的 `handleConfigRuntime()`。
  2. 默认返回 `configService.getRuntimeConfig()` 或 `getEditableRuntimeConfig()` 的脱敏结构，而不是 `getResolvedConfig()`。
  3. 如果前端确实需要编辑态，新增受 admin token 保护的接口，例如 `GET /api/config/editable`。
  4. 前端 `fetchServerRuntimeConfig()` 只依赖公开字段；保存配置时用已有表单值和 preserve secret 机制处理。
- **完成判断**：
  - 响应 JSON 中不包含 `adminToken`。
  - 响应 JSON 中不包含 `deploy.apiToken` 原文。
  - 响应 JSON 中不包含真实 deploy token，只能出现 `apiTokenConfigured: true/false`。
  - 前端设置页仍能显示“已配置/未配置”状态。
- **验证命令**：
  ```bash
  node --test test/config-runtime-security.test.js test/config-runtime-settings.test.js
  node --test test/*.js
  npm run build
  npm test
  ```
- **变更证据**：
  - `server.js:1204`：`/api/config/runtime` 改为返回公开 runtime 与 meta，不再返回 resolved config / editable。
  - `server.js:1220`、`server.js:1342`：新增受 `requireConfigAdmin()` 保护的 `GET /api/config/editable`。
  - `config-service.js:289`、`config-service.js:291`：公开配置增加 `accountIdConfigured`、`projectIdConfigured`，只暴露配置状态。
  - `config-service.js:431`、`config-service.js:434`、`config-service.js:437`：保存配置时对 deploy account/project/token 采用缺省保留，避免空表单覆盖旧 secret。
  - `app.js:189`、`app.js:2248`：设置页只有存在本地 admin token 时才读取 editable 配置。
  - `test/config-runtime-security.test.js:4`：新增真实 HTTP 行为测试，覆盖 runtime 脱敏和敏感字段不泄露。
  - 顺手修复全量 `test/*.js` 的旧失败：`app.js:1724` 将 404 纳入后台任务不可用回退；`style.css:493` 与 `style.css:502` 保证 `.btn-send` 布局测试稳定。
- **验证结果**：
  - `node --test test/config-runtime-security.test.js test/config-runtime-settings.test.js`：4 tests，4 pass，0 fail。
  - `node --test test/*.js`：100 tests，100 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
  - `npm test`：仍失败 4 个根目录手工脚本（`test-auth-check.js`、`test-generate.js`、`test-image-routes-compact.js`、`test-image-routes.js` 依赖缺失的 `.tmp_test_base_url`），归入 `P1.1` 处理，不影响 P0.1 脱敏行为。
- **关联/后续**：P0.2 管理鉴权会复用该接口划分；P1.1 需要修正 `npm test` 入口。

## P0.2 管理接口强制鉴权

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 09:06 CST
- **目标**：写配置、同步平台、触发部署、清理服务端数据不能默认裸奔。
- **推荐实现**：
  1. 修改 `config-service.js` 的 `verifyAdminToken()`。
  2. 默认无 `IMAGE_GEN_ADMIN_TOKEN` 时拒绝管理操作。
  3. 如果需要本地开发免鉴权，增加显式环境变量：`IMAGE_GEN_ALLOW_INSECURE_LOCAL_ADMIN=true`。
  4. 本地免鉴权只允许 `127.0.0.1` / `::1` 请求。
  5. 给所有管理失败返回统一 `401` 或 `403`。
- **完成判断**：
  - 未配置 admin token 时默认拒绝；仅 `IMAGE_GEN_ALLOW_INSECURE_LOCAL_ADMIN=true` 且本机请求可免鉴权。
  - 配置正确 admin token 时保存成功。
  - token 错误时拒绝。
  - 响应不回显 token。
- **验证命令**：
  ```bash
  node --test test/config-admin-security.test.js test/config-runtime-security.test.js test/config-runtime-settings.test.js
  node --test test/*.js
  npm run build
  npm test
  ```
- **变更证据**：
  - `config-service.js:122`：新增 `safeEqualString()`，已配置 admin token 时用 `crypto.timingSafeEqual()` 比对。
  - `config-service.js:460`：`verifyAdminToken()` 默认不再因 Node/非 serverless 自动放行；只有显式 `IMAGE_GEN_ALLOW_INSECURE_LOCAL_ADMIN=true` 且本机请求才允许无 token。
  - `server.js:1194`、`server.js:1202`：新增 remote address 归一化和本机请求判断，不信任可伪造 header。
  - `server.js:1209`：`requireConfigAdmin()` 将本机判断传入配置服务；失败统一返回 `401` 与通用错误文案。
  - `test/config-admin-security.test.js:17`：覆盖无 token 默认拒绝、本机开发开关仅本机可用、serverless 无 token 不放行。
  - `test/config-admin-security.test.js:34`：覆盖 `/api/config/save` 无 token/错 token 拒绝、正确 token 成功且响应不回显 token。
- **验证结果**：
  - `node --test test/config-admin-security.test.js test/config-runtime-security.test.js test/config-runtime-settings.test.js`：6 tests，6 pass，0 fail。
  - `node --test test/*.js`：102 tests，102 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
  - `npm test`：仍失败 4 个根目录手工脚本入口，归入 `P1.1`；P0.2 相关行为测试已通过。
- **关联/后续**：P0.6 存储清理接口也要接入同一套鉴权。

## P0.3 静态文件服务改为安全白名单/静态根目录

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 09:09 CST
- **目标**：静态服务只能返回前端资源，不能读取源码、配置、隐藏文件、数据目录或项目外文件。
- **推荐实现**：
  1. 优先方案：Node 服务也只从 `dist/` 提供静态资源。
  2. `npm run build` 生成 `dist/index.html`、`dist/app.js`、`dist/style.css`、`dist/ui-feedback.js`。
  3. `serveStatic()` 使用 `new URL(req.url, base).pathname`。
  4. `decodeURIComponent` 后做 `path.resolve(staticRoot, '.' + pathname)`。
  5. 校验最终路径必须以 `staticRoot + path.sep` 开头，或等于 `staticRoot/index.html`。
  6. 增加 denylist：dotfile、`config/`、`data/`、`api/`、`handlers/`、`server.js`、`.oauth-sessions.json`。
- **完成判断**：
  - `/` 返回首页。
  - `/app.js`、`/style.css` 正常返回。
  - `/server.js` 返回 403/404。
  - `/config/.env` 返回 403/404。
  - `/.oauth-sessions.json` 返回 403/404。
  - `/../...`、`/%2e%2e/...` 返回 403/404。
- **验证命令**：
  ```bash
  node --test test/static-security.test.js test/config-admin-security.test.js test/config-runtime-security.test.js
  node --test test/*.js
  npm run build
  npm test
  ```
- **变更证据**：
  - `server.js:29`：新增 `STATIC_ROOT`，默认只从 `dist/` 服务静态资源，可用 `IMAGE_GEN_STATIC_DIR` 显式覆盖。
  - `server.js:58`、`server.js:59`：新增静态服务 denylist，覆盖敏感目录、源码入口、配置/会话文件。
  - `server.js:277`：重写 `serveStatic()`，使用 `new URL()`、`decodeURIComponent()`、`path.resolve()` 和 static root 边界校验。
  - `server.js:296`、`server.js:297`：阻断路径穿越和项目外读取。
  - `test/static-security.test.js:12`：新增真实 HTTP 行为测试，覆盖首页/静态资源可读，源码、配置、隐藏文件、`%2e%2e` 穿越不可读。
- **验证结果**：
  - `node --test test/static-security.test.js test/config-admin-security.test.js test/config-runtime-security.test.js`：4 tests，4 pass，0 fail。
  - `node --test test/*.js`：103 tests，103 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
  - `npm test`：仍失败 4 个根目录手工脚本入口，归入 `P1.1`；P0.3 相关行为测试已通过。
- **关联/后续**：P1.5 Docker 构建也应统一使用 `dist/`；Node 本地开发需先执行 `npm run build` 或提供 `IMAGE_GEN_STATIC_DIR`。

## P0.4 代理接口从任意 URL 改成受控代理

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 09:19 CST
- **目标**：`/api/proxy` 只能访问允许的 OpenAI 兼容 API 地址和路径，不能访问内网、本机、metadata 或任意第三方 URL。
- **推荐实现**：
  1. 新增 `proxy-policy.js` 或 `server/proxy-policy.js`。
  2. 只允许 `https:`，开发模式可显式允许 `http://127.0.0.1`。
  3. 默认允许 host：`api.openai.com` 和用户当前账号配置的 API host。
  4. 路径白名单：
     - `/v1/images/generations`
     - `/v1/images/edits`
     - `/v1/responses`
     - `/v1/chat/completions`
     - `/v1/models`（仅测试连接）
  5. 拒绝私网、本机、link-local、metadata IP。
  6. 过滤危险 header：`host`、`connection`、`cookie`、`x-forwarded-*` 等。
  7. 加上游超时和响应大小限制。
- **完成判断**：
  - 允许正常图片 API 请求。
  - 拒绝 `http://127.0.0.1:*`。
  - 拒绝 `http://169.254.169.254/...`。
  - 拒绝非白名单路径。
  - 拒绝非 http/https 协议。
  - 不透传危险 header。
- **验证命令**：
  ```bash
  npm test
  npm run build
  ```
- **变更证据**：
  - `proxy-policy.js:92`、`proxy-policy.js:116`：新增统一代理策略，限制 allowed host、method、protocol、路径和私网/本机目标。
  - `proxy-policy.js:103`：过滤 `host`、`connection`、`cookie`、`x-forwarded-*` 等危险 header。
  - `server.js:327`、`server.js:348`、`server.js:359`：Node `/api/proxy` 接入策略校验和 header 清理。
  - `server.js:40`、`server.js:378`：Node 代理增加上游超时与响应大小限制。
  - `api/proxy.js:23`、`netlify/functions/proxy.js:20`：Vercel/Netlify 代理入口复用同一策略，避免 serverless 平台继续开放代理。
  - `test/proxy-security.test.js:10`：覆盖协议、host、路径、method、私网目标、危险 header 清理。
  - `test/proxy-security.test.js:37`：覆盖 Node `/api/proxy` 默认拒绝本机目标；显式本机开发开关下允许本机并过滤危险 header。
- **验证结果**：
  - `npm test`：106 tests，106 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
- **关联/后续**：P1.4 继续统一平台能力矩阵；若用户需要第三方兼容 API 走代理，应通过 `IMAGE_GEN_PROXY_ALLOWED_HOSTS` 显式加入 host。

## P0.5 请求体和参考图大小限制

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 09:24 CST
- **目标**：避免超大 JSON/base64 图片导致内存暴涨或服务卡死。
- **推荐实现**：
  1. 新增通用 `readJsonBody(req, res, { limitBytes })`。
  2. 默认 JSON body 限制：`10MB`。
  3. 图片任务 body 限制：`30MB`。
  4. 单张参考图限制：`8MB`。
  5. 参考图总量限制：`24MB`。
  6. 超限统一返回 `413 Payload Too Large`，错误信息保持中文可读。
  7. 前端上传时也提前检测并提示，但以后端限制为准。
- **完成判断**：
  - 超大 JSON 请求返回 413。
  - 超大参考图返回 413。
  - 正常小图仍可生成。
  - 错误响应不包含敏感 payload。
- **验证命令**：
  ```bash
  node --test test/request-limits.test.js test/reference-images.test.js test/proxy-security.test.js
  npm test
  npm run build
  ```
- **变更证据**：
  - `server.js:42`：新增 JSON body、图片任务 body、单图和总参考图大小上限，均支持环境变量覆盖并带安全上下界。
  - `server.js:657`：`readRequestText()` 在 `Content-Length` 和流式读取阶段都执行大小限制，超限返回 `413`。
  - `server.js:703`、`server.js:709`、`server.js:717`：新增 base64 解码字节估算、单图/总图限制、嵌套 data image 收集。
  - `server.js:752`、`server.js:783`、`server.js:1220`：OAuth 普通/流式入口和后台 runner 都在进入上游前校验参考图大小。
  - `server.js:919`、`server.js:957`、`server.js:992`：multipart、proxy multipart 和 `normalizeRefImages()` 统一触发单图/总量限制。
  - `request-limits.js:1`：抽出 serverless proxy 可复用的请求图片大小限制工具。
  - `api/proxy.js:7`、`netlify/functions/proxy.js:7`：Vercel/Netlify 代理入口也阻断超大 data image/multipart image。
  - `app.js:21`、`app.js:2129`、`app.js:2364`：前端上传前按单张 8MB、总计 24MB 预检，超限不读取 base64。
  - `test/request-limits.test.js:32`：新增真实 HTTP 行为测试，覆盖超大 JSON、超大参考图、proxy JSON data image、proxy multipart image 返回 `413`，以及小请求仍能通过代理。
  - `test/reference-images.test.js:10`：补充前端上传预检断言。
- **验证结果**：
  - `node --test test/request-limits.test.js test/reference-images.test.js test/proxy-security.test.js`：7 tests，7 pass，0 fail。
  - `npm test`：107 tests，107 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
- **关联/后续**：P2.3 URL 下载也需要大小限制；P1.6 仍需统一 Netlify/Vercel multipart 能力或明确降级。

## P0.6 存储清理接口加鉴权

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 09:27 CST
- **目标**：`/api/storage/clear` 不能被任意网页或未授权用户触发删除。
- **推荐实现**：
  1. 复用 P0.2 的 `requireConfigAdmin()` 或拆成 `requireAdmin()`。
  2. `GET /api/storage` 可以保留公开或脱敏；`POST /api/storage/clear` 必须鉴权。
  3. 前端清理按钮自动带 `X-Image-Gen-Admin-Token`。
  4. 未配置/错误 token 时给清晰提示。
- **完成判断**：
  - 无 token 清理返回 401/403。
  - 错 token 清理返回 401/403。
  - 正确 token 清理成功。
  - 前端设置页清理功能可用。
- **验证命令**：
  ```bash
  node --test test/storage-security.test.js test/config-admin-security.test.js test/settings-ui.test.js
  npm test
  npm run build
  ```
- **变更证据**：
  - `server.js:1339`：`handleStorageClear()` 读取 body 后复用 `requireConfigAdmin()`，无 token/错 token 直接返回 `401`，不会执行清理。
  - `app.js:585`：`clearStorageData('conversations')` 只清本地对话/UI，不再调用服务端清理接口。
  - `app.js:593`：清理图片/全部数据时使用 `getConfigRequestHeaders()`，自动带 `X-Image-Gen-Admin-Token`。
  - `test/storage-security.test.js:29`：新增真实 HTTP 行为测试，覆盖无 token、错 token 不删除文件，正确 token 才删除。
  - `test/settings-ui.test.js:50`：补充前端清理逻辑会走 admin header、对话清理本地返回的断言。
- **验证结果**：
  - `node --test test/storage-security.test.js test/config-admin-security.test.js test/settings-ui.test.js`：11 tests，11 pass，0 fail。
  - `npm test`：108 tests，108 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
- **关联/后续**：P2.1 图片索引改造后继续复用该接口；如未来增加服务端会话存储，应单独设计受控清理 scope。

## P0.7 OAuth session/status 降低抢读风险

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 09:30 CST
- **目标**：OAuth 登录结果只能由持有 `sessionId` 的发起方读取，降低 state 泄露后 token 被抢读的风险。
- **推荐实现**：
  1. `/api/oauth/status/:key` 只允许 sessionId 查询成功结果。
  2. state 只能用于 loopback 回调内部定位 session，不用于公开 status 查询。
  3. 成功结果读取一次后立即删除。
  4. 如继续支持 serverless stateless session，要增加签名 HMAC，避免纯 base64 payload 可伪造。
- **完成判断**：
  - 用 state 查询 status 不返回 token result。
  - 用 sessionId 查询成功后删除 session。
  - 过期 session 返回 404。
  - 测试不回显 token。
- **验证命令**：
  ```bash
  node --test test/oauth-session-store.test.js test/oauth-flow.test.js test/oauth-connection-ui.test.js
  npm test
  npm run build
  ```
- **变更证据**：
  - `server.js:110`：新增 OAuth stateless session 签名 secret 解析，优先 `IMAGE_GEN_OAUTH_SESSION_SECRET` / `IMAGE_GEN_ADMIN_TOKEN`。
  - `server.js:118`、`server.js:122`：新增 HMAC 签名与 timing-safe 字符串比较。
  - `server.js:129`：`makeStatelessOAuthSessionId()` 从纯 base64 改为 `payload.signature` 格式。
  - `server.js:140`：`getOAuthSessionFromStatelessId()` 校验签名后才解析 PKCE payload，篡改签名直接无效。
  - `server.js:541`：`handleOAuthStatus()` 不再通过 `getOAuthSessionByState()` 解析公开 status 查询；state 仅保留给 loopback/exchange 内部定位 session。
  - `test/oauth-session-store.test.js:51`：覆盖 stateless session 签名格式和坏签名拒绝。
  - `test/oauth-session-store.test.js:71`：新增真实 HTTP 行为测试，验证 state 查询返回 404 且不泄露 token，sessionId 查询成功后删除 session。
- **验证结果**：
  - `node --test test/oauth-session-store.test.js test/oauth-flow.test.js test/oauth-connection-ui.test.js`：15 tests，15 pass，0 fail。
  - `npm test`：109 tests，109 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
- **关联/后续**：P1.3 Vercel serverless OAuth 兼容性要同步验证；部署时建议显式设置 `IMAGE_GEN_OAUTH_SESSION_SECRET`。

## P0.8 OAuth loopback HTML escape

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 09:33 CST
- **目标**：loopback 错误页面不能把上游错误原样拼进 HTML。
- **推荐实现**：
  1. 新增 `escapeHtml()`。
  2. 所有 loopback HTML 中的动态错误文本都 escape。
  3. 更推荐错误页只显示固定文案，详细错误返回前端 JSON。
- **完成判断**：
  - 构造包含 `<script>` 的错误文本不会作为 HTML 执行。
  - 测试覆盖 escape 行为。
- **验证命令**：
  ```bash
  node --test test/oauth-loopback-security.test.js test/oauth-session-store.test.js test/oauth-flow.test.js
  npm test
  npm run build
  ```
- **变更证据**：
  - `server.js:271`、`server.js:281`、`server.js:287`：loopback 成功/失败页面统一通过 `renderOAuthLoopbackPage()` 输出。
  - `server.js:308`：新增 `escapeHtml()`，覆盖 `& < > " '` 五类 HTML 特殊字符。
  - `server.js:319`：新增 `renderOAuthLoopbackPage()`，动态 title/message 均先 escape。
  - `test/oauth-loopback-security.test.js:5`：新增转义行为测试，验证 `<script>` 不会以原始 HTML 出现在错误页。
- **验证结果**：
  - `node --test test/oauth-loopback-security.test.js test/oauth-session-store.test.js test/oauth-flow.test.js`：10 tests，10 pass，0 fail。
  - `npm test`：110 tests，110 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
- **关联/后续**：无。

## P0.9 P0 阶段总验收

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 09:35 CST
- **目标**：确认 P0 所有安全封口完成，并记录验收结果。
- **完成判断**：
  - P0.1 到 P0.8 均为 `✅ 已完成` 或有明确延后理由。
  - 新增安全测试全部通过。
  - 全量测试和构建通过。
- **验证命令**：
  ```bash
  npm run build
  npm test
  ```
- **变更证据**：
  - `P0.1` 到 `P0.8` 均已标记 `✅ 已完成`。
  - 新增/更新安全测试覆盖配置脱敏、管理鉴权、静态服务、代理限制、请求/参考图大小限制、存储清理鉴权、OAuth status 抢读、loopback HTML escape。
  - 全量 `npm run build && npm test` 已重新通过。
- **验证结果**：
  - `npm run build`：通过，`Static build written to dist/`。
  - `npm test`：110 tests，110 pass，0 fail。
- **阶段结论**：P0 安全封口完成。项目默认暴露面已显著收窄；后续转入 `P1` 修平台 handler、部署能力矩阵与 Docker 打包敏感配置问题。

---

# P1：测试和部署修复

目标：测试稳定、部署说明和实际能力一致，不再出现“文档说支持，实际路由/函数缺失”的情况。

阶段完成判断：

- `npm test` 不再执行根目录手工脚本。
- 现有失败测试修复。
- 平台 handler 正确读取配置。
- README 有真实平台能力矩阵。
- Docker 构建不携带本地敏感配置。
- 各平台降级逻辑清楚。

## P1.1 修正测试入口和手工脚本位置

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 09:11 CST
- **目标**：`npm test` 只运行正式自动化测试，不运行依赖临时凭据的手工脚本。
- **推荐实现**：
  1. 将 `package.json` 的 test 改为 `node --test test/*.js`。
  2. 把根目录 `test-generate.js`、`test-auth-check.js`、`test-image-routes*.js` 移到 `scripts/manual/`。
  3. 手工脚本重命名为不匹配 test runner 的名字，例如 `manual-generate.mjs`。
  4. README 增加“手工连通性测试”说明，不读取/打印敏感 key。
- **完成判断**：
  - 缺少 `.tmp_test_base_url` 时 `npm test` 不失败。
  - 手工脚本仍可按文档手动运行。
- **验证命令**：
  ```bash
  npm test
  npm run build
  node --test test/*.js api/oauth/test.js
  ```
- **变更证据**：
  - `package.json:10`：`npm test` 改为只运行 `test/*.js` 和 `api/oauth/test.js`。
  - `scripts/manual/auth-check.mjs`、`scripts/manual/generate-image.mjs`、`scripts/manual/image-routes.mjs`、`scripts/manual/image-routes-compact.mjs`：手工连通性脚本移出根目录并去掉 `test-*` 文件名。
  - `README.md:48`、`README.md:52`：本地运行文档补充先 `npm run build`，说明 Node 静态根变更。
  - `README.md:72`、`README.md:77`：新增自动化测试与手工连通性测试说明，明确 `.tmp_*` 临时文件不可提交/公开。
- **验证结果**：
  - `npm test`：104 tests，104 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
  - `node --test test/*.js api/oauth/test.js`：104 tests，104 pass，0 fail。
- **关联/后续**：P1.2 可继续降低源码正则脆弱性。

## P1.2 修复当前失败测试并降低源码正则脆弱性

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 09:13 CST
- **目标**：消除当前 `cloud-deploy.test.js` 和 `css-layout.test.js` 的失败，并逐步减少只看源码文本的断言。
- **推荐实现**：
  1. `cloud-deploy.test.js` 改成行为或更稳定的函数级测试。
  2. `css-layout.test.js` 避免只匹配第一段 `.btn-send`，改成解析最终规则或调整 CSS 合并重复 selector。
  3. 对安全相关测试优先改成真实 request/response 测试。
- **完成判断**：
  - `node --test test/*.js` 通过。
  - `npm test` 通过。
  - 没有为了过测试而保留无意义注释/正则占位。
- **验证命令**：
  ```bash
  npm test
  npm run build
  ```
- **变更证据**：
  - `app.js:1724`：后台任务不可用判断纳入 `HTTP 404`，满足静态/无后台任务部署回退路径。
  - `style.css:491`：保留单一完整 `.btn-send` 规则，避免第一段短规则干扰布局断言。
  - `test/background-job-ui-state.test.js:12`：把 `.btn-send` 断言从精确单行源码匹配改成验证真实规则内存在 `flex-shrink: 0`。
  - `test/cloud-deploy.test.js:72`：现有 404 回退断言已由 `app.js:1724` 的实际逻辑满足。
- **验证结果**：
  - `npm test`：104 tests，104 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
- **关联/后续**：P0 安全测试已优先采用真实 HTTP 行为测试；后续继续减少源码正则测试。

## P1.3 修复平台 handler 配置读取和 autoSync/autoRedeploy

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 09:54 CST
- **目标**：平台操作拿到正确的 deploy 配置，保存配置后的自动同步/部署按预期执行。
- **推荐实现**：
  1. `BaseHandler.getDeployConfig()` 读取 `runtime.config.deploy` 或 `configService.getResolvedConfig().deploy`。
  2. `handleConfigSave()` 不把 `setRuntimeConfig()` 返回的包装对象当 resolved config。
  3. 平台操作传入显式 resolved config，避免包装层混淆。
  4. 增加 mock fetch 测试 Vercel/Netlify/Cloudflare/EdgeOne 参数读取。
- **完成判断**：
  - 设置 deploy 字段后，handler 能读取 projectId/apiToken 配置状态。
  - autoSync 为 true 时确实调用 sync。
  - autoRedeploy 为 true 时确实调用 deploy。
- **验证命令**：
  ```bash
  npm test -- test/config-runtime-settings.test.js test/cloud-deploy.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 09:46 CST：开始排查 `handlers/base-handler.js`、`server.js` 平台 handler 配置来源，目标是让平台操作使用 resolved config 而不是公开脱敏 runtime wrapper。
  - 2026-04-28 09:48 CST：完成配置来源修复小步；`handlers/base-handler.js:19` 兼容 wrapper/直接 config，并在无显式 resolver 时优先读取 `getResolvedConfig()`；`server.js:93`、`server.js:97` 给平台 handler 传入 resolved resolver；`server.js:1523`、`server.js:1540`、`server.js:1557` 平台 check/sync/deploy 保存配置后改用 resolved platform。
  - 2026-04-28 09:51 CST：完成 P1.3 行为测试小步；`test/platform-handler-config.test.js:28` 覆盖 handler 默认读取 resolved deploy 而非公开脱敏 runtime；`test/platform-handler-config.test.js:57` 覆盖 `/api/config/save` 的 autoSync/autoRedeploy、`/api/config/platform/check` 不返回 token preview、`/api/config/platform/sync` 保留旧 token；`handlers/vercel-handler.js:49`、`handlers/netlify-handler.js:33`、`handlers/cloudflare-handler.js:34`、`handlers/edgeone-handler.js:30` 将 check 结果改为 `apiTokenConfigured`，不回显 token preview。
- **验证结果**：
  - `node --test test/platform-handler-config.test.js`：2 tests，2 pass，0 fail。
  - `node --test test/platform-handler-config.test.js test/config-runtime-settings.test.js test/cloud-deploy.test.js`：14 tests，14 pass，0 fail。
  - `npm test`：112 tests，112 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
- **关联/后续**：P1.4 平台能力矩阵依赖这里的真实能力。

## P1.4 梳理并统一平台能力矩阵

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 10:01 CST
- **目标**：README 清楚说明每个平台支持哪些能力，避免用户误判。
- **推荐实现**：
  1. 增加平台能力矩阵：Node、Docker、Vercel、Netlify、Cloudflare Pages、EdgeOne Pages。
  2. 标注：生图、后台任务、OAuth、持久化存储、配置保存、平台同步/重部署。
  3. 对 Cloudflare/EdgeOne 明确是静态/直连还是完整后端。
  4. 对 Netlify 明确哪些 API 已实现，哪些缺失。
- **完成判断**：
  - README 中存在能力矩阵。
  - 每个平台的限制和降级路径清楚。
  - 与实际路由/部署配置一致。
- **验证命令**：
  ```bash
  npm test -- test/cloud-deploy.test.js
  ```
- **变更证据**：
  - 2026-04-28 09:55 CST：开始梳理 README 与实际路由/部署配置，目标是补齐 Node、Docker、Vercel、Netlify、Cloudflare Pages、EdgeOne Pages 的能力矩阵和降级说明。
  - 2026-04-28 10:00 CST：完成 README 能力矩阵小步；`README.md:31` 加入目录入口；`README.md:278` 新增平台能力矩阵，覆盖静态页面、浏览器直连、`/api/proxy`、OAuth 后端、后台任务、图片持久化、服务端配置保存、平台同步/重部署；`README.md:605` 将 autoSync/autoRedeploy 文案改成当前已实现行为；`test/cloud-deploy.test.js:105` 新增文档一致性测试。
- **验证结果**：
  - `node --test test/cloud-deploy.test.js`：10 tests，10 pass，0 fail。
  - `npm test`：113 tests，113 pass，0 fail。
- **关联/后续**：P3 用户功能文档也需要基于该矩阵。

## P1.5 Docker 构建不携带本地运行时配置

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 10:05 CST
- **目标**：镜像里不打包本地敏感配置，运行时通过环境变量或 volume 注入。
- **推荐实现**：
  1. `.dockerignore` 明确排除 `config/.env`、`config/*.local`、`data/`、`.oauth-sessions.json`。
  2. Dockerfile 只复制 `config/.env.example` 或启动时自动生成 example。
  3. README 说明 Docker Compose volume 和环境变量方式。
  4. 增加测试检查 Dockerfile 不复制敏感 env。
- **完成判断**：
  - 构建上下文不会包含 `config/.env`。
  - 镜像仍可启动。
  - Docker Compose 挂载配置仍可用。
- **验证命令**：
  ```bash
  npm test -- test/docker-packaging.test.js
  docker build -t image-gen:test .
  ```
- **变更证据**：
  - 2026-04-28 10:02 CST：开始检查 Dockerfile、`.dockerignore`、`docker-compose.yml` 和 `test/docker-packaging.test.js`，目标是镜像构建不复制本地 `config/.env` / `data/` / OAuth session 等运行态产物。
  - 2026-04-28 10:04 CST：完成 Docker 构建隔离小步；`Dockerfile:10` 先构建 `dist/`，`Dockerfile:14` 补齐运行依赖 `proxy-policy.js`、`request-limits.js`，`Dockerfile:18` 只复制 `config/.env.example`；`.dockerignore:10` 排除 `config/.env`、本地数据、OAuth session、临时文件、日志和旧 `dist/`；`README.md:242` 补充镜像不打包本地运行态配置说明；`test/docker-packaging.test.js:20` 增加防回归测试。
- **验证结果**：
  - `node --test test/docker-packaging.test.js`：2 tests，2 pass，0 fail。
  - `npm test`：114 tests，114 pass，0 fail。
  - `docker build -t image-gen:test .`：当前 Termux 环境未安装 docker（`command -v docker` 无输出），未执行真实镜像构建；已用 Dockerfile / `.dockerignore` 静态测试兜底。
- **关联/后续**：P0.1 配置脱敏共同降低泄露风险。

## P1.6 统一 Vercel/Netlify 代理能力或明确降级

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 10:12 CST
- **目标**：不同平台的 `/api/proxy` 行为不要悄悄不一致。
- **推荐实现**：
  1. 抽出共享代理逻辑，Node/Vercel/Netlify 复用。
  2. 如果 Netlify 无法支持同等 SSE/multipart，README 和前端能力检测要明确降级。
  3. 前端根据 `/api/config/runtime` capabilities 决定是否显示/启用后台任务、代理、存储。
- **完成判断**：
  - Node 和 Vercel 代理行为一致。
  - Netlify 差异有明确测试和文档。
  - 前端不会误以为平台支持缺失 API。
- **验证命令**：
  ```bash
  npm test -- test/compatibility-routing.test.js test/cloud-deploy.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 10:06 CST：开始对齐代理能力和前端降级；目标是 runtime capabilities 明确 JSON/SSE/multipart 代理、后台任务、图片持久化能力，并让前端在 serverless 不支持 multipart proxy 时给出清晰提示。
  - 2026-04-28 10:10 CST：完成能力声明和前端降级小步；`config-service.js:374` 扩展 runtime capabilities（proxy、SSE、multipart、后台任务、图片持久化、storage API）；`app.js:58` 保存 `serverCapabilities`，`app.js:215` 增加能力读取 helper，`app.js:706` 在不支持 multipart proxy 的部署形态给清晰错误，`app.js:1784` 根据 `canPersistImages` 决定后台任务存储开关；`README.md:647` 明确 Node/Docker、Vercel、Netlify 代理能力差异；`test/proxy-security.test.js:101` 增加 Vercel/Netlify 代理共用策略和 multipart 降级测试。
- **验证结果**：
  - `node --test test/config-runtime-security.test.js test/config-runtime-settings.test.js test/compatibility-routing.test.js test/proxy-security.test.js`：11 tests，11 pass，0 fail。
  - `npm test`：115 tests，115 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
- **关联/后续**：P3 产品功能要读取 capabilities。

## P1.7 P1 阶段总验收

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 10:13 CST
- **目标**：测试、部署、文档一致性达标。
- **完成判断**：
  - P1.1 到 P1.6 均完成或有明确延后理由。
  - `npm test`、`npm run build` 通过。
  - README 平台能力矩阵和实际代码一致。
- **验证命令**：
  ```bash
  npm run build
  npm test
  ```
- **变更证据**：
  - `P1.1`：正式测试入口与手工脚本目录已收敛，`npm test` 不再执行 `.tmp_*` 连通性脚本。
  - `P1.2`：脆弱源码断言已降低，当前测试稳定。
  - `P1.3`：平台 handler 改用 resolved deploy 配置，autoSync/autoRedeploy 有行为测试覆盖。
  - `P1.4`：README 平台能力矩阵覆盖 Node/Docker/Vercel/Netlify/Cloudflare Pages/EdgeOne Pages。
  - `P1.5`：Dockerfile 和 `.dockerignore` 不再把本地运行态配置、数据、OAuth session、临时文件打进镜像。
  - `P1.6`：runtime capabilities、代理差异和前端 multipart 降级提示已对齐。
- **验证结果**：
  - `npm test`：115 tests，115 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
- **阶段结论**：P1 测试和部署修复完成；下一阶段进入 P2 存储和任务可靠性，优先处理图片索引原子写入、持久化失败可观测、远程图片 URL 下载限制和后台任务取消/TTL。

---

# P2：存储和任务可靠性

目标：后台任务、图片历史和持久化行为可信；失败可见，并发不丢数据。

阶段完成判断：

- 并发保存图片历史不丢记录。
- 索引写入原子化。
- 存储失败前端/后台任务可见。
- 后台任务支持取消、TTL、死任务回收。
- 远程图片下载有超时、大小和 host 限制。

## P2.1 图片索引原子写入与并发保护

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 10:18 CST
- **目标**：多个任务同时落盘图片时，不损坏 `image-store.json`，不丢历史记录。
- **推荐实现**：
  1. 在 `image-storage.js` 内增加 per-process 写队列/mutex。
  2. 保存索引时写到临时文件，再 `rename` 替换。
  3. 每次写入前重新读取最新索引并合并，减少覆盖风险。
  4. 后续如历史量变大，迁移 SQLite。
- **完成判断**：
  - 并发 20 次保存，索引保留 20 条。
  - 任何时刻 `image-store.json` 都是合法 JSON。
  - 异常中断不会留下半截索引。
- **验证命令**：
  ```bash
  npm test -- test/image-storage-concurrency.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 10:14 CST：开始检查 `image-storage.js` 索引读写流程和现有 `test/image-storage.test.js`，目标是增加 per-process 写队列、写临时文件后 rename，并补并发保存测试。
  - 2026-04-28 10:18 CST：完成索引原子写入和并发测试小步；`image-storage.js:36` 新增 `writeJsonAtomic()`，先写临时文件、`fsync` 后 `rename`；`image-storage.js:138` 新增 per-process `indexWriteQueue`；`image-storage.js:150` 每次串行重新读取最新索引再合并；`image-storage.js:200` 保存图片后通过队列更新索引；`test/image-storage.test.js:41` 新增 20 并发保存测试，验证不丢记录、索引是合法 JSON、无临时文件残留。
- **验证结果**：
  - `node --test test/image-storage.test.js`：3 tests，3 pass，0 fail。
  - `npm test`：116 tests，116 pass，0 fail。
- **关联/后续**：P2.2 会增加失败可观测。

## P2.2 图片持久化失败可观测

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 10:23 CST
- **目标**：保存失败不再静默吞掉，用户和调试区能知道哪里失败。
- **推荐实现**：
  1. `persistGenerationResult()` 对每个 item 返回 `persisted: true/false`。
  2. 失败时附加脱敏 `storageError`。
  3. 后台任务 progress 增加 `storage:error` 或 `storage:partial`。
  4. 前端历史诊断展示最近存储错误。
- **完成判断**：
  - 模拟写盘失败时，结果包含可读错误状态。
  - UI 不会误显示“已保存”。
  - 错误不包含 API key/token。
- **验证命令**：
  ```bash
  npm test -- test/image-storage.test.js test/background-jobs.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 10:19 CST：开始修改 `persistGenerationResult()` 静默 catch 路径，目标是每个持久化失败 item 返回 `persisted: false` 和脱敏 `storageError`，同时后台任务 progress 能展示 `storage:partial` / `storage:error`。
  - 2026-04-28 10:23 CST：完成失败可观测小步；`image-storage.js:117` 新增 `sanitizeStorageError()` 脱敏 token/API key/Bearer；`image-storage.js:226` 成功持久化 item 返回 `persisted: true`；`image-storage.js:236` 失败 item 返回 `persisted: false` 与 `storageError`；`server.js:1266` 将失败传到 `storage:partial` / `storage:error` progress；`app.js:976` 增加 storage 成功/部分失败/失败状态文案；`test/image-storage.test.js:79` 和 `test/background-job-failure-surface.test.js:16` 覆盖失败可观测。
- **验证结果**：
  - `node --test test/image-storage.test.js test/background-job-failure-surface.test.js`：6 tests，6 pass，0 fail。
  - `npm test`：118 tests，118 pass，0 fail。
- **关联/后续**：P3 历史管理会利用该字段。

## P2.3 远程图片 URL 下载加超时和限制

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 10:28 CST
- **目标**：上游返回 URL 时，下载图片不会无限等待、无限占内存或访问危险地址。
- **推荐实现**：
  1. `bufferFromUrl()` 使用 AbortController 超时。
  2. 限制最大下载字节数，例如 30MB。
  3. 校验 content-type 必须是 `image/png`、`image/jpeg`、`image/webp`。
  4. 复用 P0.4 的 host/IP 安全判断。
  5. 流式读取响应，超过限制立即 abort。
- **完成判断**：
  - 超时返回可观测错误。
  - 超大图片返回明确错误。
  - 非图片 content-type 被拒绝。
  - 私网 URL 被拒绝。
- **验证命令**：
  ```bash
  npm test -- test/image-storage.test.js test/storage-download-security.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 10:24 CST：开始加固 `image-storage.js` 的远程 URL 下载，目标是限制协议/本机私网 host、content-type、content-length/流式字节数和下载超时。
  - 2026-04-28 10:28 CST：完成远程 URL 下载限制小步；`image-storage.js:5` 复用 `isLocalOrPrivateHost()`；`image-storage.js:137` 增加可配置下载超时/最大字节数；`image-storage.js:144` 阻断非 HTTPS 和本机/私网 host；`image-storage.js:164` 流式读取并按字节上限 abort；`image-storage.js:194` 校验 HTTP 状态、图片 content-type、content-length 和超时；`test/image-storage.test.js:104` 覆盖远程 URL 成功落盘，`test/image-storage.test.js:127` 覆盖私网、非图片、超大和超时失败。
- **验证结果**：
  - `node --test test/image-storage.test.js`：6 tests，6 pass，0 fail。
  - `npm test`：120 tests，120 pass，0 fail。
- **关联/后续**：P0.4 代理策略最好抽成复用模块。

## P2.4 后台任务支持取消

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 10:33 CST
- **目标**：用户可以取消排队中或运行中的任务，避免长任务无法中断。
- **推荐实现**：
  1. `background-jobs.js` 给每个 job 增加 AbortController。
  2. runner 接收 signal。
  3. 新增 `DELETE /api/jobs/:id` 或 `POST /api/jobs/:id/cancel`。
  4. 前端 active job banner 增加“取消任务”。
  5. 对已经完成/失败的任务取消返回幂等状态。
- **完成判断**：
  - pending 任务可取消。
  - running 任务收到 abort 并转为 `cancelled`。
  - 前端取消后不再轮询。
  - 取消不会删除已生成历史。
- **验证命令**：
  ```bash
  npm test -- test/background-jobs.test.js test/background-job-ui-state.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 10:29 CST：开始检查 `background-jobs.js`、`server.js` `/api/jobs` 路由和前端 active job banner，目标是支持取消 pending/running 任务，并让 runner 能收到 AbortSignal。
  - 2026-04-28 10:30 CST：完成 job store 取消状态机小步；`background-jobs.js:19` 对外暴露 `cancelledAt`，`background-jobs.js:67` 给运行任务绑定 `AbortController` signal，`background-jobs.js:157` 新增 `cancel(id)`，可取消 queued pending 和 running，已完成/失败/已取消任务保持幂等；`background-jobs.js:181` cleanup 覆盖 `cancelled`；`test/background-jobs.test.js:72` 覆盖 pending 取消不执行 runner，`test/background-jobs.test.js:104` 覆盖 running abort，`test/background-jobs.test.js:134` 覆盖 completed 幂等取消。
  - 2026-04-28 10:31 CST：完成后端 API 与上游 abort 小步；`server.js:877` 增加 `JOB_CANCELLED` 错误归一化，`server.js:893` 让 `runWithTimeout()` 组合任务取消 signal 与原有超时，`server.js:1183` 和 `server.js:1214` 将 signal 传入 Images / Responses fetch，`server.js:1313` 将 background runner 第三参 signal 接入总路由，`server.js:1430` 新增 `handleCancelImageJob()`，`server.js:1661` 新增 `POST /api/jobs/:id/cancel`；`test/background-job-cancel-api.test.js:30` 用本地上游挂起请求验证取消后任务变 `cancelled` 且 upstream fetch 被 abort。
  - 2026-04-28 10:32 CST：完成前端取消入口小步；`index.html:492` 在 active job banner 增加“取消任务”按钮，`app.js:78` 增加本地 stopped job 集合避免继续轮询，`app.js:1710` 新增 `cancelBackgroundJob()` 调后端 cancel API，`app.js:1738` 轮询循环识别本地停止和服务端 `cancelled` 状态，`app.js:1809` 新增 `cancelActiveJob()`，取消成功后清 active job、停 waiting、结束 loading 并显示“任务已取消”，`app.js:1845` 将“放弃任务”改成只停止本地轮询但不通知后端，`app.js:2404` 绑定取消按钮；`test/background-job-ui-state.test.js:23` 覆盖取消按钮/API/停止轮询。
  - 2026-04-28 10:33 CST：完成 P2.4 验收修正；全量测试首次暴露旧断言仍要求 `runWithTimeout(task, timeoutMs, timeoutMessage)` 三参签名，已在 `test/background-job-resilience.test.js:29` 更新为新四参签名并补充 `JOB_CANCELLED` 断言，随后定向测试、`npm test`、`npm run build` 全部通过。
- **验证结果**：
  - `node --test test/background-jobs.test.js`：6 tests，6 pass，0 fail。
  - `node --test test/background-jobs.test.js test/background-job-cancel-api.test.js`：7 tests，7 pass，0 fail。
  - `node --test test/background-job-ui-state.test.js test/background-jobs.test.js test/background-job-cancel-api.test.js`：11 tests，11 pass，0 fail。
  - `node --test test/background-job-resilience.test.js test/background-job-ui-state.test.js test/background-jobs.test.js test/background-job-cancel-api.test.js`：14 tests，14 pass，0 fail。
  - `npm test`：125 tests，125 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
- **关联/后续**：P2.5 死任务回收。

## P2.5 后台任务 TTL、死任务和队列配置校验

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 10:37 CST
- **目标**：非法配置不会让任务系统失控；卡死任务能被标记失败或取消。
- **推荐实现**：
  1. 校验 `IMAGE_JOB_MAX_CONCURRENCY`，范围例如 `1-10`。
  2. 校验 `IMAGE_JOB_MAX_QUEUE`，范围例如 `1-100`。
  3. pending/running 增加最大生命周期。
  4. 超时任务转 `failed` 或 `cancelled`，释放并发槽。
  5. 前端显示“任务超时，可重试”。
- **完成判断**：
  - `NaN`、负数、0、过大值都回落安全默认值。
  - 卡死 runner 不会永久占槽。
  - 队列满返回 503 和清晰错误。
- **验证命令**：
  ```bash
  npm test -- test/background-job-backend-guardrails.test.js test/background-jobs.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 10:34 CST：开始 `P2.5 后台任务 TTL、死任务和队列配置校验`；先给 env 配置加安全整数范围，再让 job store 能清理 pending/running 超时任务并释放槽位。
  - 2026-04-28 10:36 CST：完成配置校验、死任务回收和前端超时提示小步；`server.js:39` 新增 `boundedIntEnv()`，`server.js:45` 将 `IMAGE_JOB_MAX_CONCURRENCY` 限制为 `1-10`，`server.js:46` 将 `IMAGE_JOB_MAX_QUEUE` 限制为 `1-100`，`server.js:47`-`server.js:49` 增加任务保留 TTL、pending 超时、running 超时 env；`server.js:1393` 将 TTL/timeout 传入 job store；`background-jobs.js:31`-`background-jobs.js:42` 增加 TTL/pending/running timeout 参数归一化，`background-jobs.js:62` 用 `releaseRunningSlot()` 防止卡死 runner 永久占并发槽，`background-jobs.js:210` 统一将超时任务标记为 failed 并写入 `JOB_PENDING_TIMEOUT` / `JOB_RUNNING_TIMEOUT`，`background-jobs.js:234` 在 cleanup 中回收 finished/pending/running；`app.js:876` 将任务超时分类为“后台任务超时，可重试”；`test/background-jobs.test.js:72` 覆盖 queued pending 超时不执行 runner，`test/background-jobs.test.js:100` 覆盖 stuck running 超时后释放槽位并启动后续任务。
- **验证结果**：
  - `node --test test/background-jobs.test.js test/background-job-backend-guardrails.test.js test/error-dialog-structure.test.js`：12 tests，12 pass，0 fail。
  - `npm test`：127 tests，127 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
- **关联/后续**：P3 队列面板会展示这些状态。

## P2.6 存储 scope 语义整理

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 10:40 CST
- **目标**：`images`、`conversations`、`all` 的清理语义清晰，不再“all 实际只清图片”。
- **推荐实现**：
  1. 明确定义当前有哪些持久化数据：图片、索引、OAuth session、未来 conversation/cache。
  2. `clear('images')` 只清图片和图片索引。
  3. `clear('conversations')` 当前如未实现则返回 `notImplemented` 或清晰 no-op。
  4. `clear('all')` 只清项目数据目录内的受控数据，不碰配置和账号。
  5. README/设置页文案同步。
- **完成判断**：
  - 每个 scope 行为和 UI 文案一致。
  - 不会误删配置或项目外文件。
  - 测试覆盖三个 scope。
- **验证命令**：
  ```bash
  npm test -- test/image-storage.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 10:38 CST：开始 `P2.6 存储 scope 语义整理`；先明确 `conversations` 是浏览器本地 no-op、`images` 是服务端图片、`all` 是页面本地状态 + 服务端图片，避免“全部”误解为删除配置或项目外数据。
  - 2026-04-28 10:39 CST：完成 scope 行为和文案小步；`image-storage.js:343` 让 `clear('conversations')` 返回 `browser_only` no-op，不再伪装成清了服务端数据；`image-storage.js:360` 让 `images/all` 返回 `cleared`、`removedImages`、`removedBytes`、`skipped` 等结构化结果；`app.js:614` 明确页面对话只清浏览器本地，`app.js:629` 让 `all` 同时清 active job 和 prompt；`index.html:256`-`index.html:258` 将按钮改成“清理页面对话 / 清理服务端图片 / 清理页面和图片”；`README.md:241` 明确三个 scope 不会删除账号配置、`config/.env`、OAuth 会话文件或项目外文件；`test/image-storage.test.js:191` 覆盖 conversations/images/all 三个 scope。
- **验证结果**：
  - `node --test test/image-storage.test.js test/storage-security.test.js test/settings-ui.test.js test/docker-packaging.test.js`：17 tests，17 pass，0 fail。
  - `npm test`：127 tests，127 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
- **关联/后续**：P3 历史管理会依赖 scope。

## P2.7 P2 阶段总验收

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 10:41 CST
- **目标**：存储和任务系统可靠性达标。
- **完成判断**：
  - P2.1 到 P2.6 均完成或有明确延后理由。
  - 并发、失败、取消、超时测试通过。
  - 前端错误和诊断可见。
- **验证命令**：
  ```bash
  npm run build
  npm test
  ```
- **变更证据**：
  - 2026-04-28 10:41 CST：P2.1-P2.6 均已完成；已覆盖图片索引原子写入、持久化失败可观测、远程 URL 下载限制、后台任务取消、任务 TTL/死任务回收、存储 scope 语义。
- **验证结果**：
  - `npm test`：127 tests，127 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
- **阶段结论**：P2 存储和任务可靠性达标，当前阶段转入 P3 产品功能升级。

---

# P3：产品功能升级

目标：从“能用的生图工具”升级成“好用的图片生成工作台”。

阶段完成判断：

- 常用创作流程更顺：批量生成、历史管理、重生成、模板、继续图生图。
- 功能根据平台能力自动降级。
- 前端模块拆分后仍保持可维护。
- 关键用户流程有测试覆盖。

## P3.1 前端模块化重构

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 11:02 CST
- **目标**：降低 `app.js` 维护成本，为后续产品功能铺路。
- **推荐实现**：
  1. 先保持无框架 ES module，不一次性引入复杂框架。
  2. 拆分为：
     - `frontend/state.js`
     - `frontend/api-client.js`
     - `frontend/accounts.js`
     - `frontend/generation.js`
     - `frontend/background-jobs.js`
     - `frontend/settings-ui.js`
     - `frontend/storage-ui.js`
     - `frontend/oauth-ui.js`
     - `frontend/error-dialog.js`
  3. `scripts/build-static.js` 支持复制整个 frontend 或改用 Vite/esbuild。
  4. 保持现有 UI 行为不变，先只拆结构。
- **完成判断**：
  - `app.js` 明显瘦身。
  - 所有现有前端测试通过。
  - build 输出包含所有需要的模块。
  - 浏览器入口正常加载。
- **验证命令**：
  ```bash
  npm run build
  npm test -- test/settings-ui.test.js test/ui-feedback.test.js test/reference-images.test.js
  npm test
  ```
- **变更证据**：
  - `frontend/dom.js`：抽出 DOM 查询基础工具。
  - `frontend/http.js`：抽出 `fetchWithTimeout()`、`sleep()`、后台轮询 backoff。
  - `frontend/background-jobs.js`：抽出 active job 本地状态、恢复条显示、轮询停止状态和后台任务常量。
  - `frontend/error-dialog.js`：抽出结构化错误分类、错误弹窗和通用 `showError()`。
  - `frontend/state.js`：抽出默认 app settings、运行时 state、settings clone/merge。
  - `app.js`：前端入口改为导入上述 ES modules，行数从 2528 降至 2292，保留原有 UI 行为。
  - `scripts/build-static.js`：静态构建递归复制 `frontend/` 到 `dist/frontend/`。
  - `test/frontend-modules.test.js`：新增 P3.1 模块化结构测试。
  - 多个源码结构测试已改为读取模块文件，而不是继续假设所有实现都在 `app.js`。
- **验证结果**：
  - `node --test test/frontend-modules.test.js`：1 test，1 pass。
  - `npm run build`：通过，`Static build written to dist/`，产物包含 `dist/frontend/*.js`。
  - `npm test`：128 tests，128 pass，0 fail。
- **关联/后续**：P3 后续功能都基于模块化实现。

## P3.2 批量生成和多结果管理

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 11:26 CST
- **目标**：同一提示词可一次生成多张，方便挑选。
- **推荐实现**：
  1. 设置里增加 `生成数量`，范围 `1-4`。
  2. 后端任务 payload 增加 `count`。
  3. 对支持 n 的上游直接传 n；不支持时后端排队多次生成。
  4. 结果卡片显示序号、链路、模型、时间。
  5. 历史记录保留 batchId。
- **完成判断**：
  - 用户选择 3 张时得到 3 个结果或清晰失败信息。
  - 单张失败不影响其他已成功结果展示。
  - 历史可按 batch 归组。
- **验证命令**：
  ```bash
  npm test -- test/background-jobs.test.js test/history-trace-metadata.test.js
  npm test
  ```
- **变更证据**：
  - `image-storage.js:126`、`image-storage.js:298`、`image-storage.js:311`：历史公开记录和持久化结果保留 `batchId`、`batchIndex`、`batchCount`，并对 batch 字段做基础净化。
  - `server.js:50`、`server.js:1304`、`server.js:1420`：后台图片任务统一限制 `count` 为 `1-4`，生成/净化 `batchId`，并按稳定单张链路循环执行批量任务。
  - `server.js:1453`、`server.js:1474`：单张失败会写入失败项并继续下一张；部分失败返回 `batch:partial`，全失败才让任务失败。
  - `frontend/state.js:4`、`index.html:92`、`index.html:549`：设置页和首页增加默认生成数量/本次生成数量，范围 `1-4`。
  - `app.js:599`、`app.js:1693`、`app.js:1734`：前端读取生成数量，为后台任务提交 `count` 和 `batchId`，并在 active job 中保留批量上下文。
  - `app.js:838`、`app.js:905`、`app.js:1933`：结果卡片展示批量序号、模型/链路/时间等 meta，并能显示单张失败卡片。
  - `style.css`：新增/调整结果卡片 meta 与失败卡片样式，避免长 meta 挤压操作区。
  - `test/image-storage.test.js:93`、`test/history-trace-metadata.test.js:21`、`test/background-jobs.test.js`、`test/background-job-backend-guardrails.test.js:32`、`test/background-job-ui-state.test.js:37`、`test/settings-ui.test.js:86`：覆盖存储 batch 元数据、后端 count guardrail、批量失败不互相影响、前端 payload 和 UI 默认值。
- **验证结果**：
  - `node --test test/image-storage.test.js test/history-trace-metadata.test.js`：8 tests，8 pass，0 fail。
  - `node --test test/responses-routing.test.js test/background-jobs.test.js test/images-edits-body.test.js`：14 tests，14 pass，0 fail。
  - `node --test test/background-job-backend-guardrails.test.js`：4 tests，4 pass，0 fail。
  - `node --test test/background-job-ui-state.test.js test/settings-ui.test.js test/reference-images.test.js test/css-layout.test.js`：20 tests，20 pass，0 fail。
  - `node --test test/image-storage.test.js test/history-trace-metadata.test.js test/responses-routing.test.js test/background-jobs.test.js test/background-job-backend-guardrails.test.js test/background-job-ui-state.test.js test/settings-ui.test.js test/reference-images.test.js test/css-layout.test.js`：44 tests，44 pass，0 fail。
  - `node --test test/cloud-deploy.test.js test/compatibility-routing.test.js`：14 tests，14 pass，0 fail；同步修正两个源码结构断言，使其接受批量生成新增参数。
  - `npm run build`：通过，`Static build written to dist/`。
  - `npm test`：134 tests，134 pass，0 fail。
- **关联/后续**：P3.3 历史筛选会支持 batch。

## P3.3 历史搜索、筛选、收藏和删除单图

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 11:42 CST
- **目标**：历史不只是展示最近 60 条，而是可管理资产。
- **推荐实现**：
  1. image index 增加 `favorite`、`tags`、`batchId`、`model`、`accountName/host` 等脱敏元数据。
  2. 新增 API：
     - `GET /api/storage/history?query=&favorite=&limit=&cursor=`
     - `PATCH /api/images/:id/meta`
     - `DELETE /api/images/:id`
  3. 前端增加搜索框、收藏按钮、删除单图、标签显示。
  4. 删除单图只删除对应文件和索引记录。
- **完成判断**：
  - 可以按 prompt 文本搜索。
  - 可以收藏/取消收藏。
  - 可以删除单张图片。
  - 删除不影响其他图片。
- **验证命令**：
  ```bash
  npm test -- test/image-storage.test.js test/history-trace-metadata.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 11:26 CST：开始 P3.3，实现顺序定为：存储层字段/查询/更新/删除 → 后端 API 与鉴权 → 前端历史工具栏和卡片操作 → 阶段验收。
  - 2026-04-28 11:31 CST：完成存储层小步；`image-storage.js:156` 公开 `favorite/tags/model/accountName/accountHost`，`image-storage.js:443` 新增 `listHistory()` 支持 query/favorite/batch/limit/cursor，`image-storage.js:475` 新增 `updateMeta()`，`image-storage.js:489` 新增 `deleteImage()`；这些索引写操作继续复用 `mutateIndex()` 串行队列。
  - 2026-04-28 11:34 CST：完成后端 API 小步；`server.js:1565` 新增 `GET /api/storage/history`，`server.js:1605` 新增 `PATCH /api/images/:id/meta`，`server.js:1627` 新增 `DELETE /api/images/:id`；写操作复用 `requireConfigAdmin()`，CORS methods 增加 `PATCH, DELETE`，存储 meta 会记录模型和脱敏账号 host。
  - 2026-04-28 11:41 CST：完成前端历史管理小步；`index.html:594` 增加历史搜索/只看收藏/刷新工具栏，`app.js:518` 调用历史查询 API，`app.js:996` 给已保存图片卡片增加收藏和删除操作，`style.css:684` 增加历史工具栏和卡片操作样式；不支持服务端存储的平台会禁用历史管理入口。
- **验证结果**：
  - `node --test test/image-storage.test.js test/history-trace-metadata.test.js`：9 tests，9 pass，0 fail。
  - `node --test test/storage-history-api.test.js test/storage-security.test.js test/image-storage.test.js test/history-trace-metadata.test.js`：11 tests，11 pass，0 fail。
  - `node --check app.js && node --test test/history-ui.test.js test/background-job-ui-state.test.js test/settings-ui.test.js test/css-layout.test.js test/storage-history-api.test.js`：18 tests，18 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
  - `npm test`：137 tests，137 pass，0 fail。
- **关联/后续**：P3.4 重生成依赖历史元数据。

## P3.4 从历史重新生成/继续图生图

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 11:50 CST
- **目标**：用户可以基于历史结果继续创作，而不是重新手动配置。
- **推荐实现**：
  1. 每条历史保存生成参数快照：prompt、size、quality、format、background、mode、model、是否参考图。
  2. 结果卡片增加：
     - `重新生成`
     - `作为参考图继续`
     - `复制提示词`
  3. 重新生成时恢复参数到 UI。
  4. 作为参考图继续时自动把历史图片加载为 ref image。
- **完成判断**：
  - 点击重新生成能恢复参数并提交。
  - 点击作为参考图继续能进入图生图。
  - 不泄露 API Key/OAuth token 到历史 metadata。
- **验证命令**：
  ```bash
  npm test -- test/history-trace-metadata.test.js test/reference-images.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 11:43 CST：开始 P3.4；实现顺序定为：历史记录保存脱敏生成参数快照 → 历史卡片增加重新生成/作为参考图继续/复制提示词 → 阶段验收。
  - 2026-04-28 11:45 CST：完成生成参数快照小步；`image-storage.js:138` 新增 `sanitizeGenerationSnapshot()`，历史公开记录包含 `generation` 快照；`server.js:1327`、`server.js:1344` 在保存历史时写入 prompt/size/quality/format/background/mode/model/hasRef，且不包含 key/token/参考图内容。
  - 2026-04-28 11:48 CST：完成历史卡片操作小步；`app.js:952` 从历史 meta 读取生成快照，`app.js:966` 恢复提示词/尺寸/质量/背景/格式，`app.js:979` 支持一键重新生成，`app.js:989` 支持把历史图片加入参考图，`app.js:1011` 支持复制提示词；卡片增加 `复制词`、`重新生成`、`作参考` 操作。
- **验证结果**：
  - `node --check server.js && node --test test/image-storage.test.js test/history-trace-metadata.test.js test/storage-history-api.test.js test/background-jobs.test.js`：18 tests，18 pass，0 fail。
  - `node --check app.js && node --test test/history-regenerate-ui.test.js test/history-ui.test.js test/reference-images.test.js test/settings-ui.test.js test/css-layout.test.js`：17 tests，17 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
  - `npm test`：138 tests，138 pass，0 fail。
- **关联/后续**：P3.5 prompt 模板可和历史共用。

## P3.5 Prompt 模板库和版本管理

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 11:57 CST
- **目标**：提升提示词复用和创作效率。
- **推荐实现**：
  1. 本地保存 prompt 模板：名称、内容、风格、类型、标签。
  2. 支持从当前 prompt 保存为模板。
  3. 支持模板插入、覆盖当前 prompt、追加到当前 prompt。
  4. 保存最近 prompt 历史和增强前/增强后版本。
  5. 提供导入/导出 JSON。
- **完成判断**：
  - 可新建/编辑/删除模板。
  - 可一键应用模板。
  - prompt 增强前后可回退。
  - 导入导出不包含 API key/token。
- **验证命令**：
  ```bash
  npm test -- test/prompt-enhancement.test.js test/settings-ui.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 11:51 CST：开始 P3.5；实现路线定为浏览器本地模板库，保存模板名称/内容/风格/类型/标签/版本，不导出任何账号、key、token；同时记录提示词增强前后版本用于回退。
  - 2026-04-28 11:56 CST：完成模板库和提示词版本小步；`index.html:508` 新增 Prompt 模板库面板，`app.js:87` 新增模板净化/版本结构，`app.js:191` 支持保存当前提示词为模板，`app.js:210` 支持更新模板并保留旧版本，`app.js:250`/`app.js:272` 支持安全导出/导入，`app.js:281` 记录增强前后提示词版本；`style.css:739` 增加模板库样式。
- **验证结果**：
  - `node --check app.js && node --test test/prompt-templates.test.js test/settings-ui.test.js test/prompt-enhancement.test.js test/css-layout.test.js`：17 tests，17 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
  - `npm test`：139 tests，139 pass，0 fail。
- **关联/后续**：P3.8 导入导出会统一处理。

## P3.6 简易图片编辑工作流

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 12:22 CST
- **目标**：支持基础创作闭环：裁剪、参考图、局部编辑入口。
- **推荐实现**：
  1. 第一版不做复杂画布，先实现：
     - 裁剪/压缩参考图
     - 选择历史图作为参考图
     - 简单 mask 上传入口
  2. 后端保留 mask 字段，兼容支持 mask 的上游。
  3. UI 明确不同平台/模型对 mask 的支持状态。
- **完成判断**：
  - 用户可裁剪参考图再提交。
  - 用户可上传 mask。
  - 不支持 mask 的链路给出清晰提示。
- **验证命令**：
  ```bash
  npm test -- test/reference-images.test.js test/images-edits-body.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 11:58 CST：开始 P3.6；第一版范围定为参考图自动压缩/可选居中裁剪、mask 上传预览、mask 随图生图 payload 透传。
  - 2026-04-28 12:06 CST：接手并确认当前半成品状态；`frontend/state.js` 已有 mask 状态，`index.html`/`style.css` 已有 mask 和参考图预处理 UI，`app.js` 已有参考图预处理 helper，但上传流程、mask 前后端 payload、后端转发和测试尚未完成。
  - 2026-04-28 12:10 CST：完成 P3.6 前端接入小步；`app.js:1985` 增加 mask 链路可用性提示，`app.js:2262` 后台任务 payload 透传 `maskImageBase64`，`app.js:2463` 直连 JSON edits 增加 `mask`，`app.js:2791` 兼容 multipart 请求追加 `mask` 文件，`app.js:2889` 参考图上传改为预处理后再校验/预览，`app.js:2908` 增加 mask 上传、预览、移除和无参考图拦截。
  - 2026-04-28 12:14 CST：完成 P3.6 后端 mask 转发和限制小步；`server.js:773` 增加 mask 单图大小校验，`server.js:781` 拦截无参考图或非 edits 链路使用 mask，`server.js:1061` multipart edits 追加 `mask` 文件，`server.js:1078` 代理 multipart 识别 `fieldName=mask` 并单独限制，`server.js:1212` Images edits JSON body 透传 `mask` data URL，`server.js:1561` 创建后台任务时提前校验 mask 链路。
  - 2026-04-28 12:18 CST：完成 P3.6 测试覆盖小步；`test/reference-images.test.js:32` 覆盖参考图预处理、mask 上传预览和链路限制，`test/reference-images.test.js:60` 覆盖后端 mask 限制与透传结构，`test/images-edits-body.test.js:27` 覆盖 JSON edits mask，`test/images-edits-body.test.js:41` 覆盖 multipart mask 文件字段，`test/images-edits-body.test.js:58` 覆盖无参考图拒绝 mask，`test/compatibility-routing.test.js:19` 更新兼容 multipart 断言。
  - 2026-04-28 12:20 CST：完成 P3.6 关联定向联测小步；覆盖后台任务、请求限制、代理安全、参考图和兼容路由相关测试，确认 mask 改动未破坏既有批量/后台/代理限制。
  - 2026-04-28 12:22 CST：完成 P3.6 阶段验收；`npm run build` 和 `npm test` 全量通过，P3.6 转入完成，当前阶段推进到 P3.7。
- **验证结果**：
  - `node --check app.js`：通过。
  - `node --check server.js`：通过。
  - `node --check app.js && node --check server.js && node --test test/reference-images.test.js test/images-edits-body.test.js test/compatibility-routing.test.js`：15 tests，15 pass，0 fail。
  - `node --test test/reference-images.test.js test/images-edits-body.test.js test/compatibility-routing.test.js test/background-jobs.test.js test/background-job-backend-guardrails.test.js test/request-limits.test.js test/proxy-security.test.js`：31 tests，31 pass，0 fail。
  - `npm run build`：通过，`Static build written to dist/`。
  - `npm test`：144 tests，144 pass，0 fail。
- **关联/后续**：未来可升级为完整 canvas 编辑器。

## P3.7 多模型/多账号对比生成

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 12:51 CST
- **目标**：同一 prompt 可在多个账号或模型上对比结果。
- **推荐实现**：
  1. UI 增加“对比模式”。
  2. 用户选择多个账号/模型组合。
  3. 后端创建 batch jobs，分别记录 trace。
  4. 结果按账号/模型分组展示。
- **完成判断**：
  - 至少 2 个模型/账号可并行生成。
  - 失败的账号不影响其他结果。
  - trace 中只显示 host/model，不显示 key/token。
- **验证命令**：
  ```bash
  npm test -- test/background-jobs.test.js test/history-trace-metadata.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 12:24 CST：开始 P3.7；实现路线定为浏览器端对比模式面板 + 多账号/模型组合选择，生成时逐组合调用已有稳定单账号链路并带 `compareId/compareIndex/compareCount` 元数据，结果卡片按组合显示账号/模型；后端继续复用现有后台任务和历史 trace，不新增敏感字段。
  - 2026-04-28 12:34 CST：完成 P3.7 前端入口、对比目标读取和执行链路小步；`index.html:609` 增加对比模式面板，`style.css:689` 增加对比卡片样式，`app.js:1487` 增加目标渲染/读取，`app.js:2141` 在生成入口接入对比模式校验，`app.js:2485` 增加对比后台任务执行与结果元数据，`test/compare-mode-ui.test.js:9` 增加结构覆盖。
  - 2026-04-28 12:34 CST：完成 P3.7 轮询可靠性补强小步；`app.js:2489` 为对比后台轮询增加有限重试/backoff，`app.js:2542` 将“创建任务失败才直连降级”和“已创建任务轮询失败只标记该组合失败”分开，避免后台任务已创建后因短暂网络波动触发重复直连生成；`test/compare-mode-ui.test.js:45` 增加对应源码结构回归。
  - 2026-04-28 12:37 CST：完成 P3.7 既有回归断言同步小步；`test/background-job-failure-surface.test.js:9`、`test/background-job-resilience.test.js:11`、`test/cloud-deploy.test.js:78` 允许后台结果处理函数携带 `resultMeta`，保持旧有“建任务失败才直连、轮询失败保留/失败呈现”的验收语义不变。
  - 2026-04-28 12:39 CST：并行审查返回阻塞项，P3.7 从已完成撤回为继续修复；待修问题包括 OAuth 对比目标结果不能写回激活账号、compare 多后台任务需要持久化恢复/取消/放弃、开启对比时默认选择不能被禁用态旧 DOM 覆盖，并补行为级测试。
  - 2026-04-28 12:41 CST：完成 P3.7 默认选择与 OAuth 账号归属修复小步；`app.js:1515` 在对比目标旧 DOM 状态中记录 disabled，`app.js:1535` 仅在“从初始禁用态且没有历史选择”切到启用时应用默认账号选择，避免 0 选中；`app.js:2518` 给 compare 结果元数据携带 `localAccountId`，`app.js:2696` 让 OAuth 结果按目标账号更新 device/session，不再依赖当前激活账号。
  - 2026-04-28 12:48 CST：完成 P3.7 compare active job 持久化/恢复/取消/放弃小步；`frontend/background-jobs.js:11` 支持保存多个 active jobId，`app.js:2358` 让取消按钮可批量取消 compare jobs，`app.js:2396` 让放弃按钮停止所有 compare 轮询，`app.js:2485` 增加 compare active job helper，`app.js:2556` 每个已创建的 compare job 都写入 active job，`app.js:2607` 在网络波动时保留未完成组合，`app.js:2624` 增加 compare jobs 恢复流程。
  - 2026-04-28 12:50 CST：完成 P3.7 行为级测试补强小步；`app.js:3381` 导出对比模式关键纯函数/active job helper 供测试验证，`test/compare-mode-behavior.test.js:42` 覆盖默认选择、OAuth 目标账号归属、compare 多 job 保存和逐个清理；`test/compare-mode-ui.test.js:45` 保留源码结构回归。
- **验证结果**：
  - 2026-04-28 12:35 CST：`node --check app.js && node --test test/compare-mode-ui.test.js test/background-job-ui-state.test.js test/background-jobs.test.js test/responses-routing.test.js test/history-trace-metadata.test.js test/settings-ui.test.js test/css-layout.test.js`：34 tests，34 pass，0 fail。
  - 2026-04-28 12:35 CST：`npm run build`：通过，`Static build written to dist/`。
  - 2026-04-28 12:36 CST：`npm test` 首次全量验收出现 4 个源码结构断言失败，原因是 P3.7 为结果卡片透传 `resultMeta` 后旧断言仍匹配旧函数签名；未发现运行逻辑失败。
  - 2026-04-28 12:37 CST：修正断言后执行 `node --check app.js && node --test test/background-job-failure-surface.test.js test/background-job-resilience.test.js test/cloud-deploy.test.js test/compare-mode-ui.test.js`：20 tests，20 pass，0 fail。
  - 2026-04-28 12:50 CST：`node --check app.js && node --test test/compare-mode-behavior.test.js test/compare-mode-ui.test.js test/background-job-ui-state.test.js test/background-job-resilience.test.js`：16 tests，16 pass，0 fail。
  - 2026-04-28 12:39 CST：阶段验收 `npm run build && npm test`：通过；全量测试 149 tests，149 pass，0 fail。随后根据并行审查发现的体验阻塞项撤回完成状态，继续修复。
  - 2026-04-28 12:51 CST：最终阶段验收 `npm run build && npm test`：通过；全量测试 152 tests，152 pass，0 fail。
- **关联/后续**：P3.2 batch 机制可复用。

## P3.8 设置、账号、模板导入导出

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 12:59 CST
- **目标**：方便迁移浏览器和备份配置，同时避免误导出敏感信息。
- **推荐实现**：
  1. 导出分两种：
     - 安全导出：不含 API key/token。
     - 完整加密导出：用户输入密码，浏览器端加密。
  2. 导入时先预览将变更哪些账号/设置/模板。
  3. 支持只导入模板或只导入设置。
- **完成判断**：
  - 安全导出不包含 key/token。
  - 完整导出必须加密且导入需要密码。
  - 导入有确认页。
- **验证命令**：
  ```bash
  npm test -- test/settings-ui.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 12:53 CST：开始 P3.8；实现路线定为设置页新增“导入/导出”分组，安全导出默认剔除 API key/OAuth token/session 等敏感字段，完整导出使用浏览器 Web Crypto PBKDF2 + AES-GCM 加密，导入先解析并展示账号/设置/模板变更摘要，用户确认后再按勾选范围合并。
  - 2026-04-28 12:57 CST：完成 P3.8 核心导入导出实现小步；`index.html:268` 增加设置页导入/导出分组，`style.css:1422` 增加备份操作与预览样式，`app.js:281` 增加安全账号导出净化，`app.js:313` 构建安全/完整备份 payload，`app.js:342` 使用 PBKDF2 + AES-GCM 加密完整备份，`app.js:378` 支持解密导入，`app.js:427` 支持按账号/设置/模板范围确认导入，`app.js:3458` 绑定导入导出按钮。
- **验证结果**：
  - 2026-04-28 12:58 CST：`node --check app.js && node --test test/settings-backup.test.js test/settings-ui.test.js test/prompt-templates.test.js`：15 tests，15 pass，0 fail。
  - 2026-04-28 12:59 CST：阶段验收 `npm run build && npm test`：通过；全量测试 157 tests，157 pass，0 fail。
- **关联/后续**：P3.5 模板库共用导入导出机制。

## P3.9 可访问性和移动端增强

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 13:23 CST
- **目标**：弹窗、下拉、自定义选择器、错误提示在键盘和移动端下都可用。
- **推荐实现**：
  1. Modal 增加 focus trap 和 Escape 关闭。
  2. Dropdown/select 增加 `aria-expanded`、键盘上下选择、Enter 确认。
  3. 状态提示用 `aria-live`。
  4. 图片结果补 alt 文案。
  5. loading 按钮加 `aria-busy`。
  6. 移动端底部操作区避免被输入法遮挡。
- **完成判断**：
  - 只用键盘可完成账号选择、设置保存、生成。
  - 错误弹窗读屏可感知。
  - 360px 宽度下主要功能不溢出。
- **验证命令**：
  ```bash
  npm test -- test/css-layout.test.js test/error-dialog-structure.test.js test/settings-ui.test.js
  npm test
  ```
- **变更证据**：
  - 2026-04-28 13:00 CST：开始 P3.9；实现范围定为 modal focus trap + Escape 关闭、自定义尺寸下拉 ARIA/键盘操作、生成按钮 `aria-busy`、状态/错误读屏提示和 360px 移动端布局兜底。
  - 2026-04-28 13:07 CST：完成弹窗焦点管理小步；新增 `frontend/dialog-a11y.js`，提供 `openDialog()`、`closeDialog()`、`getFocusableElements()` 和 `handleDialogKeydown()`，统一处理 dialog/lightbox 打开聚焦、Tab 循环、Escape 关闭和关闭后恢复焦点，并对 `requestAnimationFrame` 做 `setTimeout` 降级；`frontend/error-dialog.js` 改为通过该 helper 打开/关闭错误弹窗；`app.js` 将设置、账号、编辑、lightbox 的直接 `hidden` 切换替换为可访问性弹窗 helper。
  - 2026-04-28 13:09 CST：完成状态读屏和图片预览键盘入口小步；`index.html` 为 `#errorMsg` 增加 `role="alert"` 与 `aria-live="assertive"`；`app.js` 在 `setLoading()` 同步 `#generateBtn` 的 `aria-busy`/`aria-disabled`，并新增 `openImageLightbox()` / `makePreviewImageAccessible()`，让结果图片可通过 Tab 聚焦后用 Enter/Space 打开预览。
  - 2026-04-28 13:13 CST：完成账号下拉和尺寸选择键盘小步；`index.html` 为账号切换按钮/菜单补 `aria-haspopup`、`aria-expanded`、`role="menu"`，为尺寸选项补初始 `aria-selected`；`app.js` 为账号菜单新增 Arrow/Home/End/Enter/Escape 键盘导航和动态 `aria-checked`，账号管理列表改为 `radiogroup` + `radio` 可键盘选择；自定义尺寸选择器新增动态 `aria-expanded`、`aria-selected`、打开后聚焦当前项、上下/Home/End 移动、Enter/Space 确认和 Escape 关闭。
  - 2026-04-28 13:15 CST：完成移动端布局兜底小步；`style.css` 为 overlay/modal 增加 safe-area padding、`100dvh` 最大高度和滚动隔离，为下拉/账号/图片预览入口补 `:focus-visible`，在 `max-width: 600px` 下将输入工具栏改为纵向可伸展、状态文案左对齐、导入导出按钮全宽、modal footer 可换行，并新增 `max-width: 360px` 规则让 modal、footer 按钮和选项区不横向溢出。
  - 2026-04-28 13:17 CST：完成 P3.9 自动化测试补充小步；新增 `test/accessibility-ui.test.js` 覆盖 dialog helper、状态读屏、尺寸选择器键盘/ARIA、账号菜单/账号列表键盘和 360px/safe-area CSS；同步放宽 `test/settings-ui.test.js` 中首页尺寸选项解析，避免静态 ARIA 属性导致旧正则误判。
  - 2026-04-28 13:18 CST：完成测试断言修正小步；`test/accessibility-ui.test.js` 将焦点陷阱 Tab 逻辑断言从错误的等值匹配改为匹配当前实现的 `event.key !== 'Tab'` 早退判断。
  - 2026-04-28 13:22 CST：完成默认尺寸静态测试兼容小步；`test/index-defaults.test.js` 放宽 `cs-trigger` 按钮正则，允许按钮携带 P3.9 ARIA 属性，同时仍校验默认 `data-value="auto"` 和显示文案“自动”。
- **验证结果**：
  - 2026-04-28 13:08 CST：`node --check app.js && node --check frontend/error-dialog.js && node --check frontend/dialog-a11y.js`：通过。
  - 2026-04-28 13:10 CST：`node --check app.js && node --check frontend/error-dialog.js && node --check frontend/dialog-a11y.js`：通过。
  - 2026-04-28 13:14 CST：`node --check app.js && node --check frontend/dialog-a11y.js && node --check frontend/error-dialog.js`：通过。
  - 2026-04-28 13:15 CST：`node --check app.js && node --check frontend/dialog-a11y.js && node --check frontend/error-dialog.js`：通过。
  - 2026-04-28 13:18 CST：定向 `node --check app.js && node --check frontend/dialog-a11y.js && node --test test/accessibility-ui.test.js test/css-layout.test.js test/error-dialog-structure.test.js test/settings-ui.test.js`：失败 1 项；原因是新增测试误写为匹配 `event.key === 'Tab'`，实际实现用 `event.key !== 'Tab'` 作为早退条件，功能代码未发现语法错误。
  - 2026-04-28 13:19 CST：定向 `node --check app.js && node --check frontend/dialog-a11y.js && node --test test/accessibility-ui.test.js test/css-layout.test.js test/error-dialog-structure.test.js test/settings-ui.test.js`：17 tests，17 pass，0 fail。
  - 2026-04-28 13:21 CST：阶段验收 `npm run build && npm test`：失败 1 项；`test/index-defaults.test.js` 仍匹配旧的 `cs-trigger` 精确 HTML，P3.9 增加 `aria-haspopup`/`aria-expanded` 后静态正则需要放宽。
  - 2026-04-28 13:22 CST：定向 `node --test test/index-defaults.test.js test/accessibility-ui.test.js`：6 tests，6 pass，0 fail。
  - 2026-04-28 13:23 CST：阶段验收 `npm run build && npm test`：通过；全量测试 162 tests，162 pass，0 fail。
- **关联/后续**：可选引入 Playwright 做真实浏览器测试。

## P3.10 P3 阶段总验收

- **状态**：✅ 已完成
- **完成时间**：2026-04-28 13:23 CST
- **目标**：产品功能升级完成，创作工作流明显改善。
- **完成判断**：
  - P3.1 到 P3.9 完成或有明确延后理由。
  - 功能有文档、有测试、有降级说明。
  - `npm run build`、`npm test` 通过。
- **验证命令**：
  ```bash
  npm run build
  npm test
  ```
- **变更证据**：
  - 2026-04-28 13:23 CST：完成 P3 阶段总验收；P3.1-P3.9 均已完成，P3.9 新增可访问性/移动端测试后，全量构建和测试通过。
- **阶段结论**：P3 产品功能升级完成；创作工作流、历史/模板/对比/局部编辑/备份和移动端可访问性均已有对应实现与测试覆盖，当前验收基线为 `npm run build && npm test` 通过（162 tests，162 pass，0 fail）。

---

# 2. 实时进度日志

> 每完成一个小步，立刻在这里追加一条。格式固定，方便回看。

## 2026-04-28

- 2026-04-28 08:35 CST：创建本文档：`docs/p0-p3-tracking.md`。
- 2026-04-28 08:40 CST：开始 `P0.1 配置 runtime 接口脱敏`，先修改接口返回结构并补测试。
- 2026-04-28 09:01 CST：完成 `P0.1 配置 runtime 接口脱敏`；定向测试、`node --test test/*.js` 和 `npm run build` 通过；`npm test` 因根目录手工脚本入口问题失败，已记录到 `P1.1`。
- 2026-04-28 09:04 CST：开始 `P0.2 管理接口强制鉴权`；先收紧无 token 默认放行，再补真实 HTTP 行为测试。
- 2026-04-28 09:06 CST：完成 `P0.2 管理接口强制鉴权`；新增 `test/config-admin-security.test.js`，定向测试、`node --test test/*.js` 和 `npm run build` 通过；`npm test` 仍待 `P1.1` 修入口。
- 2026-04-28 09:08 CST：开始 `P0.3 静态文件服务改为安全白名单/静态根目录`；采用只从 `dist/` 或显式 `IMAGE_GEN_STATIC_DIR` 服务静态资源的方案。
- 2026-04-28 09:09 CST：完成 `P0.3 静态文件服务改为安全白名单/静态根目录`；新增 `test/static-security.test.js`，定向测试、`node --test test/*.js` 和 `npm run build` 通过；`npm test` 仍待 `P1.1` 修入口。
- 2026-04-28 09:10 CST：开始 `P1.1 修正测试入口和手工脚本位置`；先把 `npm test` 收敛到正式测试目录，避免执行依赖 `.tmp_test_base_url` 的手工脚本。
- 2026-04-28 09:11 CST：完成 `P1.1 修正测试入口和手工脚本位置`；手工脚本已移入 `scripts/manual/`，`npm test`、`npm run build` 和显式 `node --test test/*.js api/oauth/test.js` 均通过。
- 2026-04-28 09:12 CST：开始 `P1.2 修复当前失败测试并降低源码正则脆弱性`；先去掉为了旧断言保留的重复 `.btn-send` 规则，改测试断言真实规则内容。
- 2026-04-28 09:13 CST：完成 `P1.2 修复当前失败测试并降低源码正则脆弱性`；`npm test` 和 `npm run build` 通过。
- 2026-04-28 09:14 CST：开始 `P0.4 代理接口从任意 URL 改成受控代理`；先抽出代理策略，限制协议、host、路径、危险 header 和本机/私网目标。
- 2026-04-28 09:19 CST：完成 `P0.4 代理接口从任意 URL 改成受控代理`；Node/Vercel/Netlify 代理已接入统一策略，`npm test` 和 `npm run build` 通过。
- 2026-04-28 09:20 CST：开始 `P0.5 请求体和参考图大小限制`；先补通用 JSON body 限制，再限制参考图单张/总大小，并加前端提前提示。
- 2026-04-28 09:22 CST：继续 `P0.5 请求体和参考图大小限制`；已核对现有半成品，下一步补齐 OAuth/runner/multipart 入口和前端上传预检。
- 2026-04-28 09:24 CST：完成 `P0.5 请求体和参考图大小限制`；新增 `request-limits.js` 与 `test/request-limits.test.js`，服务端/代理/前端上传均有限制，`npm test` 和 `npm run build` 通过。
- 2026-04-28 09:25 CST：开始 `P0.6 存储清理接口加鉴权`；目标是 `/api/storage/clear` 复用管理 token，前端清理图片/全部数据自动带 token。
- 2026-04-28 09:27 CST：完成 `P0.6 存储清理接口加鉴权`；服务端清理接口强制 admin token，前端图片/全部清理自动带 token，`npm test` 和 `npm run build` 通过。
- 2026-04-28 09:28 CST：开始 `P0.7 OAuth session/status 降低抢读风险`；先禁止公开 status 用 state 读取结果，再给 stateless session 增加签名校验。
- 2026-04-28 09:30 CST：完成 `P0.7 OAuth session/status 降低抢读风险`；公开 status 不再接受 state，stateless session 已签名校验，`npm test` 和 `npm run build` 通过。
- 2026-04-28 09:31 CST：开始 `P0.8 OAuth loopback HTML escape`；目标是集中渲染 loopback HTML 并 escape 动态错误文本。
- 2026-04-28 09:33 CST：完成 `P0.8 OAuth loopback HTML escape`；loopback HTML 已集中渲染并转义动态文本，`npm test` 和 `npm run build` 通过。
- 2026-04-28 09:34 CST：开始 `P0.9 P0 阶段总验收`；按阶段底线重新运行 `npm run build` 和 `npm test`。
- 2026-04-28 09:35 CST：完成 `P0.9 P0 阶段总验收`；`npm run build` 和 `npm test`（110 pass）通过，P0 转入完成。
- 2026-04-28 09:46 CST：开始 `P1.3 修复平台 handler 配置读取和 autoSync/autoRedeploy`；先修 handler 配置来源，确保平台操作读取 resolved deploy secret，而不是公开脱敏 runtime。
- 2026-04-28 09:48 CST：完成 `P1.3` 配置来源修复小步；平台 handler 已改为 resolved config resolver，平台操作保存配置后不再使用请求体中的脱敏/不完整 deploy 字段判断。
- 2026-04-28 09:51 CST：完成 `P1.3` 行为测试小步；新增 `test/platform-handler-config.test.js`，覆盖 resolved deploy、autoSync/autoRedeploy、保留旧 token 和响应不回显 token preview；定向测试通过。
- 2026-04-28 09:52 CST：完成 `P1.3` 定向联测小步；`node --test test/platform-handler-config.test.js test/config-runtime-settings.test.js test/cloud-deploy.test.js` 通过（14 pass）。
- 2026-04-28 09:54 CST：完成 `P1.3 修复平台 handler 配置读取和 autoSync/autoRedeploy`；`npm test` 112 pass，`npm run build` 通过。
- 2026-04-28 09:55 CST：开始 `P1.4 梳理并统一平台能力矩阵`；先对齐 README、部署配置和现有测试覆盖。
- 2026-04-28 10:00 CST：完成 `P1.4` README 能力矩阵小步；新增 Node/Docker/Vercel/Netlify/Cloudflare Pages/EdgeOne Pages 能力表和降级边界说明，`node --test test/cloud-deploy.test.js` 通过（10 pass）。
- 2026-04-28 10:01 CST：完成 `P1.4 梳理并统一平台能力矩阵`；`npm test` 113 pass，README 已明确各部署形态能力和降级边界。
- 2026-04-28 10:02 CST：开始 `P1.5 Docker 构建不携带本地运行时配置`；先补 `.dockerignore` 和 Dockerfile 复制策略，再加测试。
- 2026-04-28 10:05 CST：完成 `P1.5 Docker 构建不携带本地运行时配置`；镜像只复制 `config/.env.example` 且 `.dockerignore` 排除本地运行态产物，`node --test test/docker-packaging.test.js` 与 `npm test` 通过；当前环境无 docker，未执行真实 `docker build`。
- 2026-04-28 10:06 CST：开始 `P1.6 统一 Vercel/Netlify 代理能力或明确降级`；先补 runtime capabilities 和前端 multipart proxy 降级提示。
- 2026-04-28 10:10 CST：完成 `P1.6` 能力声明和前端降级小步；runtime capabilities、前端 multipart proxy 提示、serverless 存储降级和 README 代理说明已对齐，定向测试通过（11 pass）。
- 2026-04-28 10:12 CST：完成 `P1.6 统一 Vercel/Netlify 代理能力或明确降级`；`npm test` 115 pass，`npm run build` 通过。
- 2026-04-28 10:13 CST：完成 `P1.7 P1 阶段总验收`；P1.1-P1.6 均已完成，`npm test` 115 pass，`npm run build` 通过；当前阶段转入 P2。
- 2026-04-28 10:14 CST：开始 `P2.1 图片索引原子写入与并发保护`；先改 `image-storage.js` 为串行写队列 + 原子替换索引，再补并发测试。
- 2026-04-28 10:18 CST：完成 `P2.1 图片索引原子写入与并发保护`；新增原子 JSON 写入、索引串行写队列和 20 并发保存测试，`node --test test/image-storage.test.js` 与 `npm test` 通过。
- 2026-04-28 10:19 CST：开始 `P2.2 图片持久化失败可观测`；先让存储失败从静默吞掉改为结构化返回，再传递到后台任务 progress。
- 2026-04-28 10:23 CST：完成 `P2.2 图片持久化失败可观测`；持久化失败现在返回脱敏 `storageError` 并进入后台任务 progress，定向测试和 `npm test` 通过。
- 2026-04-28 10:24 CST：开始 `P2.3 远程图片 URL 下载加超时和限制`；先复用代理 host 安全判断，再给 URL 下载加 content-type、大小和超时测试。
- 2026-04-28 10:28 CST：完成 `P2.3 远程图片 URL 下载加超时和限制`；远程图片下载已限制 HTTPS、私网 host、content-type、大小和超时，定向测试与 `npm test` 通过。
- 2026-04-28 10:29 CST：开始 `P2.4 后台任务支持取消`；先在 job store 增加 AbortController 和取消状态，再接入 HTTP API 与前端按钮。
- 2026-04-28 10:33 CST：完成 `P2.4 后台任务支持取消`；后台任务支持 pending/running 取消、`POST /api/jobs/:id/cancel`、上游 fetch abort、前端取消按钮和本地停止轮询；`npm test` 125 pass，`npm run build` 通过。
- 2026-04-28 10:34 CST：开始 `P2.5 后台任务 TTL、死任务和队列配置校验`；先处理 env 安全范围和 job store 超时回收。
- 2026-04-28 10:37 CST：完成 `P2.5 后台任务 TTL、死任务和队列配置校验`；后台任务 env 有边界，pending/running 超时会失败并释放槽位，前端能识别后台任务超时；`npm test` 127 pass，`npm run build` 通过。
- 2026-04-28 10:38 CST：开始 `P2.6 存储 scope 语义整理`；先对齐后端返回、设置页按钮文案、README 和 scope 测试。
- 2026-04-28 10:40 CST：完成 `P2.6 存储 scope 语义整理`；三个清理 scope 的后端返回、前端本地清理和 README 文案已对齐；`npm test` 127 pass，`npm run build` 通过。
- 2026-04-28 10:41 CST：完成 `P2.7 P2 阶段总验收`；P2.1-P2.6 全部完成，`npm test` 127 pass，`npm run build` 通过；当前阶段转入 P3。
- 2026-04-28 10:54 CST：开始 `P3.1 前端模块化重构`；采用无框架 ES module 方案，先抽离低耦合基础模块并让静态构建复制 `frontend/` 目录。
- 2026-04-28 10:58 CST：完成 `P3.1` 构建地基小步；新增 `frontend/` ES module 目录并让 `scripts/build-static.js` 递归复制到 `dist/frontend/`，`npm run build` 通过且产物包含 `dist/frontend/*.js`。
- 2026-04-28 10:59 CST：完成 `P3.1` 基础模块抽离小步；已从 `app.js` 抽出 DOM、HTTP timeout/backoff、后台任务恢复条、错误弹窗模块，并同步更新相关源码结构测试；定向 `node --test test/background-job-resilience.test.js test/background-job-ui-state.test.js test/background-job-failure-surface.test.js test/config-runtime-settings.test.js test/error-dialog-structure.test.js test/settings-ui.test.js test/cloud-deploy.test.js test/progress-timing.test.js` 通过（32 pass）。
- 2026-04-28 11:01 CST：完成 `P3.1` 状态模块抽离小步；新增 `frontend/state.js` 统一承载默认 app settings、运行时 state、settings 合并函数；`app.js` 降至 2292 行，定向 `node --test test/settings-ui.test.js test/reference-images.test.js test/config-runtime-settings.test.js test/progress-timing.test.js test/oauth-connection-ui.test.js` 通过（22 pass）。
- 2026-04-28 11:02 CST：完成 `P3.1 前端模块化重构` 阶段验收；新增 `test/frontend-modules.test.js`，`node --test test/frontend-modules.test.js`、`npm run build`、`npm test` 均通过（全量 128 pass）。
- 2026-04-28 11:04 CST：开始 `P3.2 批量生成和多结果管理`；采用推荐路线：先让存储保存 `batchId/batchIndex/batchCount`，再让后台任务用 `count/batchId` 循环稳定单张链路，最后补前端生成数量和批量结果展示。
- 2026-04-28 11:06 CST：完成 `P3.2` 存储层 batch 元数据小步；`image-storage.js` 已在保存和公开历史时保留 `batchId/batchIndex/batchCount`，并对 batch 字段做基础净化；`node --test test/image-storage.test.js test/history-trace-metadata.test.js` 通过（8 pass）。
- 2026-04-28 11:11 CST：完成 `P3.2` 后端批量任务小步；`server.js` 已校验 `count` 范围 1-4、生成/净化 `batchId`，后台任务按 count 循环现有单张链路并合并结果，单张失败会返回失败项且不影响其他成功项；`node --test test/responses-routing.test.js test/background-jobs.test.js test/images-edits-body.test.js` 通过（14 pass）。
- 2026-04-28 11:24 CST：完成 `P3.2` 前端批量 UI 和结果展示小步；设置页/首页可选择 1-4 张，前端会把 `count`/`batchId` 交给后台任务，结果卡片显示批量 meta 并支持单张失败卡片；后端 guardrail 单测和 P3.2 定向综合测试通过（44 pass），下一步跑 `npm run build` 与 `npm test` 阶段验收。
- 2026-04-28 11:26 CST：完成 `P3.2 批量生成和多结果管理` 阶段验收；修正批量生成引入参数后两个源码结构测试的旧断言，`node --test test/cloud-deploy.test.js test/compatibility-routing.test.js` 通过（14 pass），`npm run build` 通过，`npm test` 通过（134 pass）；当前阶段转入 `P3.3 历史搜索、筛选、收藏和删除单图`。
- 2026-04-28 11:26 CST：开始 `P3.3 历史搜索、筛选、收藏和删除单图`；先做存储层字段、搜索、收藏 meta 更新和单图删除，确保所有索引写入继续走同一个串行队列。
- 2026-04-28 11:31 CST：完成 `P3.3` 存储层小步；历史公开记录增加收藏、标签、模型和账号 host/name 元数据，新增 `listHistory()`、`updateMeta()`、`deleteImage()`，并覆盖搜索、收藏切换、标签净化和单图删除；`node --test test/image-storage.test.js test/history-trace-metadata.test.js` 通过（9 pass）。
- 2026-04-28 11:34 CST：完成 `P3.3` 后端 API 小步；新增历史搜索 API、单图 meta 更新 API、单图删除 API，写接口均要求 admin token，删除后 `GET /api/images/:id` 返回 404 且不影响其他图片；`node --test test/storage-history-api.test.js test/storage-security.test.js test/image-storage.test.js test/history-trace-metadata.test.js` 通过（11 pass）。
- 2026-04-28 11:41 CST：完成 `P3.3` 前端历史管理小步；首页增加历史搜索、只看收藏和刷新工具栏，已保存图片卡片增加收藏/删除按钮，收藏/删除会调用后端 API 并刷新统计；`node --check app.js && node --test test/history-ui.test.js test/background-job-ui-state.test.js test/settings-ui.test.js test/css-layout.test.js test/storage-history-api.test.js` 通过（18 pass）。
- 2026-04-28 11:42 CST：完成 `P3.3 历史搜索、筛选、收藏和删除单图` 阶段验收；`npm run build` 通过，`npm test` 通过（137 pass）；当前阶段转入 `P3.4 从历史重新生成/继续图生图`。
- 2026-04-28 11:43 CST：开始 `P3.4 从历史重新生成/继续图生图`；先让历史记录保存不含 key/token 的生成参数快照，再给历史卡片补“重新生成 / 作为参考图继续 / 复制提示词”。
- 2026-04-28 11:45 CST：完成 `P3.4` 生成参数快照小步；历史记录新增脱敏 `generation` 快照，包含 prompt/size/quality/format/background/mode/model/hasRef，不保存 key/token/参考图内容；`node --check server.js && node --test test/image-storage.test.js test/history-trace-metadata.test.js test/storage-history-api.test.js test/background-jobs.test.js` 通过（18 pass）。
- 2026-04-28 11:48 CST：完成 `P3.4` 历史卡片操作小步；历史卡片新增复制提示词、恢复参数并重新生成、作为参考图继续图生图；`node --check app.js && node --test test/history-regenerate-ui.test.js test/history-ui.test.js test/reference-images.test.js test/settings-ui.test.js test/css-layout.test.js` 通过（17 pass）。
- 2026-04-28 11:50 CST：完成 `P3.4 从历史重新生成/继续图生图` 阶段验收；`npm run build` 通过，`npm test` 通过（138 pass）；当前阶段转入 `P3.5 Prompt 模板库和版本管理`。
- 2026-04-28 11:51 CST：开始 `P3.5 Prompt 模板库和版本管理`；采用浏览器本地模板库方案，模板保存名称/内容/风格/类型/标签/版本，导入导出只处理模板数据，不包含账号、key、token。
- 2026-04-28 11:56 CST：完成 `P3.5` 模板库和提示词版本小步；新增本地 Prompt 模板面板，支持保存、应用、追加、更新版本、删除、安全导入导出，并记录手动/自动增强前后版本；`node --check app.js && node --test test/prompt-templates.test.js test/settings-ui.test.js test/prompt-enhancement.test.js test/css-layout.test.js` 通过（17 pass）。
- 2026-04-28 11:57 CST：完成 `P3.5 Prompt 模板库和版本管理` 阶段验收；`npm run build` 通过，`npm test` 通过（139 pass）；当前阶段转入 `P3.6 简易图片编辑工作流`。
- 2026-04-28 11:58 CST：开始 `P3.6 简易图片编辑工作流`；第一版先做参考图自动压缩/可选居中裁剪、mask 上传预览，以及 mask 在图生图链路中的前后端透传。
- 2026-04-28 12:06 CST：完成 `P3.6` 接手确认小步；已核对当前半成品代码和追踪文档，下一步接入参考图预处理上传流程与 mask 前端状态。
- 2026-04-28 12:10 CST：完成 `P3.6` 前端接入小步；参考图上传已走预处理后校验，mask 可上传/预览/移除，后台任务、直连 JSON edits 和兼容 multipart payload 均已带上 mask；`node --check app.js` 通过。
- 2026-04-28 12:14 CST：完成 `P3.6` 后端 mask 转发和限制小步；后端已支持 JSON edits、服务端 multipart edits、代理 multipart 的 mask 转发，并对 mask 单图大小、无参考图和非 edits 链路使用做校验；`node --check server.js` 通过。
- 2026-04-28 12:18 CST：完成 `P3.6` 测试覆盖小步；新增/更新参考图、Images edits body 和兼容 multipart 断言，定向 `node --check app.js && node --check server.js && node --test test/reference-images.test.js test/images-edits-body.test.js test/compatibility-routing.test.js` 通过（15 pass）。
- 2026-04-28 12:20 CST：完成 `P3.6` 关联定向联测小步；后台任务、请求限制、代理安全、参考图和兼容路由定向测试通过（31 pass），下一步执行 `npm run build` 与 `npm test` 阶段验收。
- 2026-04-28 12:22 CST：完成 `P3.6 简易图片编辑工作流` 阶段验收；`npm run build` 通过，`npm test` 通过（144 pass）；当前阶段转入 `P3.7 多模型/多账号对比生成`。
- 2026-04-28 12:24 CST：开始 `P3.7 多模型/多账号对比生成`；先实现前端对比模式选择和元数据，再复用现有生成链路逐组合生成，避免新增会泄露 key/token 的后端聚合接口。
- 2026-04-28 13:00 CST：开始 `P3.9 可访问性和移动端增强`；范围锁定弹窗焦点管理、自定义尺寸键盘、状态读屏、loading ARIA 和 360px 移动端兜底。
- 2026-04-28 13:07 CST：完成 `P3.9` 弹窗焦点管理小步；新增 `frontend/dialog-a11y.js` 并接入设置、账号、编辑、错误弹窗和 lightbox。
- 2026-04-28 13:09 CST：完成 `P3.9` 状态读屏和图片预览键盘入口小步；生成按钮同步 `aria-busy`，错误区域可读屏感知，结果图可用 Enter/Space 打开预览。
- 2026-04-28 13:13 CST：完成 `P3.9` 账号下拉和尺寸选择键盘小步；账号菜单、账号列表和自定义尺寸选择器均具备键盘导航和动态 ARIA 状态。
- 2026-04-28 13:15 CST：完成 `P3.9` 移动端布局兜底小步；输入工具栏、导入导出按钮、modal footer、safe-area 和 360px 视口规则已补齐。
- 2026-04-28 13:17 CST：完成 `P3.9` 自动化测试小步；新增 `test/accessibility-ui.test.js`，并修正设置页尺寸选项静态解析。
- 2026-04-28 13:19 CST：完成 `P3.9` 定向验收；可访问性、CSS、错误弹窗和设置页定向测试 17 pass。
- 2026-04-28 13:23 CST：完成 `P3.9` 与 `P3.10` 阶段总验收；`npm run build && npm test` 通过，全量 162 tests，162 pass，0 fail。

---

# 3. 归档风险备忘

这些风险来自项目审查，处理时不要丢：

## 已关闭风险

- 平台 handler 读取 `deploy` 配置路径疑似错误：已在后续配置中心和平台 handler 测试中修正。
- 图片索引写入非原子，并发可能丢历史：已通过原子写入和并发保存测试关闭。
- 图片持久化失败当前可能静默吞掉：已改为结构化失败并在前端/后台任务中显示。

- `/api/config/runtime` 泄露完整 resolved config：已在 `P0.1` 处理，后续总验收复查。
- 本地 Node/Docker 未配置 admin token 时管理接口默认放行：已在 `P0.2` 处理，后续 `P0.6` 复用到存储清理。
- `/api/proxy` 开放代理风险：已在 `P0.4` 接入统一代理策略，后续总验收复查。
- `serveStatic()` 基于项目根拼路径风险：已在 `P0.3` 改为静态根与白名单/denylist，后续总验收复查。
- 请求体和参考图缺少大小限制：已在 `P0.5` 处理，后续 `P2.3` 继续补 URL 下载大小限制。
- `/api/storage/clear` 需要鉴权：已在 `P0.6` 处理，后续 P2 存储改造继续复用。
- OAuth status 可用 state 抢读成功结果：已在 `P0.7` 处理，state 仅用于内部回调/交换定位。
- OAuth loopback 错误页 HTML 注入：已在 `P0.8` 处理，动态文本统一 escape。
- `npm test` 扫到根目录手工脚本：已在 `P1.1` 处理。

## 仍需复查风险

- 本文中的“后续总验收复查”已在第一轮完成；如要查最新 P0-P3 风险，请跳转到 `docs/audit-p0-p3-tracking-2026-04-28.md` 的“本轮审查关键证据索引”和 P3 待办。

## 新发现风险

- 第一轮文档不再新增新风险；后续新发现问题统一写入 `docs/audit-p0-p3-tracking-2026-04-28.md`，避免两个追踪源互相冲突。
