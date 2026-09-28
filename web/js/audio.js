// Capture micro → découpage aux pauses → WAV 16 kHz prêt pour Whisper.

import { Vad, resample, encodeWav, TARGET_RATE } from './shared/audio-utils.js';

export class MicCapture {
  constructor({ onSegment, onLevel, onSpeechStart } = {}) {
    this.onSegment = onSegment || (() => {});
    this.onLevel = onLevel || (() => {});
    this.onSpeechStart = onSpeechStart || (() => {});
    this.active = false;
  }

  async start() {
    if (this.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'capture-processor');
    this.vad = new Vad({
      onSegment: (samples, info) => this.onSegment(encodeWav(samples, TARGET_RATE), samples.length / TARGET_RATE, info),
      onSpeechStart: () => this.onSpeechStart(),
    });
    const rate = this.ctx.sampleRate;
    this.node.port.onmessage = (e) => {
      const level = this.vad.push(resample(e.data, rate, TARGET_RATE));
      this.onLevel(Math.min(1, level / 0.12), this.vad.speaking);
    };
    this.source.connect(this.node);
    this.active = true;
  }

  get speaking() {
    return Boolean(this.active && this.vad.speaking);
  }

  // WAV du morceau en cours de parole (transcription provisoire), ou null.
  currentWav() {
    const samples = this.active ? this.vad.current() : null;
    return samples ? encodeWav(samples, TARGET_RATE) : null;
  }

  // Arrêter envoie ce qui était en cours de phrase.
  async stop() {
    if (!this.active) return;
    this.active = false;
    this.vad.flush();
    this.source.disconnect();
    this.node.port.onmessage = null;
    this.stream.getTracks().forEach((t) => t.stop());
    await this.ctx.close();
    this.onLevel(0, false);
  }
}
