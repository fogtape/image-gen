# image-gen 管理员鉴权、账号持久化与设置中心重构追踪文档

> 适用项目：`/data/data/com.termux/files/home/image-gen`
> 创建时间：2026-04-29 14:19 CST
> 当前阶段：P1-P6 已完成；管理员解锁、设置中心、账号维度 API 地址、服务端优先账号存储、Upstash 与浏览器 fallback 均已落地并通过回归
> 来源：2026-04-29 并行审查线：管理员鉴权 / 账号持久化 / 设置 UI 信息架构
> 维护规则：每完成一个小步，立即更新状态、完成时间、变更证据、验证结果；不要在文档中写入任何真实 token、密码、Cookie、API Key 或 OAuth token。

---

## 0. 结论

本轮确定采用 **“统一设置中心 + 管理员登录态 + 服务端优先账号存储 + Upstash 云端存储 + 浏览器降级”** 的方案。

核心变化：

1. 管理员鉴权不再藏在“账号管理 → 高级设置 → 部署平台配置”里，改成参考 Metapi 的 **管理员登录/解锁流程**：输入管理员口令登录后，默认拥有全部管理权限。
2. 设置页里的 **“服务端默认 API 地址”主入口删除**；API 地址回到账号维度填写，避免用户误以为填了默认地址就完成账号配置。
3. API Key 账号与 ChatGPT OAuth 账号改为 **服务端优先保存**：Node/Docker 默认写服务端持久化文件；云平台不适合本地文件时支持 Upstash；都不可用时继续兼容浏览器 `localStorage`。
4. 设置、账号、部署、存储、OAuth、导入导出重构为一个语义清晰的 **设置中心**，让新用户按“管理员解锁 → 添加账号 → 测试连接 → 生成图片”的路径完成配置。

---

## 1. 状态约定

- `⬜ 未开始`：尚未实现。
- `🟡 进行中`：正在改代码或验证。
- `✅ 已完成`：代码、测试、文档均满足完成判断。
- `🔴 阻塞`：需要凭据、平台权限或额外产品决策。
- `🟣 延后`：本轮不做，但保留记录。

每个任务完成时补充：

- **完成时间**：例如 `2026-04-29 16:20 CST`
- **变更证据**：关键文件、函数、测试或构建产物
- **验证结果**：命令与通过/失败摘要
- **后续影响**：是否影响其他阶段

全局验收底线：

```bash
npm run build
npm test
```

涉及 Docker、serverless、Upstash、账号迁移时，需要补专项测试或 mock 集成测试。

---

## 2. 并行审查摘要

### 2.1 管理员鉴权现状

当前已有后端管理口令校验，但不是登录态模型：

- 前端输入位置：`index.html` 的账号管理高级区，`configAdminToken`。
- 前端保存位置：`localStorage` 的 `img-gen-config-admin-token`。
- 请求头：`X-Image-Gen-Admin-Token`。
- 后端校验：`server.js` 的 `requireConfigAdmin()` 调 `config-service.js` 的 `verifyAdminToken()`。
- 已受保护：`/api/config/editable`、`/api/config/save`、平台 check/sync/deploy、存储清理、图片删除和 meta 修改。

问题：用户不知道在哪里填，也不知道填完是否“已登录”；每个管理动作各自处理 token，缺少统一登录态、过期、退出和失败回到登录。

### 2.2 Metapi 可借鉴点

Metapi 的清晰点：

- 未登录只显示管理员登录页。
- 输入“管理员令牌”后校验，成功后进入后台。
- 登录态有 TTL，过期后自动退出。
- 所有管理 API 统一加 `Authorization: Bearer <token>`。
- 401/403 自动清理登录态并回到登录。
- 单管理员模型：登录后默认拥有全部权限。

本项目采纳这些点，但保留旧请求头兼容，降低升级风险。

### 2.3 账号保存现状

当前账号仍主要在浏览器本地：

- API Key 账号：`localStorage` key `img-gen-accounts`。
- OAuth 账号：登录结果也写入 `img-gen-accounts`，包含 access/refresh 相关字段。
- 服务端只保存临时 OAuth session，成功结果不落盘。
- Node/Docker 已有服务端配置持久化，但不是账号持久化。

问题：Docker/Node 多浏览器或容器重启场景，用户以为“服务端配置已保存”，但账号仍在当前浏览器；云平台没有本地持久文件时也缺少远程存储方案。

### 2.4 设置 UI 现状

当前两个弹窗概念混杂：

- 齿轮“设置”里有生成、水印、提示词、存储、导入导出、服务端默认配置。
- 账号管理里有 API Key、OAuth、全局代理、部署平台、管理口令。
- `serverDefaultApiUrl` 与账号编辑 `editUrl` 容易混淆。
- 管理员口令被放在部署平台字段组，语义不对。

问题：新用户不知道第一步应该添加账号、登录 ChatGPT、填默认 API 地址还是填管理员口令。

---

## 3. 三个可选方案与最终选择

| 方案 | 内容 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| A. 小改现有弹窗 | 保留设置和账号管理两个弹窗，只移动管理员口令并加提示 | 改动小，风险低 | 仍然入口分裂，后续 Upstash/服务端账号会继续把 UI 撑乱 | 不采用 |
| B. 统一设置中心 | 合并设置与账号管理，按“快速开始、管理员、账号、生成、连接、存储、部署、导入导出”重排 | 新用户路径最清晰，可承载服务端账号和 Upstash | 改动中等，需要较多前端回归测试 | **采用** |
| C. 完全 Metapi 后台壳 | 首屏管理员登录，登录后进入完整后台式侧边栏，生成页也在后台内 | 权限模型最统一 | 对当前图片生成产品形态改动大，可能破坏轻量体验 | 延后，仅保留可选全站鉴权开关 |

最终采用 **方案 B**：统一设置中心 + 管理员登录态。
同时预留 `IMAGE_GEN_REQUIRE_ADMIN_FOR_APP=true` 一类开关，后续如需可升级到全站登录门禁。

---

## 4. 最终目标信息架构

### 4.1 统一设置中心分区

建议将当前“设置”和“账号管理”合并为一个大弹窗/页面，使用左侧导航或顶部 Tab：

1. **快速开始**
   - 当前是否有账号
   - 当前账号是否可用
   - 管理员是否已解锁
   - 存储位置/持久化状态
   - CTA：`管理员解锁`、`添加 API Key`、`登录 ChatGPT`、`测试连接`

2. **管理员**
   - 管理员登录/退出
   - 当前状态：未登录 / 已登录 / 已过期 / 口令错误
   - 可选：修改管理员口令
   - 说明：登录后默认拥有全部管理权限

3. **账号**
   - API Key 账号
   - ChatGPT OAuth 账号
   - 当前使用账号
   - 账号保存位置：服务端 / Upstash / 当前浏览器
   - 本地账号迁移到服务端

4. **生成默认值**
   - 尺寸、质量、格式、数量
   - 图片模型、Responses 主模型
   - 流式、自动回退、图生图兼容
   - 说明：这是生成偏好/新账号默认值，不保存 API Key

5. **连接与代理**
   - 强制代理
   - CORS 自动回退说明
   - 当前部署代理能力：JSON / SSE / multipart
   - 不再提供“服务端默认 API 地址”主字段

6. **存储与同步**
   - 图片历史保存开关
   - 当前图片/账号存储后端
   - Node/Docker 本地数据目录状态
   - Upstash 配置状态与测试连接
   - 清理图片/对话数据

7. **部署同步**
   - 平台：Node/Docker/Vercel/Netlify/Cloudflare/EdgeOne
   - 平台 account/project/token
   - 校验平台配置
   - 同步环境变量
   - 触发重新部署
   - 自动同步/自动重部署

8. **增强与外观**
   - 水印
   - 提示词增强

9. **导入 / 导出**
   - 安全导出
   - 完整加密导出
   - 导入本地备份
   - 迁移到服务端存储

### 4.2 新用户推荐路径

```text
打开页面
  → 顶部提示“未配置账号”
  → 打开设置中心 / 快速开始
  → 如需改服务端配置，先管理员解锁
  → 添加 API Key 或登录 ChatGPT
  → 测试连接
  → 返回生成页开始生成
```

### 4.3 API 地址语义

- 删除设置页主入口中的 `服务端默认 API 地址` 字段。
- API 地址只在账号编辑中作为 **“此账号的 API 地址”** 出现。
- 后端 `providerDefaults.apiUrl` 可保留为兼容旧环境变量、旧配置和新账号默认预填值，但不再作为新用户主要配置路径。
- 空账号时明确提示：`添加 API Key 或登录 ChatGPT 后才能生成图片。`

---

## 5. 管理员登录态设计

### 5.1 前端会话

新增 `frontend/admin-session.js`：

- `persistAdminSession(token, ttlMs)`
- `getAdminToken()`
- `hasValidAdminSession()`
- `clearAdminSession()`
- `ADMIN_SESSION_DURATION_MS = 12 * 60 * 60 * 1000`

本地 key 建议：

- `img-gen-admin-token`
- `img-gen-admin-token-expires-at`

兼容迁移：

- 首次读取时，如果存在旧 `img-gen-config-admin-token`，可迁移到新 session key 并设置 TTL。
- 迁移后不在 UI 中继续展示旧字段。

### 5.2 管理 API 客户端

新增 `adminFetch()`：

- 自动加 `Authorization: Bearer <token>`。
- 兼容期可同时加旧头 `X-Image-Gen-Admin-Token`，或后端兼容读取二者。
- 遇到 401/403：清理管理员会话，提示重新登录。
- 所有管理动作统一走它：
  - 读取 editable config
  - 保存配置
  - 平台 check/sync/deploy
  - 服务端账号增删改
  - 存储清理
  - 图片删除和 meta 修改

### 5.3 后端接口

新增：

```http
GET /api/admin/session
GET /api/admin/security
POST /api/admin/token/change
```

行为：

- `GET /api/admin/session`：只校验 token，返回 `{ ok: true, role: "admin" }`，不返回敏感信息。
- `GET /api/admin/security`：返回 `adminTokenConfigured`、运行时能力、是否允许本机开发免鉴权等脱敏状态。
- `POST /api/admin/token/change`：旧口令 + 新口令 + 确认，成功后旧口令失效。

后端鉴权读取顺序：

1. `Authorization: Bearer <token>`
2. 兼容旧 `X-Image-Gen-Admin-Token`
3. 是否保留 body `adminToken` 需在实现前明确；推荐仅兼容一版并标记废弃

### 5.4 权限模型

- 当前只做单管理员模型。
- 管理员登录后默认拥有全部管理权限。
- 不引入角色、只读管理员、团队成员等复杂权限。

---

## 6. 账号服务端优先存储设计

### 6.1 存储优先级

默认 `IMAGE_GEN_ACCOUNT_STORE=auto`：

1. Node/Docker：优先 `file` 服务端文件存储。
2. Serverless/云平台：如配置 Upstash，则使用 `upstash`。
3. 不支持服务端存储或未配置 Upstash：回退 `browser`，继续用当前 `localStorage`。

建议环境变量：

```env
IMAGE_GEN_ACCOUNT_STORE=auto
IMAGE_GEN_ACCOUNT_STORE_NAMESPACE=image-gen
IMAGE_GEN_ACCOUNT_STORE_FILE=data/accounts.enc.json
IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY=
IMAGE_GEN_UPSTASH_REDIS_REST_URL=
IMAGE_GEN_UPSTASH_REDIS_REST_TOKEN=
```

说明：

- Node/Docker 如未提供加密 key，可由服务端生成本地 key 并保存到 `config/.account-store-key`；Docker 需要挂载 `config/` 才能长期复用。
- Upstash 场景必须配置 `IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY`，避免远程 KV 明文保存 API Key / OAuth token。

### 6.2 存储适配器

新增模块建议：

```text
account-store.js
account-store-file.js
account-store-upstash.js
account-store-crypto.js
```

统一接口：

```js
getCapabilities()
listAccounts(scope)
createAccount(scope, account)
updateAccount(scope, id, patch)
deleteAccount(scope, id)
saveAccounts(scope, accounts, options)
```

### 6.3 账号 API

新增：

```http
GET /api/accounts/capabilities
GET /api/accounts
POST /api/accounts
PATCH /api/accounts/:id
DELETE /api/accounts/:id
POST /api/accounts/import-local
```

要求：

- 服务端账号 API 需要管理员登录。
- 返回账号列表时默认脱敏 secret，只返回 `apiKeyConfigured`、`oauthTokenConfigured` 等状态。
- 生成请求尽量传 `accountId/accountRef`，由服务端解析真实 key/token；避免把服务端保存的 secret 再发回浏览器。
- 浏览器 fallback 模式保留现有 `img-gen-accounts` 格式。

### 6.4 OAuth 账号保存

Node/Docker 或 Upstash 可用时：

- OAuth exchange 成功后优先保存到服务端账号存储。
- 前端只拿到账号元数据和当前 activeId。
- refresh token 后同步更新服务端账号存储。

Fallback 模式：

- 保留现有前端保存 OAuth token 到 `localStorage` 的路径。
- UI 必须提示：`当前账号仅保存在此浏览器。`

---

## 7. Upstash 支持设计

### 7.1 适用范围

Upstash 用于不适合本地持久文件的部署：

- Vercel
- Netlify Functions
- Cloudflare Pages Functions（如项目接入）
- EdgeOne Pages Functions（如运行时支持）
- 也允许 Node/Docker 主动选择 Upstash，用于多实例共享账号

### 7.2 Key 设计

建议：

```text
{namespace}:accounts:{deploymentId}:{adminScope}
{namespace}:settings:{deploymentId}:{adminScope}
{namespace}:locks:{deploymentId}:{resource}
```

首版可以单管理员单空间，不做多用户。
若未来需要多用户，可再引入 sync passphrase / tenantId。

### 7.3 UI 配置位置

放在 **存储与同步**：

- 当前账号存储：`服务端文件 / Upstash / 当前浏览器`
- Upstash 状态：`未配置 / 已配置待校验 / 已连接 / 连接失败`
- 字段：REST URL、REST Token、Namespace、加密 Key 状态
- 按钮：`测试 Upstash`、`迁移浏览器账号到服务端`

敏感字段只在管理员登录后显示/保存；保存后不回显原文。

---

## 8. 文案准则

### 8.1 管理员

- 标题：`管理员解锁`
- 未登录：`未解锁：只能使用浏览器本地配置，不能修改服务端配置或服务端账号。`
- 已登录：`已解锁：你拥有全部管理权限。`
- 失败：`管理员口令不正确或当前部署未启用管理接口。`
- 退出：`退出管理员模式`

### 8.2 账号

- 空状态：`未配置账号`
- 副文案：`添加 API Key 或登录 ChatGPT 后才能生成图片。`
- API Key 按钮：`添加 API Key 账号`
- OAuth 按钮：`登录 ChatGPT 账号`
- 保存位置提示：
  - `账号将保存到服务端。`
  - `账号将保存到 Upstash。`
  - `账号仅保存在当前浏览器。`

### 8.3 API 地址

账号编辑字段：

- `此账号的 API 地址`
- 辅助文案：`当前账号实际请求会优先使用这里的地址。`

不再使用：

- `默认 API 地址` 作为设置页主配置项

### 8.4 部署同步

- `保存服务端配置只影响当前运行实例；云平台通常还需要同步环境变量并重新部署。`
- `首次配置平台 token 时建议先手动校验，再开启自动同步。`

---

## 9. 实施看板

| 阶段 | 主题 | 状态 | 阶段完成判断 |
|---|---|---:|---|
| P0 | 设计冻结与测试基线 | ✅ 已完成 | 当前测试基线记录完成，追踪文档确认 |
| P1 | 管理员登录态与统一 adminFetch | ✅ 已完成 | 登录、TTL、退出、401 回登录、Bearer 鉴权通过 |
| P2 | 统一设置中心信息架构 | ✅ 已完成 | 设置/账号合并，管理员、账号、存储、部署位置清晰 |
| P3 | 删除设置页默认 API 地址主入口 | ✅ 已完成 | 新用户只在账号维度填写 API 地址，旧配置兼容；生成默认值语义已归位 |
| P4 | Node/Docker 服务端账号文件存储 | ✅ 已完成 | P4.1 能力接口、P4.2 文件适配器、P4.3 账号 CRUD 与前端服务端优先同步、P4.4 浏览器账号迁移均完成 |
| P5 | Upstash 账号存储与云平台降级 | ✅ 已完成 | Upstash 适配器、配置入口、连接测试和浏览器 fallback 均完成 |
| P6 | 文档、迁移与发布门禁 | ✅ 已完成 | README/测试/构建/回归全部通过 |

---

## 10. 详细任务

### P0.1 记录当前测试基线

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 14:25 CST
- **目标**：改动前记录 `npm test`、`npm run build` 当前结果，避免大重构后不清楚回归来源。
- **完成判断**：追踪文档补充基线命令输出摘要。
- **建议验证**：
  ```bash
  npm test
  npm run build
  ```
- **变更证据**：当前变更开始前仅新增本追踪文档；源码尚未进入 P1 改造。
- **验证结果**：
  ```bash
  npm test
  npm run build
  ```
  结果：`npm test` 通过，203 tests，203 pass，0 fail，0 cancelled；`npm run build` 通过，输出 `Static build written to dist/`。

### P1.1 新增管理员会话模块

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 14:27 CST
- **目标**：从一次性 `configAdminToken` 改为有 TTL 的管理员登录态。
- **推荐变更**：
  - 新增 `frontend/admin-session.js`
  - 迁移旧 `img-gen-config-admin-token`
  - 增加会话过期自动清理
- **完成判断**：前端单测覆盖保存、读取、过期、退出和旧 key 迁移。
- **变更证据**：
  - 新增 `frontend/admin-session.js`
  - 新增 `test/admin-session.test.js`
  - 覆盖 `persistAdminSession()`、`getAdminToken()`、`hasValidAdminSession()`、`clearAdminSession()` 与旧 key `img-gen-config-admin-token` 迁移。
- **验证结果**：
  ```bash
  node --test test/admin-session.test.js
  ```
  结果：4 tests，4 pass，0 fail。

### P1.2 新增后端管理员 session 接口与 Bearer 兼容

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 14:28 CST
- **目标**：支持参考 Metapi 的 `Authorization: Bearer` 管理登录验证。
- **推荐变更**：
  - `GET /api/admin/session`
  - `GET /api/admin/security`
  - `readAdminToken()` 支持 Bearer + 旧头
  - CORS allow headers 补 `Authorization`
- **完成判断**：无 token/错 token 拒绝，正确 Bearer 和旧头均通过，不泄露 token。
- **变更证据**：
  - 新增 `test/admin-auth-api.test.js`
  - `server.js` 的 `readAdminToken()` 优先读取 `Authorization: Bearer <token>`，继续兼容 `X-Image-Gen-Admin-Token` 与 body `adminToken`。
  - 新增 `GET /api/admin/session` 与 `GET /api/admin/security`。
- **验证结果**：
  ```bash
  node --test test/admin-auth-api.test.js test/config-admin-security.test.js
  ```
  结果：5 tests，5 pass，0 fail。

### P1.3 统一管理 API 调用为 `adminFetch()`

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 14:33 CST
- **目标**：所有管理动作统一带登录态，401/403 自动回到管理员登录。
- **覆盖函数**：
  - `fetchEditableRuntimeConfig()`
  - `saveServerRuntimeConfig()`
  - `runPlatformAction()`
  - `clearStorageData()`
  - 图片 meta 修改 / 删除
- **完成判断**：不再从部署平台字段读取 `configAdminToken`；管理动作未登录时提示先解锁。
- **变更证据**：
  - 新增 `frontend/admin-api.js`，`adminFetch()` 自动附加 `Authorization: Bearer <token>`，未登录直接拒绝，401/403 清理会话。
  - `app.js` 导入 `adminFetch()` 与管理员会话模块；`fetchEditableRuntimeConfig()`、`saveServerRuntimeConfig()`、`runPlatformAction()`、`clearStorageData()`、图片 meta 修改/删除均改用 `adminFetch()`。
  - `index.html` 新增独立“管理员解锁”区：`adminTokenInput`、`adminLoginBtn`、`adminLogoutBtn`、`adminSessionStatus`；移除部署平台区里的 `configAdminToken`。
  - 新增 `test/admin-api.test.js`、`test/admin-fetch-ui.test.js`，并更新 `test/config-runtime-settings.test.js`、`test/settings-ui.test.js` 的新语义断言。
- **验证结果**：
  ```bash
  node --test test/settings-ui.test.js test/config-runtime-settings.test.js test/frontend-modules.test.js test/admin-api.test.js test/admin-session.test.js test/admin-fetch-ui.test.js
  ```
  结果：27 tests，27 pass，0 fail。

  全量回归：
  ```bash
  npm test
  npm run build
  ```
  结果：`npm test` 通过，214 tests，214 pass，0 fail，0 cancelled；`npm run build` 通过，输出 `Static build written to dist/`。

### P1.4 管理员口令修改入口

- **状态**：🟣 延后
- **延后时间**：2026-04-29 14:34 CST
- **目标**：登录后可修改服务端管理员口令，成功后当前会话切到新口令。
- **推荐变更**：
  - `POST /api/admin/token/change`
  - 最低长度校验
  - 旧口令校验
  - 限速或冷却
- **完成判断**：旧口令失效，新口令生效，响应和日志不回显口令。
- **延后原因**：本轮 P1 的核心目标是“管理员解锁后统一拥有全部管理权限”，已由登录态、Bearer 鉴权、退出和 `adminFetch()` 完成；修改管理员口令涉及服务端持久化与安全校验策略，后续可作为独立安全增强实现。
- **变更证据**：无代码变更
- **验证结果**：不适用

### P2.1 合并设置与账号管理为设置中心

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 14:51 CST
- **目标**：取消“设置”和“账号管理”两套割裂弹窗，统一为清晰分区。
- **推荐变更**：
  - `index.html` 重构设置中心结构
  - `style.css` 增加设置中心导航、状态卡、空状态
  - `app.js` 调整打开入口与 Tab 切换
- **完成判断**：存在快速开始、管理员、账号、生成默认值、连接与代理、存储与同步、部署同步、增强与外观、导入导出分区。
- **变更证据**：
  - `index.html` 将原设置弹窗改为 `设置中心`，新增 `settingsCenterNav` / `settingsPanel*` 九个语义分区。
  - `index.html` 删除独立 `accountOverlay`，账号管理内容迁入 `settingsPanelAccounts`；部署字段迁入 `settingsPanelDeploy`；全局代理迁入 `settingsPanelConnection`。
  - `app.js` 新增 `setSettingsPanel()`、`syncSettingsCenterSummary()`、`openSettingsCenter()`；账号下拉“管理账号”改为打开设置中心的账号分区。
  - `style.css` 新增设置中心两栏导航、快速开始卡片、状态胶囊、移动端堆叠样式。
  - 新增 `test/settings-center-ui.test.js`，更新 `test/settings-ui.test.js`、`test/accessibility-ui.test.js`、`test/config-runtime-settings.test.js`。
- **验证结果**：
  ```bash
  node --test test/settings-ui.test.js test/config-runtime-settings.test.js test/settings-api-address-semantics.test.js test/accessibility-ui.test.js test/admin-fetch-ui.test.js test/settings-center-ui.test.js
  npm test
  npm run build
  ```
  结果：专项测试 32 tests，32 pass；全量 `npm test` 220 tests，220 pass，0 fail；`npm run build` 通过，输出 `Static build written to dist/`。

### P2.2 快速开始与空账号引导

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 14:51 CST
- **目标**：新用户不用看 README 也能知道先添加账号。
- **完成判断**：无账号时顶部和设置中心均显示 `未配置账号`，提供添加 API Key / 登录 ChatGPT CTA。
- **变更证据**：
  - `index.html` 顶部账号名称默认改为 `未配置账号`。
  - `index.html` 快速开始分区提供 `解锁管理员`、`添加 API Key 账号`、`登录 ChatGPT 账号`、`测试当前账号连接` 四个 CTA。
  - `app.js` 无账号时 `renderSwitcher()` 显示 `未配置账号`；快速开始 CTA 可跳转管理员/账号分区或触发连接测试。
  - `app.js` `syncSettingsCenterSummary()` 会随账号列表和当前账号更新快速开始状态。
- **验证结果**：
  ```bash
  node --test test/settings-center-ui.test.js
  npm test
  npm run build
  ```
  结果：`test/settings-center-ui.test.js` 4 tests，4 pass；全量 `npm test` 220 tests，220 pass；`npm run build` 通过。

### P3.1 删除设置页“服务端默认 API 地址”主入口

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 14:37 CST
- **目标**：避免默认 API 地址与账号 API 地址混淆。
- **推荐变更**：
  - 移除或隐藏 `serverDefaultApiUrl` 所在主配置项
  - 账号编辑中强化 `此账号的 API 地址`
  - 保留后端 `providerDefaults.apiUrl` 兼容旧配置和 env
- **完成判断**：设置中心不再把 API 地址作为服务端默认配置主字段；添加账号才是填写 API 地址入口。
- **变更证据**：
  - `index.html` 移除 `serverDefaultApiUrl` 字段；服务端默认配置区文案改为生成默认值，提示 API 地址在具体账号里填写。
  - `index.html` 账号编辑字段改为 `此账号的 API 地址`，补充“当前账号实际请求会优先使用这里的地址”说明。
  - `app.js` 不再读取 `#serverDefaultApiUrl`；保存服务端默认配置时保留已有 `providerDefaults.apiUrl`，避免无字段时清空旧配置。
  - 新增 `test/settings-api-address-semantics.test.js`，并更新 `test/config-runtime-settings.test.js`。
- **验证结果**：
  ```bash
  node --test test/config-runtime-settings.test.js test/settings-ui.test.js test/settings-api-address-semantics.test.js
  ```
  结果：19 tests，19 pass，0 fail。

  全量回归：
  ```bash
  npm test
  npm run build
  ```
  结果：`npm test` 通过，216 tests，216 pass，0 fail，0 cancelled；`npm run build` 通过，输出 `Static build written to dist/`。

### P3.2 调整模型与生成默认值语义

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 17:01 CST
- **目标**：保留有用默认值，但明确它们是生成偏好，不是账号配置。
- **完成判断**：图片模型、Responses 模型、尺寸、质量、格式等集中在“生成默认值”。
- **变更证据**：
  - `index.html` 的设置中心提供独立“生成默认值”分区，包含默认图片模型、默认流式主模型、默认尺寸、质量、格式、背景、数量、流式与图生图兼容开关。
  - `index.html` / `app.js` 保持账号编辑里的“此账号的 API 地址”为账号级入口；设置中心文案说明“这里是生成偏好和新账号默认值；API Key 与 API 地址请在账号里配置”。
  - `app.js` 的 `readServerConfigForm()` 继续保留旧 `providerDefaults.apiUrl` 兼容，但不再从设置页主字段读取。
  - `test/settings-center-ui.test.js`、`test/settings-api-address-semantics.test.js`、`test/settings-ui.test.js` 覆盖生成默认值分区和 API 地址语义。
- **验证结果**：
  ```bash
  node --test test/settings-center-ui.test.js test/settings-api-address-semantics.test.js test/settings-ui.test.js
  npm test
  npm run build
  ```
  结果：设置中心 / API 地址语义专项通过；全量 `npm test` 241 tests，241 pass，0 fail；`npm run build` 通过，输出 `Static build written to dist/`。

### P4.1 新增账号存储能力接口

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 15:19 CST
- **目标**：前端可判断当前保存位置是服务端、Upstash 还是浏览器。
- **推荐接口**：
  ```http
  GET /api/accounts/capabilities
  ```
- **完成判断**：返回 store type、available、encrypted、fallback 等脱敏能力。
- **响应语义**：
  - `store.type`：`file` / `upstash` / `browser`
  - `store.available`：当前服务端或远程账号存储是否可用
  - `store.encrypted`：是否检测到账号加密配置
  - `store.fallback`：固定为 `browser`，表示后端不可用时继续兼容浏览器缓存
  - `store.scope`：`server` / `remote` / `browser`
  - `store.reason`：脱敏原因码，如 `node-file-store`、`serverless-without-upstash`、`upstash-not-configured`
- **安全边界**：能力接口公开可读但只返回脱敏状态；不返回 Upstash URL、Upstash Token、账号加密 key、管理员口令、API Key、OAuth token 或账号明细。
- **变更证据**：
  - 新增 `account-store-capabilities.js`，用纯函数解析 `IMAGE_GEN_ACCOUNT_STORE`、Upstash 配置、账号加密 key 与 serverless/runtime 状态。
  - `server.js` 新增 `GET /api/accounts/capabilities`，返回 `resolveAccountStoreCapabilities()` 的脱敏结果。
  - `frontend/state.js` 新增 `state.accountStoreCapabilities`。
  - `app.js` 新增 `fetchAccountStoreCapabilities()`、`syncAccountStoreUi()`、`describeAccountStore()`，设置中心打开和页面初始化时刷新保存位置状态；404/网络错误时静默回退浏览器缓存。
  - `index.html` 在快速开始、账号保存位置、存储与同步区加入动态状态节点：`settingsAccountStorageStatus`、`accountStoreType`、`accountStoreDetail`、`accountStoreEncrypted`、`storageAccountStoreStatus`。
  - 新增 `test/account-store-capabilities.test.js`、`test/account-store-capabilities-api.test.js`、`test/account-store-capabilities-ui.test.js`。
- **验证结果**：
  ```bash
  node --test test/account-store-capabilities.test.js test/account-store-capabilities-api.test.js test/account-store-capabilities-ui.test.js
  npm test
  npm run build
  ```
  结果：专项测试 6 tests，6 pass；全量 `npm test` 226 tests，226 pass，0 fail；`npm run build` 通过，输出 `Static build written to dist/`。
- **后续影响**：P4.2 可直接复用能力解析结果实现 Node/Docker 文件账号存储；P5 可在 Upstash 适配器完成后把 `upstash` 从能力展示升级为真实账号读写目标。

### P4.2 Node/Docker 文件账号存储

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 15:42 CST
- **目标**：Node/Docker 下 API Key 与 OAuth 账号优先保存到服务端持久文件。
- **推荐变更**：
  - 新增 `account-store-file.js`
  - 原子写入
  - Docker 复用挂载的 `data/` 或配置路径
  - 服务端只返回脱敏账号元数据
- **完成判断**：文件适配器可以加密保存 API Key/OAuth 账号、重新实例化后读取、列表响应脱敏、更新/删除原子写入且无临时文件残留；“刷新浏览器/换浏览器后账号仍存在”的端到端 UI 验收需要 P4.3 CRUD API 接入后完成。
- **变更证据**：
  - 新增 `account-store-file.js`：实现 AES-256-GCM envelope 加密落盘、账号字段规范化、脱敏列表、`saveAccounts()`、`listAccounts()`、`loadAccounts({ includeSecrets })`、`upsertAccount()`、`deleteAccount()`。
  - 新增 `account-store.js`：实现 Node/Docker 文件存储工厂、默认账号文件路径 `data/accounts.enc.json`、本地加密 key 文件 `config/.account-store-key` 的生成与复用；后续 Docker 需挂载 `config/` 才能稳定解密已有账号文件。
  - 更新 `account-store-capabilities.js`：Node/Docker 文件存储默认视为可加密，因为会使用 env key 或本地生成 key。
  - 更新 `app.js` 保存位置文案：服务端文件存储显示“已启用账号存储加密”。
  - 新增 `test/account-store-file.test.js`，覆盖加密落盘不含 secret、脱敏列表不回显 `apiKey` / `refreshToken` / OAuth session、原子更新删除、本地 key 复用。
  - 更新 `test/account-store-capabilities.test.js`，锁定 Node/Docker 文件存储 `encrypted: true`。
- **验证结果**：
  ```bash
  node --test test/account-store-file.test.js test/account-store-capabilities.test.js
  npm test
  npm run build
  ```
  结果：专项测试 7 tests，7 pass；全量 `npm test` 229 tests，229 pass，0 fail；`npm run build` 通过，输出 `Static build written to dist/`。
- **后续影响**：P4.3 可以直接用 `createAccountStore()` 提供 `GET/POST/PATCH/DELETE /api/accounts`；所有修改接口仍需管理员登录，列表接口只能返回 `redactAccountForList()` 结果。

### P4.3 服务端账号 CRUD API

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 15:24 CST
- **目标**：账号管理界面的增删改查优先走服务端。
- **推荐接口**：
  ```http
  GET /api/accounts
  POST /api/accounts
  PATCH /api/accounts/:id
  DELETE /api/accounts/:id
  ```
- **完成判断**：API Key/OAuth secret 不在列表响应明文出现；未登录管理员不能修改；前端在管理员已解锁且服务端/Upstash 账号存储可用时，会把新增、编辑、删除同步到服务端，失败时保留浏览器缓存 fallback。
- **变更证据**：
  - `server.js` 新增 `GET /api/accounts`、`POST /api/accounts`、`PATCH /api/accounts/:id`、`DELETE /api/accounts/:id`；所有账号明细读写接口均要求 `requireConfigAdmin()`。
  - `server.js` 新增 `getAccountStoreContext()`、`getAvailableAccountStore()`、`sanitizeAccountPayload()`、`handleAccountsList()`、`handleAccountCreate()`、`handleAccountPatch()`、`handleAccountDelete()`；响应统一返回脱敏账号列表和 `store` 能力，不返回 API Key、OAuth access/refresh token、session 或管理员口令。
  - `account-store-file.js` 补齐 `patchAccount()`；名称等普通字段更新时保留原 secret，更新 secret 时仍只加密落盘、不在响应回显。
  - `app.js` 新增 `canUseServerAccountStore()`、`createServerAccount()`、`patchServerAccount()`、`deleteServerAccountOnServer()`；账号新增、编辑、删除继续先写浏览器兼容副本，再在管理员已解锁且服务端账号存储可用时通过 `adminFetch()` 同步服务端。
  - `app.js` 的 `addAccount()`、`updateAccount()`、`deleteAccount()` 支持 `{ syncServer: false }`，为后续服务端脱敏列表导入/迁移避免递归同步预留安全开关。
  - 新增 `test/account-store-crud-api.test.js` 与 `test/account-store-client-ui.test.js`。
- **验证结果**：
  ```bash
  node --test test/account-store-client-ui.test.js test/account-store-crud-api.test.js test/account-store-file.test.js
  npm test
  npm run build
  ```
  结果：专项测试 5 tests，5 pass；全量 `npm test` 231 tests，231 pass，0 fail；`npm run build` 通过，输出 `Static build written to dist/`。

### P4.4 浏览器账号迁移到服务端

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 15:32 CST
- **目标**：已有用户可一键把本地账号迁到服务端或 Upstash。
- **推荐变更**：
  - `POST /api/accounts/import-local`
  - 前端显示迁移预览
  - 成功后询问是否清理浏览器本地账号副本
- **完成判断**：迁移过程不丢 activeId，不重复账号，不回显 secret。
- **本轮取舍**：先实现轻量迁移按钮，不自动清理浏览器副本；保留副本可以继续作为 fallback。账号选择预览和迁移后清理副本可作为后续增强。
- **变更证据**：
  - `server.js` 新增 `POST /api/accounts/import-local`，要求管理员鉴权，读取浏览器上传的账号数组并与服务端账号按 `id` 合并，保留 `activeId`。
  - `server.js` 新增 `sanitizeAccountImportPayload()`、`handleAccountsImportLocal()`；响应只返回脱敏账号列表、`imported` 数量、`activeId` 和 `store` 能力。
  - `index.html` 的“账号 → 保存位置”新增 `migrateBrowserAccountsBtn` 与 `accountMigrationStatus`，文案明确“迁移当前浏览器账号到服务端”，并说明浏览器副本会保留。
  - `app.js` 新增 `importLocalAccountsToServer()`、`migrateBrowserAccountsToServer()`、`syncAccountMigrationUi()`、`setAccountMigrationStatus()`；前端用 `adminFetch('/api/accounts/import-local')` 上传 `state.data.accounts.map(compactServerAccountPayload)`，迁移失败时提示错误但不破坏本地缓存。
  - `style.css` 新增 `.account-migration-actions`，让迁移按钮与状态说明在设置中心里保持清晰。
  - 新增 `test/account-store-import-api.test.js`、`test/account-store-import-ui.test.js`。
- **验证结果**：
  ```bash
  node --test test/account-store-import-api.test.js test/account-store-import-ui.test.js
  node --test test/account-store-import-api.test.js test/account-store-import-ui.test.js test/account-store-crud-api.test.js test/account-store-client-ui.test.js test/account-store-file.test.js test/settings-center-ui.test.js test/account-store-capabilities-ui.test.js
  npm test
  npm run build
  ```
  结果：迁移专项 2 tests，2 pass；账号存储/设置中心相关回归 12 tests，12 pass；全量 `npm test` 233 tests，233 pass，0 fail；`npm run build` 通过，输出 `Static build written to dist/`。

### P5.1 Upstash 适配器

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 16:18 CST
- **目标**：云平台可使用 Upstash 持久化账号。
- **推荐变更**：
  - 新增 `account-store-upstash.js`
  - REST `GET/SET` 封装
  - 超时、错误分类、重试策略
  - AES-GCM envelope 加密
- **完成判断**：mock Upstash 成功读写；KV 原始值不包含 API Key/OAuth token 明文。
- **变更证据**：
  - 新增 `account-store-upstash.js`：通过 Upstash Redis REST `POST` JSON array 命令执行 `GET` / `SET`，key 为 `{namespace}:accounts:{deploymentId}`。
  - `account-store-upstash.js` 复用 `account-store-file.js` 的 AES-256-GCM envelope 加密、账号规范化和脱敏列表能力；Upstash URL、REST Token、账号加密 Key 不进入错误消息。
  - `account-store-file.js` 导出 `encryptAccountStorePayload()`、`decryptAccountStoreEnvelope()`、`normalizeAccountState()`、`accountNotFoundError()`，供 Upstash 适配器复用。
  - `account-store.js` 在能力解析结果为 `upstash` 且可用时创建远程存储；Upstash 必须使用 env / 配置提供 `IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY`，不会自动生成本地 key。
  - 新增 `test/account-store-upstash.test.js`，覆盖加密写入、脱敏列表、upsert/patch/delete、工厂选择与错误脱敏。
- **验证结果**：
  ```bash
  node --test test/account-store-upstash.test.js test/account-store-file.test.js test/account-store-capabilities.test.js
  node --test test/account-store-upstash.test.js test/account-store-crud-api.test.js test/account-store-import-api.test.js test/account-store-capabilities-api.test.js
  npm test
  npm run build
  ```
  结果：Upstash/账号存储专项通过；全量 `npm test` 240 tests，240 pass，0 fail；`npm run build` 通过，输出 `Static build written to dist/`。

### P5.2 Upstash UI 与配置保存

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 16:39 CST
- **目标**：设置中心能配置/显示 Upstash 状态，并通过部署同步写入云平台 env。
- **完成判断**：管理员登录后可填写 Upstash REST URL/Token；保存后不回显 Token；可测试连接。
- **变更证据**：
  - `config-service.js` 新增 `accountStore` runtime 配置：`type`、`namespace`、`deploymentId`、`upstashRestUrl`、`upstashRestToken`、`encryptionKey`，映射到 `IMAGE_GEN_ACCOUNT_STORE`、`IMAGE_GEN_ACCOUNT_STORE_NAMESPACE`、`IMAGE_GEN_DEPLOYMENT_ID`、`IMAGE_GEN_UPSTASH_REDIS_REST_URL`、`IMAGE_GEN_UPSTASH_REDIS_REST_TOKEN`、`IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY`。
  - `config-service.js` 的 public/editable runtime 只返回 `upstashRestUrlConfigured`、`upstashRestTokenConfigured`、`encryptionKeyConfigured`，不回显 URL、Token 或加密 Key；保存时敏感字段留空会保留已有配置。
  - `server.js` 的账号能力和账号存储工厂改为读取当前 runtime 配置，而不只依赖进程启动时的 `process.env`。
  - `server.js` 新增 `POST /api/accounts/store/test`，管理员鉴权后用当前表单配置测试账号存储连接，响应只返回脱敏 `store`、`accountCount` 和状态消息。
  - `index.html` 的“存储与同步”新增“账号存储配置”表单：保存策略、Namespace、Deployment ID、Upstash REST URL、Upstash REST Token、账号加密 Key 和“测试账号存储”按钮。
  - `app.js` 新增 `fillAccountStoreConfigForm()`、`readAccountStoreConfigForm()`、`testAccountStoreConfigFromForm()`；保存服务端配置后自动刷新账号存储能力，测试失败不破坏浏览器 fallback。
  - `style.css` 为账号存储测试按钮和状态说明补布局。
  - 新增 `test/account-store-upstash-config-api.test.js`，更新 `test/config-runtime-security.test.js`、`test/settings-center-ui.test.js`。
- **验证结果**：
  ```bash
  node --test test/account-store-upstash-config-api.test.js test/config-runtime-security.test.js test/settings-center-ui.test.js
  node --test test/account-store-upstash.test.js test/account-store-capabilities.test.js test/account-store-capabilities-api.test.js test/account-store-crud-api.test.js test/account-store-import-api.test.js test/platform-handler-config.test.js test/config-admin-security.test.js test/config-runtime-settings.test.js
  npm test
  npm run build
  ```
  结果：Upstash 配置/API/脱敏/UI 专项通过；全量 `npm test` 240 tests，240 pass，0 fail；`npm run build` 通过，输出 `Static build written to dist/`。

### P5.3 云平台降级策略

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 16:46 CST
- **目标**：没有 Upstash 或服务端 API 不完整时，不破坏旧浏览器保存行为。
- **完成判断**：Vercel/Netlify/Cloudflare/EdgeOne API 404 或能力不足时，前端显示 `账号仅保存在当前浏览器` 并继续可用。
- **变更证据**：
  - `account-store-capabilities.js`：serverless 且未配置 Upstash 时返回 `type: "browser"`、`fallbackActive: true`、`reason: "serverless-without-upstash"`；显式 Upstash 配置缺失时返回不可用状态但 fallback 仍为 browser。
  - `app.js`：`fetchAccountStoreCapabilities()` 对 `/api/accounts/capabilities` 404 或网络错误使用 `fallbackAccountStoreCapabilities()`；`canUseServerAccountStore()` 必须同时满足管理员已解锁、store 可用且不是 browser，避免云平台缺接口时误写服务端。
  - `app.js`：账号 create/update/delete 的服务端同步失败只记录 `accountStoreSyncWarning()`，不阻断浏览器 `localStorage` 兼容副本。
  - `index.html` / 设置中心文案明确“未配置时继续保存到当前浏览器缓存”。
  - `test/account-store-capabilities-ui.test.js` 新增“账号存储能力缺失或不可用时继续使用浏览器缓存路径”断言。
- **验证结果**：
  ```bash
  node --test test/account-store-capabilities-ui.test.js test/account-store-capabilities.test.js
  npm test
  npm run build
  ```
  结果：降级专项通过；全量 `npm test` 240 tests，240 pass，0 fail；`npm run build` 通过，输出 `Static build written to dist/`。

### P6.1 更新 README 与部署文档

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 16:58 CST
- **目标**：文档与新 UI 一致。
- **需要更新**：
  - 快速开始：管理员解锁 + 添加账号
  - Node/Docker：挂载 `data/` 与 `config/`
  - Upstash：环境变量与安全说明
  - 配置优先级：账号存储优先级
- **完成判断**：README 不再强调在设置页填服务端默认 API 地址作为主路径。
- **变更证据**：
  - `README.md` 功能清单补充“统一设置中心与管理员解锁”“服务端优先账号存储”。
  - `README.md` 快速开始新增“设置中心 → 管理员解锁 → 添加 API Key / 登录 ChatGPT → 在账号编辑填写此账号 API 地址 → 测试连接”的新用户路径。
  - `README.md` 重写“配置优先级与保存位置”：账号默认服务端优先，Node/Docker 写服务端文件，云平台配置 Upstash，未配置则浏览器 fallback。
  - `README.md` Docker 部署说明补充 `data/accounts.enc.json` 与 `config/.account-store-key`，强调必须同时挂载 `config/` 与 `data/`。
  - `README.md` 平台能力矩阵新增“账号存储”列，说明 Vercel + Upstash、纯静态平台浏览器缓存 fallback。
  - `README.md` 环境变量清单新增账号存储 / Upstash 变量：`IMAGE_GEN_ACCOUNT_STORE`、`IMAGE_GEN_ACCOUNT_STORE_NAMESPACE`、`IMAGE_GEN_ACCOUNT_STORE_FILE`、`IMAGE_GEN_DEPLOYMENT_ID`、`IMAGE_GEN_ACCOUNT_ENCRYPTION_KEY`、`IMAGE_GEN_UPSTASH_REDIS_REST_URL`、`IMAGE_GEN_UPSTASH_REDIS_REST_TOKEN`。
  - `README.md` FAQ 更新账号保存位置、云平台同步范围和 Upstash 加密说明，并链接本追踪文档。
  - `test/product-roadmap.test.js` 补 README 新流程、账号存储、Upstash 文档断言。
- **验证结果**：
  ```bash
  node --test test/product-roadmap.test.js test/cloud-deploy.test.js test/docker-packaging.test.js
  npm test
  npm run build
  ```
  结果：README/部署文档专项通过；全量 `npm test` 241 tests，241 pass，0 fail；`npm run build` 通过，输出 `Static build written to dist/`。

### P6.2 测试覆盖

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 16:59 CST
- **目标**：为权限、设置中心、账号存储、Upstash 降级建立回归网。
- **建议测试**：
  - `test/admin-session-ui.test.js`
  - `test/admin-auth-api.test.js`
  - `test/settings-center-ui.test.js`
  - `test/account-store-file.test.js`
  - `test/account-store-upstash.test.js`
  - `test/account-store-fallback.test.js`
- **完成判断**：专项测试、`npm test`、`npm run build` 全部通过。
- **变更证据**：
  - 管理员鉴权：`test/admin-session.test.js`、`test/admin-auth-api.test.js`、`test/admin-api.test.js`、`test/admin-fetch-ui.test.js`。
  - 设置中心与 API 地址语义：`test/settings-center-ui.test.js`、`test/settings-ui.test.js`、`test/settings-api-address-semantics.test.js`、`test/config-runtime-settings.test.js`。
  - 服务端账号存储：`test/account-store-file.test.js`、`test/account-store-crud-api.test.js`、`test/account-store-import-api.test.js`、`test/account-store-client-ui.test.js`、`test/account-store-import-ui.test.js`。
  - Upstash 与降级：`test/account-store-upstash.test.js`、`test/account-store-upstash-config-api.test.js`、`test/account-store-capabilities.test.js`、`test/account-store-capabilities-api.test.js`、`test/account-store-capabilities-ui.test.js`。
  - 文档与部署门禁：`test/product-roadmap.test.js`、`test/cloud-deploy.test.js`、`test/docker-packaging.test.js`。
- **验证结果**：
  ```bash
  npm test
  npm run build
  ```
  结果：`npm test` 241 tests，241 pass，0 fail；`npm run build` 通过，输出 `Static build written to dist/`。

### P6.3 后台任务明确失败时展示上游真实错误

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 17:18 CST
- **问题**：后台生成任务已经由后端标记为 `failed` 后，前端仍会因为 `errorInfo.status` 为 5xx 被 `isRetryableBackgroundJobError()` 当作轮询网络波动，显示“后台任务连接波动 / 已保留后台任务”，用户只能停止或刷新。
- **目标**：区分“轮询请求本身失败，可保留任务重试”和“任务已进入终态失败，应直接展示上游错误”。
- **实现**：
  - `app.js`：`pollBackgroundJob()` 在 `job.status === 'failed'` 时优先使用 `job.errorInfo?.message || job.error` 构造错误，标记 `err.isBackgroundJobTerminalFailure = true`，清理 active job 后直接抛出终态失败。
  - `app.js`：`isRetryableBackgroundJobError()` 对 `isBackgroundJobTerminalFailure` 明确返回 `false`，避免被外层“保留后台任务 / 连接波动”逻辑吞掉。
  - `test/background-job-failure-surface.test.js`：新增回归断言，锁定“明确 failed 不再当成连接波动重试，必须展示上游真实错误”的行为。
- **验证结果**：
  ```bash
  node --check app.js
  node --test test/background-job-failure-surface.test.js test/background-job-resilience.test.js test/background-job-ui-state.test.js test/cloud-deploy.test.js test/background-jobs.test.js
  npm test
  npm run build
  ```
  结果：专项 29 tests 全通过；全量 `npm test` 242 tests，242 pass，0 fail；`npm run build` 通过，输出 `Static build written to dist/`。

### P6.4 最终 diff 审查阻塞项修复

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 17:36 CST
- **问题**：最终并行审查发现 Docker 打包、敏感错误脱敏、账号加密 key 忽略规则、服务端账号拉取、账号页连接测试反馈和未解锁管理员保存文案存在阻塞缺口。
- **实现**：
  - `Dockerfile`：运行阶段复制 `account-store.js`、`account-store-file.js`、`account-store-upstash.js`、`account-store-capabilities.js`，避免容器运行时报 `ERR_MODULE_NOT_FOUND`。
  - `.gitignore` / `.dockerignore`：加入 `config/.account-store-key`，避免自动生成的账号加密 key 被提交或打进构建上下文。
  - `handlers/platform-fetch.js`：平台 API 错误脱敏从 Authorization 扩展到请求 body 中敏感 env 值，覆盖 Upstash token、账号加密 key 等被平台错误回显的情况。
  - `app.js`：新增 `listServerAccounts()`、`mergeServerAccountsIntoLocal()`、`loadServerAccountsIntoLocal()`，管理员解锁或打开设置中心时会读取服务端/Upstash 账号元数据并合并到本地状态；敏感字段仍不从服务端回显。
  - `index.html` / `app.js`：账号页增加 `accountTestResult`，`testConnection()` 同步更新快速开始和账号页结果，避免账号页点击测试但反馈写到隐藏面板。
  - `app.js`：未解锁管理员保存设置时提示“如需写入服务端配置，请先解锁管理员”，不再误报部署不支持。
  - `config/.env.example`：补账号存储和 Upstash 环境变量示例。
- **验证结果**：
  ```bash
  node --check app.js
  node --test test/docker-packaging.test.js test/platform-fetch.test.js test/account-store-client-ui.test.js test/settings-center-ui.test.js test/account-store-capabilities-ui.test.js test/account-store-crud-api.test.js test/account-store-import-api.test.js test/account-store-upstash-config-api.test.js test/config-runtime-security.test.js test/config-runtime-settings.test.js test/admin-fetch-ui.test.js test/background-job-failure-surface.test.js
  ```
  结果：专项 32 tests，32 pass，0 fail。

### P6.5 平台同步错误脱敏补强

- **状态**：✅ 已完成
- **完成时间**：2026-04-29 18:05 CST
- **问题**：最终 diff 审查补充发现平台同步错误脱敏仍有边界缺口：EdgeOne 使用大写 `Key` / `Value` 的 `EnvVars` 请求体，Cloudflare 使用 `FormData` 中的 `settings` JSON Blob；如果上游错误回显请求体里的 Upstash token 或账号加密 key，原有脱敏只覆盖 Authorization 和部分小写 JSON 结构。
- **实现**：
  - `handlers/platform-fetch.js`：请求体脱敏支持大小写字段名，识别 `key/name/env/envName` 与 `value/values/text`；支持解析 JSON 字符串、`URLSearchParams` 和 `FormData` 中 JSON Blob。
  - `handlers/platform-fetch.js`：导出 `collectRequestBodyRedactions()`，并在 HTTP 非 2xx 错误中统一使用 body redactions；错误消息提取兼容 `Message`。
  - `handlers/edgeone-handler.js`：EdgeOne 业务层 `Code !== 0` 的 200 响应也复用同一组请求体 redactions，避免 `Message` 回显 env secret。
  - `test/platform-fetch.test.js`：新增 EdgeOne `Key/Value` 和 Cloudflare `FormData settings` 的错误回显脱敏断言。
  - `test/platform-handler-config.test.js`：新增 EdgeOne 业务错误不回显账号存储 secret 的回归测试。
- **验证结果**：
  ```bash
  node --check handlers/platform-fetch.js
  node --check handlers/edgeone-handler.js
  node --test test/platform-fetch.test.js test/platform-handler-config.test.js
  ```
  结果：专项 10 tests，10 pass，0 fail。

---

## 11. 风险与约束

1. **不要把服务端保存的 secret 再发回浏览器**：服务端账号列表只能返回脱敏元数据。
2. **Upstash 必须加密**：远程 KV 中不得明文保存 API Key、OAuth token、refresh token。
3. **浏览器 fallback 必须保留**：静态部署、函数缺失、Upstash 未配置都不能让旧用户不可用。
4. **管理员口令不能被导出**：安全导出和完整加密导出都不应包含管理员口令本身。
5. **旧配置兼容**：已有 `IMAGE_GEN_DEFAULT_API_URL` 和 `providerDefaults.apiUrl` 不立即删除，只从新 UI 主路径移除。
6. **云平台写 env 后通常需要重新部署**：UI 必须把“保存配置”和“同步/重部署”区分清楚。

---

## 12. 关键证据索引

当前项目证据：

- `app.js`：`ACCOUNTS_KEY`、`APP_SETTINGS_KEY`、`CONFIG_ADMIN_TOKEN_KEY`、`loadData()`、`saveData()`、`saveServerRuntimeConfig()`、`addOAuthAccountFromResult()`。
- `index.html`：当前设置弹窗、账号管理弹窗、`serverDefaultApiUrl`、`configAdminToken`、部署平台配置。
- `server.js`：`requireConfigAdmin()`、`/api/config/*`、`/api/storage/clear`、`/api/images/:id` 管理操作。
- `config-service.js`：`IMAGE_GEN_ADMIN_TOKEN`、`providerDefaults.apiUrl`、服务端 `.env` 持久化、`verifyAdminToken()`。
- `README.md`：配置优先级、浏览器 localStorage 保存说明、Docker 挂载说明、云平台能力矩阵。

Metapi 参考证据：

- `/data/data/com.termux/files/home/metapi/src/web/authSession.ts`：管理员登录态 TTL。
- `/data/data/com.termux/files/home/metapi/src/web/App.tsx`：未登录显示 Login，登录后进入后台。
- `/data/data/com.termux/files/home/metapi/src/web/api.ts`：统一 API 客户端自动带 `Authorization: Bearer`。
- `/data/data/com.termux/files/home/metapi/src/server/middleware/auth.ts`：后端 Bearer 管理鉴权。

---

## 13. 下一步建议

优先顺序：

1. 先做 P0 基线与 P1 管理员登录态，解决“用户不知道在哪里填管理员鉴权”的核心问题。
2. 再做 P2/P3 设置中心重构和默认 API 地址移除，解决新用户配置路径问题。
3. 然后做 P4 Node/Docker 服务端账号存储，确保自托管用户优先持久化到服务端。
4. 最后做 P5 Upstash，覆盖云平台长期存储与降级。
