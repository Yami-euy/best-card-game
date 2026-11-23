// bgm.js — STARLIGHT DUEL background music, synthesized live with the
// Web Audio API. No audio files, no network: the whole track is a soft
// music-box arpeggio over a slow pad, built from oscillators. It starts
// on the first user gesture (browsers block audio before that) and loops
// forever across title, tutorial, duel and end screens until muted.
(function (root) {
  'use strict';

  var BPM = 76;                    // slow and calm
  var STEP = 60 / BPM / 2;         // eighth notes
  var MASTER = 0.14;               // quiet by design

  // C major pentatonic, music-box register. 0 = rest.
  var SCALE = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1318.51];
  var MELODY = [
    1, 0, 3, 0, 5, 0, 4, 0,
    3, 0, 2, 0, 1, 0, 0, 0,
    1, 0, 3, 0, 6, 0, 5, 0,
    4, 0, 3, 0, 2, 0, 1, 0,
  ];
  // Four-bar pad progression: Am7 — Fmaj7 — C — G.
  var PADS = [
    [220.00, 261.63, 329.63, 392.00],
    [174.61, 220.00, 261.63, 329.63],
    [261.63, 329.63, 392.00, 523.25],
    [196.00, 246.94, 293.66, 392.00],
  ];

  var ctx = null;
  var master = null;
  var timer = null;
  var nextTime = 0;
  var step = 0;
  var muted = false;

  function ensureCtx() {
    if (ctx) return true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER;
      master.connect(ctx.destination);
      nextTime = ctx.currentTime + 0.1;
      step = 0;
      return true;
    } catch (e) { return false; }
  }

  // One music-box note: a sine fundamental plus a faint 3rd harmonic,
  // struck fast and decaying slowly like a metal tine.
  function pluck(freq, when, vol) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.5);
    var o1 = ctx.createOscillator();
    o1.type = 'sine'; o1.frequency.value = freq;
    var o2 = ctx.createOscillator();
    o2.type = 'sine'; o2.frequency.value = freq * 3;
    var g2 = ctx.createGain(); g2.gain.value = 0.18;
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(master);
    o1.start(when); o2.start(when);
    o1.stop(when + 1.6); o2.stop(when + 1.6);
  }

  // One soft pad chord: triangle waves that swell in and fade out.
  function padChord(freqs, when, dur) {
    for (var i = 0; i < freqs.length; i++) {
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(0.028, when + 1.4);
      g.gain.setValueAtTime(0.028, when + dur - 1.4);
      g.gain.linearRampToValueAtTime(0.0001, when + dur);
      var o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = freqs[i];
      o.connect(g); g.connect(master);
      o.start(when); o.stop(when + dur + 0.05);
    }
  }

  function schedule() {
    if (!ctx) return;
    while (nextTime < ctx.currentTime + 0.6) {
      var deg = MELODY[step % MELODY.length];
      if (deg) pluck(SCALE[deg - 1], nextTime, 0.085);
      if (step % 16 === 0) {
        padChord(PADS[(step / 16) % PADS.length], nextTime, STEP * 16);
      }
      nextTime += STEP;
      step++;
    }
  }

  function start() {
    if (!ensureCtx()) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    if (!timer) timer = setInterval(schedule, 150);
    schedule();
    return true;
  }

  function setMuted(m) {
    muted = !!m;
    if (master && ctx) {
      master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.1);
    }
  }

  function state() {
    return {
      ctx: ctx ? ctx.state : 'none',
      playing: !!timer,
      muted: muted,
      step: step,
    };
  }

  root.StarBGM = { start: start, setMuted: setMuted, state: state };
})(window);
