// Serveur HTTP local, sans dépendance : sert l'interface et relaie vers Whisper et Claude.
// Il est sans état : la session vit côté interface, ce qui facilitera le portage web.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { ROOT_DIR } from './config.js';
import { createClaudeCli, versionOf } from './llm/claude-cli.js';
import { createDemo } from './llm/demo.js';
import { DEMO_SCENARIO } from './llm/demo-scenario.js';
import { draftExport } from './llm/draft-export.js';
import { transcribe, whisperReachable } from './stt/whisper.js';

const WEB_DIR = join(ROOT_DIR, 'web');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};
const MAX_JSON = 2 * 1024 * 1024;
const MAX_AUDIO = 20 * 1024 * 1024;

export async function resolveProviders(cfg) {
  const demo = createDemo();
  let main = demo;
  let claudeVersion = null;
  if (cfg.llm === 'claude' || cfg.llm === 'auto') {
    claudeVersion = await versionOf(cfg.claudeBin);
    if (claudeVersion) main = createClaudeCli(cfg);
    else if (cfg.llm === 'claude') throw new Error(`CLI Claude introuvable (« ${cfg.claudeBin} »)`);
  }
  return { main, demo, claudeVersion };
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Requête trop volumineuse'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  try {
    return JSON.parse((await readBody(req, MAX_JSON)).toString('utf8'));
  } catch (err) {
    throw Object.assign(new Error(err.status ? err.message : 'JSON invalide'), { status: err.status || 400 });
  }
}

function checkSession(s) {
  if (!s || typeof s !== 'object' || !s.map?.nodes?.root || !Array.isArray(s.segments)) {
    throw Object.assign(new Error('Session invalide'), { status: 400 });
  }
  return s;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const file = join(WEB_DIR, rel || 'index.html');
  if (file !== join(WEB_DIR, 'index.html') && !file.startsWith(WEB_DIR + sep)) return send(res, 403, 'Interdit', 'text/plain');
  try {
    const data = await readFile(file);
    send(res, 200, data, TYPES[extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Introuvable', 'text/plain');
  }
}

export function createApp(cfg, providers, { log = console } = {}) {
  const pick = (body) => (body?.demo ? providers.demo : providers.main);

  const routes = {
    'GET /api/status': async () => ({
      llm: providers.main.name,
      claudeVersion: providers.claudeVersion,
      model: cfg.model || null,
      whisper: { url: cfg.whisperUrl, reachable: await whisperReachable(cfg) },
      language: cfg.language,
    }),
    'GET /api/demo-script': async () => DEMO_SCENARIO.map(({ text, answer }) => ({ text, answer: answer || null })),
    'POST /api/update': async (req) => {
      const body = await readJson(req);
      const session = checkSession(body.session);
      const started = Date.now();
      const result = await pick(body).update(session);
      log.info?.(`[update] ${pick(body).name} · ${result.ops.length} op(s) · ${Date.now() - started} ms`);
      return result;
    },
    'POST /api/warmup': async (req) => {
      const body = await readJson(req);
      if (!body.demo && typeof body.sessionId === 'string') providers.main.warm?.(body.sessionId);
      return { ok: true };
    },
    'POST /api/export': async (req) => {
      const body = await readJson(req);
      const session = checkSession(body.session);
      if (body.draft) return { prompt: draftExport(session), draft: true };
      return pick(body).export(session);
    },
    'POST /api/transcribe': async (req) => {
      const wav = await readBody(req, MAX_AUDIO);
      if (wav.length < 44 || wav.subarray(0, 4).toString() !== 'RIFF') {
        throw Object.assign(new Error('Audio WAV attendu'), { status: 400 });
      }
      const started = Date.now();
      let prompt = '';
      try { prompt = decodeURIComponent(req.headers['x-whisper-prompt'] || ''); } catch { /* en-tête illisible : ignoré */ }
      const text = await transcribe(wav, cfg, { prompt });
      log.info?.(`[stt] ${Date.now() - started} ms · « ${text.slice(0, 60)} »`);
      return { text };
    },
  };

  // Seule l'interface servie par ce serveur peut l'appeler (ni un autre site
  // ouvert dans le navigateur, ni un nom de domaine qui pointerait vers 127.0.0.1).
  const localHost = (h) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(h || '');
  const allowed = (req) => localHost(req.headers.host)
    && (!req.headers.origin || localHost(req.headers.origin.replace(/^https?:\/\//, '')));

  return createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (!allowed(req)) return send(res, 403, { error: 'Origine refusée' });
    const handler = routes[`${req.method} ${path}`];
    if (!handler) {
      if (req.method === 'GET' && !path.startsWith('/api/')) return serveStatic(req, res);
      return send(res, 404, { error: 'Route inconnue' });
    }
    try {
      send(res, 200, await handler(req));
    } catch (err) {
      const status = err.status || 502;
      log.error?.(`[${path}] ${err.message}`);
      send(res, status, { error: err.message });
    }
  });
}
