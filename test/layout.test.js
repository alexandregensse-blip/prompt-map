import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutMap, wrapText, approxMeasure } from '../web/js/shared/layout.js';
import { createMap, applyOps } from '../web/js/shared/map-model.js';
import { DEMO_SCENARIO } from '../server/llm/demo-scenario.js';

function demoMap() {
  let map = createMap();
  for (const step of DEMO_SCENARIO) ({ map } = applyOps(map, step.response.ops));
  return map;
}

const overlap = (a, b) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

test('carte de démo : aucun chevauchement de nœuds', () => {
  const { boxes } = layoutMap(demoMap());
  const list = Object.values(boxes);
  assert.equal(list.length, 14);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      assert.ok(!overlap(list[i], list[j]), `${list[i].id} chevauche ${list[j].id}`);
    }
  }
});

test('racine au centre, branches de part et d’autre, enfants du bon côté', () => {
  const map = demoMap();
  const { boxes } = layoutMap(map);
  assert.equal(boxes.root.x, 0);
  for (const b of Object.values(boxes)) {
    if (b.id === 'root') continue;
    const parent = boxes[map.nodes[b.id].parent];
    if (b.side === 'right') assert.ok(b.x > parent.x, b.id);
    else assert.ok(b.x < parent.x, b.id);
  }
  const sides = new Set(Object.values(boxes).filter((b) => b.depth === 1).map((b) => b.side));
  assert.deepEqual([...sides].sort(), ['left', 'right']);
});

test('disposition déterministe', () => {
  const map = demoMap();
  assert.deepEqual(layoutMap(map), layoutMap(map));
});

test('ajouter une feuille ne change pas le côté des branches existantes', () => {
  let map = demoMap();
  const before = layoutMap(map).boxes;
  ({ map } = applyOps(map, [{ op: 'add', id: 'n99', parent: 'n1', label: 'Nouveau détail' }]));
  const after = layoutMap(map).boxes;
  for (const id of Object.keys(before)) assert.equal(after[id].side, before[id].side);
});

test('retour à la ligne : 3 lignes au plus, points de suspension', () => {
  const lines = wrapText('un libellé beaucoup trop long qui ne tiendra jamais sur une seule ligne même large', 120, approxMeasure, 14, 400);
  assert.ok(lines.length <= 3);
  assert.ok(lines.at(-1).endsWith('…'));
  for (const l of lines) assert.ok(approxMeasure(l, 14, 400) <= 120 + 1, l);
  assert.deepEqual(wrapText('court', 200, approxMeasure, 14, 400), ['court']);
});

test('mot unique trop long : coupé', () => {
  const [line] = wrapText('src/very/long/path/to/some/deeply/nested/module/file.ts', 100, approxMeasure, 14, 400);
  assert.ok(line.endsWith('…'));
  assert.ok(approxMeasure(line, 14, 400) <= 101);
});
