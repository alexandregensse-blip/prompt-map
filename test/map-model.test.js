import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMap, applyOps, children, toOutline, peekNextId, ROOT_ID } from '../web/js/shared/map-model.js';

test('ajout, mise à jour, déplacement, suppression', () => {
  let { map, changes } = applyOps(createMap(), [
    { op: 'add', id: 'n1', parent: 'root', label: 'Thème A' },
    { op: 'add', id: 'n2', parent: 'n1', label: 'Détail' },
    { op: 'add', id: 'n3', parent: 'root', label: 'Thème B' },
  ]);
  assert.deepEqual(changes.added, ['n1', 'n2', 'n3']);
  ({ map, changes } = applyOps(map, [
    { op: 'update', id: 'n2', label: 'Détail précis' },
    { op: 'move', id: 'n2', parent: 'n3' },
  ]));
  assert.equal(map.nodes.n2.label, 'Détail précis');
  assert.equal(map.nodes.n2.parent, 'n3');
  ({ map, changes } = applyOps(map, [{ op: 'remove', id: 'n3' }]));
  assert.deepEqual(changes.removed.sort(), ['n2', 'n3']);
  assert.deepEqual(Object.keys(map.nodes).sort(), ['n1', 'root']);
});

test('la carte d’origine n’est jamais modifiée', () => {
  const map = createMap();
  applyOps(map, [{ op: 'add', id: 'n1', parent: 'root', label: 'X' }]);
  assert.deepEqual(Object.keys(map.nodes), ['root']);
});

test('opérations invalides rejetées avec une raison', () => {
  const { map, rejected } = applyOps(createMap(), [
    { op: 'add', id: 'n1', parent: 'inconnu', label: 'X' },
    { op: 'add', id: 'n2', parent: 'root', label: '   ' },
    { op: 'remove', id: 'root' },
    { op: 'move', id: 'root', parent: 'n1' },
    { op: 'explode' },
    null,
  ]);
  assert.equal(rejected.length, 6);
  assert.deepEqual(Object.keys(map.nodes), ['root']);
});

test('pas de cycle : on ne déplace pas un nœud sous son descendant', () => {
  let { map } = applyOps(createMap(), [
    { op: 'add', id: 'n1', parent: 'root', label: 'A' },
    { op: 'add', id: 'n2', parent: 'n1', label: 'B' },
  ]);
  const res = applyOps(map, [{ op: 'move', id: 'n1', parent: 'n2' }]);
  assert.equal(res.rejected[0].reason, 'parent invalide');
  assert.equal(res.map.nodes.n1.parent, 'root');
});

test('les corrections de l’utilisateur sont protégées contre le LLM', () => {
  let { map } = applyOps(createMap(), [{ op: 'add', id: 'n1', parent: 'root', label: 'Pupeter' }]);
  ({ map } = applyOps(map, [{ op: 'update', id: 'n1', label: 'Puppeteer' }], { origin: 'user' }));
  assert.equal(map.nodes.n1.locked, true);
  const res = applyOps(map, [
    { op: 'update', id: 'n1', label: 'Autre' },
    { op: 'remove', id: 'n1' },
  ]);
  assert.equal(res.rejected.length, 2);
  assert.equal(res.map.nodes.n1.label, 'Puppeteer');
});

test('un nœud déplacé par l’utilisateur n’est plus déplacé par le LLM', () => {
  let { map } = applyOps(createMap(), [
    { op: 'add', id: 'n1', parent: 'root', label: 'A' },
    { op: 'add', id: 'n2', parent: 'root', label: 'B' },
    { op: 'add', id: 'n3', parent: 'n1', label: 'Détail' },
  ]);
  ({ map } = applyOps(map, [{ op: 'move', id: 'n3', parent: 'n2' }], { origin: 'user' }));
  assert.equal(map.nodes.n3.locked, true);
  const res = applyOps(map, [{ op: 'move', id: 'n3', parent: 'n1' }]);
  assert.equal(res.rejected[0].reason, 'nœud corrigé par l’utilisateur');
});

test('ajout manuel : id généré, nœud protégé', () => {
  const { map, changes } = applyOps(createMap(), [{ op: 'add', parent: 'root', label: 'Mon point' }], { origin: 'user' });
  const id = changes.added[0];
  assert.match(id, /^n\d+$/);
  assert.equal(map.nodes[id].locked, true);
});

test('un nœud supprimé par l’utilisateur n’est pas recréé par le LLM', () => {
  let { map } = applyOps(createMap(), [{ op: 'add', id: 'n1', parent: 'root', label: 'Mauvaise idée' }]);
  ({ map } = applyOps(map, [{ op: 'remove', id: 'n1' }], { origin: 'user' }));
  assert.deepEqual(map.removedByUser, ['Mauvaise idée']);
  const res = applyOps(map, [{ op: 'add', id: 'n5', parent: 'root', label: 'mauvaise idée' }]);
  assert.equal(res.rejected[0].reason, 'supprimé par l’utilisateur');
});

test('id déjà pris : nouvel id, et les références de la même réponse suivent', () => {
  let { map } = applyOps(createMap(), [{ op: 'add', id: 'n1', parent: 'root', label: 'A' }]);
  const res = applyOps(map, [
    { op: 'add', id: 'n1', parent: 'root', label: 'B' },
    { op: 'add', id: 'n9', parent: 'n1', label: 'Enfant de B' },
  ]);
  const b = Object.values(res.map.nodes).find((n) => n.label === 'B');
  assert.notEqual(b.id, 'n1');
  assert.equal(res.map.nodes.n9.parent, b.id);
});

test('côté et couleur des branches : équilibrés et figés', () => {
  let { map } = applyOps(createMap(), ['A', 'B', 'C', 'D'].map((label, i) => ({ op: 'add', id: `n${i + 1}`, parent: 'root', label })));
  const sides = children(map, ROOT_ID).map((n) => n.side);
  assert.deepEqual(sides, ['right', 'left', 'right', 'left']);
  const colors = new Set(children(map, ROOT_ID).map((n) => n.color));
  assert.equal(colors.size, 4);
  const before = structuredClone(map.nodes.n1);
  ({ map } = applyOps(map, [{ op: 'add', id: 'n9', parent: 'root', label: 'E' }]));
  assert.equal(map.nodes.n1.side, before.side);
  assert.equal(map.nodes.n1.color, before.color);
});

test('libellés nettoyés et tronqués', () => {
  const { map } = applyOps(createMap(), [{ op: 'add', id: 'n1', parent: 'root', label: `  trop\n  d'espaces ${'x'.repeat(200)}` }]);
  assert.ok(map.nodes.n1.label.startsWith("trop d'espaces"));
  assert.ok(map.nodes.n1.label.length <= 80);
});

test('contour texte et prochain id', () => {
  const { map } = applyOps(createMap('Tâche'), [
    { op: 'add', id: 'n1', parent: 'root', label: 'A', detail: 'précision' },
    { op: 'add', id: 'n2', parent: 'n1', label: 'B' },
  ]);
  assert.equal(toOutline(map), '- [root] Tâche\n  - [n1] A — précision\n    - [n2] B');
  assert.equal(peekNextId(map), 'n3');
});
