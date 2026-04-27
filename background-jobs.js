import crypto from 'crypto';

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
  };
}

export function createJobStore({ runner, ttlMs = 30 * 60 * 1000, idFactory = defaultIdFactory, now = () => Date.now(), maxConcurrency = Infinity, maxQueue = Infinity } = {}) {
  if (typeof runner !== 'function') throw new Error('Missing background job runner');
  const jobs = new Map();
  const queue = [];
  let runningCount = 0;

  function update(job, fields = {}) {
    Object.assign(job, fields, { updatedAt: now() });
  }

  function addProgress(job, phase, message, extra = {}) {
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
      start(next);
    }
  }

  function start(job) {
    runningCount += 1;
    Promise.resolve().then(async () => {
      update(job, { status: 'running' });
      try {
        const result = await runner(job.payload, (phase, message, extra) => addProgress(job, phase, message, extra));
        update(job, {
          status: 'completed',
          result,
          error: null,
          payload: undefined,
          finishedAt: now(),
        });
      } catch (e) {
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
      } finally {
        runningCount = Math.max(0, runningCount - 1);
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
      createdAt,
      updatedAt: createdAt,
      finishedAt: null,
    };
    jobs.set(job.id, job);
    addProgress(job, 'queue:accepted', runningCount >= maxConcurrency ? '任务已进入队列，等待执行' : '任务已提交，等待执行');
    if (runningCount < maxConcurrency) start(job);
    else queue.push(job);

    return clonePublicJob(job);
  }

  function get(id) {
    cleanup();
    return clonePublicJob(jobs.get(String(id || '')) || null);
  }

  function cleanup() {
    const cutoff = now() - ttlMs;
    for (const [id, job] of jobs) {
      if ((job.status === 'completed' || job.status === 'failed') && Number(job.finishedAt || job.updatedAt) < cutoff) {
        jobs.delete(id);
      }
    }
  }

  return { create, get, cleanup };
}
