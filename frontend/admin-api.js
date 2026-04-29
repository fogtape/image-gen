import { clearAdminSession, getAdminToken } from './admin-session.js';

function makeAdminError(message, { code, status } = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.context = 'admin';
  return error;
}

function buildHeaders(headers = {}, token = '') {
  const result = new Headers(headers || {});
  if (!result.has('Content-Type')) result.set('Content-Type', 'application/json');
  result.set('Authorization', `Bearer ${token}`);
  return result;
}

export async function adminFetch(input, init = {}) {
  const token = getAdminToken();
  if (!token) {
    throw makeAdminError('请先完成管理员登录，再执行管理操作。', {
      code: 'ADMIN_AUTH_REQUIRED',
      status: 401,
    });
  }
  const resp = await fetch(input, {
    ...init,
    headers: buildHeaders(init.headers, token),
  });
  if (resp.status === 401 || resp.status === 403) {
    clearAdminSession();
    throw makeAdminError('管理员登录已过期或口令无效，请重新登录。', {
      code: 'ADMIN_AUTH_EXPIRED',
      status: resp.status,
    });
  }
  return resp;
}
