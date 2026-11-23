// shots.mjs — screenshot + play-test driver for STARLIGHT DUEL (Node 24,
// no dependencies). Talks to the headless Chromium shell over CDP with the
// built-in WebSocket client: navigates, clicks the real DOM, collects
// console errors, and captures JPEG screenshots.
//
// Usage:
//   node shots.mjs shots   — take 01-table, 02-title, 03-win, 04-loss
//   node shots.mjs play    — auto-play one full 2-player match (win run)
//   node shots.mjs idle    — never play: the AI must win on its own
//   node shots.mjs play3   — auto-play a 3-player match for a few turns
//   node shots.mjs play4   — auto-play a 4-player match for a few turns
//   node shots.mjs states  — verify hand states + the 4 action animations
// Serve game/ first (python3 -m http.server 8080 --directory game), with
// the shell on --remote-debugging-port=9222.
import { writeFileSync } from 'node:fs';

const SHELL = 'http://127.0.0.1:9222';
const BASE = 'http://127.0.0.1:8080';
const SHOTS = [
  ['01-table.jpg', '?shot=table&mode=2&seed=7'],
  ['02-title.jpg', '?shot=title&mode=2&seed=7'],
  ['03-win.jpg', '?shot=win&mode=2&seed=7'],
  ['04-loss.jpg', '?shot=loss&mode=2&seed=7'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connectTarget() {
  const list = await (await fetch(SHELL + '/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method) events.push(d);
  };
  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  return { ws, send, events };
}

async function evalJs(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result && r.result.result ? r.result.result.value : undefined;
}

async function shot(send, url, file) {
  await send('Page.navigate', { url });
  await sleep(1200);
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
  writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('shot:', file);
}

function countErrors(events) {
  return events.filter((e) =>
    (e.method === 'Runtime.exceptionThrown') ||
    (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
}

async function startMode(send, mode, seed) {
  await send('Page.navigate', { url: BASE + '/?seed=' + seed + '&mode=' + mode });
  await sleep(1000);
  await evalJs(send, `document.querySelector('.mode-btn[data-mode="${mode}"]').click(); 'started'`);
  await sleep(500);
  // First mode pick in a session shows the tutorial — skip it for drivers.
  const tut = await evalJs(send, `document.querySelector('.tut-card') !== null`);
  if (tut) {
    await evalJs(send, `document.querySelector('.tut-skip').click(); 'skipped'`);
    await sleep(500);
  }
}

async function readState(send) {
  return evalJs(send, `(() => { const s = window.__star.getState(); if (!s) return null;
    return { phase: s.phase, turn: s.turn, current: s.current, mode: s.mode,
      sides: s.sides.map(x => ({ id: x.id, life: x.life, mana: x.mana, alive: x.alive,
        hand: x.hand.map(c => c.defId), table: x.table.map(c => c.defId + ':' + c.canAttack) })) };
  })()`);
}

async function playOneTurn(send) {
  // Smart play: no-target cards first, then targeted tools (buff own
  // strongest, break the strongest enemy creature, meteor the weakest
  // face), then attack the weakest enemy creature (or the weakest face).
  const r = await evalJs(send, `(() => {
    const click = (sel) => { const e = document.querySelector(sel); if (e) { e.click(); return true; } return false; };
    let played = 0, attacked = 0;
    const s = window.__star.getState();
    const me = s.sides[0];
    for (const c of [...me.hand]) {
      if (c.target === 'none' && c.cost <= me.mana && (c.kind !== 'creature' || me.table.length < 5)) {
        if (click('.hand-row .card[data-uid="' + c.uid + '"]')) played++;
      }
    }
    const s2 = window.__star.getState(); const me2 = s2.sides[0];
    for (const c of [...me2.hand]) {
      if (c.target === 'allyCrew' && me2.table.length) {
        const t = me2.table.reduce((a, b) => a.attack >= b.attack ? a : b);
        if (click('.hand-row .card[data-uid="' + c.uid + '"]')) {
          click('.lane-p1 .table-row .card[data-uid="' + t.uid + '"]'); played++;
        }
      } else if (c.target === 'enemyCrew') {
        let best = null, bestSide = -1;
        s2.sides.slice(1).forEach((f, fi) => { if (!f.alive) return;
          f.table.forEach((tc) => { if (!best || tc.attack > best.attack) { best = tc; bestSide = fi + 1; } }); });
        if (best && click('.hand-row .card[data-uid="' + c.uid + '"]')) {
          click('.lane-p' + (bestSide + 1) + ' .table-row .card[data-uid="' + best.uid + '"]'); played++;
        }
      } else if (c.target === 'enemyFace') {
        const foes = s2.sides.slice(1).filter((x) => x.alive);
        if (!foes.length) continue;
        const low = foes.reduce((a, b) => a.life <= b.life ? a : b);
        if (click('.hand-row .card[data-uid="' + c.uid + '"]')) {
          click('.lane-p' + (s2.sides.indexOf(low) + 1) + ' .side-face'); played++;
        }
      }
    }
    const s3 = window.__star.getState(); const me3 = s3.sides[0];
    for (const c of [...me3.table]) {
      if (window.__star.getState().phase !== 'player') break; // game may end mid-turn
      if (!c.canAttack) continue;
      click('.lane-p1 .table-row .card[data-uid="' + c.uid + '"]');
      const s4 = window.__star.getState();
      let vic = null, vSide = -1;
      s4.sides.slice(1).forEach((f, fi) => { if (!f.alive) return;
        f.table.forEach((tc) => { if (!vic || tc.hp < vic.hp) { vic = tc; vSide = fi + 1; } }); });
      if (vic) click('.lane-p' + (vSide + 1) + ' .table-row .card[data-uid="' + vic.uid + '"]');
      else {
        const foes = s4.sides.slice(1).filter((x) => x.alive);
        if (!foes.length) break;
        const low = foes.reduce((a, b) => a.life <= b.life ? a : b);
        click('.lane-p' + (s4.sides.indexOf(low) + 1) + ' .side-face');
      }
      attacked++;
    }
    return { played, attacked };
  })()`);
  await sleep(300);
  await evalJs(send, `document.querySelector('.end-turn').click(); 'ended'`);
  await sleep(900);
  return r;
}

async function main() {
  const mode = process.argv[2] || 'shots';
  const { ws, send, events } = await connectTarget();
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  if (mode === 'shots') {
    for (const [file, q] of SHOTS) await shot(send, BASE + '/' + q, 'screenshots/' + file);
  } else if (mode === 'play' || mode === 'idle' || mode === 'play3' || mode === 'play4') {
    const m = mode === 'play3' ? 3 : mode === 'play4' ? 4 : 2;
    const seed = mode === 'idle' ? 23 : Number(process.argv[3] || '11');
    const maxTurns = (m === 2 && mode !== 'idle') ? 60 : 14;
    await startMode(send, m, seed);
    let outcome = 'unfinished';
    for (let turn = 0; turn < maxTurns; turn++) {
      const st = await readState(send);
      if (!st) throw new Error('no game state');
      console.log('turn', st.turn, st.phase, 'cur', st.current,
        'life', st.sides.map(s => s.id + ':' + s.life + (s.alive ? '' : '(out)')).join(' '),
        'hand', st.sides[0].hand.join(','), 'table', st.sides[0].table.join(','));
      if (st.phase === 'won' || st.phase === 'lost') { outcome = st.phase; break; }
      if (st.phase !== 'player') { await sleep(700); continue; }
      if (mode === 'idle') {
        await evalJs(send, `document.querySelector('.end-turn').click(); 'ended'`);
        await sleep(900);
      } else {
        const r = await playOneTurn(send);
        console.log('  played', r.played, 'attacked', r.attacked);
      }
    }
    const st2 = await readState(send);
    console.log('OUTCOME:', outcome, st2 ? ('phase=' + st2.phase + ' turn=' + st2.turn) : '');
    const errs = countErrors(events);
    console.log('console errors/exceptions:', errs.length);
    errs.slice(0, 5).forEach((e) => console.log(JSON.stringify(e.params).slice(0, 400)));
  } else if (mode === 'states') {
    await startMode(send, 2, 11);
    const check = (name, ok, extra) => console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : ''));
    // 1) AI flip reveal: end the first turn; the AI's opening hand always
    // has a creature, and it flips in with a purple swirl when played.
    await evalJs(send, `document.querySelector('.end-turn').click(); 'ended'`);
    let flipSeen = false;
    for (let i = 0; i < 20; i++) {
      const f = await evalJs(send, `document.querySelector('.card.flip-in') !== null`);
      if (f) { flipSeen = true; break; }
      await sleep(150);
    }
    check('ai-flip-reveal', flipSeen, '');
    // Wait for the player turn to start again.
    for (let i = 0; i < 20; i++) {
      const ph = await evalJs(send, `window.__star.getState().phase`);
      if (ph === 'player') break;
      await sleep(300);
    }
    // 2) Hover: move the mouse away first (CDP mouse position persists),
    // then over a hand card — its transform must change.
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 20 });
    await sleep(250);
    const hov = await evalJs(send, `(() => {
      const card = document.querySelector('.hand-row .card');
      if (!card) return null;
      const before = getComputedStyle(card).transform;
      const r = card.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, before };
    })()`);
    if (hov) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hov.x, y: hov.y });
      await sleep(350);
      const after = await evalJs(send, `getComputedStyle(document.querySelector('.hand-row .card')).transform`);
      check('hover-raise', after !== hov.before, 'transform ' + hov.before + ' -> ' + after);
    } else check('hover-raise', false, 'no hand card');
    // 3) Select + target reticle: click a targeted card (tool/loot with a
    // target) — the big preview appears AND the legal targets glow red
    // with a reticle. Retry over a few turns if the hand has none.
    let sel = null, previewOn = false, tgtCount = 0;
    for (let attempt = 0; attempt < 3 && sel === null; attempt++) {
      sel = await evalJs(send, `(() => {
        const s = window.__star.getState();
        if (s.phase !== 'player') return null;
        const c = s.sides[0].hand.find(x => x.target !== 'none' && x.cost <= s.sides[0].mana);
        if (!c) return null;
        const el = document.querySelector('.hand-row .card[data-uid="' + c.uid + '"]');
        if (!el) return null;
        el.click();
        return c.defId;
      })()`);
      if (sel) {
        await sleep(300);
        previewOn = await evalJs(send, `document.getElementById('preview').classList.contains('on')`);
        tgtCount = await evalJs(send, `document.querySelectorAll('.targetable').length`);
      } else {
        await evalJs(send, `document.querySelector('.end-turn').click(); 'ended'`);
        for (let i = 0; i < 20; i++) {
          const ph = await evalJs(send, `window.__star.getState().phase`);
          if (ph === 'player') break;
          await sleep(300);
        }
      }
    }
    check('select-preview', sel !== null && previewOn === true, 'card=' + sel + ' previewOn=' + previewOn);
    check('target-reticle', sel !== null && tgtCount > 0, 'targetable=' + tgtCount);
    await evalJs(send, `document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})); 'esc'`);
    await sleep(200);
    // 4) Cast burst: play a no-target loot/tool, particles must appear.
    // Retry over a few turns if the hand has none.
    let cast = null, burst = 0;
    for (let attempt = 0; attempt < 3 && cast === null; attempt++) {
      cast = await evalJs(send, `(() => {
        const s = window.__star.getState();
        if (s.phase !== 'player') return null;
        const c = s.sides[0].hand.find(x => x.target === 'none' && x.kind !== 'creature' && x.cost <= s.sides[0].mana);
        if (!c) return null;
        const el = document.querySelector('.hand-row .card[data-uid="' + c.uid + '"]');
        if (!el) return null;
        el.click();
        return c.defId;
      })()`);
      if (cast) {
        await sleep(150);
        burst = await evalJs(send, `document.querySelectorAll('#fx-layer .fx-particle').length`);
      } else {
        await evalJs(send, `document.querySelector('.end-turn').click(); 'ended'`);
        for (let i = 0; i < 20; i++) {
          const ph = await evalJs(send, `window.__star.getState().phase`);
          if (ph === 'player') break;
          await sleep(300);
        }
      }
    }
    check('cast-burst', cast !== null && burst > 0, 'card=' + cast + ' particles=' + burst);
    await sleep(800);
    // 5) Slide play: play a creature, it must slide into its table slot.
    let slide = false, slideCard = null;
    for (let attempt = 0; attempt < 3 && !slide; attempt++) {
      slideCard = await evalJs(send, `(() => {
        const s = window.__star.getState();
        if (s.phase !== 'player') return null;
        const c = s.sides[0].hand.find(x => x.kind === 'creature' && x.cost <= s.sides[0].mana && s.sides[0].table.length < 5);
        if (!c) return null;
        const el = document.querySelector('.hand-row .card[data-uid="' + c.uid + '"]');
        if (!el) return null;
        el.click();
        return c.defId;
      })()`);
      if (slideCard) {
        await sleep(150);
        slide = await evalJs(send, `document.querySelector('.card.slide-in') !== null`);
      } else {
        await evalJs(send, `document.querySelector('.end-turn').click(); 'ended'`);
        for (let i = 0; i < 20; i++) {
          const ph = await evalJs(send, `window.__star.getState().phase`);
          if (ph === 'player') break;
          await sleep(300);
        }
      }
    }
    check('slide-play', slide, 'card=' + slideCard);
    // 6) Draw fly: end the turn; on the next player turn the drawn card flies in.
    await evalJs(send, `document.querySelector('.end-turn').click(); 'ended'`);
    let fly = false;
    for (let i = 0; i < 10; i++) {
      fly = await evalJs(send, `document.querySelector('.card.draw-fly') !== null`);
      if (fly) break;
      await sleep(400);
    }
    check('draw-fly', fly === true, '');
    const errs = countErrors(events);
    console.log('console errors/exceptions:', errs.length);
    errs.slice(0, 5).forEach((e) => console.log(JSON.stringify(e.params).slice(0, 400)));
  } else if (mode === 'fixtest') {
    // (a) tutorial full walkthrough: 5x LANJUT + MULAI DUEL -> duel runs.
    const check = (name, ok, extra) => console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : ''));
    await send('Page.navigate', { url: BASE + '/?seed=11&mode=2' });
    await sleep(900);
    await evalJs(send, `document.querySelector('.mode-btn[data-mode="2"]').click(); 'm2'`);
    await sleep(400);
    check('a-tut-opens', await evalJs(send, `document.querySelector('.tut-card') !== null`) === true);
    for (let i = 0; i < 5; i++) {
      await evalJs(send, `document.querySelector('.tut-nav .tut-btn-nav:not(.ghost)').click(); 'next'`);
      await sleep(250);
    }
    const lastBtn = await evalJs(send, `(() => { const b = document.querySelector('.tut-nav .tut-btn-nav:not(.ghost)'); const t = b.textContent; b.click(); return t; })()`);
    await sleep(500);
    const stA = await readState(send);
    check('a-tut-full-to-duel', stA && stA.phase === 'player' && await evalJs(send, `document.querySelector('.tut-card') === null`), 'phase=' + (stA && stA.phase) + ' lastBtn=' + lastBtn);
    check('a-tut-seen', await evalJs(send, `window.__star.getTutorialSeen()`) === true);
    // (b) LEWATI -> duel at once.
    await send('Page.navigate', { url: BASE + '/?seed=11&mode=2' });
    await sleep(900);
    await evalJs(send, `document.querySelector('.mode-btn[data-mode="2"]').click(); 'm2'`);
    await sleep(400);
    await evalJs(send, `document.querySelector('.tut-skip').click(); 'skip'`);
    await sleep(400);
    const stB = await readState(send);
    check('b-skip-to-duel', stB && stB.phase === 'player', 'phase=' + (stB && stB.phase));
    // (c) TUTORIAL button on title -> open -> TUTUP -> title back.
    await send('Page.navigate', { url: BASE + '/?seed=11&mode=2' });
    await sleep(900);
    await evalJs(send, `document.querySelector('.tut-btn').click(); 'tut'`);
    await sleep(400);
    const tutC = await evalJs(send, `document.querySelector('.tut-card') !== null`);
    await evalJs(send, `document.querySelector('.tut-skip').click(); 'close'`);
    await sleep(400);
    check('c-tut-button-reopen', tutC === true && await evalJs(send, `document.querySelector('.title-card') !== null`) === true);
    // (g) BGM started after the mode click.
    const bgmG = await evalJs(send, `window.__star.bgmState()`);
    check('g-bgm-started', bgmG && bgmG.playing === true, JSON.stringify(bgmG));
    // (h) SUARA toggles BGM off and on.
    await evalJs(send, `document.getElementById('mute-btn').click(); 'mute'`);
    await sleep(200);
    const bgmH1 = await evalJs(send, `window.__star.bgmState()`);
    const lblH1 = await evalJs(send, `document.getElementById('mute-btn').textContent`);
    await evalJs(send, `document.getElementById('mute-btn').click(); 'unmute'`);
    await sleep(200);
    const bgmH2 = await evalJs(send, `window.__star.bgmState()`);
    const lblH2 = await evalJs(send, `document.getElementById('mute-btn').textContent`);
    check('h-mute-toggles', bgmH1 && bgmH1.muted === true && lblH1 === 'SUARA OFF' && bgmH2 && bgmH2.muted === false && lblH2 === 'SUARA ON', JSON.stringify(bgmH1) + '/' + lblH1 + ' -> ' + JSON.stringify(bgmH2) + '/' + lblH2);
    // (d) EXIT -> confirm -> YA -> title, clean state, no stale AI after 2s.
    await evalJs(send, `document.querySelector('.mode-btn[data-mode="2"]').click(); 'm2'`);
    await sleep(600);
    const exitVis = await evalJs(send, `getComputedStyle(document.getElementById('exit-btn')).display !== 'none'`);
    await evalJs(send, `document.getElementById('exit-btn').click(); 'exit'`);
    await sleep(300);
    const confD = await evalJs(send, `document.getElementById('confirm').classList.contains('on')`);
    await evalJs(send, `document.querySelector('.confirm-yes').click(); 'yes'`);
    await sleep(600);
    const stD = await readState(send);
    check('d-exit-to-title', exitVis === true && confD === true && await evalJs(send, `document.querySelector('.title-card') !== null`) === true && stD && stD.sides[0].life === 20 && stD.turn === 1, 'life=' + (stD && stD.sides[0].life) + ' turn=' + (stD && stD.turn));
    await sleep(2000);
    const stD2 = await readState(send);
    check('d-no-stale-ai', stD2 && stD2.phase === 'player' && stD2.turn === 1, 'phase=' + (stD2 && stD2.phase) + ' turn=' + (stD2 && stD2.turn));
    // (e) EXIT -> LANJUT MAIN -> duel continues.
    await evalJs(send, `document.querySelector('.mode-btn[data-mode="2"]').click(); 'm2'`);
    await sleep(600);
    await evalJs(send, `document.getElementById('exit-btn').click(); 'exit'`);
    await sleep(300);
    await evalJs(send, `document.querySelector('.confirm-no').click(); 'no'`);
    await sleep(300);
    const stE = await readState(send);
    check('e-exit-cancel', stE && stE.phase === 'player' && await evalJs(send, `document.getElementById('confirm').classList.contains('on')`) === false, 'phase=' + (stE && stE.phase));
    // (f) 3P and 4P: play a turn (AI runs), exit mid-flow, state clean, no stale AI.
    for (const m of [3, 4]) {
      await send('Page.navigate', { url: BASE + '/?seed=11&mode=' + m });
      await sleep(900);
      await evalJs(send, `document.querySelector('.mode-btn[data-mode="${m}"]').click(); 'm${m}'`);
      await sleep(400);
      if (await evalJs(send, `document.querySelector('.tut-card') !== null`)) {
        await evalJs(send, `document.querySelector('.tut-skip').click(); 'skip'`);
        await sleep(400);
      }
      await playOneTurn(send);
      await evalJs(send, `document.getElementById('exit-btn').click(); 'exit'`);
      await sleep(300);
      await evalJs(send, `document.querySelector('.confirm-yes').click(); 'yes'`);
      await sleep(600);
      const stF = await readState(send);
      await sleep(2000);
      const stF2 = await readState(send);
      check('f-exit-clean-' + m + 'p', stF && stF.sides[0].life === 20 && stF.turn === 1 && stF2 && stF2.turn === 1 && stF2.phase === 'player', 'after turn=' + (stF2 && stF2.turn));
    }
    // (i) BGM still playing after exit + re-enter.
    const bgmI = await evalJs(send, `window.__star.bgmState()`);
    check('i-bgm-survives-exit', bgmI && bgmI.playing === true, JSON.stringify(bgmI));
    const errs = countErrors(events);
    console.log('console errors/exceptions:', errs.length);
    errs.slice(0, 5).forEach((e) => console.log(JSON.stringify(e.params).slice(0, 400)));
  } else if (mode === 'fix3') {
    // FIX-3 checks: (1) new title + how strips on paper, (2) parchment
    // tutorial, (3) VICTORY/DEFEAT, (4) cancel paths, (g/h/i) play hands.
    const check = (name, ok, extra) => console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : ''));
    const uiClear = async () => evalJs(send, `(() => { const u = window.__star.ui;
      return u.selectedTool === null && u.selectedAttacker === null && u.selectedHand === null &&
        !document.getElementById('preview').classList.contains('on'); })()`);
    const selectTargeted = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const sel = await evalJs(send, `(() => {
          const s = window.__star.getState();
          if (!s || s.phase !== 'player') return null;
          const c = s.sides[0].hand.find(x => x.target !== 'none' && x.cost <= s.sides[0].mana);
          if (!c) return null;
          const el = document.querySelector('.hand-row .card[data-uid="' + c.uid + '"]');
          if (!el) return null;
          el.click();
          return { def: c.defId, uid: c.uid };
        })()`);
        if (sel) return sel;
        await evalJs(send, `document.querySelector('.end-turn').click(); 'ended'`);
        for (let i = 0; i < 20; i++) {
          if (await evalJs(send, `window.__star.getState().phase`) === 'player') break;
          await sleep(300);
        }
      }
      return null;
    };
    // (1) New title: art box, ribbon title, 5 paper panels with 6 strips.
    await send('Page.navigate', { url: BASE + '/?seed=11&mode=2' });
    await sleep(900);
    const t1 = await evalJs(send, `(() => {
      const art = document.querySelector('.title-art');
      if (!art) return null;
      return { name: (document.querySelector('.title-name') || {}).textContent,
        panels: document.querySelectorAll('.panel-note').length,
        strips: document.querySelectorAll('.panel-note .how-img').length,
        modes: document.querySelectorAll('.mode-btn').length,
        tut: document.querySelector('.tut-btn') !== null,
        bg: getComputedStyle(art).backgroundImage.slice(0, 30) };
    })()`);
    check('t1-title-v2', !!t1 && t1.name === 'STARLIGHT DUEL' && t1.panels === 5 && t1.strips === 6 && t1.modes === 3 && t1.tut, JSON.stringify(t1));
    // (2) Parchment tutorial: open, check dark ink on paper, walk through.
    await evalJs(send, `document.querySelector('.tut-btn').click(); 'tut'`);
    await sleep(400);
    const tutInk = await evalJs(send, `getComputedStyle(document.querySelector('.tut-text')).color`);
    check('t2-tut-parchment', tutInk === 'rgb(59, 37, 3)', 'ink=' + tutInk);
    for (let i = 0; i < 5; i++) {
      await evalJs(send, `document.querySelector('.tut-nav .tut-btn-nav:not(.ghost)').click(); 'next'`);
      await sleep(200);
    }
    await evalJs(send, `document.querySelector('.tut-nav .tut-btn-nav:not(.ghost)').click(); 'start'`);
    await sleep(500);
    check('t2-tut-to-duel', (await readState(send) || {}).phase === 'player');
    // (4) Cancel paths, each from a fresh selection.
    const sel1 = await selectTargeted();
    check('t4-has-targeted-card', sel1 !== null, 'card=' + (sel1 && sel1.def));
    if (sel1) {
      const batalVis = await evalJs(send, `(() => { const b = document.querySelector('.preview-cancel');
        return b && getComputedStyle(b).display !== 'none' && b.offsetParent !== null; })()`);
      await evalJs(send, `document.querySelector('.preview-cancel').click(); 'batal'`);
      await sleep(200);
      check('t4-cancel-batal-btn', batalVis === true && await uiClear() === true);
      const sel2 = await selectTargeted();
      await evalJs(send, `document.querySelector('.hand-row .card[data-uid="${sel2.uid}"]').click(); 'same'`);
      await sleep(200);
      check('t4-cancel-same-card', await uiClear() === true);
      const sel3 = await selectTargeted();
      await evalJs(send, `(() => { const s = document.querySelector('.slot-empty'); if (s) s.click(); return !!s; })()`);
      await sleep(200);
      check('t4-cancel-empty-area', await uiClear() === true);
      const sel4 = await selectTargeted();
      await evalJs(send, `document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})); 'esc'`);
      await sleep(200);
      check('t4-cancel-esc', await uiClear() === true);
      // Select again, then switch to another card and play it.
      const sel5 = await selectTargeted();
      const switched = await evalJs(send, `(() => {
        const s = window.__star.getState();
        const other = s.sides[0].hand.find(x => x.uid !== '${sel5.uid}' && x.target !== 'none' && x.cost <= s.sides[0].mana);
        if (!other) return null;
        document.querySelector('.hand-row .card[data-uid="' + other.uid + '"]').click();
        return { def: other.defId, sel: window.__star.ui.selectedTool ? window.__star.ui.selectedTool.defId : null,
          prev: window.__star.ui.selectedTool ? window.__star.ui.selectedTool.uid : null };
      })()`);
      check('t4-switch-card', switched !== null && switched.sel === switched.def, JSON.stringify(switched));
      await evalJs(send, `(() => { const b = document.querySelector('.preview-cancel'); if (b) b.click(); return !!b; })()`);
      await sleep(200);
      check('t4-cancel-after-switch', await uiClear() === true);
    }
    // (g) Player hand: play a creature, the hand sprite must appear mid-flight.
    let handMe = false, handGone = false;
    for (let attempt = 0; attempt < 3 && !handMe; attempt++) {
      const played = await evalJs(send, `(() => {
        const s = window.__star.getState();
        if (!s || s.phase !== 'player') return null;
        const c = s.sides[0].hand.find(x => x.kind === 'creature' && x.target === 'none' && x.cost <= s.sides[0].mana && s.sides[0].table.length < 5);
        if (!c) return null;
        document.querySelector('.hand-row .card[data-uid="' + c.uid + '"]').click();
        return c.defId;
      })()`);
      if (played) {
        await sleep(200);
        handMe = await evalJs(send, `(() => { const h = document.querySelector('.play-hand.hand-me');
          return !!h && h.src.indexOf('hand-player.png') >= 0; })()`);
        await sleep(800);
        handGone = await evalJs(send, `document.querySelector('.play-hand') === null`);
      } else {
        await evalJs(send, `document.querySelector('.end-turn').click(); 'ended'`);
        for (let i = 0; i < 20; i++) {
          if (await evalJs(send, `window.__star.getState().phase`) === 'player') break;
          await sleep(300);
        }
      }
    }
    check('g-hand-player', handMe === true, 'appeared=' + handMe);
    check('g-hand-removed', handGone === true);
    // (h) Opponent hand: end the turn, watch the AI turn for a foe hand.
    await evalJs(send, `document.querySelector('.end-turn').click(); 'ended'`);
    let handFoe = false;
    for (let i = 0; i < 40 && !handFoe; i++) {
      handFoe = await evalJs(send, `(() => { const h = document.querySelector('.play-hand.hand-foe');
        return !!h && h.src.indexOf('hand-opponent.png') >= 0; })()`);
      if (!handFoe) await sleep(200);
    }
    check('h-hand-opponent', handFoe === true);
    // (i) The hand sprite itself can never block a click: its layer and
    // the sprite are pointer-events:none by construction. Probe directly
    // instead of depending on a table card surviving the AI turn.
    await sleep(1000);
    const under = await evalJs(send, `(() => {
      const gone = document.querySelector('.play-hand') === null;
      const probe = document.createElement('img');
      probe.className = 'play-hand hand-me';
      document.getElementById('fx-layer').appendChild(probe);
      const pe = getComputedStyle(probe).pointerEvents;
      probe.remove();
      return gone && pe === 'none' ? 'card' : 'gone=' + gone + ' pe=' + pe;
    })()`);
    check('i-hand-not-blocking', under === 'card', 'under=' + under);
    // (3) End screens: VICTORY + MAIN LAGI starts a new match; DEFEAT + KE TITLE.
    await send('Page.navigate', { url: BASE + '/?shot=win&mode=2&seed=7' });
    await sleep(900);
    const winWord = await evalJs(send, `(() => { const w = document.querySelector('.end-word');
      return w ? w.textContent : null; })()`);
    const winBtns = await evalJs(send, `(() => { const bs = [...document.querySelectorAll('.end-btns .big-btn')];
      return bs.map(b => b.textContent.trim()); })()`);
    check('t3-win-word', winWord === 'VICTORY', 'word=' + winWord);
    check('t3-win-buttons', winBtns.join('|').indexOf('MAIN LAGI') >= 0 && winBtns.join('|').indexOf('KE TITLE') >= 0, JSON.stringify(winBtns));
    await evalJs(send, `document.querySelector('.end-btns .big-btn:not(.ghost)').click(); 'again'`);
    await sleep(600);
    const stW = await readState(send);
    check('t3-play-again', stW && stW.phase === 'player' && stW.turn === 1, 'phase=' + (stW && stW.phase) + ' turn=' + (stW && stW.turn));
    await send('Page.navigate', { url: BASE + '/?shot=loss&mode=2&seed=7' });
    await sleep(900);
    const lossWord = await evalJs(send, `(() => { const w = document.querySelector('.end-word');
      return w ? w.textContent : null; })()`);
    check('t3-loss-word', lossWord === 'DEFEAT', 'word=' + lossWord);
    await evalJs(send, `document.querySelector('.end-btns .big-btn.ghost').click(); 'totitle'`);
    await sleep(500);
    check('t3-loss-to-title', await evalJs(send, `document.querySelector('.title-card') !== null`) === true);
    // (f) EXIT still works after the rework (fresh page load shows the
    // tutorial on first mode pick — skip it like startMode does).
    await evalJs(send, `document.querySelector('.mode-btn[data-mode="2"]').click(); 'm2'`);
    await sleep(600);
    if (await evalJs(send, `document.querySelector('.tut-card') !== null`)) {
      await evalJs(send, `document.querySelector('.tut-skip').click(); 'skip'`);
      await sleep(400);
    }
    await evalJs(send, `document.getElementById('exit-btn').click(); 'exit'`);
    await sleep(300);
    await evalJs(send, `document.querySelector('.confirm-yes').click(); 'yes'`);
    await sleep(600);
    check('f-exit', await evalJs(send, `document.querySelector('.title-card') !== null`) === true);
    const errs = countErrors(events);
    console.log('console errors/exceptions:', errs.length);
    errs.slice(0, 5).forEach((e) => console.log(JSON.stringify(e.params).slice(0, 400)));
  }
  ws.close();
}

main().catch((e) => { console.error('DRIVER FAIL:', e.message); process.exit(1); });
