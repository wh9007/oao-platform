function encodeAudioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numChannels = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const interleaved = new Float32Array(length * numChannels);
  for (let ch = 0; ch < numChannels; ch++) {
    const channel = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      interleaved[i * numChannels + ch] = channel[i];
    }
  }
  const pcm16 = new Int16Array(interleaved.length);
  for (let i = 0; i < interleaved.length; i++) {
    const sample = Math.max(-1, Math.min(1, interleaved[i]));
    pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const dataSize = pcm16.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm16.buffer));
  return new Blob([buffer], { type: "audio/wav" });
}

export type PcmCaptureHandle = {
  stop: () => void;
  requestFlush: () => Promise<Blob | null>;
};

export function startPcmWavCapture(
  stream: MediaStream,
  options?: { minDurationSec?: number }
): PcmCaptureHandle {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new Error("当前浏览器不支持音频采集");

  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const buffers: Float32Array[] = [];
  const sampleRate = ctx.sampleRate;
  let stopped = false;

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    buffers.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };

  source.connect(processor);
  processor.connect(ctx.destination);
  void ctx.resume().catch(() => undefined);

  const requestFlush = async (): Promise<Blob | null> => {
    if (buffers.length === 0) return null;
    const totalLength = buffers.reduce((sum, chunk) => sum + chunk.length, 0);
    const minSamples = Math.floor(sampleRate * (options?.minDurationSec ?? 0.8));
    if (totalLength < minSamples) return null;

    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of buffers) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    buffers.length = 0;

    const offline = new OfflineAudioContext(1, merged.length, sampleRate);
    const audioBuffer = offline.createBuffer(1, merged.length, sampleRate);
    audioBuffer.copyToChannel(merged, 0);
    return encodeAudioBufferToWav(audioBuffer);
  };

  return {
    stop: () => {
      stopped = true;
      processor.disconnect();
      source.disconnect();
      buffers.length = 0;
      void ctx.close().catch(() => undefined);
    },
    requestFlush,
  };
}

export async function convertBlobToWav(sourceBlob: Blob): Promise<Blob> {
  if (sourceBlob.type.includes("wav")) return sourceBlob;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new Error("当前浏览器不支持音频解码");
  const audioCtx = new AudioCtx();
  try {
    const arrayBuffer = await sourceBlob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    return encodeAudioBufferToWav(audioBuffer);
  } finally {
    await audioCtx.close().catch(() => undefined);
  }
}

export function createAudioLevelMonitor(
  stream: MediaStream,
  onLevel: (level: number) => void
): () => void {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return () => undefined;

  const ctx = new AudioCtx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.75;
  const source = ctx.createMediaStreamSource(stream);
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    onLevel(sum / data.length / 255);
    raf = requestAnimationFrame(tick);
  };

  void ctx.resume().then(() => {
    raf = requestAnimationFrame(tick);
  });

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    source.disconnect();
    void ctx.close();
  };
}
