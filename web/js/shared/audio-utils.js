// Découpage de la parole (VAD par énergie) et encodage WAV, sans dépendance.
// Whisper transcrit des segments : on coupe aux pauses, on envoie phrase par phrase.

export const TARGET_RATE = 16000;

// Rééchantillonnage linéaire vers 16 kHz (le navigateur capte souvent en 48 kHz).
export function resample(input, fromRate, toRate = TARGET_RATE) {
  if (fromRate === toRate) return Float32Array.from(input);
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = pos - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

export function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / (frame.length || 1));
}

export function encodeWav(samples, rate = TARGET_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

// Détecteur de parole à seuil adaptatif. On lui pousse des trames de 20 ms à 16 kHz ;
// il appelle onSegment(samples, { final }) pour chaque morceau prêt à transcrire.
//
// Découpage, pour transcrire au fil de l'eau même si on parle longtemps sans s'arrêter :
//   - fin de prise de parole : pause d'au moins 850 ms (final: true) ;
//   - au-delà de 6 s de parole : coupe à la première respiration (pause de 250 ms) ;
//   - au-delà de 12 s sans respiration : coupe au moment le plus calme de la dernière seconde.
export class Vad {
  constructor({
    rate = TARGET_RATE,
    frameMs = 20,
    minThreshold = 0.012,
    noiseFactor = 3.2,
    startFrames = 3,
    endSilenceMs = 850,
    preRollMs = 300,
    minSpeechMs = 450,
    softMaxMs = 6000,
    breathMs = 250,
    hardMaxMs = 12000,
    cutSearchMs = 1200,
    onSegment = () => {},
    onSpeechStart = () => {},
  } = {}) {
    Object.assign(this, { rate, minThreshold, noiseFactor, startFrames, onSegment, onSpeechStart });
    const frames = (ms) => Math.ceil(ms / frameMs);
    this.frameSize = Math.round((rate * frameMs) / 1000);
    this.frameMs = frameMs;
    this.endFrames = frames(endSilenceMs);
    this.preRollFrames = frames(preRollMs);
    this.minSpeechFrames = frames(minSpeechMs);
    this.softFrames = frames(softMaxMs);
    this.breathFrames = frames(breathMs);
    this.hardFrames = frames(hardMaxMs);
    this.cutSearchFrames = frames(cutSearchMs);
    this.noise = minThreshold / noiseFactor;
    this.pending = new Float32Array(0);
    this.reset();
  }

  reset() {
    this.speaking = false;
    this.loudRun = 0;
    this.silentRun = 0;
    this.frames = [];
    this.levels = [];
    this.preRoll = [];
  }

  get threshold() {
    return Math.max(this.minThreshold, this.noise * this.noiseFactor);
  }

  // Accepte des échantillons de n'importe quelle longueur.
  push(samples) {
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending);
    merged.set(samples, this.pending.length);
    let off = 0;
    let level = 0;
    while (off + this.frameSize <= merged.length) {
      level = this.frame(merged.subarray(off, off + this.frameSize));
      off += this.frameSize;
    }
    this.pending = merged.slice(off);
    return level;
  }

  frame(frame) {
    const copy = Float32Array.from(frame);
    const level = rms(copy);
    const loud = level > this.threshold;
    if (!this.speaking) {
      // Le bruit de fond n'est appris que hors parole.
      this.noise = loud ? this.noise : this.noise * 0.95 + level * 0.05;
      this.preRoll.push({ f: copy, l: level });
      if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
      this.loudRun = loud ? this.loudRun + 1 : 0;
      if (this.loudRun >= this.startFrames) {
        this.speaking = true;
        this.frames = this.preRoll.map((p) => p.f);
        this.levels = this.preRoll.map((p) => p.l);
        this.preRoll = [];
        this.silentRun = 0;
        this.onSpeechStart();
      }
      return level;
    }
    this.frames.push(copy);
    this.levels.push(level);
    this.silentRun = loud ? 0 : this.silentRun + 1;

    if (this.silentRun >= this.endFrames) {
      this.flush();
    } else if (this.frames.length >= this.softFrames && this.silentRun >= this.breathFrames) {
      // Respiration après un long passage : on envoie ce morceau et on attend la suite.
      this.emit(this.frames, this.levels, false);
      this.reset();
    } else if (this.frames.length >= this.hardFrames) {
      // Pas de respiration : coupe au moment le plus calme de la dernière seconde.
      const from = this.frames.length - this.cutSearchFrames;
      let cut = from;
      for (let i = from; i < this.frames.length; i++) if (this.levels[i] < this.levels[cut]) cut = i;
      this.emit(this.frames.slice(0, cut), this.levels.slice(0, cut), false);
      this.frames = this.frames.slice(cut);
      this.levels = this.levels.slice(cut);
    }
    return level;
  }

  emit(frames, levels, final) {
    const threshold = this.threshold;
    const voiced = levels.filter((l) => l > threshold).length;
    if (voiced < this.minSpeechFrames) return;
    const out = new Float32Array(frames.length * this.frameSize);
    frames.forEach((f, i) => out.set(f, i * this.frameSize));
    this.onSegment(out, { final });
  }

  // Audio de la phrase en cours (pour une transcription provisoire), ou null.
  current(minMs = 1000) {
    if (!this.speaking || this.frames.length * this.frameMs < minMs) return null;
    const out = new Float32Array(this.frames.length * this.frameSize);
    this.frames.forEach((f, i) => out.set(f, i * this.frameSize));
    return out;
  }

  // Fin de prise de parole (ou arrêt du micro) : on envoie ce qui reste.
  flush() {
    if (this.speaking) {
      // On retire la queue de silence, en gardant un peu d'air.
      const keep = Math.max(0, this.frames.length - Math.max(0, this.silentRun - 10));
      this.emit(this.frames.slice(0, keep), this.levels.slice(0, keep), true);
    }
    this.reset();
  }
}
