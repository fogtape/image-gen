import {
  IDLE_GENERATION_HINT,
  POLICY_VIOLATION_MESSAGE,
  getGeneratingHint,
  getGenerationProgressMessage,
  getResponseStreamProgressMessage,
  getSseProgressMessage,
  getWaitingProgressMessage,
  isPolicyViolationText,
  normalizeGenerationError,
} from './ui-feedback.js';

const $ = (s) => document.querySelector(s);
const ACCOUNTS_KEY = 'img-gen-accounts';
const ACTIVE_JOB_KEY = 'img-gen-active-job';
const OLD_KEY = 'img-gen-settings';
const DEFAULT_MODEL = 'gpt-5.4';

const state = {
  data: { activeId: null, accounts: [], useProxy: false },
  refImageBase64: null,
  generating: false,
  dropdownOpen: false,
  oauthPendingSessionId: null,
  oauthPendingState: null,
  oauthAuthUrl: '',
  generationHintTimer: null,
  generationHintStep: 0,
  waitingStatusTimer: null,
  waitingStatusStep: 0,
};

// --- Data Layer ---

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveActiveJob(job) {
  localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job));
}

function loadActiveJob() {
  try { return JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY)); } catch { return null; }
}

function clearActiveJob() {
  localStorage.removeItem(ACTIVE_JOB_KEY);
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
        model: old.model || DEFAULT_MODEL,
        streamMode: old.streamMode !== false,
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
  return {
    apiUrl: acc ? acc.apiUrl : '',
    apiKey: acc ? acc.apiKey : '',
    model: acc ? acc.model : DEFAULT_MODEL,
    streamMode: acc ? acc.streamMode !== false : true,
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

function parseSseBlock(block) {
  const eventLines = String(block || '').split('\n');
  let event = 'message';
  const dataLines = [];
  for (const line of eventLines) {
    if (line.startsWith('event:')) event = line.slice(6).trim() || 'message';
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  const dataText = dataLines.join('\n').trim();
  return { event, dataText };
}

async function readSseText(resp, onEvent) {
  if (!resp.body || !resp.body.getReader) return await resp.text();
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let rawText = '';

  const consumeBlock = (block) => {
    if (!block.trim()) return;
    rawText += `${block}\n\n`;
    const { event, dataText } = parseSseBlock(block);
    if (!dataText || dataText === '[DONE]') return;
    let data = dataText;
    try { data = JSON.parse(dataText); } catch {}
    onEvent?.(event, data, dataText);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() || '';
    for (const part of parts) consumeBlock(part);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeBlock(buffer);
  return rawText;
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
      name: data.name || acc.name,
      accountId: data.accountId || acc.accountId,
      planType: data.planType || acc.planType,
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
  el.textContent = normalizeGenerationError(msg);
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 10000);
}

function setGenerationStatus(phaseOrMessage, message) {
  const hintEl = $('#generationHint') || $('.toolbar-right .hint');
  if (!hintEl) return;
  hintEl.textContent = message || getGenerationProgressMessage(phaseOrMessage, String(phaseOrMessage || '正在生成图片'));
}

function stopWaitingStatusSequence() {
  if (state.waitingStatusTimer) {
    clearInterval(state.waitingStatusTimer);
    state.waitingStatusTimer = null;
  }
}

function startWaitingStatusSequence() {
  stopWaitingStatusSequence();
  state.waitingStatusStep = 0;
  setGenerationStatus(getWaitingProgressMessage(state.waitingStatusStep++));
  state.waitingStatusTimer = setInterval(() => {
    setGenerationStatus(getWaitingProgressMessage(state.waitingStatusStep++));
  }, 4500);
}

function setLoading(on) {
  state.generating = on;
  $('#generateBtn .btn-text').classList.toggle('hidden', on);
  $('#generateBtn .btn-loading').classList.toggle('hidden', !on);
  $('#generateBtn').disabled = on;
  if (state.generationHintTimer) {
    clearInterval(state.generationHintTimer);
    state.generationHintTimer = null;
  }
  stopWaitingStatusSequence();
  if (on) {
    state.generationHintStep = 0;
    setGenerationStatus(getGeneratingHint(state.generationHintStep++));
  } else {
    setGenerationStatus(IDLE_GENERATION_HINT);
  }
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
  $('#editModel').value = acc ? (acc.model || DEFAULT_MODEL) : DEFAULT_MODEL;
  $('#editStream').checked = acc ? acc.streamMode !== false : true;
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
    model: $('#editModel').value.trim() || DEFAULT_MODEL,
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

function addOAuthAccountFromResult(r) {
  addAccount({
    id: genId(),
    name: r.name || r.email || 'OpenAI',
    type: 'oauth',
    apiUrl: 'https://api.openai.com',
    apiKey: r.accessToken,
    model: DEFAULT_MODEL,
    streamMode: true,
    email: r.email || '',
    accountId: r.accountId || '',
    planType: r.planType || '',
    openaiDeviceId: r.openaiDeviceId || genId(),
    openaiSessionId: r.openaiSessionId || genId(),
    refreshToken: r.refreshToken || null,
    tokenExpiresAt: Date.now() + (r.expiresIn || 3600) * 1000,
    createdAt: Date.now(),
  });
  renderAccountList();
  renderSwitcher();
  renderDropdown();
}

function resetOAuthManual() {
  state.oauthPendingSessionId = null;
  state.oauthPendingState = null;
  state.oauthAuthUrl = '';
  const manualEl = $('#oauthManual');
  const inputEl = $('#oauthCallbackInput');
  const authUrlEl = $('#oauthAuthUrl');
  if (manualEl) manualEl.classList.add('hidden');
  if (inputEl) inputEl.value = '';
  if (authUrlEl) authUrlEl.value = '';
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
  return ok;
}

function openOAuthAuthUrl() {
  if (!state.oauthAuthUrl) return;
  window.open(state.oauthAuthUrl, '_blank', 'noopener,noreferrer');
}

async function copyOAuthAuthUrl() {
  const statusEl = $('#oauthStatus');
  const textEl = $('#oauthStatusText');
  statusEl.classList.remove('hidden');
  const ok = await copyTextToClipboard(state.oauthAuthUrl || $('#oauthAuthUrl').value);
  textEl.textContent = ok ? '授权链接已复制，请到浏览器打开登录。' : '复制失败，请手动长按/全选复制授权链接。';
}

async function startOAuth() {
  const statusEl = $('#oauthStatus');
  const textEl = $('#oauthStatusText');
  statusEl.classList.remove('hidden');
  textEl.textContent = '正在发起登录...';

  try {
    const resp = await fetch('/api/oauth/start', { method: 'POST' });
    const data = await resp.json();
    if (!data.authorizationUrl) throw new Error('未获取到授权地址');

    state.oauthPendingSessionId = data.sessionId || data.state;
    state.oauthPendingState = data.state;
    state.oauthAuthUrl = data.authorizationUrl;
    $('#oauthAuthUrl').value = data.authorizationUrl;
    $('#oauthCallbackInput').value = '';
    $('#oauthManual').classList.remove('hidden');
    textEl.textContent = '授权链接已生成。请点击“打开授权页面”或复制链接到浏览器登录，完成后把授权码/回调链接粘贴回来。';
    pollOAuthStatus(state.oauthPendingSessionId);
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
        addOAuthAccountFromResult(r);
        resetOAuthManual();
        textEl.textContent = '登录成功: ' + (r.email || r.name || '');
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

async function finishOAuthWithCode() {
  const statusEl = $('#oauthStatus');
  const textEl = $('#oauthStatusText');
  const inputEl = $('#oauthCallbackInput');
  const value = inputEl.value.trim();
  if ((!state.oauthPendingSessionId && !state.oauthPendingState) || !value) {
    textEl.textContent = '请先发起登录，并粘贴回调链接或 code';
    statusEl.classList.remove('hidden');
    return;
  }

  statusEl.classList.remove('hidden');
  textEl.textContent = '正在完成登录...';
  $('#oauthExchangeBtn').disabled = true;
  try {
    const resp = await fetch('/api/oauth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.oauthPendingSessionId, state: state.oauthPendingState, callbackUrl: value }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.status !== 'success') {
      throw new Error(data.error || data.message || `HTTP ${resp.status}`);
    }
    const r = data.result;
    addOAuthAccountFromResult(r);
    resetOAuthManual();
    textEl.textContent = '登录成功: ' + (r.email || r.name || '');
    setTimeout(() => statusEl.classList.add('hidden'), 2000);
  } catch (e) {
    textEl.textContent = '登录失败: ' + e.message;
  } finally {
    $('#oauthExchangeBtn').disabled = false;
  }
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
  const size = $('#sizeSelect').dataset.value;
  const format = $('#formatSelect').value;
  const style = $('#styleSelect').value;
  const type = $('#typeSelect').value;
  const hasRef = !!state.refImageBase64;

  let finalPrompt = prompt;
  const tags = [style, type].filter(Boolean);
  if (tags.length) finalPrompt = `${tags.join(', ')} style. ${prompt}`;

  setLoading(true);
  setGenerationStatus('prompt:prepare');
  $('#errorMsg').classList.add('hidden');

  try {
    if (cfg.isOAuth && hasRef) {
      throw new Error('OAuth 登录生图已改走 ChatGPT 后端通道；当前先支持文字生图，参考图请暂用 API Key 账号。');
    }
    await genBackgroundImages(cfg, finalPrompt, quality, background, size, format, hasRef);
  } catch (e) {
    showError(e);
  } finally {
    setLoading(false);
  }
}

// --- Background Jobs ---

function backgroundModeFor(cfg, hasRef) {
  if (cfg.isOAuth) return 'oauth';
  if (cfg.streamMode) return 'responses';
  return hasRef ? 'edits' : 'images';
}

function publicJobCfg(cfg) {
  return {
    apiUrl: cfg.apiUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    isOAuth: cfg.isOAuth,
    accountId: cfg.accountId,
    openaiDeviceId: cfg.openaiDeviceId,
    openaiSessionId: cfg.openaiSessionId,
  };
}

async function createBackgroundJob(payload) {
  const resp = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(normalizeGenerationError(data.error || data.message || `HTTP ${resp.status}`));
  return data;
}

async function fetchBackgroundJob(jobId) {
  const resp = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(normalizeGenerationError(data.error || data.message || `HTTP ${resp.status}`));
  return data;
}

function applyJobProgress(job) {
  const last = Array.isArray(job.progress) ? job.progress.at(-1) : null;
  if (last?.message) setGenerationStatus(last.phase || last.message, last.message);
}

async function pollBackgroundJob(jobId, format, isOAuth) {
  startWaitingStatusSequence();
  while (true) {
    const job = await fetchBackgroundJob(jobId);
    applyJobProgress(job);
    if (job.status === 'completed') {
      clearActiveJob();
      stopWaitingStatusSequence();
      setGenerationStatus('result:render');
      if (isOAuth) handleOAuthImageResult(job.result, format);
      else handleImagesResult(job.result, format);
      return;
    }
    if (job.status === 'failed') {
      clearActiveJob();
      stopWaitingStatusSequence();
      throw new Error(normalizeGenerationError(job.error || '后台生成失败'));
    }
    await sleep(2000);
  }
}

async function genBackgroundImages(cfg, prompt, quality, background, size, format, hasRef) {
  const mode = backgroundModeFor(cfg, hasRef);
  const payload = {
    mode,
    cfg: publicJobCfg(cfg),
    prompt,
    quality,
    background,
    size,
    format,
    refImageBase64: hasRef ? state.refImageBase64 : undefined,
  };

  setGenerationStatus('request:send');
  const job = await createBackgroundJob(payload);
  saveActiveJob({ jobId: job.jobId || job.id, format, isOAuth: cfg.isOAuth, createdAt: Date.now() });
  setGenerationStatus('后台任务已提交，可以切到后台稍后回来查看');
  await pollBackgroundJob(job.jobId || job.id, format, cfg.isOAuth);
}

async function resumeActiveJobIfAny() {
  const active = loadActiveJob();
  if (!active?.jobId || state.generating) return;
  setLoading(true);
  $('#errorMsg').classList.add('hidden');
  setGenerationStatus('正在恢复后台生成任务');
  try {
    await pollBackgroundJob(active.jobId, active.format || 'png', !!active.isOAuth);
  } catch (e) {
    clearActiveJob();
    showError(e);
  } finally {
    setLoading(false);
  }
}

// --- OAuth ChatGPT backend image generation ---
async function genOAuthImages(cfg, prompt, quality, background, size, format) {
  const body = {
    accessToken: cfg.apiKey,
    accountId: cfg.accountId,
    openaiDeviceId: cfg.openaiDeviceId,
    openaiSessionId: cfg.openaiSessionId,
    model: cfg.model,
    prompt,
    n: 1,
    quality,
    background,
    size,
    format,
  };

  setGenerationStatus('request:send');
  const resp = await fetch('/api/oauth/images/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const contentType = resp.headers.get('content-type') || '';
  startWaitingStatusSequence();
  if (!contentType.includes('text/event-stream')) {
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(normalizeGenerationError(data.error?.message || data.error || data.message || `HTTP ${resp.status}`));
    handleOAuthImageResult(data, format);
    return;
  }

  let resultData = null;
  let streamError = null;
  await readSseText(resp, (event, data) => {
    const message = getSseProgressMessage(event, data);
    if (message) {
      stopWaitingStatusSequence();
      setGenerationStatus(message);
    }
    if (event === 'result') {
      resultData = data;
    } else if (event === 'error') {
      streamError = data;
      stopWaitingStatusSequence();
      setGenerationStatus('生成失败，正在整理错误信息');
    }
  });

  if (streamError) throw new Error(normalizeGenerationError(streamError.error || streamError.message || streamError));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  if (!resultData) throw new Error('OAuth 生图接口未返回结果');
  handleOAuthImageResult(resultData, format);
}

function handleOAuthImageResult(data, format) {
  const acc = getActiveAccount();
  if (acc && acc.type === 'oauth') {
    const updates = {};
    if (data.openaiDeviceId && data.openaiDeviceId !== acc.openaiDeviceId) updates.openaiDeviceId = data.openaiDeviceId;
    if (data.openaiSessionId && data.openaiSessionId !== acc.openaiSessionId) updates.openaiSessionId = data.openaiSessionId;
    if (Object.keys(updates).length) updateAccount(acc.id, updates);
  }

  setGenerationStatus('result:render');
  stopWaitingStatusSequence();
  handleImagesResult(data, format);
}

// --- /v1/images/generations ---

async function genImages(cfg, prompt, quality, background, size, format) {
  const body = { model: cfg.model, prompt, n: 1, response_format: 'b64_json' };
  if (quality) body.quality = quality;
  if (background && background !== 'auto') body.background = background;
  if (size && size !== 'auto') body.size = size;
  if (format !== 'png') body.output_format = format;

  setGenerationStatus('request:send');
  const resp = await smartFetch(`${cfg.apiUrl}/v1/images/generations`, {
    method: 'POST',
    headers: buildHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    jsonBody: body,
    _forceProxy: cfg.isOAuth,
  });
  setGenerationStatus('request:accepted');
  startWaitingStatusSequence();
  const data = await resp.json();
  if (!resp.ok) throw new Error(normalizeGenerationError(data.error?.message || data.message || `HTTP ${resp.status}`));
  setGenerationStatus('result:render');
  stopWaitingStatusSequence();
  handleImagesResult(data, format);
}

// --- /v1/images/edits ---

async function genEdits(cfg, prompt, quality, background, size, format) {
  const body = {
    model: cfg.model, prompt, n: 1, response_format: 'b64_json',
    image: [{ type: 'base64', data: state.refImageBase64 }],
  };
  if (quality) body.quality = quality;
  if (background && background !== 'auto') body.background = background;
  if (size && size !== 'auto') body.size = size;
  if (format !== 'png') body.output_format = format;

  setGenerationStatus('request:send');
  const resp = await smartFetch(`${cfg.apiUrl}/v1/images/edits`, {
    method: 'POST',
    headers: buildHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    jsonBody: body,
    _forceProxy: cfg.isOAuth,
  });
  setGenerationStatus('request:accepted');
  startWaitingStatusSequence();
  const data = await resp.json();
  if (!resp.ok) throw new Error(normalizeGenerationError(data.error?.message || data.message || `HTTP ${resp.status}`));
  setGenerationStatus('result:render');
  stopWaitingStatusSequence();
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

async function genResponsesWithFallback(cfg, prompt, quality, background, size, format, hasRef) {
  try {
    await genResponses(cfg, prompt, quality, background, size, format, hasRef);
  } catch (e) {
    if (normalizeGenerationError(e) === POLICY_VIOLATION_MESSAGE) throw e;
    console.warn('Responses API failed, falling back to Images API:', e);
    setGenerationStatus('fallback:images');
    if (hasRef) await genEdits(cfg, prompt, quality, background, size, format);
    else await genImages(cfg, prompt, quality, background, size, format);
  }
}

async function genResponses(cfg, prompt, quality, background, size, format, hasRef) {
  let input;
  if (hasRef) {
    input = [{ role: 'user', content: [
      { type: 'input_image', image_url: `data:image/png;base64,${state.refImageBase64}` },
      { type: 'input_text', text: prompt },
    ]}];
  } else {
    input = prompt;
  }

  const imageTool = {
    type: 'image_generation',
    action: hasRef ? 'edit' : 'generate',
    quality: quality || 'medium',
    size: size === 'auto' ? 'auto' : size,
    background: background || 'auto',
    output_format: format,
  };

  const body = {
    model: cfg.model || DEFAULT_MODEL,
    input,
    stream: true,
    tool_choice: 'required',
    tools: [imageTool],
  };

  setGenerationStatus('request:send');
  const resp = await smartFetch(`${cfg.apiUrl}/v1/responses`, {
    method: 'POST',
    headers: buildHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    jsonBody: body,
    _forceProxy: cfg.isOAuth,
  });

  let found = false;
  let streamError = null;
  const contentType = resp.headers.get('content-type') || '';
  startWaitingStatusSequence();
  const rawText = contentType.includes('text/event-stream')
    ? await readSseText(resp, (event, data) => {
        if (!data || typeof data !== 'object') return;
        const message = getSseProgressMessage(event, data);
        if (message) {
          stopWaitingStatusSequence();
          setGenerationStatus(message);
        }
        const type = data.type || event;
        if (type === 'response.output_item.done' && data.item?.type === 'image_generation_call' && data.item.result) {
          stopWaitingStatusSequence();
          setGenerationStatus('result:render');
          addResultCard(data.item.result, format);
          found = true;
        }
        if (data.error) streamError = data.error;
      })
    : await resp.text();

  if (streamError) throw new Error(normalizeGenerationError(streamError.message || JSON.stringify(streamError)));

  try {
    setGenerationStatus('result:parse');
    const data = JSON.parse(rawText);
    if (!resp.ok) throw new Error(normalizeGenerationError(data.error?.message || data.message || `HTTP ${resp.status}`));
    for (const item of (data.output || [])) {
      if (item.type === 'image_generation_call' && item.result) { stopWaitingStatusSequence(); setGenerationStatus('result:render'); addResultCard(item.result, format); found = true; }
    }
    if (found) return;
  } catch (e) {
    if (e.message && !e.message.includes('JSON') && !e.message.includes('position')) throw e;
  }

  if (found) return;
  for (const line of rawText.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const s = line.slice(5).trim();
    if (!s || s === '[DONE]') continue;
    try {
      const ev = JSON.parse(s);
      const message = getResponseStreamProgressMessage(ev);
      if (message) { stopWaitingStatusSequence(); setGenerationStatus(message); }
      if (ev.type === 'response.output_item.done' && ev.item?.type === 'image_generation_call' && ev.item.result) { stopWaitingStatusSequence(); setGenerationStatus('result:render'); addResultCard(ev.item.result, format); found = true; }
      if (ev.error) throw new Error(normalizeGenerationError(ev.error.message || JSON.stringify(ev.error)));
    } catch (e) {
      if (e.message && !e.message.includes('JSON') && !e.message.includes('position')) throw e;
    }
  }

  if (isPolicyViolationText(rawText)) throw new Error(normalizeGenerationError(rawText));
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
  $('#oauthOpenBtn').onclick = openOAuthAuthUrl;
  $('#oauthCopyBtn').onclick = copyOAuthAuthUrl;
  $('#oauthExchangeBtn').onclick = finishOAuthWithCode;
  $('#oauthCancelBtn').onclick = () => {
    resetOAuthManual();
    $('#oauthStatus').classList.add('hidden');
  };

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

  // Custom size select
  const csEl = $('#sizeSelect');
  const csTrigger = csEl.querySelector('.cs-trigger');
  const csDropdown = csEl.querySelector('.cs-dropdown');
  csTrigger.onclick = (e) => { e.stopPropagation(); csDropdown.classList.toggle('hidden'); };
  csEl.querySelectorAll('.cs-item').forEach((item) => {
    item.onclick = () => {
      csEl.dataset.value = item.dataset.value;
      csTrigger.textContent = item.dataset.label;
      csEl.querySelectorAll('.cs-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      csDropdown.classList.add('hidden');
    };
    if (item.dataset.value === csEl.dataset.value) item.classList.add('active');
  });
  document.addEventListener('click', (e) => {
    if (!csEl.contains(e.target)) csDropdown.classList.add('hidden');
  });

  // Ctrl+Enter
  $('#prompt').addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate(); });

  resumeActiveJobIfAny();
});
