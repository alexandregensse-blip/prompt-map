import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vad, encodeWav, resample, rms } from '../web/js/shared/audio-utils.js';

const RATE = 16000;
function silence(ms, amp = 0.002) {
  const out = new Float32Array((RATE * ms) / 1000);
  let seed = 7;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 16807) % 2147483647;
    out[i] = ((seed / 2147483647) * 2 - 1) * amp;
  }
  return out;
}
function voice(ms, amp = 0.15) {
  const out = new Float32Array((RATE * ms) / 1000);
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * 220 * i) / RATE) * (0.6 + 0.4 * Math.sin(i / 400));
  return out;
}
function feed(vad, parts) {
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 640) vad.push(part.subarray(i, i + 640));
  }
}

test('WAV : en-tête PCM 16 bits mono', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000);
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), 8);
  assert.equal(view.getInt16(46, true), 32767);
  assert.equal(view.getInt16(48, true), -32768);
  assert.equal(wav.length, 52);
});

test('rééchantillonnage 48 kHz → 16 kHz', () => {
  const input = new Float32Array(48000).fill(0.5);
  const out = resample(input, 48000, 16000);
  assert.equal(out.length, 16000);
  assert.ok(Math.abs(rms(out) - 0.5) < 1e-6);
});

test('VAD : deux phrases séparées par une pause donnent deux segments', () => {
  const segments = [];
  const vad = new Vad({ onSegment: (s) => segments.push(s.length / RATE) });
  feed(vad, [silence(800), voice(1500), silence(1200), voice(2000), silence(1200)]);
  assert.equal(segments.length, 2);
  assert.ok(segments[0] > 1.5 && segments[0] < 2.6, `durée ${segments[0]}`);
  assert.ok(segments[1] > 2.0 && segments[1] < 3.1, `durée ${segments[1]}`);
});

test('VAD : une courte pause dans une phrase ne la coupe pas', () => {
  const segments = [];
  const vad = new Vad({ onSegment: (s) => segments.push(s) });
  feed(vad, [silence(500), voice(1000), silence(400), voice(1000), silence(1200)]);
  assert.equal(segments.length, 1);
});

test('VAD : un bruit bref est ignoré', () => {
  const segments = [];
  const vad = new Vad({ onSegment: (s) => segments.push(s) });
  feed(vad, [silence(600), voice(120), silence(1500)]);
  assert.equal(segments.length, 0);
});

// Parole continue avec de courtes respirations (300 ms) toutes les 2,5 s.
function monologue(seconds) {
  const parts = [silence(500)];
  for (let t = 0; t < seconds; t += 2.8) parts.push(voice(2500), silence(300));
  parts.push(silence(1200));
  return parts;
}

test('VAD : 30 s de parole avec respirations, découpées en morceaux de 6 à 9 s', () => {
  const segments = [];
  const vad = new Vad({ onSegment: (s, info) => segments.push({ d: s.length / RATE, final: info.final }) });
  feed(vad, monologue(30));
  assert.ok(segments.length >= 3 && segments.length <= 6, `${segments.length} morceaux`);
  for (const s of segments) assert.ok(s.d >= 5.5 && s.d <= 9.5, `morceau de ${s.d.toFixed(1)} s`);
  const total = segments.reduce((a, s) => a + s.d, 0);
  assert.ok(total > 27, `durée totale ${total.toFixed(1)} s`);
});

test('VAD : 30 s sans aucune pause, jamais plus de 12 s d’attente', () => {
  const segments = [];
  const vad = new Vad({ onSegment: (s) => segments.push(s.length / RATE) });
  feed(vad, [silence(500), voice(30000), silence(1200)]);
  assert.ok(segments.length >= 3, `${segments.length} morceaux`);
  for (const d of segments) assert.ok(d <= 12.1, `morceau de ${d.toFixed(1)} s`);
  const total = segments.reduce((a, d) => a + d, 0);
  assert.ok(Math.abs(total - 30.3) < 1.2, `durée totale ${total.toFixed(1)} s`);
});

test('VAD : audio de la phrase en cours disponible pour une transcription provisoire', () => {
  const vad = new Vad();
  feed(vad, [silence(500), voice(500)]);
  assert.equal(vad.current(), null, 'moins d’une seconde : rien');
  feed(vad, [voice(1500)]);
  const cur = vad.current();
  assert.ok(cur && cur.length / RATE > 1.8);
});

test('VAD : arrêter le micro envoie la phrase en cours', () => {
  const segments = [];
  const vad = new Vad({ onSegment: (s) => segments.push(s) });
  feed(vad, [silence(500), voice(1200)]);
  assert.equal(segments.length, 0);
  vad.flush();
  assert.equal(segments.length, 1);
});
