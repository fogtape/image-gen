import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, 'proof-worker.js');

/**
 * Run proof-of-work computation in a worker thread to avoid blocking the event loop.
 * @param {'challenge'|'proof'} type - Which computation to run
 * @param {object} data - Parameters for the computation
 * @returns {Promise<string>} - The computed result
 */
export function runProofOfWork(type, data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: { type, data },
    });
    worker.on('message', (result) => {
      resolve(result);
    });
    worker.on('error', (err) => {
      reject(err);
    });
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Proof-of-work worker exited with code ${code}`));
      }
    });
    // Timeout after 30 seconds to prevent runaway workers
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Proof-of-work worker timed out'));
    }, 30_000);
    worker.on('message', () => clearTimeout(timer));
    worker.on('error', () => clearTimeout(timer));
    worker.on('exit', () => clearTimeout(timer));
  });
}
