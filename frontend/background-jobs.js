import { $ } from './dom.js';

export const ACTIVE_JOB_KEY = 'img-gen-active-job';
export const BACKGROUND_JOB_CREATE_TIMEOUT_MS = 20_000;
export const BACKGROUND_JOB_POLL_TIMEOUT_MS = 15_000;
export const BACKGROUND_JOB_POLL_INTERVAL_MS = 2_000;
export const BACKGROUND_JOB_POLL_RETRY_LIMIT = 4;
export const BACKGROUND_JOB_POLL_RETRY_BASE_MS = 1_200;
export const ACTIVE_JOB_STALE_MS = 30 * 60 * 1000;

export function saveActiveJob(state, job) {
  const jobIds = Array.isArray(job?.jobs)
    ? job.jobs.map((item) => String(item?.jobId || item?.id || '')).filter(Boolean)
    : [String(job?.jobId || job?.id || '')].filter(Boolean);
  for (const jobId of jobIds) state.stoppedJobIds.delete(jobId);
  localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job));
}

export function loadActiveJob() {
  try { return JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY)); } catch { return null; }
}

export function clearActiveJob() {
  localStorage.removeItem(ACTIVE_JOB_KEY);
  hideActiveJobBanner();
}

export function stopPollingJob(state, jobId) {
  const id = String(jobId || '');
  if (id) state.stoppedJobIds.add(id);
}

export function isPollingStopped(state, jobId) {
  const id = String(jobId || '');
  return !!id && state.stoppedJobIds.has(id);
}

export function formatRelativeTime(ts) {
  const diff = Math.max(0, Date.now() - Number(ts || 0));
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  return `${hour} 小时前`;
}

export function showActiveJobBanner(title, meta = '') {
  const wrap = $('#activeJobBanner');
  if (!wrap) return;
  $('#activeJobBannerTitle').textContent = title || '后台任务进行中';
  $('#activeJobBannerMeta').textContent = meta || '正在等待后台任务状态…';
  wrap.classList.remove('hidden');
}

export function hideActiveJobBanner() {
  $('#activeJobBanner')?.classList.add('hidden');
}
