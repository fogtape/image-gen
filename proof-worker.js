import { parentPort, workerData } from 'node:worker_threads';
import crypto from 'crypto';

function sha3Hex(input) {
  return crypto.createHash('sha3-512').update(input).digest('hex');
}

function compactJSON(value) {
  return JSON.stringify(value);
}

function generateChallengeAnswer(seed, difficulty, config) {
  const diffLen = difficulty.length;
  const p1 = compactJSON(config.slice(0, 3)).replace(/\]$/, '');
  const p2 = compactJSON(config.slice(4, 9)).replace(/^\[/, '');
  const p3 = compactJSON(config.slice(10)).replace(/^\[/, '');
  for (let i = 0; i < 100000; i++) {
    const payload = `${p1}${i},${p2},${i >> 1},${p3}`;
    const encoded = Buffer.from(payload).toString('base64');
    if (sha3Hex(seed + encoded).slice(0, diffLen) <= difficulty) return encoded;
  }
  return '';
}

function generateProofToken({ seed, difficulty, userAgent, chatgptBase }) {
  const screen = String(seed).length % 2 === 0 ? 4010 : 3008;
  const token = [
    screen,
    new Date().toUTCString(),
    null,
    0,
    userAgent,
    `${chatgptBase}/`,
    'dpl=openai-images',
    'en',
    'en-US',
    null,
    'plugins[object PluginArray]',
    '_reactListening',
    'alert',
  ];
  const diffLen = String(difficulty).length;
  for (let i = 0; i < 100000; i++) {
    token[3] = i;
    const encoded = Buffer.from(JSON.stringify(token)).toString('base64');
    if (sha3Hex(String(seed) + encoded).slice(0, diffLen) <= String(difficulty)) return `gAAAAAB${encoded}`;
  }
  const fallbackBase = Buffer.from(JSON.stringify(String(seed))).toString('base64');
  return `gAAAAA...xZ4D${fallbackBase}`;
}

const { type, data } = workerData;

let result;
if (type === 'challenge') {
  result = generateChallengeAnswer(data.seed, data.difficulty, data.config);
} else if (type === 'proof') {
  result = generateProofToken(data);
}

parentPort.postMessage(result);
