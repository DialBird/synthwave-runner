// WebAudio によるプロシージャル効果音 + BGM ループ
// 効果音はアセットを持たず合成で鳴らす（チップチューン的な質感 / 低遅延 / 依存ゼロ）。
// 実音源は public/bgm.mp3 のみ。ブラウザの自動再生制約により、初回ユーザー操作で開始する。

let ctx = null;
let master = null;
let bgmBuffer = null;
let bgmSource = null;
let bgmGain = null;

export function initAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(ctx.destination);
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export async function loadBgm(url) {
  if (!ctx) initAudio();
  try {
    const res = await fetch(url);
    bgmBuffer = await ctx.decodeAudioData(await res.arrayBuffer());
  } catch {
    bgmBuffer = null; // BGM 欠損でも効果音だけで動かす
  }
}

export function startBgm() {
  if (!ctx || !bgmBuffer || bgmSource) return;
  bgmSource = ctx.createBufferSource();
  bgmSource.buffer = bgmBuffer;
  bgmSource.loop = true;
  bgmGain = ctx.createGain();
  bgmGain.gain.value = 0;
  bgmSource.connect(bgmGain).connect(master);
  bgmSource.start();
  bgmGain.gain.setTargetAtTime(0.5, ctx.currentTime, 0.8); // fade in
}

export function duckBgm(target, tc = 0.4) {
  if (bgmGain) bgmGain.gain.setTargetAtTime(target, ctx.currentTime, tc);
}

// ---------------------------------------------------------------- synth helpers
function tone({ type = 'square', f0, f1, dur = 0.12, gain = 0.3, attack = 0.005, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

function noise({ dur = 0.25, gain = 0.4, lpf0 = 1400, lpf1 = 200 }) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(lpf0, t);
  filt.frequency.exponentialRampToValueAtTime(lpf1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t);
}

// ---------------------------------------------------------------- sfx
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]; // メジャーペンタの半音オフセット

export const sfx = {
  // リング取得: コンボが上がるほど音階が上昇する（C5 起点）
  ring(combo = 1) {
    const semi = PENTA[Math.min(Math.max(combo - 1, 0), PENTA.length - 1)];
    const f = 523.25 * Math.pow(2, semi / 12);
    tone({ type: 'triangle', f0: f, f1: f * 1.5, dur: 0.13, gain: 0.3, attack: 0.004 });
    tone({ type: 'square', f0: f * 2, f1: f * 2, dur: 0.08, gain: 0.08 }); // きらめき
  },
  jump() {
    tone({ type: 'square', f0: 300, f1: 760, dur: 0.14, gain: 0.2, attack: 0.004 });
  },
  move() {
    tone({ type: 'square', f0: 520, f1: 360, dur: 0.05, gain: 0.08 });
  },
  crash() {
    noise({ dur: 0.28, gain: 0.45, lpf0: 1600, lpf1: 180 });
    tone({ type: 'sawtooth', f0: 150, f1: 42, dur: 0.3, gain: 0.32 }); // 低い衝撃
  },
  gameOver() {
    // 下降アルペジオ（パワーダウン）
    [0, 1, 2, 3].forEach((i) => {
      tone({ type: 'sawtooth', f0: 440 / Math.pow(1.18, i), dur: 0.22, gain: 0.22, delay: i * 0.12 });
    });
    tone({ type: 'triangle', f0: 220, f1: 55, dur: 0.9, gain: 0.18, delay: 0.5 });
  },
  clear() {
    // 上昇するメジャーアルペジオのファンファーレ（C E G C）
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone({ type: 'triangle', f0: f, dur: 0.5, gain: 0.26, delay: i * 0.1 });
      tone({ type: 'square', f0: f * 2, dur: 0.18, gain: 0.06, delay: i * 0.1 });
    });
    tone({ type: 'square', f0: 1046.5, dur: 0.7, gain: 0.12, delay: 0.42 });
  },
};
