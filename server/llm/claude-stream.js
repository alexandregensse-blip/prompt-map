// Conversations Claude persistantes : un processus `claude -p` en mode flux par session,
// gardé ouvert entre deux mises à jour. On évite le démarrage de la CLI à chaque appel
// et le début de la conversation reste en cache côté modèle.
//
// Premier message d'un processus : l'état complet (carte, grille, transcription).
// Ensuite : seulement les nouveautés. Si le processus plante, devient trop long ou reste
// inactif, on en relance un avec l'état actuel : un « compact » maison, sans rejouer l'historique.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { buildArgs, WORK_DIR } from './claude-cli.js';
import { buildUpdateMessage, buildDeltaMessage } from './prompts.js';
import { applyOps, toOutline } from '../../web/js/shared/map-model.js';

export const LIMITS = {
  maxTurns: 30, // au-delà, on repart d'un état compact
  maxChars: 200000, // taille cumulée des messages envoyés
  idleMs: 15 * 60 * 1000, // processus fermé après 15 min sans activité
  maxProcesses: 3, // sessions ouvertes en même temps (onglets)
};

export function streamArgs(opts) {
  return buildArgs({ ...opts, stream: true });
}

// Un processus `claude` qui reste ouvert. send() écrit un message et attend le résultat.
export class ClaudeProcess {
  constructor({ bin, timeoutMs, onExit, ...opts }) {
    mkdirSync(WORK_DIR, { recursive: true });
    this.timeoutMs = timeoutMs;
    this.turns = 0;
    this.chars = 0;
    this.alive = true;
    this.pending = null;
    this.stderr = '';
    this.child = spawn(bin, streamArgs(opts), { cwd: WORK_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    this.child.stdout.on('data', (d) => {
      buffer += d;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) this.onLine(line);
      }
    });
    this.child.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-2000); });
    const die = (reason) => {
      if (!this.alive) return;
      this.alive = false;
      this.fail(new Error(reason));
      onExit?.(this);
    };
    this.child.on('error', (err) => die(`Impossible de lancer « ${bin} » : ${err.message}`));
    this.child.on('close', (code) => die(`Le processus Claude s'est arrêté (code ${code})${this.stderr ? ` — ${this.stderr.trim().split('\n').slice(-2).join(' ')}` : ''}`));
    this.child.stdin.on('error', () => {});
  }

  onLine(line) {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.type === 'system' && event.subtype === 'init' && event.model) this.model = event.model;
    if (event.type !== 'result' || !this.pending) return;
    const { resolve, reject, timer } = this.pending;
    this.pending = null;
    clearTimeout(timer);
    if (event.is_error || (event.subtype && event.subtype !== 'success')) {
      reject(new Error(`Claude a renvoyé une erreur : ${String(event.result || event.subtype).slice(0, 300)}`));
    } else {
      resolve(event);
    }
  }

  fail(err) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(err);
    this.pending = null;
  }

  send(text) {
    if (!this.alive) return Promise.reject(new Error('Processus Claude arrêté'));
    if (this.pending) return Promise.reject(new Error('Un message est déjà en cours'));
    this.turns += 1;
    this.chars += text.length;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`Claude n'a pas répondu en ${Math.round(this.timeoutMs / 1000)} s`));
        this.close();
      }, this.timeoutMs);
      this.pending = { resolve, reject, timer };
      const message = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } };
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  close() {
    this.alive = false;
    this.fail(new Error('Processus Claude fermé'));
    this.child.stdin.end();
    this.child.kill('SIGTERM');
  }
}

// Ce que le modèle a déjà vu, pour n'envoyer ensuite que les nouveautés.
function snapshotOf(session, result) {
  return {
    segmentKeys: session.segments.map((s) => s.id || s.text),
    expectedOutline: toOutline(applyOps(session.map, result.ops).map),
    removedCount: session.map.removedByUser?.length || 0,
    dismissedCount: session.dismissed?.length || 0,
    later: [...(session.later || [])],
  };
}

function historyMatches(seen, session) {
  if (!seen || session.segments.length < seen.segmentKeys.length) return false;
  return seen.segmentKeys.every((key, i) => (session.segments[i].id || session.segments[i].text) === key);
}

// Un processus par session d'interface (clé : session.sessionId).
export class ConversationPool {
  constructor(opts, { log = console, limits = LIMITS } = {}) {
    this.opts = opts;
    this.log = log;
    this.limits = limits;
    this.conversations = new Map();
  }

  get(id) {
    let conv = this.conversations.get(id);
    if (!conv) {
      conv = { id, proc: null, seen: null, idle: null, busy: Promise.resolve() };
      this.conversations.set(id, conv);
    }
    // Ordre d'usage : la plus récente en dernier (éviction de la plus ancienne).
    this.conversations.delete(id);
    this.conversations.set(id, conv);
    return conv;
  }

  start(conv) {
    conv.proc?.close();
    conv.seen = null;
    conv.proc = new ClaudeProcess({
      ...this.opts(),
      onExit: (proc) => { if (conv.proc === proc) conv.seen = null; },
    });
    const open = [...this.conversations.values()].filter((c) => c.proc?.alive);
    for (const old of open.slice(0, Math.max(0, open.length - this.limits.maxProcesses))) this.drop(old.id);
  }

  touch(conv) {
    clearTimeout(conv.idle);
    conv.idle = setTimeout(() => this.drop(conv.id), this.limits.idleMs);
    conv.idle.unref?.();
  }

  drop(id) {
    const conv = this.conversations.get(id);
    if (!conv) return;
    clearTimeout(conv.idle);
    conv.proc?.close();
    this.conversations.delete(id);
  }

  // Lance le processus à l'avance, pour que le premier message n'attende pas le démarrage.
  warm(id) {
    const conv = this.get(id);
    if (!conv.proc?.alive) this.start(conv);
    this.touch(conv);
  }

  // Renvoie { event, commit } : commit(result) enregistre ce que le modèle a vu.
  async send(session) {
    const conv = this.get(session.sessionId);
    const run = conv.busy.then(async () => {
      const { proc } = conv;
      const fresh = proc?.alive && proc.turns === 0;
      const tooLong = proc && (proc.turns >= this.limits.maxTurns || proc.chars >= this.limits.maxChars);
      const snapshot = !proc?.alive || tooLong || !historyMatches(conv.seen, session);
      if (snapshot && !fresh) {
        if (proc) this.log.info?.(`[claude] nouvelle conversation (${!proc.alive ? 'processus arrêté' : tooLong ? 'conversation trop longue' : 'historique différent'}), reprise depuis l'état actuel`);
        this.start(conv);
      }
      const text = snapshot ? buildUpdateMessage(session) : buildDeltaMessage(session, conv.seen);
      this.touch(conv);
      try {
        const event = await conv.proc.send(text);
        return {
          event,
          model: conv.proc.model || null,
          commit: (result) => { conv.seen = snapshotOf(session, result); },
        };
      } catch (err) {
        conv.proc?.close();
        conv.seen = null;
        throw err;
      }
    });
    conv.busy = run.catch(() => {});
    return run;
  }

  closeAll() {
    for (const id of [...this.conversations.keys()]) this.drop(id);
  }
}
