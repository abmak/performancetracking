// Chat sound effects — generated with the Web Audio API so no audio assets
// need to be shipped or downloaded. Sounds are tiny synthesized blips.

const MUTE_KEY = 'vas_chat_sound_muted';

let audioCtx = null;

function getContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  // Browsers suspend the context until a user gesture; resume on demand.
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

export function isChatSoundMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch (e) {
    return false;
  }
}

export function setChatSoundMuted(muted) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch (e) { /* ignore */ }
}

// Play a single tone with a soft attack/decay envelope.
function tone(ctx, { freq, start, duration, gain = 0.12, type = 'sine', sweepTo = null }) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, start + duration);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function play(builder) {
  if (isChatSoundMuted()) return;
  const ctx = getContext();
  if (!ctx) return;
  try {
    builder(ctx, ctx.currentTime);
  } catch (e) { /* never let audio break the chat */ }
}

// Outgoing message: short ascending two-tone "swoosh".
export function playSentSound() {
  play((ctx, now) => {
    tone(ctx, { freq: 660, sweepTo: 1180, start: now, duration: 0.11, gain: 0.09, type: 'triangle' });
    tone(ctx, { freq: 1320, start: now + 0.07, duration: 0.09, gain: 0.06, type: 'sine' });
  });
}

// Incoming message: gentle two-note "ding-dong" chime.
export function playIncomingSound() {
  play((ctx, now) => {
    tone(ctx, { freq: 988, start: now, duration: 0.16, gain: 0.13, type: 'sine' });
    tone(ctx, { freq: 740, start: now + 0.13, duration: 0.26, gain: 0.11, type: 'sine' });
  });
}

// Someone started typing: very soft single click-tick.
export function playTypingSound() {
  play((ctx, now) => {
    tone(ctx, { freq: 1500, sweepTo: 900, start: now, duration: 0.06, gain: 0.035, type: 'sine' });
  });
}

// A short preview used by the mute toggle so the user hears the change.
export function playSoundPreview() {
  play((ctx, now) => {
    tone(ctx, { freq: 880, start: now, duration: 0.12, gain: 0.1, type: 'sine' });
    tone(ctx, { freq: 1175, start: now + 0.1, duration: 0.16, gain: 0.09, type: 'sine' });
  });
}
