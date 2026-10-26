// WAV files: writing audio out (exports, recordings in the projects folder) and reading back
// the ones we wrote.
//
//   encodeWav([left, right], 44100, 16)   // 16-bit: an export anyone can play
//   encodeWav([mono], 48000, 32)           // 32-bit float: a recording, exactly as captured
//   decodeWav(bytes)                       // → { channels, sampleRate } (PCM 16 / float 32)

export function encodeWav(channels: Float32Array[], sampleRate: number, bits: 16 | 32 = 16): ArrayBuffer {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = bits / 8;
  const dataBytes = frames * count * bytesPerSample;
  const out = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(out);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, bits === 32 ? 3 : 1, true); // 3: IEEE float, 1: PCM
  v.setUint16(22, count, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * count * bytesPerSample, true);
  v.setUint16(32, count * bytesPerSample, true);
  v.setUint16(34, bits, true);
  text(36, 'data');
  v.setUint32(40, dataBytes, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const s = channels[c][i];
      if (bits === 32) v.setFloat32(at, s, true);
      else v.setInt16(at, Math.max(-1, Math.min(1, s)) * 0x7fff, true);
      at += bytesPerSample;
    }
  }
  return out;
}

export function decodeWav(bytes: ArrayBuffer): { channels: Float32Array[]; sampleRate: number } {
  const v = new DataView(bytes);
  let format = 1, count = 1, sampleRate = 44100, bits = 16;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
    const size = v.getUint32(at + 4, true);
    if (id === 'fmt ') {
      format = v.getUint16(at + 8, true);
      count = v.getUint16(at + 10, true);
      sampleRate = v.getUint32(at + 12, true);
      bits = v.getUint16(at + 22, true);
    } else if (id === 'data') {
      const bytesPerSample = bits / 8;
      const frames = Math.floor(Math.min(size, bytes.byteLength - at - 8) / (bytesPerSample * count));
      const channels = Array.from({ length: count }, () => new Float32Array(frames));
      let p = at + 8;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < count; c++) {
          channels[c][i] = format === 3 ? v.getFloat32(p, true) : v.getInt16(p, true) / 0x8000;
          p += bytesPerSample;
        }
      }
      return { channels, sampleRate };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('no audio data in this WAV file');
}
