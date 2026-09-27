// Transmet les échantillons du micro au fil principal, par paquets d'environ 40 ms.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.size = 0;
    this.target = Math.round(sampleRate * 0.04);
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      this.buffer.push(new Float32Array(channel));
      this.size += channel.length;
      if (this.size >= this.target) {
        const out = new Float32Array(this.size);
        let off = 0;
        for (const b of this.buffer) { out.set(b, off); off += b.length; }
        this.port.postMessage(out, [out.buffer]);
        this.buffer = [];
        this.size = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
