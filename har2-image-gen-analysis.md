# HAR File 2 Analysis: ChatGPT 文生图流程

## 完整请求时间线（24 个 backend-api 请求）

用户输入：**"帮我生成一个猪八戒吃西瓜的图片，尽量真实"**

| # | 时间 | 方法 | 端点 | 状态 |
|---|------|------|------|------|
| 0 | 14:59:22 | POST | /backend-api/f/conversation/prepare | 200 |
| 1 | 14:59:27 | POST | /backend-api/f/conversation/prepare | 200 |
| 2 | 14:59:30 | POST | /backend-api/f/conversation/prepare | 200 |
| 3 | 14:59:30 | POST | /backend-api/sentinel/ping | 200 |
| 4 | 14:59:35 | POST | /backend-api/f/conversation/prepare | 200 |
| **5** | **14:59:38** | **POST** | **/backend-api/f/conversation** | **200** |
| 6 | 14:59:38 | POST | /backend-api/sentinel/chat-requirements/prepare | 200 |
| 7 | 14:59:39 | POST | /backend-api/sentinel/ping | 200 |
| **8** | **14:59:39** | **POST** | **/backend-api/conversation/init** | **200** |
| 9 | 14:59:39 | POST | /backend-api/sentinel/ping | 200 |
| **10** | **14:59:41** | **POST** | **/backend-api/sentinel/chat-requirements/finalize** | **200** |
| 11 | 14:59:41 | GET | /backend-api/conversation/{id}/stream_status | 200 |
| 12 | 14:59:42 | POST | /backend-api/sentinel/ping | 200 |
| 13 | 14:59:42 | GET | /backend-api/beacons/home?conversation_id=... | 200 |
| 14 | 14:59:44 | POST | /backend-api/sentinel/ping | 200 |
| **15** | **14:59:45** | **POST** | **/backend-api/sentinel/req** | **200** |
| 16-18 | 14:59:45~15:00:09 | POST | /backend-api/sentinel/ping (x3) | 200 |
| 19 | 15:00:13 | POST | /backend-api/sentinel/heartbeat | 200 |
| **20** | **15:00:18** | **GET** | **/backend-api/files/download/file_*** | **200** |
| 21 | 15:00:19 | POST | /backend-api/lat/r | 200 |
| **22** | **15:00:19** | **GET** | **/backend-api/estuary/content?id=...&sig=...** | **200** |
| 23 | 15:00:20 | POST | /backend-api/f/conversation/prepare | 200 |

---

## 1. sentinel/chat-requirements/prepare (ENTRY 6)

### 请求
```json
{"p":"gAAAAA...XQ=="}
```
> `p` 字段是通过 proof-of-work 生成的 requirements token

### 响应
```json
{
  "persona": "chatgpt-freeaccount",
  "prepare_token": "gAAAAA...9xdG",
  "turnstile": {
    "required": true,
    "dx": "PBp5bW...(长串 base64)"
  }
}
```
> 注意：响应中 **没有** `token` 字段（只有 `prepare_token`），说明需要 finalize

---

## 2. sentinel/chat-requirements/finalize (ENTRY 10)

### 请求
```json
{"prepare_token": "gAAAAA...WcmV", "proofofwork": "...", "turnstile": "..."}
```
> 请求包含 `prepare_token`、`proofofwork`、`turnstile` 三个字段

### 响应
```json
{
  "persona": "chatgpt-freeaccount",
  "token": "***",
  "expire_after": 540,
  "expire_at": 1777475320
}
```
> `token` 被 HAR 录制工具模糊化了

---

## 3. conversation/init (ENTRY 8)

### 请求
```json
{
  "gizmo_id": null,
  "requested_default_model": null,
  "conversation_id": null,
  "timezone_offset_min": -480
}
```
> **注意**：没有 `system_hints` 字段！

### 响应
```json
{
  "type": "conversation_detail_metadata",
  "banner_info": null,
  "blocked_features": [],
  "model_limits": [],
  "limits_progress": [
    {"feature_name": "deep_research", "remaining": 5, "reset_after": "2026-05-29..."},
    {"feature_name": "file_upload", "remaining": 3, "reset_after": "2026-04-30..."},
    {"feature_name": "paste_text_to_file", "remaining": 3, "reset_after": "2026-04-30..."},
    {"feature_name": "image_gen", "remaining": 4, "reset_after": "2026-04-30T02:58:21..."}
  ],
  "default_model_slug": "auto",
  "atlas_mode_enabled": null
}
```

---

## 4. f/conversation (ENTRY 5) - 主请求与 SSE 响应

### 请求体
```json
{
  "action": "next",
  "messages": [{
    "id": "msg_***",
    "author": {"role": "user"},
    "create_time": 1777474778.196,
    "content": {
      "content_type": "text",
      "parts": ["帮我生成一个猪八戒吃西瓜的图片，尽量真实"]
    },
    "metadata": {
      "selected_github_repos": [],
      "selected_all_github_repos": false,
      "system_hints": ["picture_v2"],
      "serialization_metadata": {"custom_symbol_offsets": []}
    }
  }],
  "parent_message_id": "client-created-root",
  "model": "auto",
  "client_prepare_state": "success",
  "timezone_offset_min": -480,
  "timezone": "Asia/Shanghai",
  "conversation_mode": {"kind": "primary_assistant"},
  "enable_message_followups": true,
  "system_hints": ["picture_v2"],
  "supports_buffering": true,
  "supported_encodings": ["v1"],
  "client_contextual_info": {
    "is_dark_mode": false,
    "time_since_loaded": 96,
    "page_height": 436,
    "page_width": 400,
    "pixel_ratio": 3,
    "screen_height": 890,
    "screen_width": 400,
    "app_name": "chatgpt.com"
  },
  "paragen_cot_summary_display_override": "allow",
  "force_parallel_switch": "auto"
}
```

### SSE 响应关键事件（按顺序）

#### ① delta_encoding
```
event: delta_encoding
data: "v1"
```

#### ② resume_conversation_token
```json
{"type": "resume_conversation_token", "kind": "topic", "token": "***", "conversation_id": "conv_***"}
```

#### ③ 模型可编辑上下文 (c: 0)
```json
{
  "p": "", "o": "add",
  "v": {
    "message": {
      "id": "msg_***",
      "author": {"role": "assistant"},
      "content": {"content_type": "model_editable_context", "model_set_context": ""},
      "status": "finished_successfully",
      "metadata": {
        "parent_id": "msg_parent_***",
        "request_id": "req_***",
        "model_slug": "gpt-5-3"
      }
    },
    "conversation_id": "conv_***"
  },
  "c": 0
}
```

#### ④ 工具调用 - 代码执行 (c: 1)
```json
{
  "v": {
    "message": {
      "id": "msg_***",
      "author": {"role": "assistant"},
      "content": {
        "content_type": "code",
        "language": "python3",
        "text": "{\"skipped_mainline\":true}"
      },
      "status": "in_progress",
      "recipient": "t2uay3k.sj1i4kz"
    }
  },
  "c": 1
}
```

#### ⑤ 状态更新
```
data: {"p": "/message/status", "o": "replace", "v": "finished_successfully"}
```

#### ⑥ ping 两次（~15秒和~30秒后）

#### ⑦ 标题生成
```json
{"type": "title_generation", "title": "猪八戒吃西瓜", "conversation_id": "conv_***"}
```

#### ⑧ ★ 图片结果 - 工具返回消息 (c: 2)
```json
{
  "p": "", "o": "add",
  "v": {
    "message": {
      "id": "msg_***",
      "author": {"role": "tool", "name": "t2uay3k.sj1i4kz"},
      "content": {
        "content_type": "multimodal_text",
        "parts": [{
          "content_type": "image_asset_pointer",
          "asset_pointer": "sediment://file_***",
          "size_bytes": 1755161,
          "width": 1402,
          "height": 1122,
          "metadata": {
            "dalle": {
              "gen_id": "gen_***",
              "prompt": ""
            },
            "generation": {
              "gen_id": "gen_***",
              "gen_size": "smimage",
              "gen_size_v2": "16",
              "height": 1122,
              "width": 1402,
              "transparent_background": false,
              "orientation": "landscape"
            }
          }
        }]
      },
      "status": "finished_successfully",
      "metadata": {
        "image_gen_title": "森林中吃西瓜的戏服人物",
        "parent_id": "msg_***"
      }
    }
  },
  "c": 2
}
```

#### ⑨ server_ste_metadata（重要）
```json
{
  "type": "server_ste_metadata",
  "metadata": {
    "model_slug": "i-mini",
    "turn_use_case": "image gen",
    "turn_mode": "default",
    "cluster_region": "westus3",
    "plan_type": "free",
    ...
  }
}
```
> 实际使用的模型是 **i-mini**（不是 gpt-5-3）

#### ⑩ 完成
```
data: {"type": "message_stream_complete", ...}
data: [DONE]
```

---

## 5. 图片下载流程

### 步骤 1: files/download (ENTRY 20)
```
GET /backend-api/files/download/file_***?conversation_id=...&inline=false
```
响应：
```json
{
  "status": "success",
  "download_url": "https://chatgpt.com/backend-api/estuary/content?id=file_***&ts=...&p=fs&cid=1&sig=...&v=0",
  "file_name": "user-***/***.png",
  "file_size_bytes": 1755161
}
```

### 步骤 2: estuary/content (ENTRY 22)
```
GET /backend-api/estuary/content?id=...&ts=...&sig=...
```
响应：`image/png` (1,755,161 字节的实际 PNG 图片)

---

## 与 openai-oauth-image.js 实现对比

### ✅ 匹配的地方

| 功能 | HAR | JS 实现 | 匹配? |
|------|-----|---------|-------|
| `system_hints: ["picture_v2"]` | ✅ 在消息和请求中 | ✅ `buildConversationRequest` 和 `buildPrepareRequest` | ✅ |
| `conversation_mode: {kind: "primary_assistant"}` | ✅ | ✅ | ✅ |
| `supported_encodings: ["v1"]` | ✅ | ✅ | ✅ |
| `client_prepare_state: "success"` | ✅ | ✅ | ✅ |
| `model: "auto"` | ✅ | ✅ | ✅ |
| 图片指针格式 `sediment://file_xxx` | ✅ | ✅ `walkInlineAssets` 正确解析 | ✅ |
| 下载流程: files/download → estuary/content | ✅ | ✅ `buildPointerDownloadURLs` + `fetchDownloadURL` | ✅ |
| SSE 解析逻辑 | ✅ delta events | ✅ `parseConversationSsePayloads` | ✅ |
| chat-requirements prepare→finalize 流程 | ✅ | ✅ `fetchChatRequirementsViaPrepareFinalize` | ✅ |

### ❌ 差异

| # | 项目 | HAR（实际网页行为） | JS 实现 | 影响 |
|---|------|---------------------|---------|------|
| 1 | **请求执行顺序** | prepare calls → f/conversation → chat-requirements/prepare → conversation/init → chat-requirements/finalize | bootstrap → init → chat-requirements → prepare → conversation | **JS 在 conversation 之前做 chat-requirements，HAR 在之后** |
| 2 | **conversation/init 的 system_hints** | ❌ **没有** `system_hints` | ✅ 有 `system_hints: ['picture_v2']` | JS 多传了字段 |
| 3 | **增量 prepare 调用** | 4 次 prepare（随打字） | 仅 1 次 prepare | HAR 有前端打字预热，JS 不需要 |
| 4 | **sentinel/req** | ✅ 有调用 | ❌ 没有实现 | JS 缺少此调用 |
| 5 | **sentinel/heartbeat** | ✅ 有调用 | ❌ 没有实现 | JS 缺少此调用 |
| 6 | **beacons/home** | ✅ 有调用 | ❌ 没有实现 | 可能不重要 |
| 7 | **stream_status 轮询** | ✅ 有调用 | ❌ 用 conversation GET 轮询代替 | JS 用不同方式轮询 |
| 8 | **消息 metadata** | 较简单，无 `is_visually_hidden_from_conversation` 等字段 | 较完整，有很多额外字段 | JS 多传了字段，可能不被使用 |
| 9 | **parent_message_id** | `"client-created-root"` (首次) | `"client-created-root"` | ✅ 已对齐 |
| 10 | **bootstrap (GET /)** | ❌ HAR 没有显示 bootstrap 调用 | ✅ JS 做了 `bootstrap(headers)` | JS 多了一步 |
| 11 | **lat/r (延迟报告)** | ✅ 有调用 | ❌ 没有实现 | 遥测，不重要 |
| 12 | **prepare 响应中的 conduit_token** | ✅ 返回 conduit_token | ✅ JS 正确获取和使用 | ✅ 匹配 |

### ⚠️ 关键差异详解

#### 差异 1: 执行顺序
**HAR 实际顺序**: 用户打字 → 多次 prepare → 最终 prepare → 主 conversation → chat-requirements → init → finalize → 下载图片

**JS 顺序**: bootstrap → init → chat-requirements → prepare → conversation → 下载图片

这说明 ChatGPT 前端是先发送 conversation 请求，然后再补充完成 chat-requirements 流程。但 JS 实现中先完成 chat-requirements 再发送 conversation，这是合理的因为 conversation 请求需要 `openai-sentinel-chat-requirements-token` header。

#### 差异 3: 增量 prepare
HAR 显示前端在用户打字时不断调用 prepare（部分文本），这是为了预热连接。最终的 prepare 包含完整文本。JS 只做一次 prepare，这是正确的——不需要模拟打字行为。

#### 差异 9: parent_message_id
HAR 中首次对话的 `parent_message_id` 是固定字符串 `"client-created-root"`，JS 也已改为使用该固定值。✅ 已对齐。

#### 差异 10: bootstrap
HAR 中没有显示 GET / 的调用（可能在更早的页面加载时已完成），JS 每次生图都做 bootstrap。这是合理的防御性做法。

---

## 总结

JS 实现的核心流程与 HAR 基本一致：
1. ✅ 图片通过 `sediment://` 指针在 SSE 中返回，需要二次下载
2. ✅ 下载流程 (files/download → estuary/content) 完全匹配
3. ✅ chat-requirements prepare/finalize 流程匹配
4. ✅ 请求结构（system_hints、conversation_mode 等）匹配

需要注意的潜在问题：
- `parent_message_id: "client-created-root"` 是否是必需的？
- conversation/init 不需要传 `system_hints`
- `sentinel/req` 和 `sentinel/heartbeat` 可能是可选的遥测调用
