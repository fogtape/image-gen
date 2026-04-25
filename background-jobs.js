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
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt || null,
  };
}

export function createJobStore({ runner, ttlMs = 30 * 60 * 1000, idFactory = defaultIdFactory, now = () => Date.now() } = {}) {
  if (typeof runner !== 'function') throw new Error('Missing background job runner');
  const jobs = new Map();

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

  function create(payload = {}) {
    cleanup();
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

    Promise.resolve().then(async () => {
      update(job, { status: 'running' });
      try {
        const result = await runner(payload, (phase, message, extra) => addProgress(job, phase, message, extra));
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
          payload: undefined,
          finishedAt: now(),
        });
      }
    });

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
