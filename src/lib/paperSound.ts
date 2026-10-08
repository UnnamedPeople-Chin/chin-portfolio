/**
 * paperSound.ts
 *
 * Murni Web Audio API — tanpa file audio eksternal/mp3. Menghasilkan sound
 * effect gesekan lembaran kertas buku yang dibalik (paper flip / rustle).
 *
 * Prinsip: white noise buffer satu-kali → diputar lewat BiquadFilter
 * (bandpass yang frekuensinya di-sweep turun) + gain envelope serangan-
 * peluruhan yang natural (~200-300ms per suara).
 */

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

/** Ambil (atau buat sekali) AudioContext yang dipakai bersama seluruh sesi. */
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;

  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;

  ctx = new AC();
  return ctx;
}

/**
 * Buat satu buffer white noise stereo pendek (2 detik) yang akan dipotong
 * per-panggilan. Dibuat sekali lalu dipakai ulang → hemat alokasi.
 */
function getNoiseBuffer(audio: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;

  const length = Math.floor(audio.sampleRate * 2);
  const buf = audio.createBuffer(1, length, audio.sampleRate);
  const data = buf.getChannelData(0);

  // White noise murni + sedikit low-pass 1-pole supaya tidak terdengar
  // berisik digital kasar, melainkan mirip tekstur kertas.
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    // Low-pass sederhana: 0.7 dari nilai lama + 0.3 noise baru.
    last = last * 0.7 + white * 0.3;
    data[i] = last;
  }

  noiseBuffer = buf;
  return buf;
}

/**
 * Mainkan satu sound effect balikan kertas.
 *
 * @param intensity 0–1. 0 = bisik halus (lembar tipis), 1 = balikan mantap
 *                  (lembar tebal / karton). Mengontrol filter Q, durasi,
 *                  gain puncak, dan lebar sweep. Default 0.5.
 */
export function playPaperFlipSound(intensity = 0.5): void {
  const audio = getCtx();
  if (!audio) return;

  // AudioContext browser modern dibuat dalam state "suspended" sampai ada
  // interaksi pengguna. Resume setiap kali dipanggil agar selalu siaga.
  if (audio.state === "suspended") {
    void audio.resume();
  }

  const clamped = Math.max(0, Math.min(1, intensity));

  // Durasi dasar ~200–300ms, sedikit memanjang untuk flip tebal.
  const duration = 0.2 + clamped * 0.1;

  // --- Source: potongan noise ---
  const src = audio.createBufferSource();
  src.buffer = getNoiseBuffer(audio);
  src.loop = false;

  // Loop start dipilih acak supaya tiap balikan terdengar sedikit beda,
  // menghindari kesan "sample berulang".
  const totalLen = src.buffer.duration;
  const startOffset = Math.random() * (totalLen - duration);
  // playbackRate sedikit divariasikan (0.9–1.1) untuk variasi pitch halus.
  src.playbackRate.value = 0.9 + Math.random() * 0.2;

  // --- Filter 1: bandpass — karakter "swish" kertas ---
  const band = audio.createBiquadFilter();
  band.type = "bandpass";
  const startFreq = 2200 + clamped * 1400; // 2200–3600 Hz
  const endFreq = 700 + clamped * 400; // 700–1100 Hz (sweep turun)
  band.frequency.setValueAtTime(startFreq, audio.currentTime);
  band.frequency.exponentialRampToValueAtTime(
    endFreq,
    audio.currentTime + duration
  );
  // Q lebih tinggi untuk flip tebal (resonansi lebih fokus).
  band.Q.value = 0.8 + clamped * 1.6;

  // --- Filter 2: lowpass — membuang hiss di atas, makin natural ---
  const low = audio.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.setValueAtTime(5000, audio.currentTime);
  low.frequency.exponentialRampToValueAtTime(
    2400,
    audio.currentTime + duration
  );
  low.Q.value = 0.5;

  // --- Gain envelope: serangan cepat + peluruhan eksponensial ---
  // Bentuk "whoosh": volume naik cepat di awal (~15%) lalu turun landai.
  const peak = 0.18 + clamped * 0.22; // 0.18–0.40
  const gain = audio.createGain();
  const t0 = audio.currentTime;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + duration * 0.15);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  // --- Rantai: source → bandpass → lowpass → gain → output ---
  src.connect(band);
  band.connect(low);
  low.connect(gain);
  gain.connect(audio.destination);

  // Potong buffer sesuai durasi: main dari startOffset selama `duration`.
  src.start(t0, startOffset, duration);
  src.onended = () => {
    src.disconnect();
    band.disconnect();
    low.disconnect();
    gain.disconnect();
  };
}

/** Bebaskan AudioContext (mis. saat komponen unmount permanen). */
export function disposePaperSound(): void {
  if (ctx) {
    void ctx.close();
    ctx = null;
    noiseBuffer = null;
  }
}
