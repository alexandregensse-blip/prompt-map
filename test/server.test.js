import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { createDemo } from '../server/llm/demo.js';
import { loadConfig } from '../server/config.js';
import { cleanTranscript } from '../server/stt/whisper.js';
import { encodeWav } from '../web/js/shared/audio-utils.js';
import { createMap } from '../web/js/shared/map-model.js';
import { emptyGrid } from '../web/js/shared/grid.js';

let app;
let whisper;
let base;
let whisperRequests = [];
const quiet = { info() {}, error() {} };

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

before(async () => {
  // Faux serveur whisper.cpp : vérifie le formulaire et renvoie un texte.
  whisper = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('latin1');
    whisperRequests.push({ url: req.url, type: req.headers['content-type'], body });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ text: body.includes('RIFF') ? '  Bonjour,   je voudrais un export PDF. ' : '' }));
  });
  const wport = await listen(whisper);
  const cfg = loadConfig({ PROMPTMAP_WHISPER_URL: `http://127.0.0.1:${wport}/inference` }, '/nexiste/pas.json');
  const demo = createDemo();
  app = createApp(cfg, { main: demo, demo, claudeVersion: null }, { log: quiet });
  base = `http://127.0.0.1:${await listen(app)}`;
});

after(() => {
  app.close();
  whisper.close();
});

const session = (segments) => ({ map: createMap(), grid: emptyGrid(), suggestions: [], dismissed: [], segments, processedCount: 0 });

test('sert l’interface et ses modules', async () => {
  const html = await fetch(`${base}/`);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /<title>prompt-map<\/title>/);
  const js = await fetch(`${base}/js/shared/map-model.js`);
  assert.match(js.headers.get('content-type'), /javascript/);
  // Remonter hors de web/ est impossible, même encodé.
  for (const path of ['/../package.json', '/%2e%2e/package.json', '/..%2fserver%2fconfig.js']) {
    const res = await fetch(`${base}${path}`);
    assert.ok(res.status === 404 || res.status === 403, path);
  }
});

test('statut : fournisseur et Whisper joignable', async () => {
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.llm, 'demo');
  assert.equal(status.whisper.reachable, true);
});

test('mise à jour : renvoie opérations, grille et suggestions', async () => {
  const res = await fetch(`${base}/api/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: session([{ text: 'Je veux un export PDF de mes factures.' }]) }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.ops.length > 0);
  assert.ok(data.grid.objectif);
});

test('session invalide ou JSON cassé : erreur 400 lisible', async () => {
  const bad = await fetch(`${base}/api/update`, { method: 'POST', body: '{"session":{}}' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'Session invalide');
  const broken = await fetch(`${base}/api/update`, { method: 'POST', body: '{oups' });
  assert.equal(broken.status, 400);
});

test('refuse les appels venant d’un autre site', async () => {
  const res = await fetch(`${base}/api/update`, {
    method: 'POST',
    headers: { origin: 'https://site-malveillant.example' },
    body: JSON.stringify({ session: session([]) }),
  });
  assert.equal(res.status, 403);
});

test('adresse supplémentaire autorisée (IP de conteneur), les autres refusées', async (t) => {
  const cfg = loadConfig({ PROMPTMAP_ALLOWED_HOSTS: '172.17.0.5' }, '/nexiste/pas.json');
  const demo = createDemo();
  const server = createApp(cfg, { main: demo, demo, claudeVersion: null }, { log: quiet });
  const port = await listen(server);
  t.after(() => server.close());
  const { request } = await import('node:http');
  const get = (host, origin) => new Promise((resolve) => {
    request({ host: '127.0.0.1', port, path: '/api/status', headers: { host, ...(origin ? { origin } : {}) } }, (res) => { res.resume(); resolve(res.statusCode); }).end();
  });
  assert.equal(await get(`172.17.0.5:${port}`), 200);
  assert.equal(await get(`172.17.0.5:${port}`, `https://172.17.0.5:${port}`), 200);
  assert.equal(await get(`evil.example:${port}`), 403);
  assert.equal(await get(`172.17.0.5:${port}`, 'https://evil.example'), 403);
});

test('export : version brute sans IA', async () => {
  const res = await fetch(`${base}/api/export`, {
    method: 'POST',
    body: JSON.stringify({ session: session([{ text: 'x' }]), draft: true }),
  });
  const data = await res.json();
  assert.equal(data.draft, true);
  assert.match(data.prompt, /^# Ton idée/);
});

test('transcription : WAV relayé à whisper.cpp, texte nettoyé', async () => {
  whisperRequests = [];
  const wav = encodeWav(new Float32Array(1600));
  const res = await fetch(`${base}/api/transcribe`, {
    method: 'POST',
    headers: { 'content-type': 'audio/wav', 'x-whisper-prompt': encodeURIComponent('Vocabulaire : pdfkit, Express.') },
    body: encodeWav(new Float32Array(16000 * 3)),
  });
  assert.deepEqual(await res.json(), { text: 'Bonjour, je voudrais un export PDF.' });
  const req = whisperRequests[0];
  assert.equal(req.url, '/inference');
  assert.match(req.type, /multipart\/form-data/);
  assert.match(req.body, /name="language"\r\n\r\nfr/);
  assert.match(req.body, /name="response_format"\r\n\r\njson/);
  assert.match(req.body, /name="suppress_nst"\r\n\r\ntrue/);
  assert.doesNotMatch(req.body, /name="audio_ctx"/, 'fenêtre complète pour le texte définitif');
  assert.match(req.body, /name="temperature_inc"\r\n\r\n0\.0/);
  assert.match(Buffer.from(req.body, 'latin1').toString('utf8'), /name="prompt"\r\n\r\nVocabulaire : pdfkit, Express\./);
});

test('transcription : refuse ce qui n’est pas un WAV', async () => {
  const res = await fetch(`${base}/api/transcribe`, { method: 'POST', body: new Uint8Array(100) });
  assert.equal(res.status, 400);
});

test('fenêtre d’encodage Whisper ajustée à la durée', async () => {
  const { audioContext } = await import('../server/stt/whisper.js');
  assert.equal(audioContext(0), 128);
  assert.equal(audioContext(8), 528);
  assert.equal(audioContext(30), 1500);
  assert.equal(audioContext(60), 1500);
});

test('garde-fous : trop de texte pour la durée, indice recopié', async () => {
  const { plausible } = await import('../server/stt/whisper.js');
  assert.equal(plausible('Bonjour, je voudrais un export PDF.', 2), 'Bonjour, je voudrais un export PDF.');
  assert.equal(plausible('Une très longue phrase inventée qui ne peut pas tenir en une demi-seconde de parole.', 0.5), '');
  assert.equal(plausible('Vocabulaire : pdfkit, Express.', 3), '');
  assert.equal(plausible('Export PDF des factures, pdfkit', 3, 'Vocabulaire : Export PDF des factures, pdfkit, React.'), '');
});

test('nettoyage des hallucinations classiques de Whisper', () => {
  assert.equal(cleanTranscript('Sous-titres réalisés par la communauté d’Amara.org'), '');
  assert.equal(cleanTranscript('Merci d\'avoir regardé cette vidéo !'), '');
  assert.equal(cleanTranscript('[BLANK_AUDIO]'), '');
  assert.equal(cleanTranscript(' Ajoute un bouton   export. '), 'Ajoute un bouton export.');
  assert.equal(cleanTranscript('il faut que il faut que il faut que ça marche'), 'il faut que ça marche');
  assert.equal(cleanTranscript('[Bruit de joie]'), '');
  assert.equal(cleanTranscript(' (Rires) '), '');
  assert.equal(cleanTranscript('Alors [bruit de fond] on ajoute *tousse* un export.'), 'Alors on ajoute un export.');
  assert.equal(cleanTranscript('♪ musique ♪ Bonjour.'), 'Bonjour.');
  assert.equal(cleanTranscript('Le module (celui que je t’ai montré hier) est fragile.'), 'Le module (celui que je t’ai montré hier) est fragile.');
});

test('configuration : fichier puis variables d’environnement', () => {
  const cfg = loadConfig({ PROMPTMAP_PORT: '5000', PROMPTMAP_OPEN: 'non', PROMPTMAP_MODEL: 'sonnet' }, '/nexiste/pas.json');
  assert.equal(cfg.port, 5000);
  assert.equal(cfg.openWindow, false);
  assert.equal(cfg.model, 'sonnet');
  assert.equal(cfg.updateEffort, 'low');
});
