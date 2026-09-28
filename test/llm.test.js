import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUpdateMessage, buildExportMessage, nextSuggestionId, formatSegment, UPDATE_SCHEMA, UPDATE_SYSTEM } from '../server/llm/prompts.js';
import { normalizeUpdate, extractJson } from '../server/llm/normalize.js';
import { buildArgs, parseCliOutput, createClaudeCli } from '../server/llm/claude-cli.js';
import { createDemo } from '../server/llm/demo.js';
import { DEMO_SCENARIO } from '../server/llm/demo-scenario.js';
import { draftExport } from '../server/llm/draft-export.js';
import { createMap, applyOps } from '../web/js/shared/map-model.js';
import { emptyGrid, gridProgress, DIMENSION_KEYS } from '../web/js/shared/grid.js';

const FAKE_CLAUDE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.js');

function session(extra = {}) {
  return { map: createMap(), grid: emptyGrid(), suggestions: [], dismissed: [], segments: [], processedCount: 0, ...extra };
}

test('message de mise à jour : carte, id suivant, ancien et nouveau séparés', () => {
  let { map } = applyOps(createMap('Export PDF'), [{ op: 'add', id: 'n1', parent: 'root', label: 'Appli' }]);
  const msg = buildUpdateMessage(session({
    map,
    suggestions: [{ id: 's2', kind: 'question', text: 'Comment tu sauras que c’est fini ?', dimension: 'critere_fin' }],
    dismissed: ['Question ignorée'],
    segments: [
      { text: 'Première phrase.' },
      { text: 'Quand les tests passent.', answerTo: 'Comment tu sauras que c’est fini ?' },
    ],
    processedCount: 1,
  }));
  assert.match(msg, /- \[root\] Export PDF\n {2}- \[n1\] Appli/);
  assert.match(msg, /Prochain id libre : n2/);
  assert.match(msg, /## Transcription déjà prise en compte\n1\. Première phrase\./);
  assert.match(msg, /## Nouveau depuis la dernière mise à jour\n2\. \[réponse à « Comment tu sauras que c’est fini \? »\] Quand les tests passent\./);
  assert.match(msg, /- \[s2\] \(question, critere_fin\)/);
  assert.match(msg, /Prochain id de suggestion libre : s3/);
  assert.match(msg, /ne pas reproposer\)\n- Question ignorée/);
});

test('phrases : réponse, approfondissement, correction et retrait', () => {
  assert.equal(formatSegment({ text: 'Oui.', answerTo: 'Q ?' }, 0), '1. [réponse à « Q ? »] Oui.');
  assert.equal(formatSegment({ text: 'Aide-moi.', focus: 'pdfkit' }, 1), '2. [l\'utilisateur veut approfondir « pdfkit »] Aide-moi.');
  assert.equal(formatSegment({ text: 'freelance', corrects: 'frilance' }, 2), '3. [l\'utilisateur corrige la transcription de « frilance », qui devient :] freelance');
  assert.match(formatSegment({ text: '', retracts: 'Puppeteer' }, 3), /^4\. \[l'utilisateur retire sa phrase « Puppeteer » : enlève de la carte/);
  assert.equal(formatSegment({ text: 'Puppeteer', retracted: true }, 4), '5. [phrase retirée ensuite] Puppeteer');
});

test('prochain id de suggestion : jamais un id déjà utilisé', () => {
  assert.equal(nextSuggestionId([], []), 's1');
  assert.equal(nextSuggestionId([{ id: 's2' }], ['s7', 'grid-objectif', 'h-perimetre']), 's8');
});

test('schéma : toutes les dimensions, JSON sérialisable', () => {
  assert.deepEqual(UPDATE_SCHEMA.properties.grid.required, DIMENSION_KEYS);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(UPDATE_SCHEMA)));
  for (const key of DIMENSION_KEYS) assert.ok(UPDATE_SYSTEM.includes(key), key);
});

test('normalisation : suggestions limitées, champs invalides corrigés', () => {
  const out = normalizeUpdate({
    ops: [{ op: 'add' }, 'x', null],
    grid: { objectif: { status: 'covered', summary: 'ok' }, contexte: { status: 'n/a' } },
    suggestions: [
      { id: 'a', kind: 'question', text: 'Un ?' },
      { id: 'a', kind: 'question', text: 'Doublon' },
      { id: 'b', kind: 'bizarre', text: 'Deux ?', dimension: 'inconnue' },
      { id: 'c', text: '' },
      { id: 'd', text: 'Trois ?' },
      { id: 'e', text: 'Quatre ?' },
    ],
  }, emptyGrid());
  assert.equal(out.ops.length, 1);
  assert.equal(out.grid.objectif.status, 'covered');
  assert.equal(out.grid.contexte.status, 'missing');
  assert.deepEqual(out.suggestions.map((s) => s.id), ['a', 'b', 'd']);
  assert.equal(out.suggestions[1].kind, 'question');
  assert.equal(out.suggestions[1].dimension, '');
});

test('extraction JSON dans du texte ou un bloc de code', () => {
  assert.deepEqual(extractJson('Voici :\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('bla {"a":{"b":2}} bla'), { a: { b: 2 } });
  assert.equal(extractJson('rien'), null);
});

test('CLI : arguments sans outils ni session, schéma et modèle transmis', () => {
  const args = buildArgs({ system: 'SYS', schema: { type: 'object' }, model: 'sonnet', effort: 'low' });
  assert.equal(args[0], '-p');
  assert.deepEqual(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2), ['--output-format', 'json']);
  assert.equal(args[args.indexOf('--system-prompt') + 1], 'SYS');
  assert.equal(args[args.indexOf('--json-schema') + 1], '{"type":"object"}');
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
  assert.equal(args[args.indexOf('--effort') + 1], 'low');
  assert.deepEqual(args.slice(-2), ['--tools', '']);
  assert.ok(args.includes('--no-session-persistence'));
  assert.ok(!buildArgs({ system: 'S' }).includes('--model'));
});

test('CLI : enveloppe d’erreur et sortie illisible', () => {
  assert.throws(() => parseCliOutput('{"is_error":true,"result":"Not logged in"}'), /Not logged in/);
  assert.throws(() => parseCliOutput('n’importe quoi'), /illisible/);
  assert.equal(parseCliOutput('{"is_error":false,"subtype":"success","result":"ok"}').result, 'ok');
});

test('CLI : chaîne complète avec un faux binaire claude', async (t) => {
  const log = join(mkdtempSync(join(tmpdir(), 'pm-')), 'log.json');
  process.env.FAKE_CLAUDE_LOG = log;
  t.after(() => { delete process.env.FAKE_CLAUDE_LOG; delete process.env.FAKE_CLAUDE_MODE; });
  const llm = createClaudeCli({ claudeBin: FAKE_CLAUDE, timeoutMs: 10000, updateEffort: 'low' });

  const res = await llm.update(session({ segments: [{ text: 'Bonjour' }] }));
  assert.equal(res.ops[0].label, 'Depuis le faux Claude');
  assert.equal(res.grid.objectif.status, 'partial');
  assert.equal(res.grid.contexte.status, 'missing');
  const call = JSON.parse(readFileSync(log, 'utf8').trim().split('\n')[0]);
  assert.match(call.input, /## Nouveau depuis la dernière mise à jour\n1\. Bonjour/);
  assert.ok(call.args.includes('--json-schema'));

  const exp = await llm.export(session({ segments: [{ text: 'Bonjour' }] }));
  assert.equal(exp.prompt, '# Prompt final\n\n## Objectif\nTest.');

  process.env.FAKE_CLAUDE_MODE = 'error';
  await assert.rejects(llm.update(session()), /Not logged in/);
  process.env.FAKE_CLAUDE_MODE = 'garbage';
  await assert.rejects(llm.update(session()), /illisible/);
  await assert.rejects(createClaudeCli({ claudeBin: '/nexiste/pas', timeoutMs: 5000 }).update(session()), /Impossible de lancer/);
});

test('CLI : si --json-schema est refusé, bascule sur le JSON dans le texte', async (t) => {
  process.env.FAKE_CLAUDE_MODE = 'no-schema';
  t.after(() => { delete process.env.FAKE_CLAUDE_MODE; });
  const errors = [];
  const llm = createClaudeCli({ claudeBin: FAKE_CLAUDE, timeoutMs: 10000 }, { log: { error: (m) => errors.push(m) } });
  const first = await llm.update(session({ segments: [{ text: 'Bonjour' }] }));
  assert.equal(first.ops[0].label, 'Depuis le faux Claude');
  assert.equal(errors.length, 1);
  const second = await llm.update(session({ segments: [{ text: 'Encore' }] }));
  assert.equal(second.suggestions[0].id, 's1');
  assert.equal(errors.length, 1, 'le mode sans schéma est mémorisé');
});

test('démo : le scénario complet construit la carte attendue', async () => {
  const demo = createDemo();
  let s = session();
  for (const step of DEMO_SCENARIO) {
    s.segments.push({ text: step.text });
    const res = await demo.update(s);
    const { map, rejected } = applyOps(s.map, res.ops);
    assert.deepEqual(rejected, []);
    s = { ...s, map, grid: res.grid, suggestions: res.suggestions, processedCount: s.segments.length };
  }
  assert.equal(s.map.nodes.root.label, 'Export PDF des factures');
  assert.equal(s.map.nodes.n6.label, 'pdfkit');
  assert.equal(Object.keys(s.map.nodes).length, 14);
  assert.ok(gridProgress(s.grid) > 0.7);
  assert.equal(s.suggestions[0].kind, 'blind_spot');
});

test('démo : texte libre rangé par mots-clés, questions sur les manques', async () => {
  const demo = createDemo();
  const s = session({ segments: [{ text: 'Je veux un script Python qui renomme mes photos.' }] });
  const res = await demo.update(s);
  const { map, rejected } = applyOps(s.map, res.ops);
  assert.deepEqual(rejected, []);
  assert.ok(Object.values(map.nodes).some((n) => n.label === 'Objectif'));
  assert.notEqual(map.nodes.root.label, 'Ton idée');
  assert.ok(res.suggestions.length > 0);
  assert.ok(res.suggestions.every((sg) => res.grid[sg.dimension].status === 'missing'));
});

test('export brut : sections remplies et points non précisés', () => {
  const step = DEMO_SCENARIO.at(-1).response;
  let map = createMap();
  for (const st of DEMO_SCENARIO) ({ map } = applyOps(map, st.response.ops));
  const out = draftExport({ map, grid: step.grid, suggestions: step.suggestions });
  assert.match(out, /^# Export PDF des factures/);
  assert.match(out, /## Critère de fin\nLe bouton télécharge le PDF et les tests Jest passent\./);
  assert.match(out, /## Points non précisés[\s\S]*- Question restée ouverte : pdfkit ne lit pas le HTML/);
  assert.match(out, /- Périmètre \(précisé en partie\)/);
  assert.match(out, /- Points laissés libres/);
  assert.doesNotMatch(out, /\[n\d+\]/);
});

test('message d’export : carte, grille, transcription', () => {
  const msg = buildExportMessage(session({
    segments: [{ text: 'A' }, { text: 'B', answerTo: 'Q ?' }],
    suggestions: [{ id: 's1', kind: 'blind_spot', text: 'Risque ?' }],
  }));
  assert.match(msg, /restées sans réponse\n- \(blind_spot\) Risque \?/);
  assert.match(msg, /## Carte\n- \[root\]/);
  assert.match(msg, /2\. \[réponse à « Q \? »\] B/);
});
