// Configuration : valeurs par défaut < prompt-map.config.json < variables d'environnement.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  port: 4317,
  host: '127.0.0.1',
  // auto : Claude Code si la CLI est installée, sinon démo.
  llm: 'auto',
  claudeBin: 'claude',
  claudeMode: 'stream', // stream : une conversation gardée ouverte par session · oneshot : un processus par appel
  model: '', // vide = modèle par défaut de ton Claude Code
  updateEffort: 'low', // mises à jour fréquentes : on privilégie la réactivité
  exportEffort: '', // export : effort par défaut du modèle
  timeoutMs: 120000,
  researchTimeoutMs: 300000, // une recherche web peut prendre quelques minutes
  researchEffort: '',
  whisperUrl: 'http://127.0.0.1:8178/inference',
  // Serveur Whisper minuscule dédié au direct (mots affichés pendant qu'on parle) ; '' pour s'en passer.
  whisperLiveUrl: 'http://127.0.0.1:8179/inference',
  whisperModel: '',
  language: 'fr',
  openWindow: true,
  // Adresses supplémentaires acceptées (ex. IP d'un conteneur) ; localhost l'est toujours.
  allowedHosts: [],
  // HTTPS (certificat et clé PEM) : nécessaire au micro hors de localhost.
  tlsCert: '',
  tlsKey: '',
};

const ENV = {
  port: ['PROMPTMAP_PORT', Number],
  host: ['PROMPTMAP_HOST', String],
  llm: ['PROMPTMAP_LLM', String],
  claudeBin: ['PROMPTMAP_CLAUDE_BIN', String],
  claudeMode: ['PROMPTMAP_CLAUDE_MODE', String],
  model: ['PROMPTMAP_MODEL', String],
  updateEffort: ['PROMPTMAP_UPDATE_EFFORT', String],
  exportEffort: ['PROMPTMAP_EXPORT_EFFORT', String],
  timeoutMs: ['PROMPTMAP_TIMEOUT_MS', Number],
  researchEffort: ['PROMPTMAP_RESEARCH_EFFORT', String],
  whisperUrl: ['PROMPTMAP_WHISPER_URL', String],
  whisperLiveUrl: ['PROMPTMAP_WHISPER_LIVE_URL', String],
  whisperModel: ['PROMPTMAP_WHISPER_MODEL', String],
  language: ['PROMPTMAP_LANGUAGE', String],
  openWindow: ['PROMPTMAP_OPEN', (v) => !/^(0|false|no|non)$/i.test(v)],
  allowedHosts: ['PROMPTMAP_ALLOWED_HOSTS', (v) => v.split(',').map((h) => h.trim()).filter(Boolean)],
  tlsCert: ['PROMPTMAP_TLS_CERT', String],
  tlsKey: ['PROMPTMAP_TLS_KEY', String],
};

export function loadConfig(env = process.env, file = join(ROOT_DIR, 'prompt-map.config.json')) {
  let fromFile = {};
  if (existsSync(file)) {
    try {
      fromFile = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`prompt-map.config.json invalide : ${err.message}`);
    }
  }
  const cfg = { ...DEFAULTS, ...fromFile };
  for (const [key, [name, cast]] of Object.entries(ENV)) {
    if (env[name] !== undefined && env[name] !== '') cfg[key] = cast(env[name]);
  }
  return cfg;
}
