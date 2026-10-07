/* Native-rate mono → continuous 16kHz frames. No samples leave the worklet when gated. */
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.mode = false; this.reset();
    this.port.onmessage = ({ data }) => { this.mode = data.enabled === true; this.reset(); };
  }
  reset() { this.last = 0; this.inputIndex = 0; this.next = 0; this.frame = new Float32Array(512); this.used = 0; }
  process(inputs) {
    const channels = inputs[0];
    if (!this.mode || !channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0; for (const channel of channels) value += channel[i] / channels.length;
      const index = this.inputIndex++;
      while (this.next <= index) {
        const fraction = this.next - (index - 1);
        this.frame[this.used++] = index === 0 ? value : this.last + Math.max(0, Math.min(1, fraction)) * (value - this.last);
        this.next += sampleRate / 16000;
        if (this.used === 512) { this.port.postMessage(this.frame, [this.frame.buffer]); this.frame = new Float32Array(512); this.used = 0; }
      }
      this.last = value;
    }
    return true;
  }
}
registerProcessor("voice-capture", VoiceCapture);
