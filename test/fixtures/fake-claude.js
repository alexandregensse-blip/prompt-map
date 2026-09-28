#!/usr/bin/env node
// Faux binaire `claude` pour les tests : n'appelle aucun modèle.
// Il note chaque message reçu (JSON par ligne dans FAKE_CLAUDE_LOG) et répond comme la CLI :
// une enveloppe JSON (`--output-format json`) ou des événements ligne par ligne (mode flux).
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('9.9.9 (fake)');
  process.exit(0);
}
const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
const stream = args.includes('--input-format');
const schema = args.includes('--json-schema');

const log = (input) => {
  if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ pid: process.pid, stream, args, input })}\n`);
};

function respond(input) {
  if (input.includes('Rédige le prompt de tâche final')) {
    return { type: 'result', subtype: 'success', is_error: false, result: '```markdown\n# Prompt final\n\n## Objectif\nTest.\n```' };
  }
  const nextId = /Prochain id libre : (n\d+)/.exec(input)?.[1] || 'n1';
  const structured = {
    ops: [{ op: 'add', id: nextId, parent: 'root', label: 'Depuis le faux Claude' }],
    grid: { objectif: { status: 'partial', summary: 'Test.' } },
    suggestions: [{ id: 's1', kind: 'question', text: 'Une question ?', dimension: 'objectif', node: '' }],
  };
  return schema
    ? { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: structured }
    : { type: 'result', subtype: 'success', is_error: false, result: `Voici la mise à jour :\n${JSON.stringify(structured)}` };
}

if (stream) {
  // Mode flux : un message utilisateur par ligne, un événement « result » par message.
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }));
  const crashAfter = Number(process.env.FAKE_CLAUDE_CRASH_AFTER || Infinity);
  let count = 0;
  createInterface({ input: process.stdin }).on('line', (line) => {
    const msg = JSON.parse(line);
    const text = msg.message.content.map((c) => c.text).join('');
    log(text);
    count += 1;
    if (count > crashAfter) process.exit(3);
    console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '…' }] } }));
    console.log(JSON.stringify(respond(text)));
  });
} else {
  let input = '';
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    log(input);
    if (mode === 'error') {
      console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in' }));
      return;
    }
    if (mode === 'no-schema' && schema) {
      console.error('error: unknown option --json-schema');
      process.exit(1);
    }
    if (mode === 'garbage') {
      console.log('pas du json');
      process.exit(1);
    }
    console.log(JSON.stringify(respond(input)));
  });
}
