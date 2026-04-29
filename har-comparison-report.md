# HAR 文件 1（图生图流程）分析报告 — 最终版

## 流程时间线

```
02:55:55  conversation/init #1
02:56:08  f/conversation/prepare #1
02:56:09  /backend-api/files (创建上传)
02:56:12  f/conversation/prepare #2
02:56:13  PUT oaiusercontent.com (上传参考图)
02:56:14  files/process_upload_stream
02:56:15  files/download (轮询就绪)
02:56:16  estuary/content (验证可下载)
02:56:18~02:57:00  多次 f/conversation/prepare (心跳轮询)
02:57:09  sentinel/chat-requirements/prepare
02:57:09  sentinel/chat-requirements/finalize
02:57:09  conversation/init #2
02:57:09  f/conversation (主图像生成) ← SSE 长连接
02:57:10  files/download (图片就绪检查)
02:58:22  files/download (图片2)
02:58:23  f/conversation/prepare (后续)
02:58:29  estuary/content (下载生成的图片)
```

---

## 关键发现：所有请求共有的额外 Headers

HAR 中 **每个** backend-api 请求都包含以下 JS 实现中缺失的 headers：

| Header | 值 | JS 是否发送 |
|--------|-----|-------------|
| `oai-client-build-number` | `6232230` | ❌ 缺失 |
| `oai-client-version` | `prod-5d86787f9f8d1f6b6e7e021b6aa4d6b14a14445c` | ❌ 缺失 |
| `oai-language` | `zh-CN` | ❌ 缺失 |
| `x-openai-target-path` | 动态（等于请求 path） | ❌ 缺失 |
| `x-openai-target-route` | 动态（等于请求 path） | ❌ 缺失 |
| `x-requested-with` | `mark.via`（浏览器特定） | N/A |

f/conversation 额外还有：

| Header | JS 是否发送 |
|--------|-------------|
| `oai-echo-logs` | ❌ 缺失 |
| `oai-telemetry` | ❌ 缺失 |
| `openai-sentinel-turnstile-token` | ❌ 缺失 |
| `x-oai-turn-trace-id` | ❌ 缺失 |

---

## 1. sentinel/chat-requirements/prepare

**HAR Body:** `{"p": "gAAAAA...XQ=="}`
**JS Body:** `{"p": reqToken}` (由 generateRequirementsToken() 生成)
✅ **匹配**

**HAR Response 200:**
```json
{
  "persona": "chatgpt-freeaccount",
  "prepare_token": "gAAAAA...06U=",
  "turnstile": {"required": true, "dx": "PBp5bWF4c3lPd1VvbB..."}
}
```
**关键发现：** 响应包含 `turnstile: {required: true, dx: "大型base64数据"}`。`dx` 是 turnstile widget 需要的配置数据。

---

## 2. sentinel/chat-requirements/finalize

**HAR Body:**
```json
{
  "prepare_token": "gAAAAA...Oi78...",
  "proofofwork": "gAAAAA...DAwM...",
  "turnstile": "ShAfCh0GBQwJEXBwWVERHRAYCx0G..."
}
```

**JS Body:**
```json
{
  "prepare_token": "...",
  "proofofwork": "..."
}
```

### 🔴 差异：缺少 `turnstile` 字段
JS 实现在检测到 `turnstile.required === true` 时直接抛出错误。但 HAR 显示浏览器成功通过了 turnstile 验证，并将结果 token 附加到 finalize 请求中。

---

## 3. conversation/init

**HAR Body:**
```json
{"gizmo_id": null, "requested_default_model": null, "conversation_id": null, "timezone_offset_min": -480}
```

**JS Body:**
```json
{"gizmo_id": null, "requested_default_model": null, "conversation_id": null, "timezone_offset_min": -480, "system_hints": ["picture_v2"]}
```

### 差异：多余的 `system_hints` 字段
JS 多加了 `system_hints: ['picture_v2']`。可能被忽略，但不一致。

---

## 4. f/conversation（主图像生成请求）

### Request Headers 差异

**HAR 有但 JS 没有：**
- `openai-sentinel-turnstile-token` ← 🔴 关键！
- `oai-client-build-number: 6232230`
- `oai-client-version: prod-...`
- `oai-language: zh-CN`
- `oai-echo-logs: ...`
- `oai-telemetry: [1,null]`
- `x-oai-turn-trace-id: ...`
- `x-openai-target-path: /backend-api/f/conversation`
- `x-openai-target-route: /backend-api/f/conversation`

**JS 有但 HAR 没有：**
- `Cache-Control: no-cache`

### Request Body 差异

**`parent_message_id`：**
- HAR: `"client-created-root"`（首条消息时）
- JS: `randomUUID()`（总是生成随机 UUID）

**metadata 多余字段（JS 有，HAR 没有）：**
- `is_visually_hidden_from_conversation: false`
- `exclude_after_next_user_message: false`
- `content_references: []`
- `search_result_groups: []` (虽然顶层 messages[0] 没有，但 messages[0].metadata 没有此字段)
- `search_queries: []`
- `image_results: []`
- `developer_mode_connector_ids: []`
- `real_time_audio_has_video: false`
- `dictation: false`
- `voice_mode_message: false`
- `image_gen_async: false`
- `trigger_async_ux: false`
- `writing_blocks: {}`

**accept header：**
- HAR: `text/event-stream`
- JS: `text/event-stream,application/json`

**SSE Response：** JS 解析逻辑能正确处理 `sediment://` 指针提取 ✅

---

## 5. 文件上传流程

### 5a. /backend-api/files
✅ Body 字段完全匹配：`file_name`, `file_size`, `use_case: 'multimodal'`, `timezone_offset_min`, `reset_rate_limits: false`

### 5b. PUT oaiusercontent.com
**差异：**
- ❌ HAR 有 `x-ms-version: 2020-04-08` header，JS 缺失
- ✅ `x-ms-blob-type: BlockBlob` 匹配
- ✅ `content-type` 匹配

### 5c. files/process_upload_stream
✅ Body 完全匹配：`file_id`, `use_case`, `index_for_retrieval`, `file_name`, `entry_surface`

### 5d. files/download
✅ URL 格式匹配：`/backend-api/files/download/{file_id}`

---

## 总结：按严重性排序的差异

### 🔴 严重（导致功能失败）

1. **turnstile 挑战无法自动完成**
   - HAR: 浏览器通过 Cloudflare turnstile widget 获取 token
   - JS: 检测到 `turnstile.required === true` 时直接抛错
   - 影响：在需要 turnstile 的账号上完全无法使用

2. **finalize 请求缺少 `turnstile` token**
   - HAR body: `{prepare_token, proofofwork, turnstile}`
   - JS body: `{prepare_token, proofofwork}`
   - 影响：finalize 步骤可能返回错误

3. **f/conversation 缺少 `openai-sentinel-turnstile-token` header**
   - HAR 在最终请求中包含此 header
   - JS 完全没有这个 header
   - 影响：服务器可能拒绝请求

### 🟡 中等（可能被检测/拒绝）

4. **`parent_message_id` 应为 `"client-created-root"`**（首条消息时）
5. **缺少 `oai-client-build-number` / `oai-client-version`**（可被用作 bot 检测）
6. **缺少 `oai-language` header**
7. **缺少 `x-openai-target-path` / `x-openai-target-route` headers**
8. **PUT 请求缺少 `x-ms-version: 2020-04-08` header**
9. **metadata 有约 12 个多余字段**（可能被服务器忽略，但也可能被检测）

### 🟢 轻微（可能不影响功能）

10. **conversation/init 多余 `system_hints` 字段**
11. **accept header 格式差异**（`text/event-stream` vs `text/event-stream,application/json`）
12. **缺少 `Cache-Control: no-cache`**（HAR 没有此头）
13. **缺少 `oai-echo-logs` / `oai-telemetry`**（遥测数据）

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `/tmp/har-analysis/chatgpt.com_2026_04_29_10_58_39.har` | 原始 HAR 文件（12MB, 396 请求） |
| `/tmp/har-analysis/extract_backend_api.py` | 提取脚本 |
| `/tmp/har-analysis/extracted_requests.json` | 提取的 27 个 backend-api 请求详情 |
| `/tmp/har-analysis/focused_analysis.py` | 聚焦分析脚本 |
| `/tmp/image-gen-review/openai-oauth-image.js` | JS 实现代码（1461 行） |
| `/tmp/image-gen-review/har-comparison-report.md` | 本报告 |
