import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function defaultIdFactory() {
  return `job_${crypto.randomBytes(12).toString('hex')}`;
}

function clonePublicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress.slice(),
    result: job.result ?? null,
    error: job.error || null,
    errorInfo: job.errorInfo || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt || null,
    cancelledAt: job.cancelledAt || null,
  };
}

function normalizeDurationMs(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function createJobStore({
  runner,
  ttlMs = 30 * 60 * 1000,
  maxPendingMs = 15 * 60 * 1000,
  maxRunningMs = 15 * 60 * 1000,
  idFactory = defaultIdFactory,
  now = () => Date.now(),
  maxConcurrency = Infinity,
  maxQueue = Infinity,
  persistencePath = null,
} = {}) {
  if (typeof runner !== 'function') throw new Error('Missing background job runner');
  const retentionTtlMs = normalizeDurationMs(ttlMs, 30 * 60 * 1000);
  const pendingTimeoutMs = normalizeDurationMs(maxPendingMs, 15 * 60 * 1000);
  const runningTimeoutMs = normalizeDurationMs(maxRunningMs, 15 * 60 * 1000);
  const jobs = new Map();
  const queue = [];
  let runningCount = 0;

  // --- File persistence for job recovery across restarts ---
  function persistJobs() {
    if (!persistencePath) return;
    try {
      const active = [];
      for (const [, job] of jobs) {
        if (!isFinalStatus(job.status)) {
          active.push({ id: job.id, status: job.status, createdAt: job.createdAt, progress: job.progress.slice(-5) });
        }
      }
      const dir = path.dirname(persistencePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${persistencePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ active, savedAt: now() }), 'utf8');
      fs.renameSync(tmp, persistencePath);
    } catch { /* best-effort persistence */ }
  }

  function recoverPersistedJobs() {
    if (!persistencePath) return;
    try {
      if (!fs.existsSync(persistencePath)) return;
      const data = JSON.parse(fs.readFileSync(persistencePath, 'utf8'));
      if (!Array.isArray(data?.active)) return;
      for (const saved of data.active) {
        if (!saved?.id) continue;
        jobs.set(saved.id, {
          id: saved.id,
          status: 'failed',
          progress: saved.progress || [],
          result: null,
          error: '服务重启，任务中断',
          errorInfo: { code: 'SERVER_RESTARTED' },
          createdAt: saved.createdAt || now(),
          updatedAt: now(),
          finishedAt: now(),
          cancelledAt: null,
          started: false,
          slotReleased: true,
        });
      }
      try { fs.unlinkSync(persistencePath); } catch {}
    } catch { /* best-effort recovery */ }
  }

  recoverPersistedJobs();

  function isFinalStatus(status) {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
  }

  function makeCancelledError() {
    const error = new Error('后台任务已取消');
    error.name = 'AbortError';
    error.code = 'JOB_CANCELLED';
    return error;
  }

  function update(job, fields = {}) {
    Object.assign(job, fields, { updatedAt: now() });
  }

  function releaseRunningSlot(job) {
    if (!job?.started || job.slotReleased) return false;
    job.slotReleased = true;
    runningCount = Math.max(0, runningCount - 1);
    return true;
  }

  function addProgress(job, phase, message, extra = {}) {
    if (isFinalStatus(job.status) && phase !== 'job:cancelled') return null;
    if (extra?.previewImage) {
      for (const item of job.progress) delete item.previewImage;
    }
    const event = {
      phase: String(phase || ''),
      message: String(message || phase || '处理中'),
      at: now(),
      ...extra,
    };
    job.progress.push(event);
    job.progress = job.progress.slice(-50);
    update(job);
    return event;
  }

  function drainQueue() {
    while (runningCount < maxConcurrency && queue.length) {
      const next = queue.shift();
      if (!next) break;
      if (next.status === 'cancelled') continue;
      start(next);
    }
  }

  function start(job) {
    runningCount += 1;
    job.started = true;
    job.slotReleased = false;
    Promise.resolve().then(async () => {
      if (isFinalStatus(job.status) || job.controller?.signal?.aborted) return;
      update(job, { status: 'running', startedAt: now() });
      try {
        const result = await runner(job.payload, (phase, message, extra) => addProgress(job, phase, message, extra), job.controller.signal);
        if (!isFinalStatus(job.status) && !job.controller.signal.aborted) {
          update(job, {
            status: 'completed',
            result,
            error: null,
            payload: undefined,
            finishedAt: now(),
          });
          persistJobs();
        }
      } catch (e) {
        if (isFinalStatus(job.status)) {
          // The job may already have been marked failed by timeout cleanup.
        } else if (job.status === 'cancelled' || job.controller.signal.aborted || e?.name === 'AbortError' || e?.code === 'JOB_CANCELLED') {
          if (job.status !== 'cancelled') {
            const cancelledAt = now();
            addProgress(job, 'job:cancelled', '后台任务已取消');
            update(job, {
              status: 'cancelled',
              error: null,
              errorInfo: null,
              payload: undefined,
              finishedAt: cancelledAt,
              cancelledAt,
            });
            persistJobs();
          }
        } else {
          update(job, {
            status: 'failed',
            error: e?.message || String(e),
            errorInfo: {
              message: e?.message || String(e),
              status: Number(e?.status || 0) || null,
              code: e?.code || '',
              errorType: e?.errorType || '',
              fallbackAttempted: e?.fallbackAttempted === true,
            },
            payload: undefined,
            finishedAt: now(),
          });
          persistJobs();
        }
      } finally {
        releaseRunningSlot(job);
        drainQueue();
      }
    });
  }

  function create(payload = {}) {
    cleanup();
    if (runningCount + queue.length >= maxQueue) {
      const error = new Error('后台任务队列已满，请稍后重试');
      error.status = 503;
      error.code = 'JOB_QUEUE_FULL';
      throw error;
    }
    const createdAt = now();
    const job = {
      id: idFactory(),
      status: 'pending',
      payload,
      progress: [],
      result: null,
      error: null,
      errorInfo: null,
      controller: new AbortController(),
      started: false,
      startedAt: null,
      slotReleased: false,
      createdAt,
      updatedAt: createdAt,
      finishedAt: null,
      cancelledAt: null,
    };
    jobs.set(job.id, job);
    addProgress(job, 'queue:accepted', runningCount >= maxConcurrency ? '任务已进入队列，等待执行' : '任务已提交，等待执行', { progressKind: 'estimated', source: 'queue' });
    persistJobs();
    if (runningCount < maxConcurrency) start(job);
    else queue.push(job);

    return clonePublicJob(job);
  }

  function get(id) {
    cleanup();
    return clonePublicJob(jobs.get(String(id || '')) || null);
  }

  function cancel(id) {
    cleanup();
    const job = jobs.get(String(id || ''));
    if (!job) return null;
    if (isFinalStatus(job.status)) return clonePublicJob(job);

    const cancelledAt = now();
    const queuedIndex = queue.indexOf(job);
    if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
    try { job.controller?.abort(makeCancelledError()); } catch { job.controller?.abort?.(); }
    addProgress(job, 'job:cancelled', '后台任务已取消');
    update(job, {
      status: 'cancelled',
      error: null,
      errorInfo: null,
      payload: undefined,
      finishedAt: cancelledAt,
      cancelledAt,
    });
    if (!job.started) drainQueue();
    return clonePublicJob(job);
  }

  function failTimedOutJob(job, { phase, message, code, errorType }) {
    if (!job || isFinalStatus(job.status)) return false;
    const finishedAt = now();
    const queuedIndex = queue.indexOf(job);
    if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
    try { job.controller?.abort(makeCancelledError()); } catch { job.controller?.abort?.(); }
    addProgress(job, phase, message);
    update(job, {
      status: 'failed',
      error: message,
      errorInfo: {
        message,
        status: null,
        code,
        errorType,
        fallbackAttempted: false,
      },
      payload: undefined,
      finishedAt,
    });
    releaseRunningSlot(job);
    return true;
  }

  function cleanup() {
    const current = now();
    const cutoff = current - retentionTtlMs;
    let changed = false;
    for (const [id, job] of jobs) {
      if (isFinalStatus(job.status) && Number(job.finishedAt || job.updatedAt) < cutoff) {
        jobs.delete(id);
        changed = true;
        continue;
      }
      if (isFinalStatus(job.status)) continue;
      if (!job.started && pendingTimeoutMs !== Infinity && current - Number(job.createdAt || current) > pendingTimeoutMs) {
        changed = failTimedOutJob(job, {
          phase: 'job:timeout',
          message: '后台任务排队超时，请重试',
          code: 'JOB_PENDING_TIMEOUT',
          errorType: 'job_timeout',
        }) || changed;
        continue;
      }
      if (job.started && runningTimeoutMs !== Infinity && current - Number(job.startedAt || job.createdAt || current) > runningTimeoutMs) {
        changed = failTimedOutJob(job, {
          phase: 'job:timeout',
          message: '后台任务执行超时，请重试',
          code: 'JOB_RUNNING_TIMEOUT',
          errorType: 'job_timeout',
        }) || changed;
      }
    }
    if (changed) drainQueue();
  }

  return { create, get, cancel, cleanup };
}
