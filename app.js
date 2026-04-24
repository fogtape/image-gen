const $ = (s) => document.querySelector(s);
const ACCOUNTS_KEY = 'img-gen-accounts';
const OLD_KEY = 'img-gen-settings';

const state = {
  data: { activeId: null, accounts: [], useProxy: false },
  refImageBase64: null,
  generating: false,
  dropdownOpen: false,
};

// --- Data Layer ---

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(ACCOUNTS_KEY));
    if (saved) { state.data = saved; return; }
  } catch {}
  migrateOldSettings();
}

function saveData() {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(state.data));
}

function migrateOldSettings() {
  try {
    const old = JSON.parse(localStorage.getItem(OLD_KEY));
    if (old && old.apiUrl) {
      const acc = {
        id: genId(),
        name: '默认账号',
        type: 'manual',
        apiUrl: old.apiUrl || '',
        apiKey: old.apiKey || '',
        model: old.model || 'gpt-image-2',
        streamMode: !!old.streamMode,
        createdAt: Date.now(),
      };
      state.data.accounts.push(acc);
      state.data.activeId = acc.id;
      state.data.useProxy = !!old.useProxy;
      saveData();
    }
  } catch {}
}

function getActiveAccount() {
  return state.data.accounts.find((a) => a.id === state.data.activeId) || null;
}

function setActiveAccount(id) {
  state.data.activeId = id;
  saveData();
  renderSwitcher();
}

function addAccount(acc) {
  state.data.accounts.push(acc);
  if (!state.data.activeId) state.data.activeId = acc.id;
  saveData();
}

function updateAccount(id, fields) {
  const acc = state.data.accounts.find((a) => a.id === id);
  if (acc) Object.assign(acc, fields);
  saveData();
}

function deleteAccount(id) {
  state.data.accounts = state.data.accounts.filter((a) => a.id !== id);
  if (state.data.activeId === id) {
    state.data.activeId = state.data.accounts.length ? state.data.accounts[0].id : null;
  }
  saveData();
}

// --- Effective Config ---

function getEffective() {
  const acc = getActiveAccount();
  const tu = $('#tempUrl').value.replace(/\/+$/, '');
  const tk = $('#tempKey').value;
  const tm = $('#tempModel').value;
  return {
    apiUrl: tu || (acc ? acc.apiUrl : ''),
    apiKey: tk || (acc ? acc.apiKey : ''),
    model: tm || (acc ? acc.model : 'gpt-image-2'),
    streamMode: acc ? acc.streamMode : false,
    useProxy: state.data.useProxy,
    isOAuth: acc ? acc.type === 'oauth' : false,
    accountId: acc ? (acc.accountId || '') : '',
    openaiDeviceId: acc ? (acc.openaiDeviceId || '') : '',
    openaiSessionId: acc ? (acc.openaiSessionId || '') : '',
  };
}

function getActiveValue(field) {
  const btn = $(`.seg[data-field="${field}"] button.active`);
  return btn ? btn.dataset.value : null;
}

// --- Network ---

async function proxyFetch(url, opts) {
  return fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      method: opts.method || 'POST',
      headers: opts.headers || {},
      body: opts.jsonBody,
    }),
  });
}

function buildHeaders(cfg, extra) {
  const headers = { Authorization: `Bearer ${cfg.apiKey}`, ...extra };
  if (cfg.isOAuth) {
    headers['Originator'] = 'codex_cli_rs';
    if (cfg.accountId) headers['Chatgpt-Account-Id'] = cfg.accountId;
    headers['Version'] = '0.101.0';
    headers['OpenAI-Beta'] = 'responses=experimental';
    headers['Session_id'] = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
    headers['User-Agent'] = 'codex_cli_rs/0.101.0';
    headers['Accept'] = 'text/event-stream';
    headers['Connection'] = 'Keep-Alive';
  }
  return headers;
}

async function smartFetch(url, opts) {
  if (state.data.useProxy || opts._forceProxy) return proxyFetch(url, opts);
  try {
    const fetchOpts = { method: opts.method || 'POST', headers: opts.headers || {} };
    if (opts.body) fetchOpts.body = opts.body;
    return await fetch(url, fetchOpts);
  } catch (e) {
    if (e.name === 'TypeError' || (e.message && e.message.includes('fetch'))) {
      try {
        return await proxyFetch(url, opts);
      } catch {
        throw new Error('直连被 CORS 拦截，代理也不可用。请用 node server.js 启动本地服务器');
      }
    }
    throw e;
  }
}

// --- Token Refresh ---

async function refreshOAuthToken(acc) {
  if (!acc.refreshToken) return false;
  try {
    const resp = await fetch('/api/oauth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: acc.refreshToken }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.accessToken) return false;
    updateAccount(acc.id, {
      apiKey: data.accessToken,
      refreshToken: data.refreshToken || acc.refreshToken,
      tokenExpiresAt: Date.now() + (data.expiresIn || 3600) * 1000,
      email: data.email || acc.email,
    });
    return true;
  } catch { return false; }
}

async function ensureValidToken(cfg) {
  const acc = getActiveAccount();
  if (!acc || acc.type !== 'oauth') return cfg;
  if (acc.tokenExpiresAt && Date.now() > acc.tokenExpiresAt - 60000) {
    const ok = await refreshOAuthToken(acc);
    if (ok) return { ...cfg, apiKey: acc.apiKey };
  }
  return cfg;
}

// --- UI Helpers ---

function showError(msg) {
  const el = $('#errorMsg');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 10000);
}

function setLoading(on) {
  state.generating = on;
  $('#generateBtn .btn-text').classList.toggle('hidden', on);
  $('#generateBtn .btn-loading').classList.toggle('hidden', !on);
  $('#generateBtn').disabled = on;
}

function addResultCard(b64, format) {
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const src = `data:${mime};base64,${b64}`;
  const card = document.createElement('div');
  card.className = 'gallery-card';
  const wrap = document.createElement('div');
  wrap.className = 'img-wrap';
  if (format === 'png') wrap.classList.add('checkerboard');
  const img = document.createElement('img');
  img.src = src;
  img.alt = '生成的图片';
  img.onclick = () => { $('#lightboxImg').src = src; $('#lightbox').classList.remove('hidden'); };
  wrap.appendChild(img);
  const bar = document.createElement('div');
  bar.className = 'card-bar';
  const dl = document.createElement('button');
  dl.className = 'btn btn-ghost';
  dl.textContent = '下载';
  dl.onclick = () => { const a = document.createElement('a'); a.href = src; a.download = `image-${Date.now()}.${format}`; a.click(); };
  bar.appendChild(dl);
  card.appendChild(wrap);
  card.appendChild(bar);
  $('#results').prepend(card);
}

function addResultCardFromUrl(imageUrl, format) {
  const card = document.createElement('div');
  card.className = 'gallery-card';
  const wrap = document.createElement('div');
  wrap.className = 'img-wrap';
  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = '生成的图片';
  img.onclick = () => { $('#lightboxImg').src = imageUrl; $('#lightbox').classList.remove('hidden'); };
  wrap.appendChild(img);
  const bar = document.createElement('div');
  bar.className = 'card-bar';
  const dl = document.createElement('button');
  dl.className = 'btn btn-ghost';
  dl.textContent = '下载';
  dl.onclick = () => { const a = document.createElement('a'); a.href = imageUrl; a.download = `image-${Date.now()}.${format}`; a.target = '_blank'; a.click(); };
  bar.appendChild(dl);
  card.appendChild(wrap);
  card.appendChild(bar);
  $('#results').prepend(card);
}

// --- UI Rendering ---

function renderSwitcher() {
  const acc = getActiveAccount();
  const dot = $('#switcherDot');
  const name = $('#switcherName');
  if (!acc) {
    name.textContent = '未配置';
    dot.className = 'switcher-dot inactive';
    return;
  }
  name.textContent = acc.name || acc.email || acc.apiUrl || '未命名';
  if (acc.type === 'oauth' && acc.tokenExpiresAt && Date.now() > acc.tokenExpiresAt) {
    dot.className = 'switcher-dot expired';
  } else {
    dot.className = 'switcher-dot';
  }
}

function renderDropdown() {
  const list = $('#dropdownList');
  list.innerHTML = '';
  for (const acc of state.data.accounts) {
    const btn = document.createElement('button');
    btn.className = 'dropdown-item' + (acc.id === state.data.activeId ? ' active' : '');
    const dotEl = document.createElement('span');
    dotEl.className = 'item-dot';
    const info = document.createElement('span');
    info.className = 'item-info';
    const nameEl = document.createElement('span');
    nameEl.className = 'item-name';
    nameEl.textContent = acc.name || acc.email || '未命名';
    const sub = document.createElement('span');
    sub.className = 'item-sub';
    sub.textContent = acc.type === 'oauth' ? (acc.email || 'OAuth') : (acc.apiUrl || '');
    info.appendChild(nameEl);
    info.appendChild(sub);
    const badge = document.createElement('span');
    badge.className = 'item-badge' + (acc.type === 'oauth' ? ' oauth' : '');
    badge.textContent = acc.type === 'oauth' ? 'OAuth' : '手动';
    btn.appendChild(dotEl);
    btn.appendChild(info);
    btn.appendChild(badge);
    btn.onclick = () => { setActiveAccount(acc.id); renderDropdown(); toggleDropdown(false); };
    list.appendChild(btn);
  }
  if (!state.data.accounts.length) {
    const empty = document.createElement('div');
    empty.className = 'dropdown-item';
    empty.style.color = 'var(--text-3)';
    empty.textContent = '暂无账号';
    list.appendChild(empty);
  }
}

function toggleDropdown(force) {
  state.dropdownOpen = force !== undefined ? force : !state.dropdownOpen;
  $('#switcherDropdown').classList.toggle('hidden', !state.dropdownOpen);
}

function renderAccountList() {
  const list = $('#accountList');
  list.innerHTML = '';
  if (!state.data.accounts.length) {
    list.innerHTML = '<div class="account-empty">还没有账号，点击上方按钮添加</div>';
    return;
  }
  for (const acc of state.data.accounts) {
    const card = document.createElement('div');
    card.className = 'account-card' + (acc.id === state.data.activeId ? ' active' : '');
    card.onclick = () => { setActiveAccount(acc.id); renderAccountList(); };

    const radio = document.createElement('div');
    radio.className = 'account-radio';

    const info = document.createElement('div');
    info.className = 'account-info';
    const nameRow = document.createElement('div');
    nameRow.className = 'account-name';
    nameRow.textContent = acc.name || acc.email || '未命名';
    const badge = document.createElement('span');
    badge.className = 'badge ' + (acc.type === 'oauth' ? 'badge-oauth' : 'badge-manual');
    badge.textContent = acc.type === 'oauth' ? 'OAuth' : '手动';
    if (acc.type === 'oauth' && acc.tokenExpiresAt && Date.now() > acc.tokenExpiresAt) {
      badge.className = 'badge badge-expired';
      badge.textContent = '已过期';
    }
    nameRow.appendChild(badge);
    const detail = document.createElement('div');
    detail.className = 'account-detail';
    detail.textContent = acc.type === 'oauth' ? (acc.email || '') : (acc.apiUrl || '');
    info.appendChild(nameRow);
    info.appendChild(detail);

    const actions = document.createElement('div');
    actions.className = 'account-actions-bar';
    const editBtn = document.createElement('button');
    editBtn.title = '编辑';
    editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    editBtn.onclick = (e) => { e.stopPropagation(); openEditModal(acc); };
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete';
    delBtn.title = '删除';
    delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    delBtn.onclick = (e) => { e.stopPropagation(); if (confirm('确定删除此账号？')) { deleteAccount(acc.id); renderAccountList(); renderSwitcher(); renderDropdown(); } };
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    card.appendChild(radio);
    card.appendChild(info);
    card.appendChild(actions);
    list.appendChild(card);
  }
}

// --- Edit Modal ---

function openEditModal(acc) {
  $('#editId').value = acc ? acc.id : '';
  $('#editTitle').textContent = acc ? '编辑账号' : '添加账号';
  $('#editName').value = acc ? (acc.name || '') : '';
  $('#editUrl').value = acc ? (acc.apiUrl || '') : '';
  $('#editKey').value = acc ? (acc.apiKey || '') : '';
  $('#editModel').value = acc ? (acc.model || 'gpt-image-2') : 'gpt-image-2';
  $('#editStream').checked = acc ? !!acc.streamMode : false;
  $('#editOverlay').classList.remove('hidden');
}

function closeEditModal() {
  $('#editOverlay').classList.add('hidden');
}

function saveEditModal() {
  const id = $('#editId').value;
  const fields = {
    name: $('#editName').value.trim() || '未命名',
    apiUrl: $('#editUrl').value.trim().replace(/\/+$/, ''),
    apiKey: $('#editKey').value.trim(),
    model: $('#editModel').value.trim() || 'gpt-image-2',
    streamMode: $('#editStream').checked,
  };
  if (id) {
    updateAccount(id, fields);
  } else {
    addAccount({ id: genId(), type: 'manual', createdAt: Date.now(), ...fields });
  }
  closeEditModal();
  renderAccountList();
  renderSwitcher();
  renderDropdown();
}

// --- OAuth Flow ---

async function startOAuth() {
  const statusEl = $('#oauthStatus');
  const textEl = $('#oauthStatusText');
  statusEl.classList.remove('hidden');
  textEl.textContent = '正在发起登录...';

  try {
    const resp = await fetch('/api/oauth/start', { method: 'POST' });
    const data = await resp.json();
    if (!data.authorizationUrl) throw new Error('未获取到授权地址');

    window.open(data.authorizationUrl, '_blank', 'width=600,height=700');
    textEl.textContent = '等待浏览器登录...';
    pollOAuthStatus(data.state);
  } catch (e) {
    textEl.textContent = '发起失败: ' + e.message;
    setTimeout(() => statusEl.classList.add('hidden'), 5000);
  }
}

async function pollOAuthStatus(oauthState) {
  const statusEl = $('#oauthStatus');
  const textEl = $('#oauthStatusText');
  let attempts = 0;
  const maxAttempts = 120;

  const poll = async () => {
    if (attempts++ > maxAttempts) {
      textEl.textContent = '登录超时，请重试';
      setTimeout(() => statusEl.classList.add('hidden'), 3000);
      return;
    }
    try {
      const resp = await fetch(`/api/oauth/status/${oauthState}`);
      const data = await resp.json();
      if (data.status === 'success') {
        const r = data.result;
        addAccount({
          id: genId(),
          name: r.name || r.email || 'OpenAI',
          type: 'oauth',
          apiUrl: 'https://api.openai.com',
          apiKey: r.accessToken,
          model: 'gpt-image-2',
          streamMode: false,
          email: r.email || '',
          accountId: r.accountId || '',
          planType: r.planType || '',
          refreshToken: r.refreshToken || null,
          tokenExpiresAt: Date.now() + (r.expiresIn || 3600) * 1000,
          createdAt: Date.now(),
        });
        textEl.textContent = '登录成功: ' + (r.email || r.name || '');
        renderAccountList();
        renderSwitcher();
        renderDropdown();
        setTimeout(() => statusEl.classList.add('hidden'), 2000);
        return;
      }
      if (data.status === 'error') {
        textEl.textContent = '登录失败: ' + (data.error || '');
        setTimeout(() => statusEl.classList.add('hidden'), 5000);
        return;
      }
      setTimeout(poll, 2000);
    } catch {
      setTimeout(poll, 3000);
    }
  };
  poll();
}

// --- Test Connection ---

async function testConnection() {
  const el = $('#testResult');
  el.className = 'toast';
  el.textContent = '测试中...';
  el.classList.remove('hidden');

  let cfg = getEffective();
  if (!cfg.apiUrl || !cfg.apiKey) {
    el.className = 'toast error';
    el.textContent = '请先添加账号并配置 API 地址和 Key';
    return;
  }

  cfg = await ensureValidToken(cfg);

  try {
    if (cfg.isOAuth) {
      const body = { model: cfg.model, input: 'test', max_output_tokens: 1 };
      const resp = await smartFetch(`${cfg.apiUrl}/v1/responses`, {
        method: 'POST',
        headers: buildHeaders(cfg, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        jsonBody: body,
        _forceProxy: true,
      });
      if (resp.ok || resp.status === 200) {
        el.className = 'toast success';
        el.textContent = '连接成功 — OAuth token 有效';
      } else {
        const data = await resp.json().catch(() => ({}));
        el.className = 'toast error';
        el.textContent = `失败 (${resp.status}): ${data.error?.message || data.message || ''}`;
      }
    } else {
      const resp = await smartFetch(`${cfg.apiUrl}/v1/models`, {
        method: 'GET',
        headers: buildHeaders(cfg),
      });
      if (resp.ok) {
        const data = await resp.json();
        const models = data.data ? data.data.map((m) => m.id).slice(0, 6).join(', ') : '(无列表)';
        el.className = 'toast success';
        el.textContent = `连接成功 — ${models} ...`;
      } else {
        const data = await resp.json().catch(() => ({}));
        el.className = 'toast error';
        el.textContent = `失败 (${resp.status}): ${data.error?.message || data.message || ''}`;
      }
    }
  } catch (e) {
    el.className = 'toast error';
    el.textContent = e.message;
  }
}

// --- Generate ---

async function generate() {
  if (state.generating) return;

  const prompt = $('#prompt').value.trim();
  if (!prompt) { showError('请输入提示词'); return; }

  let cfg = getEffective();
  if (!cfg.apiUrl || !cfg.apiKey) { showError('请先添加账号并配置 API 地址和 Key'); return; }

  cfg = await ensureValidToken(cfg);

  const quality = getActiveValue('quality');
  const background = getActiveValue('background');
  const size = $('#sizeSelect').value;
  const n = parseInt($('#numSelect').value);
  const format = $('#formatSelect').value;
  const hasRef = !!state.refImageBase64;

  setLoading(true);
  $('#errorMsg').classList.add('hidden');

  try {
    if (cfg.isOAuth) {
      if (hasRef) {
        throw new Error('OAuth 登录生图已改走 ChatGPT 后端通道；当前先支持文字生图，参考图请暂用 API Key 账号。');
      }
      await genOAuthImages(cfg, prompt, quality, background, size, n, format);
    } else if (cfg.streamMode) {
      await genResponses(cfg, prompt, quality, background, size, n, format, hasRef);
    } else if (hasRef) {
      await genEdits(cfg, prompt, quality, background, size, n, format);
    } else {
      await genImages(cfg, prompt, quality, background, size, n, format);
    }
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(false);
  }
}

// --- OAuth ChatGPT backend image generation ---
async function genOAuthImages(cfg, prompt, quality, background, size, n, format) {
  const body = {
    accessToken: cfg.apiKey,
    accountId: cfg.accountId,
    openaiDeviceId: cfg.openaiDeviceId,
    openaiSessionId: cfg.openaiSessionId,
    model: cfg.model,
    prompt,
    n,
    quality,
    background,
    size,
    format,
  };

  const resp = await fetch('/api/oauth/images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error?.message || data.error || data.message || `HTTP ${resp.status}`);

  const acc = getActiveAccount();
  if (acc && acc.type === 'oauth') {
    const updates = {};
    if (data.openaiDeviceId && data.openaiDeviceId !== acc.openaiDeviceId) updates.openaiDeviceId = data.openaiDeviceId;
    if (data.openaiSessionId && data.openaiSessionId !== acc.openaiSessionId) updates.openaiSessionId = data.openaiSessionId;
    if (Object.keys(updates).length) updateAccount(acc.id, updates);
  }

  handleImagesResult(data, format);
}

// --- /v1/images/generations ---

async function genImages(cfg, prompt, quality, background, size, n, format) {
  const body = { model: cfg.model, prompt, n, response_format: 'b64_json' };
  if (quality) body.quality = quality;
  if (background && background !== 'auto') body.background = background;
  if (size && size !== 'auto') body.size = size;
  if (format !== 'png') body.output_format = format;

  const resp = await smartFetch(`${cfg.apiUrl}/v1/images/generations`, {
    method: 'POST',
    headers: buildHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    jsonBody: body,
    _forceProxy: cfg.isOAuth,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || data.message || `HTTP ${resp.status}`);
  handleImagesResult(data, format);
}

// --- /v1/images/edits ---

async function genEdits(cfg, prompt, quality, background, size, n, format) {
  const body = {
    model: cfg.model, prompt, n, response_format: 'b64_json',
    image: [{ type: 'base64', data: state.refImageBase64 }],
  };
  if (quality) body.quality = quality;
  if (background && background !== 'auto') body.background = background;
  if (size && size !== 'auto') body.size = size;
  if (format !== 'png') body.output_format = format;

  const resp = await smartFetch(`${cfg.apiUrl}/v1/images/edits`, {
    method: 'POST',
    headers: buildHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    jsonBody: body,
    _forceProxy: cfg.isOAuth,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || data.message || `HTTP ${resp.status}`);
  handleImagesResult(data, format);
}

function handleImagesResult(data, format) {
  let found = false;
  if (data.data) {
    for (const item of data.data) {
      if (item.b64_json) { addResultCard(item.b64_json, format); found = true; }
      else if (item.url) { addResultCardFromUrl(item.url, format); found = true; }
    }
  }
  if (!found) throw new Error('API 返回成功但未包含图片数据');
}

// --- /v1/responses (streaming) ---

async function genResponses(cfg, prompt, quality, background, size, n, format, hasRef) {
  let input;
  if (hasRef) {
    input = [{ role: 'user', content: [
      { type: 'input_image', image_url: `data:image/png;base64,${state.refImageBase64}` },
      { type: 'input_text', text: prompt },
    ]}];
  } else {
    input = prompt;
  }

  const body = {
    model: cfg.model, input, stream: true,
    tools: [{ type: 'image_generation', quality: quality || 'medium', size: size === 'auto' ? undefined : size, background: background || 'auto', output_format: format }],
  };

  const resp = await smartFetch(`${cfg.apiUrl}/v1/responses`, {
    method: 'POST',
    headers: buildHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    jsonBody: body,
    _forceProxy: cfg.isOAuth,
  });

  const rawText = await resp.text();
  let found = false;

  try {
    const data = JSON.parse(rawText);
    if (!resp.ok) throw new Error(data.error?.message || data.message || `HTTP ${resp.status}`);
    for (const item of (data.output || [])) {
      if (item.type === 'image_generation_call' && item.result) { addResultCard(item.result, format); found = true; }
    }
    if (found) return;
  } catch (e) {
    if (e.message && !e.message.includes('JSON') && !e.message.includes('position')) throw e;
  }

  for (const line of rawText.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const s = line.slice(5).trim();
    if (!s || s === '[DONE]') continue;
    try {
      const ev = JSON.parse(s);
      if (ev.type === 'response.output_item.done' && ev.item?.type === 'image_generation_call' && ev.item.result) { addResultCard(ev.item.result, format); found = true; }
      if (ev.error) throw new Error(ev.error.message || JSON.stringify(ev.error));
    } catch (e) {
      if (e.message && !e.message.includes('JSON') && !e.message.includes('position')) throw e;
    }
  }

  if (!found) throw new Error('未能从响应中提取到图片');
}

// --- File Helpers ---

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  renderSwitcher();

  // Account switcher dropdown
  $('#switcherBtn').onclick = (e) => { e.stopPropagation(); renderDropdown(); toggleDropdown(); };
  document.addEventListener('click', (e) => {
    if (state.dropdownOpen && !$('#accountSwitcher').contains(e.target)) toggleDropdown(false);
  });

  // Account management overlay
  $('#dropdownManage').onclick = () => { toggleDropdown(false); renderAccountList(); $('#useProxy').checked = state.data.useProxy; $('#accountOverlay').classList.remove('hidden'); };
  $('#closeAccount').onclick = () => $('#accountOverlay').classList.add('hidden');
  $('#accountOverlay').onclick = (e) => { if (e.target === $('#accountOverlay')) $('#accountOverlay').classList.add('hidden'); };

  // Add manual account
  $('#addManualBtn').onclick = () => openEditModal(null);

  // OAuth login
  $('#oauthLoginBtn').onclick = startOAuth;

  // Edit modal
  $('#saveEdit').onclick = saveEditModal;
  $('#cancelEdit').onclick = closeEditModal;
  $('#closeEdit').onclick = closeEditModal;
  $('#editOverlay').onclick = (e) => { if (e.target === $('#editOverlay')) closeEditModal(); };
  $('#toggleEditKey').onclick = () => { const el = $('#editKey'); el.type = el.type === 'password' ? 'text' : 'password'; };

  // Global settings
  $('#useProxy').onchange = () => { state.data.useProxy = $('#useProxy').checked; saveData(); };
  $('#testConnection').onclick = testConnection;

  // Generate
  $('#generateBtn').onclick = generate;

  // Segmented controls
  document.querySelectorAll('.seg').forEach((g) => {
    g.querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => { g.querySelectorAll('button').forEach((b) => b.classList.remove('active')); btn.classList.add('active'); };
    });
  });

  // Reference image
  $('#refImage').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    state.refImageBase64 = await fileToBase64(file);
    $('#refPreviewImg').src = URL.createObjectURL(file);
    $('#refPreview').classList.remove('hidden');
  };
  $('#removeRef').onclick = () => { state.refImageBase64 = null; $('#refImage').value = ''; $('#refPreview').classList.add('hidden'); };

  // Lightbox
  $('#lightboxClose').onclick = () => $('#lightbox').classList.add('hidden');
  $('#lightbox').onclick = (e) => { if (e.target === $('#lightbox')) $('#lightbox').classList.add('hidden'); };

  // Ctrl+Enter
  $('#prompt').addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate(); });
});
