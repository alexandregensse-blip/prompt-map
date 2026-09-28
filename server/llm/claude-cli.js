// Fournisseur Claude via la CLI Claude Code (`claude -p`) : utilise l'abonnement
// déjà connecté sur la machine, sans clé API ni coût à l'usage.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UPDATE_SYSTEM, UPDATE_SCHEMA, EXPORT_SYSTEM, buildUpdateMessage, buildExportMessage } from './prompts.js';
import { normalizeUpdate, extractJson } from './normalize.js';
import { ConversationPool } from './claude-stream.js';

// Dossier vide : la CLI ne charge ni CLAUDE.md ni réglages d'un projet.
export const WORK_DIR = join(tmpdir(), 'prompt-map-claude');

// stream : processus gardé ouvert, messages JSON ligne par ligne sur l'entrée et la sortie.
export function buildArgs({ system, schema, model, effort, stream = false }) {
  const args = [
    '-p',
    ...(stream
      ? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']
      : ['--output-format', 'json']),
    '--no-session-persistence',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--system-prompt', system,
  ];
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  // Aucun outil : le modèle ne fait que lire et répondre.
  args.push('--tools', '');
  return args;
}

// Interprète la sortie `--output-format json` de la CLI.
export function parseCliOutput(stdout) {
  const tryParse = (text) => { try { return JSON.parse(text); } catch { return null; } };
  const lines = stdout.trim().split('\n').filter(Boolean);
  const envelope = tryParse(lines.at(-1) || '') || tryParse(stdout);
  if (!envelope) throw new Error('Sortie de la CLI Claude illisible');
  if (envelope.is_error || (envelope.subtype && envelope.subtype !== 'success')) {
    throw new Error(`Claude a renvoyé une erreur : ${String(envelope.result || envelope.subtype).slice(0, 300)}`);
  }
  return envelope;
}

export function runClaude({ bin, prompt, timeoutMs, ...opts }) {
  mkdirSync(WORK_DIR, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(bin, buildArgs(opts), { cwd: WORK_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Claude n'a pas répondu en ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Impossible de lancer « ${bin} » : ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        resolve(parseCliOutput(stdout));
      } catch (err) {
        const detail = stderr.trim().split('\n').slice(-3).join(' ');
        reject(new Error(`${err.message}${code ? ` (code ${code})` : ''}${detail ? ` — ${detail}` : ''}`));
      }
    });
    child.stdin.end(prompt);
  });
}

export function versionOf(bin) {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => { child.kill(); resolve(null); }, 5000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? out.trim() : null); });
  });
}

export function createClaudeCli(cfg, { log = console, limits } = {}) {
  const base = { bin: cfg.claudeBin, model: cfg.model, timeoutMs: cfg.timeoutMs };
  // Si la CLI refuse la sortie structurée (--json-schema), on bascule une fois pour toutes
  // sur du JSON lu dans le texte : le prompt système décrit le format de toute façon.
  let useSchema = true;
  // Conversations persistantes, sauf si elles échouent trois fois de suite.
  let streamFailures = 0;
  const useStream = () => cfg.claudeMode !== 'oneshot' && streamFailures < 3;
  const pool = new ConversationPool(() => ({
    ...base,
    effort: cfg.updateEffort,
    system: UPDATE_SYSTEM,
    schema: useSchema ? UPDATE_SCHEMA : null,
  }), { log, limits });

  const parse = (envelope, session) => {
    const data = envelope.structured_output ?? extractJson(envelope.result);
    if (!data) throw new Error('Réponse de Claude sans JSON exploitable');
    return normalizeUpdate(data, session.grid);
  };

  // Appel ponctuel : un processus par mise à jour, avec l'état complet.
  async function oneShot(session) {
    const call = (schema) => runClaude({
      ...base,
      effort: cfg.updateEffort,
      system: UPDATE_SYSTEM,
      schema,
      prompt: buildUpdateMessage(session),
    });
    let envelope;
    try {
      envelope = await call(useSchema ? UPDATE_SCHEMA : null);
    } catch (err) {
      if (!useSchema || /Impossible de lancer|n'a pas répondu|Not logged in|login/i.test(err.message)) throw err;
      log.error?.(`[claude] échec avec --json-schema (${err.message}) : nouvel essai sans schéma`);
      useSchema = false;
      envelope = await call(null);
    }
    return parse(envelope, session);
  }

  return {
    name: 'claude-cli',
    warm(sessionId) {
      if (useStream() && sessionId) pool.warm(sessionId);
    },
    async update(session) {
      if (useStream() && session.sessionId) {
        try {
          const { event, commit } = await pool.send(session);
          const result = parse(event, session);
          commit(result);
          streamFailures = 0;
          return result;
        } catch (err) {
          pool.drop(session.sessionId);
          streamFailures += 1;
          if (/Impossible de lancer/.test(err.message)) throw err;
          log.error?.(`[claude] conversation persistante en échec (${err.message}) : appel ponctuel en secours`);
        }
      }
      return oneShot(session);
    },
    async export(session) {
      const envelope = await runClaude({
        ...base,
        effort: cfg.exportEffort,
        system: EXPORT_SYSTEM,
        prompt: buildExportMessage(session),
      });
      const text = String(envelope.result || '').trim();
      if (!text) throw new Error('Claude a renvoyé un prompt vide');
      return { prompt: text.replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, '$1') };
    },
    close() {
      pool.closeAll();
    },
  };
}
