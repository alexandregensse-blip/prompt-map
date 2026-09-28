import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeCli } from '../server/llm/claude-cli.js';
import { streamArgs } from '../server/llm/claude-stream.js';
import { createMap, applyOps } from '../web/js/shared/map-model.js';
import { emptyGrid } from '../web/js/shared/grid.js';

const FAKE_CLAUDE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.js');
const quiet = { info() {}, error() {} };

// Simule l'interface : une session, des phrases, les résultats appliqués à la carte.
function harness(t, { env = {}, limits, cfg = {} } = {}) {
  const log = join(mkdtempSync(join(tmpdir(), 'pm-')), 'log.jsonl');
  const saved = { ...process.env };
  Object.assign(process.env, { FAKE_CLAUDE_LOG: log }, env);
  const llm = createClaudeCli({ claudeBin: FAKE_CLAUDE, timeoutMs: 10000, ...cfg }, { log: quiet, limits });
  t.after(() => { llm.close(); process.env = saved; });
  const session = {
    sessionId: 'abc', map: createMap(), grid: emptyGrid(), suggestions: [], dismissed: [],
    segments: [], processedCount: 0, usedSuggestionIds: [],
  };
  let n = 0;
  return {
    llm,
    session,
    calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []),
    async say(text) {
      session.segments.push({ id: `seg${++n}`, text });
      const res = await llm.update(session);
      session.map = applyOps(session.map, res.ops).map;
      session.grid = res.grid;
      session.suggestions = res.suggestions;
      session.processedCount = session.segments.length;
      return res;
    },
  };
}

test('arguments du mode flux', () => {
  const args = streamArgs({ system: 'S', schema: { type: 'object' } });
  assert.deepEqual(args.slice(args.indexOf('--input-format'), args.indexOf('--input-format') + 2), ['--input-format', 'stream-json']);
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
  assert.ok(args.includes('--verbose'));
  assert.equal(args.filter((a) => a === '--output-format').length, 1);
});

test('un seul processus : état complet d’abord, puis seulement les nouveautés', async (t) => {
  const h = harness(t);
  await h.say('Première phrase.');
  await h.say('Deuxième phrase.');
  await h.say('Troisième phrase.');
  const calls = h.calls();
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.stream));
  assert.equal(new Set(calls.map((c) => c.pid)).size, 1, 'un seul processus claude');
  assert.match(calls[0].input, /## Carte actuelle/);
  assert.doesNotMatch(calls[1].input, /## Carte actuelle|Première phrase/);
  assert.match(calls[1].input, /## Nouveau depuis la dernière mise à jour\n2\. Deuxième phrase\./);
  assert.match(calls[2].input, /3\. Troisième phrase\./);
  assert.doesNotMatch(calls[2].input, /modifié la carte/);
  assert.match(calls[2].input, /Prochain id libre : n3/);
  assert.equal(Object.keys(h.session.map.nodes).length, 4);
});

test('une correction manuelle de la carte est transmise en entier', async (t) => {
  const h = harness(t);
  await h.say('Première phrase.');
  h.session.map = applyOps(h.session.map, [{ op: 'update', id: 'n1', label: 'Corrigé à la main' }], { origin: 'user' }).map;
  h.session.dismissed.push('Une question ?');
  await h.say('Suite.');
  const last = h.calls().at(-1).input;
  assert.match(last, /L'utilisateur a modifié la carte : voici la carte actuelle\n- \[root\]/);
  assert.match(last, /\[n1\] Corrigé à la main \(corrigé par l’utilisateur\)/);
  assert.match(last, /ne pas reproposer\)\n- Une question \?/);
});

test('plantage : secours ponctuel, puis nouvelle conversation reprise depuis l’état actuel', async (t) => {
  const h = harness(t, { env: { FAKE_CLAUDE_CRASH_AFTER: '1' } });
  await h.say('Un.');
  const res = await h.say('Deux.');
  assert.equal(res.ops[0].label, 'Depuis le faux Claude', 'le secours a répondu');
  await h.say('Trois.');
  const calls = h.calls();
  const [first, crashed, fallback, resumed] = calls;
  assert.ok(first.stream && crashed.stream && !fallback.stream && resumed.stream);
  assert.equal(first.pid, crashed.pid);
  assert.notEqual(resumed.pid, first.pid);
  assert.match(fallback.input, /## Carte actuelle/);
  // Pseudo-compact : l'état complet (carte, transcription), pas un rejeu des messages.
  assert.match(resumed.input, /## Carte actuelle/);
  assert.match(resumed.input, /## Transcription déjà prise en compte\n1\. Un\.\n2\. Deux\./);
  assert.match(resumed.input, /## Nouveau depuis la dernière mise à jour\n3\. Trois\./);
});

test('conversation trop longue : on repart d’un état compact', async (t) => {
  const h = harness(t, { limits: { maxTurns: 2, maxChars: 1e9, idleMs: 60000, maxProcesses: 3 } });
  await h.say('Un.');
  await h.say('Deux.');
  await h.say('Trois.');
  const calls = h.calls();
  assert.equal(calls[0].pid, calls[1].pid);
  assert.notEqual(calls[2].pid, calls[1].pid);
  assert.match(calls[2].input, /## Carte actuelle/);
});

test('historique différent (autre session, transcription modifiée) : état complet', async (t) => {
  const h = harness(t);
  await h.say('Un.');
  h.session.segments[0] = { id: 'autre', text: 'Réécrit.' };
  await h.say('Deux.');
  const calls = h.calls();
  assert.notEqual(calls[1].pid, calls[0].pid);
  assert.match(calls[1].input, /## Carte actuelle/);
});

test('préchauffage : le processus démarre avant la première phrase et sert ensuite', async (t) => {
  const h = harness(t);
  h.llm.warm('abc');
  await new Promise((r) => setTimeout(r, 300));
  await h.say('Un.');
  await h.say('Deux.');
  const calls = h.calls();
  assert.equal(calls[0].pid, calls[1].pid);
  assert.match(calls[0].input, /## Carte actuelle/);
});

test('mode ponctuel forcé par la configuration', async (t) => {
  const h = harness(t, { cfg: { claudeMode: 'oneshot' } });
  await h.say('Un.');
  await h.say('Deux.');
  const calls = h.calls();
  assert.ok(calls.every((c) => !c.stream));
  assert.notEqual(calls[0].pid, calls[1].pid);
});
