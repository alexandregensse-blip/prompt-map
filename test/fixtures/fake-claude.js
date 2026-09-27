#!/usr/bin/env node
// Faux binaire `claude` pour les tests : n'appelle aucun modèle.
// Il enregistre ses arguments et son entrée, puis renvoie une enveloppe JSON comme `claude -p --output-format json`.
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('9.9.9 (fake)');
  process.exit(0);
}
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  if (process.env.FAKE_CLAUDE_LOG) writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, input }));
  const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
  if (mode === 'error') {
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in' }));
    return;
  }
  if (mode === 'no-schema' && args.includes('--json-schema')) {
    console.error('error: unknown option --json-schema');
    process.exit(1);
  }
  if (mode === 'garbage') {
    console.log('pas du json');
    process.exit(1);
  }
  const schema = args.includes('--json-schema');
  const structured = {
    ops: [{ op: 'add', id: 'n1', parent: 'root', label: 'Depuis le faux Claude' }],
    grid: { objectif: { status: 'partial', summary: 'Test.' } },
    suggestions: [{ id: 's1', kind: 'question', text: 'Une question ?', dimension: 'objectif', node: '' }],
  };
  const isExport = input.includes('Rédige le prompt de tâche final');
  const envelope = schema
    ? { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: structured }
    : isExport
      ? { type: 'result', subtype: 'success', is_error: false, result: '```markdown\n# Prompt final\n\n## Objectif\nTest.\n```' }
      : { type: 'result', subtype: 'success', is_error: false, result: `Voici la mise à jour :\n${JSON.stringify(structured)}` };
  console.log(JSON.stringify(envelope));
});
