// Modèle de la carte : un arbre de nœuds à ID stables, modifié par opérations.
// Le LLM ne renvoie jamais une carte complète, seulement des opérations,
// pour que la carte ne « saute » pas à chaque mise à jour.

export const ROOT_ID = 'root';
const MAX_LABEL = 80;
const MAX_DETAIL = 240;
const PALETTE_SIZE = 8;

export function createMap(title = 'Ton idée') {
  return {
    seq: 1,
    nodes: {
      [ROOT_ID]: { id: ROOT_ID, parent: null, label: title, detail: '', order: 0, locked: false },
    },
    removedByUser: [],
  };
}

export function children(map, id) {
  return Object.values(map.nodes)
    .filter((n) => n.parent === id)
    .sort((a, b) => a.order - b.order);
}

export function isDescendant(map, id, ancestorId) {
  let cur = map.nodes[id];
  while (cur && cur.parent) {
    if (cur.parent === ancestorId) return true;
    cur = map.nodes[cur.parent];
  }
  return false;
}

export function nodeCount(map) {
  return Object.keys(map.nodes).length;
}

export function nextId(map) {
  let id;
  do id = `n${map.seq++}`;
  while (map.nodes[id]);
  return id;
}

// Prochain ID libre, sans modifier la carte (sert d'indice au LLM).
export function peekNextId(map) {
  let seq = map.seq;
  while (map.nodes[`n${seq}`]) seq++;
  return `n${seq}`;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

// Côté et couleur sont attribués une fois pour toutes à la création d'une
// branche principale : ajouter une branche ne déplace jamais les autres.
function assignBranch(map, node) {
  const top = children(map, ROOT_ID).filter((n) => n.id !== node.id);
  const right = top.filter((n) => n.side === 'right').length;
  const left = top.filter((n) => n.side === 'left').length;
  node.side = right <= left ? 'right' : 'left';
  const used = new Set(top.map((n) => n.color));
  let color = top.length % PALETTE_SIZE;
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const c = (top.length + i) % PALETTE_SIZE;
    if (!used.has(c)) { color = c; break; }
  }
  node.color = color;
}

function reparentBranch(map, node) {
  if (node.parent === ROOT_ID) {
    if (!node.side) assignBranch(map, node);
  } else {
    delete node.side;
    delete node.color;
  }
}

function removeSubtree(map, id, removed) {
  for (const child of children(map, id)) removeSubtree(map, child.id, removed);
  removed.push(id);
  delete map.nodes[id];
}

// Applique des opérations venant du LLM (origin 'ai') ou de l'utilisateur ('user').
// Renvoie une nouvelle carte ; les opérations invalides sont rejetées, pas corrigées en silence.
export function applyOps(map, ops, { origin = 'ai' } = {}) {
  const next = structuredClone(map);
  const changes = { added: [], updated: [], moved: [], removed: [] };
  const rejected = [];
  const idAlias = {};
  const resolve = (id) => (id && idAlias[id]) || id;

  for (const raw of Array.isArray(ops) ? ops : []) {
    const op = raw && typeof raw === 'object' ? raw : {};
    const reject = (reason) => rejected.push({ op, reason });
    const id = resolve(typeof op.id === 'string' ? op.id.trim() : '');
    const node = next.nodes[id];
    const aiOnLocked = origin === 'ai' && node && node.locked;

    switch (op.op) {
      case 'add': {
        const parentId = resolve(op.parent || ROOT_ID);
        if (!next.nodes[parentId]) { reject('parent inconnu'); break; }
        const label = cleanText(op.label, MAX_LABEL);
        if (!label) { reject('libellé vide'); break; }
        if (origin === 'ai' && next.removedByUser.some((l) => l.toLowerCase() === label.toLowerCase())) {
          reject('supprimé par l’utilisateur'); break;
        }
        let newId = id;
        if (!newId || next.nodes[newId] || newId === ROOT_ID) newId = nextId(next);
        if (id && id !== newId) idAlias[id] = newId;
        const created = {
          id: newId,
          parent: parentId,
          label,
          detail: cleanText(op.detail, MAX_DETAIL),
          order: next.seq++,
          locked: origin === 'user',
        };
        next.nodes[newId] = created;
        reparentBranch(next, created);
        changes.added.push(newId);
        break;
      }
      case 'update': {
        if (!node) { reject('nœud inconnu'); break; }
        if (aiOnLocked) { reject('nœud corrigé par l’utilisateur'); break; }
        let changed = false;
        const label = cleanText(op.label, MAX_LABEL);
        if (label && label !== node.label) { node.label = label; changed = true; }
        if (typeof op.detail === 'string') {
          const detail = cleanText(op.detail, MAX_DETAIL);
          if (detail !== node.detail) { node.detail = detail; changed = true; }
        }
        if (origin === 'user' && changed) node.locked = true;
        if (changed) changes.updated.push(node.id);
        break;
      }
      case 'move': {
        const parentId = resolve(op.parent);
        if (!node || node.id === ROOT_ID) { reject('nœud inconnu'); break; }
        if (aiOnLocked) { reject('nœud corrigé par l’utilisateur'); break; }
        if (!next.nodes[parentId] || parentId === node.id || isDescendant(next, parentId, node.id)) {
          reject('parent invalide'); break;
        }
        if (node.parent === parentId) break;
        node.parent = parentId;
        node.order = next.seq++;
        reparentBranch(next, node);
        changes.moved.push(node.id);
        break;
      }
      case 'remove': {
        if (!node || node.id === ROOT_ID) { reject('nœud inconnu'); break; }
        if (aiOnLocked) { reject('nœud corrigé par l’utilisateur'); break; }
        if (origin === 'user') next.removedByUser.push(node.label);
        removeSubtree(next, node.id, changes.removed);
        break;
      }
      default:
        reject('opération inconnue');
    }
  }

  next.removedByUser = next.removedByUser.slice(-50);
  return { map: next, changes, rejected };
}

// Représentation texte compacte, lue par le LLM.
export function toOutline(map) {
  const lines = [];
  const walk = (id, depth) => {
    const n = map.nodes[id];
    const flags = n.locked ? ' (corrigé par l’utilisateur)' : '';
    const detail = n.detail ? ` — ${n.detail}` : '';
    lines.push(`${'  '.repeat(depth)}- [${n.id}] ${n.label}${detail}${flags}`);
    for (const c of children(map, id)) walk(c.id, depth + 1);
  };
  walk(ROOT_ID, 0);
  return lines.join('\n');
}
