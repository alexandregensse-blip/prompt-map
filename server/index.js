#!/usr/bin/env node
// Point d'entrée : `npm start` (ou `node server/index.js`, `--demo` pour forcer la démo).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { createApp, resolveProviders } from './app.js';

const args = new Set(process.argv.slice(2));
const cfg = loadConfig();
if (args.has('--demo')) cfg.llm = 'demo';
if (args.has('--no-open')) cfg.openWindow = false;

const CHROMIUM = {
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  win32: [
    `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
};

function findChromium() {
  for (const candidate of CHROMIUM[process.platform] || []) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) return candidate;
    } else if (spawnSync('which', [candidate]).status === 0) {
      return candidate;
    }
  }
  return null;
}

// Ouvre une fenêtre d'application (sans barre d'adresse) si un navigateur Chromium
// est installé ; sinon, le navigateur par défaut.
function openWindow(url) {
  const chromium = findChromium();
  const detached = { detached: true, stdio: 'ignore' };
  if (chromium) {
    spawn(chromium, [
      `--app=${url}`,
      `--user-data-dir=${join(tmpdir(), 'prompt-map-window')}`,
      '--window-size=1360,860',
      '--no-first-run',
      '--no-default-browser-check',
    ], detached).unref();
    return;
  }
  const opener = { darwin: 'open', win32: 'explorer' }[process.platform] || 'xdg-open';
  spawn(opener, [url], detached).on('error', () => {}).unref();
}

const providers = await resolveProviders(cfg);
const server = createApp(cfg, providers);
server.listen(cfg.port, cfg.host, () => {
  const url = `http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${cfg.port}`;
  const llm = providers.main.name === 'claude-cli'
    ? `Claude Code ${providers.claudeVersion.replace(/\s*\(Claude Code\)/, '')}${cfg.model ? ` (modèle ${cfg.model})` : ''}`
    : 'démo (sans IA)';
  console.log(`\n  prompt-map  →  ${url}\n  LLM         :  ${llm}\n  Whisper     :  ${cfg.whisperUrl}\n`);
  if (cfg.openWindow) openWindow(url);
});
const shutdown = () => {
  providers.main.close?.();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Le port ${cfg.port} est déjà utilisé (PROMPTMAP_PORT pour en changer).` : err.message);
  process.exit(1);
});
