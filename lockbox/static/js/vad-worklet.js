// AudioWorklet: slices the mic stream into 20 ms frames and posts each with its RMS.
// Runs off the main thread so the face never stutters while listening.

class VadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = Math.round(sampleRate * 0.02);
    this.buf = new Float32Array(this.frameSize);
    this.fill = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.buf[this.fill++] = channel[i];
      if (this.fill === this.frameSize) {
        let sum = 0;
        for (let j = 0; j < this.frameSize; j++) sum += this.buf[j] * this.buf[j];
        const frame = this.buf.slice();
        this.port.postMessage({ rms: Math.sqrt(sum / this.frameSize), frame }, [frame.buffer]);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor("vad", VadProcessor);
