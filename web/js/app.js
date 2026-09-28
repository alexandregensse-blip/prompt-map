import { api } from './api.js';
import { MicCapture } from './audio.js';
import { createMapView } from './map-view.js';
import { createMap, applyOps, nodeCount, ROOT_ID } from './shared/map-model.js';
import { DIMENSIONS, emptyGrid, gridProgress, STATUS_LABELS } from './shared/grid.js';

const $ = (id) => document.getElementById(id);
// Sessions gardées dans le navigateur : un index + une entrée par session.
const LEGACY_KEY = 'prompt-map:session';
const INDEX_KEY = 'prompt-map:sessions';
const CURRENT_KEY = 'prompt-map:current';
const sessionKey = (id) => `prompt-map:s:${id}`;
const DEFAULT_TITLE = 'Ton idée';
const KIND_LABELS = { question: 'Question', blind_spot: 'Angle mort', lead: 'Piste', search: 'Recherche' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- Session ----------

function newSession(demo = false) {
  return {
    id: uid(),
    map: createMap(DEFAULT_TITLE),
    grid: emptyGrid(),
    suggestions: [],
    dismissed: [], // textes écartés, transmis au LLM
    hidden: [], // suggestions écartées ou déjà répondues : { id, text }
    segments: [],
    processedCount: 0,
    later: [], // questions mises de côté : { id, text, kind, dimension, node }
    research: [], // recherches web : { id, topic, status, references, ideas, added, error }
    usage: { tokens: 0, calls: 0, last: null }, // consommation Claude de la session
    demo,
  };
}

function parseSession(raw) {
  try {
    const saved = JSON.parse(raw);
    if (saved?.map?.nodes?.[ROOT_ID] && Array.isArray(saved.segments)) {
      const hidden = (saved.hidden || []).map((h) => (typeof h === 'string' ? { id: h, text: '' } : h));
      // Une recherche « en cours » au moment de la fermeture ne reviendra pas.
      const research = (saved.research || []).map((j) => (j.status === 'running' ? { ...j, status: 'error', error: 'Interrompue' } : j));
      return { ...newSession(), ...saved, hidden, research, later: saved.later || [], usage: saved.usage || { tokens: 0, calls: 0, last: null } };
    }
  } catch { /* entrée corrompue */ }
  return null;
}

function readIndex() {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY)) || []; } catch { return []; }
}

function loadSession(id) {
  try {
    const found = parseSession(localStorage.getItem(sessionKey(id || localStorage.getItem(CURRENT_KEY))));
    if (found) return found;
    // Ancienne sauvegarde (une seule session) : reprise telle quelle.
    const legacy = parseSession(localStorage.getItem(LEGACY_KEY));
    if (legacy && !id) return legacy;
  } catch { /* stockage indisponible */ }
  return newSession();
}

function save() {
  try {
    localStorage.setItem(sessionKey(session.id), JSON.stringify(session));
    localStorage.setItem(CURRENT_KEY, session.id);
    localStorage.removeItem(LEGACY_KEY);
    // Une session n'entre dans l'historique qu'une fois qu'on y a dit quelque chose.
    if (session.segments.length) {
      const entry = {
        id: session.id,
        title: session.map.nodes[ROOT_ID].label,
        updatedAt: Date.now(),
        demo: session.demo,
        coverage: Math.round(gridProgress(session.grid) * 100),
      };
      const index = readIndex().filter((e) => e.id !== session.id);
      localStorage.setItem(INDEX_KEY, JSON.stringify([entry, ...index].slice(0, 50)));
    }
  } catch { /* sans persistance */ }
}

function deleteStored(id) {
  try {
    localStorage.removeItem(sessionKey(id));
    localStorage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter((e) => e.id !== id)));
  } catch { /* sans persistance */ }
}

let session = loadSession();
let status = { llm: null, whisper: { reachable: false } };
let answering = null; // { id, text } : question à laquelle on répond
let pending = []; // segments audio en cours de transcription
let demoRunning = false;

// ---------- Carte ----------

const mapView = createMapView($('map'), {
  onSelect: () => positionToolbar(),
  onViewChange: () => { positionToolbar(); positionRename(); },
  onRequestRename: (id) => startRename(id),
  onMove: (id, parent) => userOps([{ op: 'move', id, parent }]),
});

function userOps(ops) {
  const { map, changes } = applyOps(session.map, ops, { origin: 'user' });
  session.map = map;
  save();
  renderMap(changes);
  return changes;
}

// Ajout manuel : un point sous le nœud choisi, aussitôt en cours de renommage.
function addChild(parentId) {
  const before = session.map;
  const changes = userOps([{ op: 'add', parent: parentId, label: 'Nouveau point' }]);
  const id = changes.added[0];
  if (!id) return;
  mapView.select(id);
  startRename(id, before);
}

function renderMap(changes) {
  mapView.render(session.map, changes);
  const root = session.map.nodes[ROOT_ID].label;
  $('session-title').textContent = root === DEFAULT_TITLE ? '' : root;
  document.title = root === DEFAULT_TITLE ? 'prompt-map' : `${root} · prompt-map`;
  const empty = nodeCount(session.map) === 1 && !session.segments.length && !pending.length && !demoRunning && !mic.active;
  $('empty').hidden = !empty;
  document.querySelector('.map-controls').hidden = empty;
  $('map').style.visibility = empty ? 'hidden' : 'visible';
}

const toolbar = $('node-toolbar');
function positionToolbar() {
  const id = mapView.selected;
  const box = id && mapView.screenBox(id);
  if (!box || !$('rename-input').hidden) { toolbar.hidden = true; return; }
  toolbar.hidden = false;
  // Centrée au-dessus du nœud, sans déborder du canevas.
  const half = toolbar.offsetWidth / 2;
  const width = $('map-area').clientWidth;
  toolbar.style.left = `${Math.min(Math.max(box.x, half + 8), width - half - 8)}px`;
  toolbar.style.top = `${Math.max(box.y - box.h / 2, toolbar.offsetHeight + 18)}px`;
  toolbar.querySelector('[data-action="delete"]').hidden = id === ROOT_ID;
  toolbar.querySelector('[data-action="focus"]').hidden = id === ROOT_ID;
  const detail = session.map.nodes[id]?.detail || '';
  $('node-detail').hidden = !detail;
  // Les URL du détail (références trouvées par la recherche) deviennent des liens.
  $('node-detail').replaceChildren(...detail.split(/(https?:\/\/[^\s—]+)/g).map((part) => {
    if (!/^https?:\/\//.test(part)) return document.createTextNode(part);
    const a = Object.assign(document.createElement('a'), { href: part, textContent: part, target: '_blank', rel: 'noopener noreferrer' });
    return a;
  }));
}

toolbar.addEventListener('click', (e) => {
  const action = e.target.closest('button')?.dataset.action;
  const id = mapView.selected;
  if (!action || !id) return;
  if (action === 'rename') startRename(id);
  if (action === 'add') addChild(id);
  if (action === 'search') {
    const n = session.map.nodes[id];
    launchResearch(n.detail ? `${n.label} : ${n.detail}` : n.label);
    mapView.select(null);
  }
  if (action === 'delete') deleteNode(id);
  if (action === 'focus') {
    addSegment({ text: 'Aide-moi à approfondir ce point.', focus: session.map.nodes[id].label });
    mapView.select(null);
  }
});

function deleteNode(id) {
  if (id === ROOT_ID || !session.map.nodes[id]) return;
  const label = session.map.nodes[id].label;
  const before = session.map;
  userOps([{ op: 'remove', id }]);
  toast(`« ${label} » supprimé.`, {
    action: {
      label: 'Annuler',
      fn: () => { session.map = before; save(); renderMap({}); },
    },
  });
}

const renameInput = $('rename-input');
let renaming = null;
let renameUndo = null; // carte d'avant un ajout : Échap annule l'ajout
function startRename(id, undoMap = null) {
  if (!session.map.nodes[id]) return;
  renaming = id;
  renameUndo = undoMap;
  renameInput.value = session.map.nodes[id].label;
  renameInput.hidden = false;
  positionRename();
  toolbar.hidden = true;
  renameInput.focus();
  renameInput.select();
}
function positionRename() {
  if (!renaming) return;
  const box = mapView.screenBox(renaming);
  if (!box) { endRename(false); return; }
  renameInput.style.left = `${box.x}px`;
  renameInput.style.top = `${box.y}px`;
  renameInput.style.width = `${Math.max(box.w + 40, 200)}px`;
}
function endRename(commit) {
  if (!renaming) return;
  const id = renaming;
  renaming = null;
  renameInput.hidden = true;
  const label = renameInput.value.trim();
  const undo = renameUndo;
  renameUndo = null;
  if (undo && (!commit || !label)) {
    session.map = undo;
    save();
    renderMap({});
  } else if (commit && label && label !== session.map.nodes[id]?.label) {
    userOps([{ op: 'update', id, label }]);
  }
  positionToolbar();
}
renameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); endRename(true); }
  if (e.key === 'Escape') { e.preventDefault(); endRename(false); }
});
renameInput.addEventListener('blur', () => endRename(true));

$('zoom-in').addEventListener('click', () => mapView.zoom(1.25));
$('zoom-out').addEventListener('click', () => mapView.zoom(0.8));
$('zoom-fit').addEventListener('click', () => mapView.fit());

// ---------- Transcription et mises à jour ----------

function addSegment({ text, answerTo, focus }) {
  const clean = String(text || '').trim();
  if (!clean) return;
  const target = answerTo !== undefined ? answerTo : answering;
  session.segments.push({
    id: uid(),
    text: clean,
    answerTo: target ? target.text : undefined,
    focus,
    at: Date.now(),
  });
  if (target) {
    session.hidden.push({ id: target.id, text: target.text });
    // La carte reste affichée, validée, jusqu'à ce que l'agent intègre la réponse.
    const card = session.suggestions.find((s) => s.id === target.id);
    if (card) card.answered = true;
    if (answering && answering.id === target.id) setAnswering(null);
  }
  save();
  renderMap({});
  renderTranscript();
  renderSuggestions();
  // Un « merci » ou un mot isolé attend la suite plutôt que de déclencher un appel à lui seul.
  scheduleUpdate(onlyMinorNews() ? 4000 : 450);
}

function onlyMinorNews() {
  const fresh = session.segments.slice(session.processedCount);
  if (fresh.some((s) => s.answerTo || s.focus || s.research || s.corrects !== undefined || s.retracts !== undefined)) return false;
  const words = fresh.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
  return words < 4;
}

let updateTimer = null;
let inflight = false;
function scheduleUpdate(delay = 450) {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(runUpdate, delay);
}

async function runUpdate() {
  if (inflight || session.processedCount >= session.segments.length) return;
  inflight = true;
  const current = session;
  const upto = session.segments.length;
  showActivity('L’agent met la carte à jour…');
  try {
    const res = await api.update(current, current.demo);
    if (current !== session) return; // session remplacée entre-temps
    // Réponses reconnues par l'agent : la carte passe à « ✓ », un temps, avant de s'envoler.
    const recognized = session.suggestions.filter((s) => (res.answered || []).includes(s.id) && !s.answered);
    if (recognized.length) {
      for (const s of recognized) {
        s.answered = true;
        session.hidden.push({ id: s.id, text: s.text });
      }
      renderSuggestions();
      await sleep(900);
      if (current !== session) return;
    }
    const flights = captureAnswered();
    const { map, changes, rejected } = applyOps(session.map, res.ops, { origin: 'ai' });
    if (rejected.length) console.info('Opérations écartées', rejected);
    session.map = map;
    session.grid = res.grid;
    // null : l'agent garde les mêmes questions (on retire seulement celles déjà répondues).
    // Sinon, on masque une suggestion déjà traitée si c'est bien la même (id et texte).
    session.suggestions = res.suggestions === null
      ? session.suggestions.filter((s) => !s.answered)
      : res.suggestions.filter((s) => !session.hidden.some((h) => h.id === s.id && (!h.text || h.text === s.text)));
    session.processedCount = upto;
    // Recherche explicitement demandée à voix haute : lancée tout de suite, sans carte.
    for (const s of session.suggestions.filter((x) => x.kind === 'search' && x.requested)) {
      session.hidden.push({ id: s.id, text: s.text });
      launchResearch(s.text);
    }
    session.suggestions = session.suggestions.filter((x) => !(x.kind === 'search' && x.requested));
    recordUsage(res.meta);
    save();
    renderMap(changes);
    renderSuggestions();
    renderGrid();
    hideActivity();
    launchFlights(flights, changes);
  } catch (err) {
    showActivity(err.message, true);
    toast(err.message, { error: true, action: { label: 'Réessayer', fn: () => scheduleUpdate(0) } });
    setTimeout(hideActivity, 4000);
    inflight = false;
    return;
  } finally {
    inflight = false;
  }
  if (session.processedCount < session.segments.length) scheduleUpdate(100);
}

let activityTimer = null;
function showActivity(text, error = false) {
  clearInterval(activityTimer);
  $('agent-activity').hidden = false;
  $('agent-activity').classList.toggle('error', error);
  $('agent-activity').querySelector('.spinner').hidden = error;
  $('agent-activity-text').textContent = text;
  $('llm-chip').classList.toggle('busy', !error);
  if (error) return;
  // Au-delà de 2 s, on affiche le temps écoulé.
  const started = Date.now();
  activityTimer = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    if (s >= 2) $('agent-activity-text').textContent = `${text} ${s} s`;
  }, 500);
}
function hideActivity() {
  clearInterval(activityTimer);
  $('agent-activity').hidden = true;
  $('llm-chip').classList.remove('busy');
}

// ---------- Réponse intégrée : la carte question rejoint la carte heuristique ----------

// Avant la mise à jour : copie des cartes répondues, à leur place à l'écran.
function captureAnswered() {
  const box = $('suggestions');
  return session.suggestions.filter((s) => s.answered).map((s) => {
    const el = box.querySelector(`[data-id="${CSS.escape(s.id)}"]`);
    return el ? { s, clone: el.cloneNode(true), rect: el.getBoundingClientRect() } : null;
  }).filter(Boolean);
}

// Le nœud qui répond le mieux à la question : celui qu'elle visait s'il a changé,
// sinon le premier ajouté, sinon le premier modifié.
function answerTarget(s, changes) {
  const touched = [...(changes.added || []), ...(changes.updated || []), ...(changes.moved || [])];
  if (s.node && touched.includes(s.node)) return s.node;
  if (changes.added?.length) return changes.added[0];
  if (touched.length) return touched[0];
  return s.node && session.map.nodes[s.node] ? s.node : null;
}

function launchFlights(flights, changes) {
  if (!flights.length) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Deux images : la carte a pu se recadrer (le bandeau a changé de hauteur).
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const { s, clone, rect } of flights) {
      const target = answerTarget(s, changes);
      Object.assign(clone.style, {
        position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', zIndex: '60', pointerEvents: 'none',
      });
      clone.classList.add('flying');
      document.body.append(clone);
      const box = target && mapView.screenBox(target);
      if (!box || reduced) {
        clone.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.94)' }], { duration: 450, easing: 'ease-out' })
          .onfinish = () => { clone.remove(); if (target) mapView.flash(target); };
        continue;
      }
      const svg = $('map').getBoundingClientRect();
      const dx = svg.left + box.x - (rect.left + rect.width / 2);
      const dy = svg.top + box.y - (rect.top + rect.height / 2);
      const sx = Math.max(box.w / rect.width, 0.08);
      const sy = Math.max(box.h / rect.height, 0.08);
      clone.animate([
        { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
        { transform: 'translate(0, -8px) scale(1.03)', opacity: 1, offset: 0.18 },
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.25, offset: 1 },
      ], { duration: 850, easing: 'cubic-bezier(.55, 0, .25, 1)' }).onfinish = () => {
        clone.remove();
        mapView.flash(target);
      };
    }
  }));
}

// ---------- Panneau : suggestions, grille, transcription ----------

function setAnswering(target) {
  answering = target;
  $('answer-chip').hidden = !target;
  $('answer-text').textContent = target ? target.text : '';
  renderSuggestions();
  if (target) $('text-input').focus();
}
$('answer-cancel').addEventListener('click', () => setAnswering(null));

function buildCard(s) {
  const card = document.createElement('div');
  card.dataset.id = s.id;
  card.dataset.text = s.text;
  const dim = DIMENSIONS.find((d) => d.key === s.dimension);
  card.innerHTML = `
    <div class="sugg-kind"></div>
    <p class="sugg-text"></p>
    <div class="sugg-actions">
      <button type="button" class="answer">Répondre</button>
      <button type="button" class="postpone" title="Mettre de côté : l'agent ne la repose pas, elle reste dans le prompt final">Plus tard</button>
      <button type="button" class="dismiss" title="Ne plus proposer">Ignorer</button>
      <span class="dim"></span>
    </div>
    <div class="sugg-done"><span class="check">✓</span> Réponse notée · l’agent l’intègre…</div>`;
  card.querySelector('.sugg-kind').textContent = KIND_LABELS[s.kind] || 'Question';
  card.querySelector('.sugg-text').textContent = s.text;
  card.querySelector('.dim').textContent = dim ? dim.label : '';
  if (s.kind === 'search') {
    const btn = card.querySelector('.answer');
    btn.textContent = 'Chercher';
    btn.className = 'search-btn';
    btn.title = 'Lancer cette recherche web (agent séparé)';
    btn.addEventListener('click', () => {
      session.hidden.push({ id: s.id, text: s.text });
      session.suggestions = session.suggestions.filter((x) => x.id !== s.id);
      launchResearch(s.text);
    });
  } else {
    card.querySelector('.answer').addEventListener('click', () => setAnswering(answering?.id === s.id ? null : s));
  }
  card.querySelector('.dismiss').addEventListener('click', () => {
    session.dismissed.push(s.text);
    session.hidden.push({ id: s.id, text: s.text });
    session.suggestions = session.suggestions.filter((x) => x.id !== s.id);
    if (answering?.id === s.id) setAnswering(null);
    save();
    renderSuggestions();
  });
  card.querySelector('.postpone').addEventListener('click', () => {
    session.later.push({ id: s.id, text: s.text, kind: s.kind, dimension: s.dimension, node: s.node });
    session.hidden.push({ id: s.id, text: s.text });
    session.suggestions = session.suggestions.filter((x) => x.id !== s.id);
    if (answering?.id === s.id) setAnswering(null);
    save();
    renderSuggestions();
  });
  card.addEventListener('mouseenter', () => mapView.setLinked(s.node || null));
  card.addEventListener('mouseleave', () => mapView.setLinked(null));
  return card;
}

// ---------- Recherches web : un agent séparé, en parallèle ----------

function launchResearch(topic) {
  const clean = String(topic || '').trim();
  if (!clean) return;
  if (session.research.some((j) => j.topic === clean && j.status === 'running')) return;
  const job = { id: uid(), topic: clean, status: 'running', startedAt: Date.now(), references: [], ideas: [], added: [] };
  const owner = session;
  session.research.unshift(job);
  save();
  renderSuggestions();
  api.research(session, clean).then((res) => {
    Object.assign(job, { status: 'done', references: res.references, ideas: res.ideas, doneAt: Date.now() });
    if (owner !== session) return;
    recordUsage(res.meta);
    // Le résumé filtré part à l'agent de travail, qui décide quoi intégrer à la carte.
    session.segments.push({
      id: uid(), text: '', at: Date.now(),
      research: { topic: clean, references: res.references, ideas: res.ideas },
    });
    renderTranscript();
    scheduleUpdate(0);
  }).catch((err) => {
    Object.assign(job, { status: 'error', error: err.message });
  }).finally(() => {
    if (owner !== session) return;
    save();
    renderSuggestions();
  });
}

let researchTimer = null;
function renderResearch() {
  const box = $('research');
  const jobs = session.research;
  box.hidden = !jobs.length;
  box.textContent = '';
  clearInterval(researchTimer);
  for (const job of jobs) {
    const el = document.createElement('div');
    el.className = 'job';
    el.innerHTML = '<div class="job-head"><svg class="job-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><span class="topic"></span><span class="state"></span><button type="button" class="close" title="Fermer">×</button></div>';
    el.querySelector('.topic').textContent = job.topic;
    const state = el.querySelector('.state');
    if (job.status === 'running') {
      state.innerHTML = '<span class="spinner"></span><span class="elapsed"></span>';
      state.querySelector('.elapsed').dataset.since = job.startedAt;
    } else if (job.status === 'error') {
      state.classList.add('error');
      state.textContent = `Échec : ${job.error}`;
    } else {
      const n = job.references.length;
      state.textContent = n
        ? `✓ ${n} référence${n > 1 ? 's' : ''} transmise${n > 1 ? 's' : ''} à l’agent`
        : '✓ Rien de pertinent trouvé';
    }
    el.querySelector('.close').addEventListener('click', () => {
      session.research = session.research.filter((j) => j !== job);
      save();
      renderSuggestions();
    });
    box.append(el);
  }
  // Une recherche aboutie s'efface d'elle-même : l'agent a pris le relais.
  const finished = jobs.filter((j) => j.status === 'done');
  if (finished.length) {
    setTimeout(() => {
      const before = session.research.length;
      session.research = session.research.filter((j) => !(j.status === 'done' && Date.now() - (j.doneAt || 0) > 5500));
      if (session.research.length !== before) { save(); renderSuggestions(); }
    }, 6000);
  }
  // Temps écoulé des recherches en cours.
  if (jobs.some((j) => j.status === 'running')) {
    const tick = () => box.querySelectorAll('.elapsed').forEach((e) => { e.textContent = `recherche… ${Math.round((Date.now() - Number(e.dataset.since)) / 1000)} s`; });
    tick();
    researchTimer = setInterval(tick, 1000);
  }
}

// Pile des questions mises de côté : on y répond ou on les écarte quand on veut.
let laterOpen = false;
function renderLater() {
  const items = session.later;
  $('later').hidden = !items.length;
  if (!items.length) { laterOpen = false; return; }
  $('later-toggle').textContent = `${laterOpen ? '▾' : '▸'} Plus tard · ${items.length} question${items.length > 1 ? 's' : ''} mise${items.length > 1 ? 's' : ''} de côté`;
  $('later-toggle').setAttribute('aria-expanded', String(laterOpen));
  const list = $('later-list');
  list.hidden = !laterOpen;
  list.textContent = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><button type="button">Répondre</button><button type="button">Ignorer</button>';
    li.querySelector('span').textContent = item.text;
    const [answer, dismiss] = li.querySelectorAll('button');
    answer.addEventListener('click', () => {
      session.later = session.later.filter((x) => x.id !== item.id);
      save();
      setAnswering(item);
    });
    dismiss.addEventListener('click', () => {
      session.later = session.later.filter((x) => x.id !== item.id);
      session.dismissed.push(item.text);
      save();
      renderSuggestions();
    });
    list.append(li);
  }
}
$('later-toggle').addEventListener('click', () => { laterOpen = !laterOpen; renderLater(); });

// ---------- Consommation Claude, façon statusline ----------

// « claude-opus-5-5 » → « Opus 5.5 » ; « [1m] » ou fenêtre d'un million → « 1M ».
function modelName(id, window) {
  if (!id) return 'Claude';
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(id);
  const name = m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : id;
  return /\[1m\]/i.test(id) || window >= 1000000 ? `${name} 1M` : name;
}
const hum = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const band = (pct) => (pct < 30 ? 'g' : pct < 50 ? 'y' : pct < 70 ? 'o' : 'r');

function recordUsage(meta) {
  if (!meta?.usage) return;
  const u = meta.usage;
  session.usage.tokens += u.input + u.output;
  session.usage.calls += 1;
  session.usage.last = meta;
  renderUsage();
}

function renderUsage() {
  const el = $('usage');
  const last = session.usage?.last;
  el.hidden = !last;
  if (!last) return;
  const u = last.usage;
  if (last.mode === 'démo') {
    el.innerHTML = '<b>Démo</b><span class="sep">|</span>sans IA, aucun token';
    return;
  }
  const ctx = u.input + u.cacheRead + u.cacheWrite;
  const pct = u.contextWindow ? (ctx / u.contextWindow) * 100 : null;
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // Chaque élément reste entier ; la ligne passe à la ligne entre deux éléments si le panneau est étroit.
  const parts = [
    `Ctx: <span class="${pct === null ? '' : band(pct)}">${hum(ctx)}${pct === null ? '' : ` (${pct.toFixed(1)}%)`}</span>`,
    `${hum(session.usage.tokens)} tokens`,
    `<span class="g">${hum(u.cacheRead)}</span> cache`,
    u.durationMs ? `${(u.durationMs / 1000).toFixed(1)} s` : '',
  ].filter(Boolean);
  el.innerHTML = `<div class="usage-line"><span class="item"><b>${esc(modelName(u.model, u.contextWindow))}</b></span><span class="item">effort ${esc(last.effort)}</span><span class="item">${esc(last.mode)}</span></div>`
    + `<div class="usage-line">${parts.map((p) => `<span class="item">${p}</span>`).join('')}</div>`;
  el.title = [
    `Modèle : ${u.model || '?'} · mode ${last.mode} · effort ${last.effort}`,
    `Dernier appel : entrée ${u.input}, cache lu ${u.cacheRead}, cache écrit ${u.cacheWrite}, sortie ${u.output}`,
    `Session : ${session.usage.calls} appel${session.usage.calls > 1 ? 's' : ''}, ${session.usage.tokens} tokens (entrée + sortie, hors cache)`,
    u.costUsd !== null ? `Équivalent API du dernier appel : ${u.costUsd.toFixed(3)} $ (inclus dans l'abonnement)` : '',
  ].filter(Boolean).join('\n');
}

// Rendu par clé : une question déjà affichée garde sa carte, seules les nouvelles s'animent.
function renderSuggestions() {
  const box = $('suggestions');
  const list = session.suggestions;
  // Le bandeau n'apparaît que lorsqu'il y a des questions (ou des questions mises de côté).
  $('questions').hidden = !list.length && !session.later.length && !session.research.length;
  $('suggestions').hidden = !list.length;
  renderLater();
  renderResearch();
  const existing = new Map([...box.children].map((el) => [el.dataset.id, el]));
  list.forEach((s, i) => {
    let card = existing.get(s.id);
    if (!card || card.dataset.text !== s.text) {
      card?.remove();
      card = buildCard(s);
    }
    existing.delete(s.id);
    card.className = `sugg ${s.kind}${answering?.id === s.id ? ' active' : ''}${s.answered ? ' answered' : ''}`;
    if (box.children[i] !== card) box.insertBefore(card, box.children[i] || null);
  });
  for (const el of existing.values()) el.remove();
}

function renderGrid() {
  const list = $('grid-list');
  list.textContent = '';
  const progress = gridProgress(session.grid);
  $('grid-progress').style.width = `${Math.round(progress * 100)}%`;
  $('grid-progress-label').textContent = session.segments.length ? `${Math.round(progress * 100)} %` : '';
  for (const d of DIMENSIONS) {
    const g = session.grid[d.key] || { status: 'missing', summary: '' };
    const li = document.createElement('li');
    li.className = `grid-item ${g.status}`;
    li.title = `${d.hint}${g.summary ? `\n\n${g.summary}` : ''}\n\nStatut : ${STATUS_LABELS[g.status]}${g.status === 'missing' || g.status === 'partial' ? '\nClique pour y répondre.' : ''}`;
    li.innerHTML = '<span class="grid-dot"></span><span class="grid-name"></span><span class="grid-summary"></span>';
    li.querySelector('.grid-name').textContent = d.label;
    li.querySelector('.grid-summary').textContent = g.summary;
    li.addEventListener('click', () => setAnswering({ id: `grid-${d.key}`, text: d.question }));
    list.append(li);
  }
}

function renderTranscript() {
  const list = $('transcript');
  list.textContent = '';
  if (!session.segments.length && !pending.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = 'Ce que tu dis s’affichera ici.';
    list.append(li);
  }
  for (const s of session.segments) {
    // Corrections et retraits s'affichent sur la phrase d'origine.
    if (s.corrects !== undefined || s.retracts !== undefined) continue;
    const li = document.createElement('li');
    if (s.research) {
      const n = s.research.references.length;
      li.className = 'focus';
      li.textContent = `Recherche « ${s.research.topic} » : ${n} référence${n > 1 ? 's' : ''} transmise${n > 1 ? 's' : ''} à l’agent.`;
    } else if (s.focus) {
      li.className = 'focus';
      li.textContent = `Tu as demandé d’approfondir « ${s.focus} ».`;
    } else {
      li.className = `seg${s.retracted ? ' retracted' : ''}`;
      if (s.answerTo) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = `↳ ${s.answerTo}`;
        li.append(tag);
      }
      const text = document.createElement('span');
      text.className = 'seg-text';
      text.textContent = s.text;
      li.append(text);
      if (s.edited) {
        const mark = document.createElement('span');
        mark.className = 'edited';
        mark.textContent = 'corrigée';
        li.append(mark);
      }
      if (!s.retracted) {
        const actions = document.createElement('span');
        actions.className = 'seg-actions';
        actions.innerHTML = '<button type="button" title="Corriger la transcription">✎</button><button type="button" title="Retirer cette phrase">✕</button>';
        const [edit, remove] = actions.querySelectorAll('button');
        edit.addEventListener('click', () => editSegment(s, li));
        remove.addEventListener('click', () => retractSegment(s));
        li.append(actions);
      }
    }
    list.append(li);
  }
  for (const p of pending) {
    const li = document.createElement('li');
    li.className = 'pending';
    li.textContent = `Transcription (${p.duration.toFixed(1)} s)`;
    list.append(li);
  }
  // Suit le texte, sauf si on est remonté lire plus haut.
  const zone = list.parentElement;
  if (stickToBottom) zone.scrollTop = zone.scrollHeight;
}
let stickToBottom = true;
$('transcript').parentElement.addEventListener('scroll', (e) => {
  const z = e.currentTarget;
  stickToBottom = z.scrollHeight - z.scrollTop - z.clientHeight < 40;
});

// Whisper se trompe parfois : on corrige la phrase, et l'agent remet la carte en accord.
function editSegment(seg, li) {
  const area = document.createElement('textarea');
  area.className = 'seg-edit';
  area.value = seg.text;
  area.rows = Math.max(2, Math.ceil(seg.text.length / 42));
  li.replaceChildren(area);
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const text = area.value.replace(/\s+/g, ' ').trim();
    if (commit && text && text !== seg.text) {
      const old = seg.text;
      seg.text = text;
      seg.edited = true;
      session.segments.push({ id: uid(), text, corrects: old, at: Date.now() });
      save();
      scheduleUpdate();
    }
    renderTranscript();
  };
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  area.addEventListener('blur', () => finish(true));
}

function retractSegment(seg) {
  seg.retracted = true;
  session.segments.push({ id: uid(), text: '', retracts: seg.text, at: Date.now() });
  save();
  renderTranscript();
  scheduleUpdate();
  toast('Phrase retirée : l’agent retire de la carte ce qui venait d’elle.');
}

// Indice pour Whisper : quelques termes de la carte, sans la phrase précédente
// (Whisper a tendance à recopier une phrase donnée en indice : texte inventé).
function whisperPrompt() {
  const labels = Object.values(session.map.nodes)
    .filter((n) => n.id !== ROOT_ID)
    .map((n) => n.label.replace(/[.…]+$/, ''));
  const vocab = [...new Set(labels)].join(', ').slice(0, 200);
  return vocab ? `Vocabulaire : ${vocab}.` : '';
}

// ---------- Saisie : texte et micro ----------

$('composer-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('text-input');
  addSegment({ text: input.value });
  input.value = '';
});

const caption = $('caption');
let captionTimer = null;
// Montre un instant ce que Whisper a compris.
function flashCaption(text) {
  if (demoRunning) return;
  showCaption(text);
  captionTimer = setTimeout(() => { if (caption.textContent === text) showCaption(''); }, 2800);
}
function showCaption(text, listening = false) {
  clearTimeout(captionTimer);
  caption.hidden = !text;
  caption.textContent = text || '';
  caption.classList.toggle('listening', listening);
}

let transcribeQueue = Promise.resolve();
// Vitesse de Whisper : temps de transcription / durée de l'audio (moyenne glissante).
let sttSpeed = null;
let interimBusy = false;
const INTERIM_MAX_SPEED = 0.33; // provisoire seulement si Whisper va 3 fois plus vite que la parole

const mic = new MicCapture({
  onSpeechStart: () => showCaption('Je t’écoute…', true),
  onLevel: (level) => {
    $('mic-level').style.transform = `scale(${1 + level * 0.5})`;
  },
  onSegment: (wav, duration) => {
    const target = answering; // la réponse vise la question active au moment où on parle
    const job = { id: uid(), duration };
    pending.push(job);
    renderTranscript();
    renderMap({});
    transcribeQueue = transcribeQueue.then(async () => {
      try {
        const started = Date.now();
        const { text } = await api.transcribe(wav, whisperPrompt());
        const speed = (Date.now() - started) / 1000 / duration;
        sttSpeed = sttSpeed === null ? speed : sttSpeed * 0.7 + speed * 0.3;
        pending = pending.filter((p) => p !== job);
        if (text) {
          addSegment({ text, answerTo: target });
          flashCaption(`« ${text} »`);
        } else renderTranscript();
      } catch (err) {
        pending = pending.filter((p) => p !== job);
        renderTranscript();
        toast(`Transcription impossible : ${err.message}`, { error: true });
      }
      renderMap({});
    });
  },
});

// Transcription provisoire du morceau en cours, affichée dans la bulle pendant qu'on parle.
// Avec le petit serveur dédié (tiny) : toutes les ~0,9 s. Sinon, seulement si le Whisper principal
// est assez rapide. Jamais pendant la transcription d'un morceau définitif : elle ne doit pas le retarder.
setInterval(async () => {
  const live = Boolean(status.whisperLive?.reachable);
  if (!mic.speaking || interimBusy || pending.length) return;
  if (!live && (sttSpeed === null || sttSpeed > INTERIM_MAX_SPEED)) return;
  const wav = mic.currentWav();
  if (!wav) return;
  interimBusy = true;
  try {
    const { text } = await api.transcribe(wav, whisperPrompt(), { live });
    if (text && mic.speaking) showCaption(`${text} …`, true);
  } catch { /* le morceau définitif suivra */ } finally {
    interimBusy = false;
  }
}, 900);

async function toggleMic() {
  if (mic.active) {
    await mic.stop();
    setMicUi(false);
    return;
  }
  // Les navigateurs n'ouvrent le micro qu'en HTTPS ou sur localhost.
  if (!window.isSecureContext || !navigator.mediaDevices) {
    toast('Le micro exige HTTPS (ou localhost) : ouvre prompt-map en https://, voir le README. En attendant, tu peux écrire.', { error: true, ms: 8000 });
    return;
  }
  if (!status.whisper.reachable) {
    await refreshStatus();
    if (!status.whisper.reachable) {
      toast('Whisper n’est pas lancé. Démarre-le avec « npm run whisper », puis réessaie. En attendant, tu peux écrire.', { error: true, ms: 7000 });
      $('text-input').focus();
      return;
    }
  }
  try {
    await mic.start();
    setMicUi(true);
  } catch (err) {
    toast(err.name === 'NotAllowedError' ? 'Accès au micro refusé.' : `Micro indisponible : ${err.message}`, { error: true });
  }
}

function setMicUi(on) {
  $('mic-btn').setAttribute('aria-pressed', String(on));
  $('mic-btn').title = on ? 'Arrêter le micro (Espace)' : 'Parler (Espace)';
  $('composer-status').textContent = on
    ? 'Micro actif · parle librement, je découpe aux pauses · Espace pour couper'
    : 'Espace : appui bref pour le micro continu, maintenu pour parler · Entrée pour envoyer';
  if (!on) showCaption('');
  renderMap({});
}

$('mic-btn').addEventListener('click', toggleMic);
$('empty-mic').addEventListener('click', toggleMic);

// ---------- Export ----------

const dialog = $('export-dialog');
async function openExport({ draft = false, force = false } = {}) {
  if (!session.segments.length) {
    toast('Dis ou écris d’abord quelque chose : il n’y a encore rien à exporter.');
    return;
  }
  if (!dialog.open) dialog.showModal();
  // Rien n'a changé depuis le dernier prompt généré : on le remontre tel quel.
  const last = session.lastExport;
  if (!force && !draft && last && last.segments === session.segments.length && last.processed === session.processedCount) {
    $('export-loading').hidden = true;
    $('export-text').hidden = false;
    $('export-text').value = last.prompt;
    $('export-meta').textContent = `Prompt généré à ${new Date(last.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · « Régénérer » pour une nouvelle version`;
    return;
  }
  const progress = gridProgress(session.grid);
  const missing = DIMENSIONS.filter((d) => ['missing', 'partial'].includes(session.grid[d.key]?.status));
  $('export-meta').textContent = `Couverture ${Math.round(progress * 100)} %${missing.length
    ? ` · ${missing.length} point${missing.length > 1 ? 's' : ''} non précisé${missing.length > 1 ? 's' : ''} (${missing.map((d) => d.label.toLowerCase()).join(', ')}), signalé${missing.length > 1 ? 's' : ''} à Claude`
    : ''}`;
  $('export-loading').hidden = false;
  $('export-text').hidden = true;
  $('export-loading').lastChild.textContent = draft || session.demo ? ' Assemblage du prompt…' : ' Claude rédige le prompt…';
  try {
    const { prompt, meta } = await api.export(session, { demo: session.demo, draft });
    if (!draft) recordUsage(meta);
    $('export-text').value = prompt;
    $('export-text').hidden = false;
    if (!draft) {
      session.lastExport = { prompt, at: Date.now(), segments: session.segments.length, processed: session.processedCount };
      save();
    }
  } catch (err) {
    toast(`${err.message}. Tu peux utiliser la version brute.`, { error: true });
    const res = await api.export(session, { draft: true }).catch(() => null);
    $('export-text').value = res?.prompt || '';
    $('export-text').hidden = false;
  } finally {
    $('export-loading').hidden = true;
  }
}

$('export-btn').addEventListener('click', () => openExport());
$('export-regen').addEventListener('click', () => openExport({ force: true }));
$('export-draft').addEventListener('click', () => openExport({ draft: true }));
$('export-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('export-text').value);
    toast('Prompt copié. Colle-le dans Claude Code.');
  } catch {
    $('export-text').select();
    document.execCommand('copy');
    toast('Prompt copié.');
  }
});
$('export-command').addEventListener('click', async () => {
  const prompt = $('export-text').value;
  const command = `claude '${prompt.replace(/'/g, "'\\''")}'`;
  try {
    await navigator.clipboard.writeText(command);
    toast('Commande copiée : colle-la dans un terminal ouvert dans le dossier du projet.');
  } catch {
    toast('Copie impossible ici : utilise « Copier ».', { error: true });
  }
});
$('export-download').addEventListener('click', () => {
  const root = session.map.nodes[ROOT_ID].label;
  const name = `${root.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'prompt'}.md`;
  const url = URL.createObjectURL(new Blob([$('export-text').value], { type: 'text/markdown' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ---------- Démo ----------

async function typeCaption(text) {
  for (let i = 1; i <= text.length && demoRunning; i += 2) {
    showCaption(text.slice(0, i));
    await sleep(22);
  }
  showCaption(text);
  await sleep(350);
}

async function waitIdle() {
  while (demoRunning && (inflight || session.processedCount < session.segments.length)) await sleep(120);
}

async function runDemo() {
  let script;
  try {
    script = await api.demoScript();
  } catch (err) {
    toast(err.message, { error: true });
    return;
  }
  resetSession(true);
  demoRunning = true;
  renderMap({});
  $('composer-status').textContent = 'Démo en cours · Échap pour l’arrêter';
  for (const step of script) {
    if (!demoRunning) break;
    if (step.answer) {
      const s = session.suggestions.find((x) => x.id === step.answer);
      if (s) { setAnswering(s); await sleep(1300); }
    }
    await typeCaption(step.text);
    if (!demoRunning) break;
    addSegment({ text: step.text });
    showCaption('');
    await waitIdle();
    await sleep(1500);
  }
  const finished = demoRunning;
  demoRunning = false;
  showCaption('');
  setMicUi(mic.active);
  renderMap({});
  if (finished) toast('Démo terminée. Clique sur « Générer le prompt » pour voir le résultat.', { ms: 6000 });
}
$('demo-btn').addEventListener('click', runDemo);

// ---------- Session, statut, raccourcis ----------

function resetSession(demo = false) {
  demoRunning = false;
  session = newSession(demo);
  pending = [];
  setAnswering(null);
  mapView.reset();
  save();
  renderAll();
  warmup();
}

function warmup() {
  if (status.llm === 'claude-cli' && !session.demo) api.warmup(session);
}

$('new-btn').addEventListener('click', () => {
  const kept = session.segments.length > 0;
  resetSession(false);
  if (kept) toast('Nouvelle session. La précédente est dans « Sessions ».');
});

// ---------- Historique des sessions ----------

const sessionsMenu = $('sessions-menu');
function renderSessionsMenu() {
  const list = $('sessions-list');
  list.textContent = '';
  const index = readIndex();
  if (!index.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = 'Aucune session enregistrée pour l’instant.';
    list.append(li);
    return;
  }
  const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  for (const entry of index) {
    const li = document.createElement('li');
    li.className = `session-row${entry.id === session.id ? ' current' : ''}`;
    li.innerHTML = '<button type="button" class="session-open"><span class="session-title"></span><span class="session-meta"><span class="session-date"></span><span class="session-cov"><span class="bar"><span></span></span><span class="pct"></span></span></span></button><button type="button" class="session-delete" title="Supprimer cette session">✕</button>';
    li.querySelector('.session-title').textContent = entry.title + (entry.demo ? ' (démo)' : '');
    li.querySelector('.session-date').textContent = entry.id === session.id ? 'en cours' : fmt.format(entry.updatedAt);
    // Avancement : couverture du prompt (la session en cours est lue en direct).
    const coverage = entry.id === session.id ? Math.round(gridProgress(session.grid) * 100) : entry.coverage ?? null;
    li.querySelector('.session-cov').hidden = coverage === null;
    li.querySelector('.session-cov .bar span').style.width = `${coverage || 0}%`;
    li.querySelector('.session-cov .pct').textContent = `${coverage} %`;
    li.querySelector('.session-cov').title = 'Couverture du prompt';
    li.querySelector('.session-open').addEventListener('click', () => openSession(entry.id));
    li.querySelector('.session-delete').addEventListener('click', () => {
      deleteStored(entry.id);
      if (entry.id === session.id) resetSession(false);
      renderSessionsMenu();
    });
    list.append(li);
  }
}

function openSession(id) {
  sessionsMenu.hidden = true;
  if (id === session.id) return;
  demoRunning = false;
  session = loadSession(id);
  pending = [];
  setAnswering(null);
  mapView.reset();
  save();
  renderAll();
  warmup();
  if (session.processedCount < session.segments.length) scheduleUpdate(300);
}

$('sessions-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  sessionsMenu.hidden = !sessionsMenu.hidden;
  if (!sessionsMenu.hidden) renderSessionsMenu();
});
document.addEventListener('click', (e) => {
  if (!sessionsMenu.hidden && !e.target.closest('#sessions-menu')) sessionsMenu.hidden = true;
});

function renderAll() {
  renderUsage();
  renderMap({});
  renderSuggestions();
  renderGrid();
  renderTranscript();
  renderStatus();
}

function renderStatus() {
  const stt = $('stt-chip');
  stt.classList.toggle('ok', status.whisper.reachable);
  stt.classList.toggle('off', !status.whisper.reachable);
  stt.title = status.whisper.reachable
    ? `Whisper local prêt (${status.whisper.url})`
    : `Whisper injoignable (${status.whisper.url || '?'}). Lance « npm run whisper ».`;
  $('mic-btn').classList.toggle('disabled', !status.whisper.reachable);
  const llm = $('llm-chip');
  const demo = session.demo || status.llm === 'demo';
  llm.textContent = demo ? 'Démo sans IA' : 'Claude Code';
  llm.classList.toggle('ok', Boolean(status.llm));
  llm.title = demo
    ? 'Réponses simulées, sans IA. Installe la CLI Claude Code pour une vraie analyse.'
    : `Analyse par Claude via ta CLI Claude Code${status.claudeVersion ? ` (${status.claudeVersion})` : ''}`;
}

async function refreshStatus() {
  try {
    status = await api.status();
  } catch (err) {
    status = { llm: null, whisper: { reachable: false } };
    toast(err.message, { error: true });
  }
  renderStatus();
}
$('stt-chip').addEventListener('click', async () => {
  await refreshStatus();
  if (!status.whisper.reachable) toast('Whisper n’est pas lancé : « npm run whisper » dans un terminal, puis clique à nouveau ici.', { ms: 6000 });
  else toast('Whisper est prêt.');
});

function toast(message, { error = false, action = null, ms = 4500 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = message;
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', () => { action.fn(); el.remove(); });
    el.append(btn);
  }
  $('toasts').append(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 300); }, ms);
}

// Barre espace : appui bref = micro continu (on/off) · appui maintenu = parler tant qu'on tient.
const HOLD_MS = 350;
let spaceDownAt = 0;
let spaceStarted = false;
let spaceStart = Promise.resolve();
let spaceDown = false;
let holdHint = null;
document.addEventListener('keyup', async (e) => {
  if (e.key !== ' ' || e.target.closest?.('input, textarea') || dialog.open) return;
  e.preventDefault();
  spaceDown = false;
  clearTimeout(holdHint);
  const held = Date.now() - spaceDownAt;
  if (spaceStarted) {
    await spaceStart;
    if (held >= HOLD_MS && mic.active) await toggleMic(); // fin de l'appui maintenu : on envoie
  } else if (mic.active) {
    await toggleMic(); // appui bref, micro allumé : on l'éteint
  }
});

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea') || dialog.open;
  if (e.key === 'Escape') {
    if (demoRunning) { demoRunning = false; showCaption(''); setMicUi(mic.active); toast('Démo arrêtée.'); return; }
    if (answering) { setAnswering(null); return; }
    if (mapView.selected) { mapView.select(null); return; }
    if (e.target === $('text-input')) e.target.blur();
    return;
  }
  if (typing) return;
  if (e.key === ' ') {
    e.preventDefault();
    if (e.repeat) return;
    spaceDownAt = Date.now();
    // Micro éteint : on l'allume ; au relâchement, on saura si c'était un appui bref ou maintenu.
    spaceStarted = !mic.active;
    if (spaceStarted) {
      spaceStart = toggleMic();
      // Toujours appuyé après un instant : c'est un appui maintenu.
      clearTimeout(holdHint);
      holdHint = setTimeout(() => {
        if (spaceDown && mic.active) $('composer-status').textContent = 'Enregistrement… relâche Espace pour envoyer';
      }, HOLD_MS);
    }
    spaceDown = true;
  } else if (e.key === '/') { e.preventDefault(); $('text-input').focus(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && mapView.selected) { e.preventDefault(); deleteNode(mapView.selected); }
  else if ((e.key === 'Enter' || e.key === 'F2') && mapView.selected) { e.preventDefault(); startRename(mapView.selected); }
  else if (e.key === 'Tab' && mapView.selected) { e.preventDefault(); addChild(mapView.selected); }
});

setMicUi(false);
renderAll();
refreshStatus().then(warmup);
if (session.processedCount < session.segments.length) scheduleUpdate(300);
