// Disposition de la carte : racine au centre, branches principales réparties
// à droite et à gauche (côté figé à la création), sous-arbres empilés.
// Fonction pure : la même carte donne toujours les mêmes positions.

import { ROOT_ID, children } from './map-model.js';

export const STYLE = {
  root: { font: 18, weight: 700, maxWidth: 280, padX: 20, padY: 13 },
  branch: { font: 15, weight: 600, maxWidth: 230, padX: 15, padY: 9 },
  leaf: { font: 14, weight: 450, maxWidth: 220, padX: 12, padY: 7 },
  lineHeight: 1.32,
  maxLines: 3,
  gap: { root: 72, branch: 44, leaf: 36 },
  vGap: { branch: 26, leaf: 10 },
};

export function styleFor(depth) {
  if (depth === 0) return STYLE.root;
  if (depth === 1) return STYLE.branch;
  return STYLE.leaf;
}

// Mesure approximative, utilisée hors navigateur (tests, rendus statiques).
export function approxMeasure(text, font, weight = 400) {
  let w = 0;
  for (const ch of text) {
    if (/[ilj.,;:!'’|]/.test(ch)) w += 0.28;
    else if (/[mwMW@]/.test(ch)) w += 0.84;
    else if (/[A-Z]/.test(ch)) w += 0.66;
    else if (ch === ' ') w += 0.27;
    else w += 0.54;
  }
  return w * font * (weight >= 600 ? 1.05 : 1);
}

export function wrapText(text, maxWidth, measure, font, weight, maxLines = STYLE.maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  const fits = (s) => measure(s, font, weight) <= maxWidth;
  const cut = (s) => {
    let out = s;
    while (out.length > 1 && !fits(`${out}…`)) out = out.slice(0, -1);
    return `${out}…`;
  };
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) { line = candidate; continue; }
    if (line) lines.push(line);
    line = fits(word) ? word : cut(word);
    if (lines.length === maxLines) {
      lines[maxLines - 1] = cut(`${lines[maxLines - 1]} ${words.slice(i).join(' ')}`);
      return lines;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const rest = lines.slice(maxLines - 1).join(' ');
    lines.length = maxLines - 1;
    lines.push(cut(rest));
  }
  return lines.length ? lines : [''];
}

export function layoutMap(map, measure = approxMeasure) {
  const boxes = {};

  const size = (id, depth, side, color) => {
    const node = map.nodes[id];
    const st = styleFor(depth);
    const lines = wrapText(node.label, st.maxWidth, measure, st.font, st.weight);
    const textW = Math.max(...lines.map((l) => measure(l, st.font, st.weight)));
    const w = Math.ceil(Math.max(textW, depth === 0 ? 120 : 40) + st.padX * 2);
    const h = Math.ceil(lines.length * st.font * STYLE.lineHeight + st.padY * 2);
    const branchSide = depth === 1 ? node.side || 'right' : side;
    const branchColor = depth === 1 ? node.color ?? 0 : color;
    const kids = children(map, id).map((c) => size(c.id, depth + 1, branchSide, branchColor));
    const gapV = depth === 0 ? STYLE.vGap.branch : STYLE.vGap.leaf;
    const kidsH = kids.reduce((s, k) => s + k.total, 0) + Math.max(0, kids.length - 1) * gapV;
    const box = { id, depth, lines, w, h, side: branchSide, color: branchColor, kids, total: Math.max(h, kidsH) };
    return box;
  };

  const place = (box, edgeX, cy) => {
    const dir = box.side === 'left' ? -1 : 1;
    const cx = edgeX + dir * (box.w / 2);
    boxes[box.id] = {
      id: box.id, depth: box.depth, lines: box.lines, w: box.w, h: box.h,
      side: box.side, color: box.color, x: cx, y: cy,
    };
    if (!box.kids.length) return;
    const gap = box.depth === 1 ? STYLE.gap.branch : STYLE.gap.leaf;
    const childEdge = edgeX + dir * (box.w + gap);
    const gapV = STYLE.vGap.leaf;
    const kidsH = box.kids.reduce((s, k) => s + k.total, 0) + (box.kids.length - 1) * gapV;
    let y = cy - kidsH / 2;
    for (const k of box.kids) {
      place(k, childEdge, y + k.total / 2);
      y += k.total + gapV;
    }
  };

  const root = size(ROOT_ID, 0, 'right', null);
  boxes[ROOT_ID] = {
    id: ROOT_ID, depth: 0, lines: root.lines, w: root.w, h: root.h, side: null, color: null, x: 0, y: 0,
  };
  for (const side of ['right', 'left']) {
    const kids = root.kids.filter((k) => k.side === side);
    const gapV = STYLE.vGap.branch;
    const total = kids.reduce((s, k) => s + k.total, 0) + Math.max(0, kids.length - 1) * gapV;
    const dir = side === 'left' ? -1 : 1;
    const edgeX = dir * (root.w / 2 + STYLE.gap.root);
    let y = -total / 2;
    for (const k of kids) {
      place(k, edgeX, y + k.total / 2);
      y += k.total + gapV;
    }
  }

  const edges = [];
  for (const b of Object.values(boxes)) {
    const node = map.nodes[b.id];
    if (!node.parent) continue;
    const p = boxes[node.parent];
    const dir = b.side === 'left' ? -1 : 1;
    const x1 = p.x + dir * (p.w / 2);
    const x2 = b.x - dir * (b.w / 2);
    edges.push({ id: b.id, from: node.parent, to: b.id, color: b.color, depth: b.depth, path: curve(x1, p.y, x2, b.y) });
  }

  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const b of Object.values(boxes)) {
    minX = Math.min(minX, b.x - b.w / 2);
    maxX = Math.max(maxX, b.x + b.w / 2);
    minY = Math.min(minY, b.y - b.h / 2);
    maxY = Math.max(maxY, b.y + b.h / 2);
  }
  return { boxes, edges, bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY } };
}

export function curve(x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2;
  const r = (v) => Math.round(v * 10) / 10;
  return `M ${r(x1)} ${r(y1)} C ${r(mx)} ${r(y1)}, ${r(mx)} ${r(y2)}, ${r(x2)} ${r(y2)}`;
}
