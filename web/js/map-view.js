// Rendu SVG de la carte : mise à jour par clé (ID de nœud), animations d'entrée,
// de déplacement et de sortie, zoom et déplacement à la souris ou au pavé tactile.

import { layoutMap, styleFor, STYLE } from './shared/layout.js';
import { ROOT_ID, isDescendant } from './shared/map-model.js';

const SVG = 'http://www.w3.org/2000/svg';
const FONT = getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'sans-serif';

const ctx = document.createElement('canvas').getContext('2d');
const measureCache = new Map();
function measure(text, size, weight = 400) {
  const key = `${weight}|${size}|${text}`;
  let w = measureCache.get(key);
  if (w === undefined) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    w = ctx.measureText(text).width;
    if (measureCache.size > 5000) measureCache.clear();
    measureCache.set(key, w);
  }
  return w;
}

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

const setTransform = (node, x, y, scale = 1) => {
  node.style.transform = `translate(${x}px, ${y}px)${scale !== 1 ? ` scale(${scale})` : ''}`;
};
const setPath = (path, d) => {
  path.setAttribute('d', d);
  path.style.d = `path("${d}")`;
};

export function createMapView(svg, handlers = {}) {
  const viewport = svg.querySelector('#viewport');
  const edgesLayer = svg.querySelector('#edges');
  const nodesLayer = svg.querySelector('#nodes');
  const nodeEls = new Map();
  const edgeEls = new Map();
  let layout = null;
  let currentMap = null;
  let selected = null;
  let linked = null;
  let follow = true;
  const view = { x: 0, y: 0, k: 1 };

  function applyView(animate = false) {
    viewport.classList.toggle('animate', animate);
    viewport.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    handlers.onViewChange?.();
  }

  function size() {
    const r = svg.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  function fit(animate = true) {
    if (!layout) return;
    const { w, h } = size();
    if (!w || !h) return;
    const b = layout.bounds;
    const padX = 40;
    const padTop = 60;
    const padBottom = 150; // le compositeur flotte en bas
    const k = Math.max(0.3, Math.min(1.15, (w - padX * 2) / b.width, (h - padTop - padBottom) / b.height));
    view.k = k;
    view.x = w / 2 - (b.minX + b.width / 2) * k;
    view.y = padTop + (h - padTop - padBottom) / 2 - (b.minY + b.height / 2) * k;
    applyView(animate);
  }

  function render(map, changes = {}) {
    currentMap = map;
    const prev = layout;
    layout = layoutMap(map, measure);
    const added = new Set(changes.added || []);
    const updated = new Set([...(changes.updated || []), ...(changes.moved || [])]);

    // Arêtes
    for (const edge of layout.edges) {
      let path = edgeEls.get(edge.id);
      if (!path) {
        path = el('path', {}, edgesLayer);
        edgeEls.set(edge.id, path);
        // Entrée : l'arête « pousse » depuis le bord du parent.
        const start = prev?.boxes[edge.from] || layout.boxes[edge.from];
        const x = start.x + (layout.boxes[edge.to].side === 'left' ? -1 : 1) * (start.w / 2);
        setPath(path, `M ${x} ${start.y} C ${x} ${start.y}, ${x} ${start.y}, ${x} ${start.y}`);
        path.getBoundingClientRect();
      }
      path.setAttribute('class', `edge c${edge.color ?? 0} ${edge.depth === 1 ? 'd1' : ''}`);
      setPath(path, edge.path);
    }
    for (const [id, path] of edgeEls) {
      if (layout.edges.some((e) => e.id === id)) continue;
      edgeEls.delete(id);
      path.classList.add('leaving');
      setTimeout(() => path.remove(), 350);
    }

    // Nœuds
    for (const box of Object.values(layout.boxes)) {
      const node = map.nodes[box.id];
      let g = nodeEls.get(box.id);
      const isNew = !g;
      if (isNew) {
        g = el('g', { 'data-id': box.id }, nodesLayer);
        el('rect', { class: 'box' }, g);
        el('text', {}, g);
        el('title', {}, g);
        nodeEls.set(box.id, g);
        // Entrée : le nœud part de la position de son parent.
        const parent = node.parent && (prev?.boxes[node.parent] || layout.boxes[node.parent]);
        g.classList.add('entering');
        setTransform(g, parent ? parent.x : box.x, parent ? parent.y : box.y, 0.4);
      }
      const depthClass = box.depth === 0 ? 'd0' : box.depth === 1 ? 'd1' : 'dn';
      g.setAttribute('class', [
        'node', depthClass, box.color !== null ? `c${box.color}` : '',
        isNew ? 'entering' : '', selected === box.id ? 'selected' : '', linked === box.id ? 'linked' : '',
      ].filter(Boolean).join(' '));

      const st = styleFor(box.depth);
      const rect = g.querySelector('rect');
      rect.setAttribute('x', -box.w / 2);
      rect.setAttribute('y', -box.h / 2);
      rect.setAttribute('width', box.w);
      rect.setAttribute('height', box.h);
      rect.setAttribute('rx', box.depth === 0 ? 16 : Math.min(12, box.h / 2));

      const text = g.querySelector('text');
      const lh = st.font * STYLE.lineHeight;
      const key = `${box.lines.join('\n')}|${box.depth}`;
      if (text.dataset.key !== key) {
        text.dataset.key = key;
        text.textContent = '';
        text.setAttribute('font-size', st.font);
        text.setAttribute('font-weight', st.weight);
        text.setAttribute('text-anchor', 'middle');
        box.lines.forEach((line, i) => {
          const t = el('tspan', { x: 0, y: (i - (box.lines.length - 1) / 2) * lh }, text);
          t.textContent = line;
        });
      }
      g.querySelector('title').textContent = `${node.label}${node.detail ? `\n${node.detail}` : ''}${node.locked ? '\n(corrigé par toi)' : ''}`;

      let lock = g.querySelector('.lock');
      if (node.locked && box.depth > 0) {
        if (!lock) lock = el('circle', { class: 'lock', r: 3.5 }, g);
        lock.setAttribute('cx', box.w / 2 - 7);
        lock.setAttribute('cy', -box.h / 2 + 7);
      } else if (lock) lock.remove();

      if (isNew) {
        g.getBoundingClientRect();
        g.classList.remove('entering');
      }
      setTransform(g, box.x, box.y);

      if (prev && (isNew || added.has(box.id))) flash(g, 'fresh', 2400);
      else if (updated.has(box.id)) flash(g, 'changed', 1600);
    }
    for (const [id, g] of nodeEls) {
      if (layout.boxes[id]) continue;
      nodeEls.delete(id);
      g.classList.add('leaving');
      if (selected === id) select(null);
      setTimeout(() => g.remove(), 400);
    }

    if (follow) fit(Boolean(prev));
    handlers.onViewChange?.();
  }

  function flash(g, cls, ms) {
    g.classList.remove(cls);
    g.getBoundingClientRect();
    g.classList.add(cls);
    clearTimeout(g[`_${cls}`]);
    g[`_${cls}`] = setTimeout(() => g.classList.remove(cls), ms);
  }

  function select(id) {
    selected = id;
    for (const [nid, g] of nodeEls) g.classList.toggle('selected', nid === id);
    handlers.onSelect?.(id);
  }

  function setLinked(id) {
    linked = id;
    for (const [nid, g] of nodeEls) g.classList.toggle('linked', nid === id);
  }

  // Position écran (relative au SVG) d'un nœud.
  function screenBox(id) {
    const b = layout?.boxes[id];
    if (!b) return null;
    return {
      x: view.x + b.x * view.k,
      y: view.y + b.y * view.k,
      w: b.w * view.k,
      h: b.h * view.k,
    };
  }

  function zoomAt(factor, cx, cy, animate = false) {
    const k = Math.max(0.25, Math.min(2.5, view.k * factor));
    const f = k / view.k;
    view.x = cx - (cx - view.x) * f;
    view.y = cy - (cy - view.y) * f;
    view.k = k;
    follow = false;
    applyView(animate);
  }

  // Interactions : glisser le fond déplace la vue, glisser un nœud le range ailleurs.
  let drag = null;
  let nodeDrag = null;
  let suppressClick = false;

  const toMap = (e) => {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  };
  const setDropTarget = (id) => {
    if (nodeDrag.target === id) return;
    nodeEls.get(nodeDrag.target)?.classList.remove('drop-target');
    nodeDrag.target = id;
    nodeEls.get(id)?.classList.add('drop-target');
  };

  svg.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.node');
    if (g) {
      if (g.dataset.id !== ROOT_ID && handlers.onMove && e.button === 0) {
        // Pas de capture tout de suite : un simple clic doit arriver au nœud.
        nodeDrag = { id: g.dataset.id, g, x: e.clientX, y: e.clientY, moved: false, target: null, pointerId: e.pointerId };
      }
      return;
    }
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (nodeDrag) {
      if (!nodeDrag.moved && Math.hypot(e.clientX - nodeDrag.x, e.clientY - nodeDrag.y) < 6) return;
      if (!nodeDrag.moved) {
        svg.setPointerCapture(nodeDrag.pointerId);
        select(null);
      }
      nodeDrag.moved = true;
      nodeDrag.g.classList.add('dragging');
      const p = toMap(e);
      setTransform(nodeDrag.g, p.x, p.y);
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.node')?.dataset.id;
      const valid = over && over !== nodeDrag.id && over !== currentMap.nodes[nodeDrag.id]?.parent
        && !isDescendant(currentMap, over, nodeDrag.id);
      setDropTarget(valid ? over : null);
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    svg.classList.add('panning');
    follow = false;
    view.x = drag.vx + dx;
    view.y = drag.vy + dy;
    applyView(false);
  });
  const endDrag = () => {
    if (nodeDrag) {
      const { id, g, moved, target } = nodeDrag;
      nodeEls.get(target)?.classList.remove('drop-target');
      g.classList.remove('dragging');
      nodeDrag = null;
      if (moved) {
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        if (target) handlers.onMove(id, target);
        else if (layout?.boxes[id]) setTransform(g, layout.boxes[id].x, layout.boxes[id].y);
      }
      return;
    }
    if (drag && !drag.moved) select(null);
    drag = null;
    svg.classList.remove('panning');
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    // Molette de souris ou pincement : zoom. Pavé tactile à deux doigts : déplacement.
    const mouseWheel = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || mouseWheel) {
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), cx, cy);
    } else {
      view.x -= e.deltaX;
      view.y -= e.deltaY;
      follow = false;
      applyView(false);
    }
  }, { passive: false });

  nodesLayer.addEventListener('click', (e) => {
    if (suppressClick) return;
    const g = e.target.closest('.node');
    if (g) select(g.dataset.id === selected ? null : g.dataset.id);
  });
  nodesLayer.addEventListener('dblclick', (e) => {
    const g = e.target.closest('.node');
    if (g) handlers.onRequestRename?.(g.dataset.id);
  });

  new ResizeObserver(() => { if (follow) fit(false); else handlers.onViewChange?.(); }).observe(svg);

  return {
    render,
    select,
    setLinked,
    screenBox,
    get selected() { return selected; },
    fit() { follow = true; fit(true); },
    zoom(factor) {
      const { w, h } = size();
      zoomAt(factor, w / 2, h / 2, true);
    },
    reset() {
      for (const g of nodeEls.values()) g.remove();
      for (const p of edgeEls.values()) p.remove();
      nodeEls.clear();
      edgeEls.clear();
      layout = null;
      selected = null;
      follow = true;
    },
    isRoot: (id) => id === ROOT_ID,
  };
}
