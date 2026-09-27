import { api } from './api.js';
import { MicCapture } from './audio.js';
import { createMapView } from './map-view.js';
import { createMap, applyOps, nodeCount, ROOT_ID } from './shared/map-model.js';
import { DIMENSIONS, emptyGrid, gridProgress, STATUS_LABELS } from './shared/grid.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'prompt-map:session';
const DEFAULT_TITLE = 'Ton idée';
const KIND_LABELS = { question: 'Question', blind_spot: 'Angle mort', lead: 'Piste' };
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
    demo,
  };
}

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.map?.nodes?.[ROOT_ID] && Array.isArray(saved.segments)) {
      const hidden = (saved.hidden || []).map((h) => (typeof h === 'string' ? { id: h, text: '' } : h));
      return { ...newSession(), ...saved, hidden };
    }
  } catch { /* stockage indisponible ou corrompu */ }
  return newSession();
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch { /* sans persistance */ }
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
});

function userOps(ops) {
  const { map, changes } = applyOps(session.map, ops, { origin: 'user' });
  session.map = map;
  save();
  renderMap(changes);
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
  toolbar.style.left = `${box.x}px`;
  toolbar.style.top = `${box.y - box.h / 2}px`;
  toolbar.querySelector('[data-action="delete"]').hidden = id === ROOT_ID;
  toolbar.querySelector('[data-action="focus"]').hidden = id === ROOT_ID;
}

toolbar.addEventListener('click', (e) => {
  const action = e.target.closest('button')?.dataset.action;
  const id = mapView.selected;
  if (!action || !id) return;
  if (action === 'rename') startRename(id);
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
function startRename(id) {
  if (!session.map.nodes[id]) return;
  renaming = id;
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
  if (commit && label && label !== session.map.nodes[id]?.label) userOps([{ op: 'update', id, label }]);
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
    session.suggestions = session.suggestions.filter((s) => s.id !== target.id);
    if (answering && answering.id === target.id) setAnswering(null);
  }
  save();
  renderMap({});
  renderTranscript();
  renderSuggestions();
  scheduleUpdate();
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
    const { map, changes, rejected } = applyOps(session.map, res.ops, { origin: 'ai' });
    if (rejected.length) console.info('Opérations écartées', rejected);
    session.map = map;
    session.grid = res.grid;
    // Masque une suggestion déjà traitée seulement si c'est bien la même (id et texte).
    session.suggestions = res.suggestions.filter((s) => !session.hidden.some((h) => h.id === s.id && (!h.text || h.text === s.text)));
    session.processedCount = upto;
    save();
    renderMap(changes);
    renderSuggestions();
    renderGrid();
    hideActivity();
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

function showActivity(text, error = false) {
  $('agent-activity').hidden = false;
  $('agent-activity').classList.toggle('error', error);
  $('agent-activity').querySelector('.spinner').hidden = error;
  $('agent-activity-text').textContent = text;
  $('llm-chip').classList.toggle('busy', !error);
}
function hideActivity() {
  $('agent-activity').hidden = true;
  $('llm-chip').classList.remove('busy');
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

function renderSuggestions() {
  const box = $('suggestions');
  const list = session.suggestions;
  $('sugg-count').textContent = list.length || '';
  box.textContent = '';
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'none';
    p.textContent = session.segments.length
      ? 'Rien à demander pour l’instant. Continue, ou génère le prompt.'
      : 'Les questions de l’agent apparaîtront ici pendant que tu parles.';
    box.append(p);
    return;
  }
  for (const s of list) {
    const card = document.createElement('div');
    card.className = `sugg ${s.kind}${answering?.id === s.id ? ' active' : ''}`;
    const dim = DIMENSIONS.find((d) => d.key === s.dimension);
    card.innerHTML = `
      <div class="sugg-kind"></div>
      <p class="sugg-text"></p>
      <div class="sugg-actions">
        <button type="button" class="answer">Répondre</button>
        <button type="button" class="dismiss" title="Ne plus proposer">Ignorer</button>
        <span class="dim"></span>
      </div>`;
    card.querySelector('.sugg-kind').textContent = KIND_LABELS[s.kind] || 'Question';
    card.querySelector('.sugg-text').textContent = s.text;
    card.querySelector('.dim').textContent = dim ? dim.label : '';
    card.querySelector('.answer').addEventListener('click', () => setAnswering(answering?.id === s.id ? null : s));
    card.querySelector('.dismiss').addEventListener('click', () => {
      session.dismissed.push(s.text);
      session.hidden.push({ id: s.id, text: s.text });
      session.suggestions = session.suggestions.filter((x) => x.id !== s.id);
      if (answering?.id === s.id) setAnswering(null);
      save();
      renderSuggestions();
    });
    card.addEventListener('mouseenter', () => mapView.setLinked(s.node || null));
    card.addEventListener('mouseleave', () => mapView.setLinked(null));
    box.append(card);
  }
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
    li.title = `${d.hint}\nStatut : ${STATUS_LABELS[g.status]}${g.status === 'missing' || g.status === 'partial' ? '\nClique pour y répondre.' : ''}`;
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
    const li = document.createElement('li');
    if (s.focus) {
      li.className = 'focus';
      li.textContent = `Tu as demandé d’approfondir « ${s.focus} ».`;
    } else {
      if (s.answerTo) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = `↳ ${s.answerTo}`;
        li.append(tag);
      }
      li.append(document.createTextNode(s.text));
    }
    list.append(li);
  }
  for (const p of pending) {
    const li = document.createElement('li');
    li.className = 'pending';
    li.textContent = `Transcription (${p.duration.toFixed(1)} s)`;
    list.append(li);
  }
}

// ---------- Saisie : texte et micro ----------

$('composer-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('text-input');
  addSegment({ text: input.value });
  input.value = '';
});

const caption = $('caption');
function showCaption(text, listening = false) {
  caption.hidden = !text;
  caption.textContent = text || '';
  caption.classList.toggle('listening', listening);
}

let transcribeQueue = Promise.resolve();
const mic = new MicCapture({
  onSpeechStart: () => showCaption('Je t’écoute…', true),
  onLevel: (level) => {
    $('mic-level').style.transform = `scale(${1 + level * 0.5})`;
  },
  onSegment: (wav, duration) => {
    const target = answering; // la réponse vise la question active au moment où on parle
    const job = { id: uid(), duration };
    pending.push(job);
    showCaption('');
    renderTranscript();
    renderMap({});
    transcribeQueue = transcribeQueue.then(async () => {
      try {
        const { text } = await api.transcribe(wav);
        pending = pending.filter((p) => p !== job);
        if (text) addSegment({ text, answerTo: target });
        else renderTranscript();
      } catch (err) {
        pending = pending.filter((p) => p !== job);
        renderTranscript();
        toast(`Transcription impossible : ${err.message}`, { error: true });
      }
      renderMap({});
    });
  },
});

async function toggleMic() {
  if (mic.active) {
    await mic.stop();
    setMicUi(false);
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
    ? 'Micro actif · parle librement, je découpe aux pauses'
    : 'Espace pour parler · Entrée pour envoyer';
  if (!on) showCaption('');
  renderMap({});
}

$('mic-btn').addEventListener('click', toggleMic);
$('empty-mic').addEventListener('click', toggleMic);

// ---------- Export ----------

const dialog = $('export-dialog');
async function openExport({ draft = false } = {}) {
  if (!session.segments.length) {
    toast('Dis ou écris d’abord quelque chose : il n’y a encore rien à exporter.');
    return;
  }
  if (!dialog.open) dialog.showModal();
  const progress = gridProgress(session.grid);
  const missing = DIMENSIONS.filter((d) => ['missing', 'partial'].includes(session.grid[d.key]?.status));
  $('export-meta').textContent = `Couverture ${Math.round(progress * 100)} %${missing.length
    ? ` · ${missing.length} point${missing.length > 1 ? 's' : ''} non précisé${missing.length > 1 ? 's' : ''} (${missing.map((d) => d.label.toLowerCase()).join(', ')}), signalé${missing.length > 1 ? 's' : ''} à Claude`
    : ''}`;
  $('export-loading').hidden = false;
  $('export-text').hidden = true;
  $('export-loading').lastChild.textContent = draft || session.demo ? ' Assemblage du prompt…' : ' Claude rédige le prompt…';
  try {
    const { prompt } = await api.export(session, { demo: session.demo, draft });
    $('export-text').value = prompt;
    $('export-text').hidden = false;
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
$('export-regen').addEventListener('click', () => openExport());
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
  if (session.segments.length && !confirm('Remplacer la session en cours par la démo ?')) return;
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
}

$('new-btn').addEventListener('click', () => {
  if (session.segments.length && !confirm('Commencer une nouvelle session ? La carte actuelle sera effacée.')) return;
  resetSession(false);
});

function renderAll() {
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

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, textarea') || dialog.open;
  if (e.key === 'Escape') {
    if (demoRunning) { demoRunning = false; showCaption(''); setMicUi(mic.active); toast('Démo arrêtée.'); return; }
    if (answering) { setAnswering(null); return; }
    if (mapView.selected) { mapView.select(null); return; }
    if (e.target === $('text-input')) e.target.blur();
    return;
  }
  if (typing) return;
  if (e.key === ' ') { e.preventDefault(); toggleMic(); }
  else if (e.key === '/') { e.preventDefault(); $('text-input').focus(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && mapView.selected) { e.preventDefault(); deleteNode(mapView.selected); }
  else if ((e.key === 'Enter' || e.key === 'F2') && mapView.selected) { e.preventDefault(); startRename(mapView.selected); }
});

setMicUi(false);
renderAll();
refreshStatus();
if (session.processedCount < session.segments.length) scheduleUpdate(300);
