// Dictation's mic tap (src/dictation/mic.ts): the mic's samples, posted every 50 ms. Stays on
// our origin because the CSP allows no blob scripts.
class DictateMic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 20);
    this.buf = new Float32Array(this.size);
    this.at = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const n = Math.min(ch.length - i, this.size - this.at);
      this.buf.set(ch.subarray(i, i + n), this.at);
      this.at += n;
      i += n;
      if (this.at === this.size) {
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(this.size);
        this.at = 0;
      }
    }
    return true;
  }
}
registerProcessor("dictate-mic", DictateMic);
