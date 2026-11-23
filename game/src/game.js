// game.js — the state machine of STARLIGHT DUEL, a celestial card duel.
// 2, 3 or 4 seats around one star table: the human (P1, bottom) against
// AI duelists (P2, P3, P4). Turns rotate P1 → P2 → P3 → P4. Each turn:
// draw 1, Mana +1 (max 10), play what you can afford, attack with each
// ready creature once. A creature just played cannot attack yet. Attacks
// hit a creature (which hits back) or a face. A side at 0 life is out;
// the last side standing wins.
(function (root) {
  'use strict';

  var MAX_LIFE = 20;
  var MAX_MANA = 10;
  var MAX_HAND = 7;
  var MAX_TABLE = 5;
  var START_HAND = 4;
  var START_MANA = 3;

  var SEATS = [
    { id: 'p1', name: 'KAMU', short: 'P1', color: 'gold', human: true },
    { id: 'p2', name: 'RASI BULAN', short: 'P2', color: 'silver', human: false },
    { id: 'p3', name: 'AWAN UNGU', short: 'P3', color: 'violet', human: false },
    { id: 'p4', name: 'SENJA MERAH', short: 'P4', color: 'rose', human: false },
  ];

  var state = null;
  var ui = { selectedHand: null, selectedTool: null, selectedAttacker: null };
  var muted = false;
  var audioCtx = null;
  // Every match gets a fresh id. AI turns are chains of setTimeouts; the
  // guard below makes a stale chain (from a match the player already left)
  // stop dead instead of playing on a newer match's state.
  var matchId = 0;
  // The step-by-step tutorial is shown once per session: the first time
  // the player picks a mode. Afterwards mode picks start the duel at once.
  var tutorialSeen = false;

  function params() {
    var q = {};
    var raw = window.location.search.replace(/^\?/, '');
    raw.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv[0]) q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return q;
  }

  function beep(freq, dur, type) {
    if (muted) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.08, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* sound is garnish, never a blocker */ }
  }

  function log(msg) {
    state.log.push(msg);
    if (state.log.length > 40) state.log.shift();
  }

  function freshSide(seat, rand) {
    return {
      id: seat.id, name: seat.name, short: seat.short, color: seat.color,
      human: seat.human, alive: true, life: MAX_LIFE, mana: START_MANA,
      deck: root.StarDeck.buildDeck(root.StarCards.sharedDeck, seat.id, rand),
      hand: [], table: [],
    };
  }

  function startMatch(mode, seed) {
    mode = (mode === 3 || mode === 4) ? mode : 2;
    matchId++;
    var rand = root.StarDeck.mulberry32(seed || (Date.now() % 2147483647));
    state = {
      seed: seed || 0, rand: rand, mode: mode,
      maxLife: MAX_LIFE, maxMana: MAX_MANA,
      sides: [], current: 0, turn: 1, phase: 'player', log: [],
      stats: { turns: 1, cardsPlayed: 0, damageDealt: 0 },
      lastDrawnUid: null, lastCastAt: 0,
    };
    for (var i = 0; i < mode; i++) {
      var side = freshSide(SEATS[i], rand);
      root.StarDeck.drawCards(side.deck, side.hand, START_HAND, MAX_HAND);
      state.sides.push(side);
    }
    clearSelection();
    log('Duel bintang dimulai! ' + mode + ' pemain, nyawa 20 lawan 20.');
    log('Giliran 1: kamu dapat 4 kartu dan 3 Mana.');
    beginTurn(0);
  }

  // ---- Mode pick, tutorial, exit ----
  function beginDuel(mode) {
    startMatch(mode);
    root.StarRender.hideTitle();
  }

  // First mode pick in a session shows the tutorial; later picks go
  // straight into the duel. The mode click is the first user gesture,
  // so it is also where the BGM is allowed to start.
  function pickMode(mode) {
    if (root.StarBGM) root.StarBGM.start();
    if (!tutorialSeen) {
      root.StarRender.showTutorial(mode, {
        onStart: function (m) { tutorialSeen = true; beginDuel(m); },
        onSkip: function (m) { tutorialSeen = true; beginDuel(m); },
      });
    } else {
      beginDuel(mode);
    }
  }

  // The title screen's TUTORIAL button: browse the steps, then return
  // to the title. Having seen it once also counts as "seen" for later
  // mode picks — the button stays there if the player wants it again.
  function openTutorial() {
    if (root.StarBGM) root.StarBGM.start();
    root.StarRender.showTutorial(null, {
      onClose: function () { tutorialSeen = true; root.StarRender.showTitle(); },
    });
  }

  // End screen's MAIN LAGI: a fresh match in the same mode.
  function playAgain() {
    var mode = state ? state.mode : 2;
    startMatch(mode);
    root.StarRender.hideTitle();
  }

  // Leave the duel: throw the match away (fresh state, fresh match id so
  // no pending AI timeout can touch it) and show the title again.
  function exitToTitle() {
    clearSelection();
    root.StarRender.hideConfirm();
    var mode = state ? state.mode : 2;
    startMatch(mode);
    root.StarRender.showTitle();
  }

  function askExit() {
    if (!state || (state.phase !== 'player' && state.phase !== 'ai')) return;
    root.StarRender.showConfirmExit(exitToTitle, function () { /* keep playing */ });
  }

  function clearSelection() {
    ui.selectedHand = null; ui.selectedTool = null; ui.selectedAttacker = null;
    if (root.StarRender) root.StarRender.hidePreview();
  }

  // ---- Animated play hand (transparent PNG sprites) ----
  // Capture the hand's start point BEFORE the card leaves the hand; the
  // returned finisher runs AFTER refresh with the target selector and
  // slides the hand from the player's (or AI's) side to the slot.
  function rectOf(sel) {
    var n = document.querySelector(sel);
    if (!n) return null;
    var r = n.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function startHandCarry(sideIdx, cardUid) {
    var from = sideIdx === 0
      ? rectOf('.hand-row .card[data-uid="' + cardUid + '"]')
      : rectOf('.lane-p' + (sideIdx + 1) + ' .side-face');
    if (!from) return function () {};
    return function (sel, fallbackSel) {
      var to = rectOf(sel) || (fallbackSel ? rectOf(fallbackSel) : null);
      if (to) root.StarRender.showHand(from, to, sideIdx !== 0);
    };
  }

  function me() { return state.sides[0]; }
  function currentSide() { return state.sides[state.current]; }

  function refresh() {
    root.StarRender.renderTable(state, {
      selectedHand: ui.selectedHand,
      selectedTool: ui.selectedTool ? { target: ui.selectedTool.target } : null,
      selectedAttacker: ui.selectedAttacker,
      onHandCardClick: onHandCardClick,
      onTableCardClick: onTableCardClick,
      onFaceClick: onFaceClick,
      onEndTurn: endTurn,
      onModePick: function (mode) { startMatch(mode); root.StarRender.hideTitle(); },
    });
    var label = document.getElementById('turn-label');
    if (label) {
      var cur = currentSide();
      label.textContent = 'GILIRAN ' + state.turn + '  ·  ' +
        (state.phase === 'player' ? 'GILIRANMU' :
         state.phase === 'ai' ? cur.name + ' BERMAIN…' : 'SELESAI');
    }
    // The EXIT button lives only while a duel is running.
    root.StarRender.setExitVisible(state.phase === 'player' || state.phase === 'ai');
  }

  function findCard(list, uid) {
    for (var i = 0; i < list.length; i++) if (list[i].uid === uid) return list[i];
    return null;
  }

  function removeFromTable(side, uid) {
    for (var i = 0; i < side.table.length; i++) {
      if (side.table[i].uid === uid) return side.table.splice(i, 1)[0];
    }
    return null;
  }

  function aliveSides() {
    var out = [];
    for (var i = 0; i < state.sides.length; i++) if (state.sides[i].alive) out.push(i);
    return out;
  }

  function killSide(idx) {
    var side = state.sides[idx];
    if (!side.alive) return;
    side.alive = false;
    side.table = [];
    log(side.name + ' kehabisan nyawa dan keluar dari duel!');
  }

  function checkEnd() {
    if (!me().alive) {
      state.phase = 'lost';
      refresh();
      beep(220, 0.4);
      root.StarRender.showEnd(false, state.stats);
      return true;
    }
    var alive = aliveSides();
    if (alive.length === 1 && alive[0] === 0) {
      state.phase = 'won';
      refresh();
      beep(660, 0.25); setTimeout(function () { beep(880, 0.4); }, 200);
      root.StarRender.showEnd(true, state.stats);
      return true;
    }
    return false;
  }

  function dealDamageToCreature(side, card, amount, sourceName) {
    if (card.dodge) {
      card.dodge = false;
      log(card.name + ' menghindar dari serangan ' + sourceName + '!');
      return;
    }
    card.hp -= amount;
    log(sourceName + ' memberi ' + amount + ' damage ke ' + card.name +
      ' (' + Math.max(0, card.hp) + '/' + card.maxHp + ').');
    if (card.hp <= 0) {
      removeFromTable(side, card.uid);
      log(card.name + ' tumbang dan keluar dari meja.');
    }
  }

  function dealDamageToFace(sideIdx, amount, sourceName) {
    var side = state.sides[sideIdx];
    side.life -= amount;
    if (sideIdx === 0) state.stats.damageDealt += 0; // human face damage counted by attacker
    log(sourceName + ': ' + amount + ' damage ke nyawa ' + side.name +
      ' (' + Math.max(0, side.life) + '/' + MAX_LIFE + ').');
    if (side.life <= 0) killSide(sideIdx);
  }

  function applyEffect(sideIdx, card, targetUid, targetSideIdx) {
    var side = state.sides[sideIdx];
    switch (card.effect) {
      case 'buffAttack2': {
        var ally = findCard(side.table, targetUid);
        if (ally) { ally.attack += 2; log(card.name + ': ' + ally.name + ' kini ' + ally.attack + ' serangan.'); }
        break;
      }
      case 'dodgeOnce': {
        var ally2 = findCard(side.table, targetUid);
        if (ally2) { ally2.dodge = true; log(card.name + ': ' + ally2.name + ' siap menghindar sekali.'); }
        break;
      }
      case 'damageCrew2': {
        var foeSide = state.sides[targetSideIdx];
        var enemy = foeSide ? findCard(foeSide.table, targetUid) : null;
        if (enemy) dealDamageToCreature(foeSide, enemy, 2, card.name);
        break;
      }
      case 'draw2':
        var drawn = root.StarDeck.drawCards(side.deck, side.hand, 2, MAX_HAND);
        if (drawn.length) state.lastDrawnUid = drawn[drawn.length - 1].uid;
        log(card.name + ': ambil 2 kartu.');
        break;
      case 'mana2': side.mana = Math.min(MAX_MANA, side.mana + 2); log(card.name + ': +2 Mana.'); break;
      case 'mana3': side.mana = Math.min(MAX_MANA, side.mana + 3); log(card.name + ': +3 Mana.'); break;
      case 'faceDamage3':
        dealDamageToFace(targetSideIdx, 3, card.name);
        if (sideIdx === 0) state.stats.damageDealt += 3;
        break;
      case 'heal4':
        side.life = Math.min(MAX_LIFE, side.life + 4);
        log(card.name + ': pulih 4 nyawa.');
        break;
    }
  }

  function playCard(sideIdx, card, targetUid, targetSideIdx) {
    var side = state.sides[sideIdx];
    if (!side.alive || side.mana < card.cost) return false;
    var idx = side.hand.indexOf(card);
    if (idx < 0) return false;
    side.hand.splice(idx, 1);
    side.mana -= card.cost;
    state.stats.cardsPlayed++;
    if (card.kind === 'creature') {
      if (side.table.length >= MAX_TABLE) {
        side.hand.splice(idx, 0, card); side.mana += card.cost; return false;
      }
      card.canAttack = false;
      card.justPlayed = true;
      card._animDone = false;
      side.table.push(card);
      log(side.name + ' memainkan ' + card.name +
        ' (' + card.attack + '/' + card.hp + ').');
      if (card.onPlay === 'draw1') {
        var drawn = root.StarDeck.drawCards(side.deck, side.hand, 1, MAX_HAND);
        if (drawn.length) state.lastDrawnUid = drawn[drawn.length - 1].uid;
        log(card.name + ': ambil 1 kartu.');
      }
    } else {
      log(side.name + ' memainkan ' + card.name + '.');
      applyEffect(sideIdx, card, targetUid, targetSideIdx);
    }
    beep(520, 0.08, 'triangle');
    return true;
  }

  function attackWith(attacker, targetSideIdx, targetUid) {
    var foe = state.sides[targetSideIdx];
    attacker.canAttack = false;
    beep(180, 0.12, 'square');
    if (targetUid === null) {
      var atk = attacker.attack;
      foe.life -= atk;
      if (attacker.owner === 'p1') state.stats.damageDealt += atk;
      log(attacker.name + ' menyerang langsung: ' + atk +
        ' damage ke nyawa ' + foe.name + '!');
      if (foe.life <= 0) killSide(targetSideIdx);
    } else {
      var victim = findCard(foe.table, targetUid);
      if (!victim) return;
      var atk2 = attacker.attack;
      dealDamageToCreature(foe, victim, atk2, attacker.name);
      // The victim hits back, unless it just died or dodged the blow.
      if (victim.hp > 0 && !victim.dodge) {
        var ownerSide = null;
        for (var i = 0; i < state.sides.length; i++) {
          if (state.sides[i].id === attacker.owner) ownerSide = state.sides[i];
        }
        if (ownerSide) dealDamageToCreature(ownerSide, attacker, victim.attack, victim.name + ' (balasan)');
      }
    }
    checkEnd();
  }

  // ---- Turn flow ----
  function beginTurn(idx) {
    state.current = idx;
    var side = state.sides[idx];
    side.mana = Math.min(MAX_MANA, side.mana + 1);
    var drawn = root.StarDeck.drawCards(side.deck, side.hand, 1, MAX_HAND);
    state.lastDrawnUid = drawn.length ? drawn[drawn.length - 1].uid : null;
    for (var i = 0; i < side.table.length; i++) {
      side.table[i].canAttack = true; side.table[i].justPlayed = false;
    }
    if (side.human) {
      state.phase = 'player';
      log('Giliran ' + state.turn + ': +1 Mana, ambil 1 kartu. Makhluk siap menyerang.');
    } else {
      state.phase = 'ai';
      log('— Giliran ' + side.name + ' —');
    }
    refresh();
    if (!side.human) runAiTurn(idx);
  }

  function nextSide() {
    if (state.phase === 'won' || state.phase === 'lost') return;
    var alive = aliveSides();
    if (alive.length <= 1) { checkEnd(); return; }
    var next = state.current;
    do {
      next = (next + 1) % state.sides.length;
    } while (!state.sides[next].alive);
    if (next === 0) { state.turn++; state.stats.turns = state.turn; }
    beginTurn(next);
  }

  function runAiTurn(idx) {
    var side = state.sides[idx];
    var myMatch = matchId;
    var plan = root.StarAI.planTurn(side, state.sides, idx);
    var step = 0;
    function nextAction() {
      if (myMatch !== matchId) return; // this match is over — stop dead
      if (state.phase !== 'ai' || state.current !== idx) return; // game ended or moved on
      if (step >= plan.length) { nextSide(); return; }
      var a = plan[step++];
      var handFinish = null, handSel = null, handFb = null;
      if (a.type === 'play') {
        // Creatures ride the hand to their slot; instant tools just happen.
        if (a.card.kind === 'creature') {
          handFinish = startHandCarry(idx, a.card.uid);
          handSel = '.lane-p' + (idx + 1) + ' .table-row .card[data-uid="' + a.card.uid + '"]';
          handFb = '.lane-p' + (idx + 1) + ' .table-row';
        }
        playCard(idx, a.card, null, -1);
      } else if (a.type === 'playTarget') {
        handFinish = startHandCarry(idx, a.card.uid);
        handSel = '.lane-p' + (a.targetSide + 1) + ' .table-row .card[data-uid="' + a.targetUid + '"]';
        handFb = '.lane-p' + (a.targetSide + 1) + ' .table-row';
        playCard(idx, a.card, a.targetUid, a.targetSide);
      } else if (a.type === 'playFace') {
        handFinish = startHandCarry(idx, a.card.uid);
        handSel = '.lane-p' + (a.targetSide + 1) + ' .side-face';
        playCard(idx, a.card, null, a.targetSide);
      } else if (a.type === 'attack') {
        var atk = findCard(side.table, a.attackerUid);
        if (atk && atk.canAttack) attackWith(atk, a.targetSide, a.targetUid);
      }
      if (state.phase === 'ai') { refresh(); if (handFinish) handFinish(handSel, handFb); setTimeout(nextAction, 450); }
      else refresh();
    }
    setTimeout(nextAction, 500);
  }

  // ---- Human input ----
  function onHandCardClick(card) {
    if (state.phase !== 'player') return;
    var player = me();
    if (card.cost > player.mana) {
      log(card.name + ' butuh ' + card.cost + ' Mana — kamu punya ' + player.mana + '.');
      refresh(); return;
    }
    if (card.kind === 'creature' && player.table.length >= MAX_TABLE) {
      log('Meja penuh — maksimal 5 makhluk.');
      refresh(); return;
    }
    if (card.target === 'none') {
      var wasTool = card.kind !== 'creature';
      var finish = wasTool ? null : startHandCarry(0, card.uid);
      playCard(0, card, null, -1);
      clearSelection();
      if (wasTool) root.StarRender.spawnBurst('cast');
      var ended = checkEnd();
      if (!ended) refresh();
      if (finish && !ended) finish('.lane-p1 .table-row .card[data-uid="' + card.uid + '"]', '.lane-p1 .table-row');
      return;
    }
    // Targeted card: select it, show the big preview, then click a target.
    if (ui.selectedTool === card) { clearSelection(); refresh(); return; }
    ui.selectedTool = card;
    // Mark the hand card itself as selected too, so the player can see
    // WHICH card is picked (render.js already styles .card.selected —
    // it just never got set). Without this the only visible sign of the
    // pick is the big preview, and the player cannot find the card to
    // tap again to cancel.
    ui.selectedHand = card.uid;
    ui.selectedAttacker = null;
    root.StarRender.showPreview(card, function () { clearSelection(); refresh(); });
    log(card.name + ': pilih target di meja.');
    refresh();
  }

  function onTableCardClick(card, sideIdx) {
    if (state.phase !== 'player') return;
    if (ui.selectedTool) {
      var tool = ui.selectedTool;
      var ok = (tool.target === 'allyCrew' && sideIdx === 0) ||
               (tool.target === 'enemyCrew' && sideIdx !== 0);
      if (!ok) { log('Target tidak cocok untuk ' + tool.name + '.'); return; }
      var finishT = startHandCarry(0, tool.uid);
      playCard(0, tool, card.uid, sideIdx);
      root.StarRender.spawnBurst('cast');
      clearSelection();
      var endedT = checkEnd();
      if (!endedT) refresh();
      if (!endedT) finishT('.lane-p' + (sideIdx + 1) + ' .table-row .card[data-uid="' + card.uid + '"]', '.lane-p' + (sideIdx + 1) + ' .table-row');
      return;
    }
    if (sideIdx === 0) {
      if (!card.canAttack) {
        log(card.name + (card.justPlayed ? ' baru dimainkan — belum bisa menyerang giliran ini.' : ' sudah menyerang giliran ini.'));
        refresh(); return;
      }
      ui.selectedAttacker = (ui.selectedAttacker === card.uid) ? null : card.uid;
      log(ui.selectedAttacker ? card.name + ' siap menyerang — klik makhluk lawan atau wajah lawan.' : 'Batal memilih penyerang.');
      refresh();
      return;
    }
    // Enemy creature clicked: attack it if an attacker is selected.
    if (ui.selectedAttacker) {
      var attacker = findCard(me().table, ui.selectedAttacker);
      clearSelection();
      if (attacker) attackWith(attacker, sideIdx, card.uid);
      if (state.phase === 'player') refresh();
    }
  }

  function onFaceClick(sideIdx) {
    if (state.phase !== 'player' || sideIdx === 0) return;
    if (ui.selectedTool && ui.selectedTool.target === 'enemyFace') {
      var tool = ui.selectedTool;
      var finishF = startHandCarry(0, tool.uid);
      playCard(0, tool, null, sideIdx);
      root.StarRender.spawnBurst('cast');
      clearSelection();
      var endedF = checkEnd();
      if (!endedF) refresh();
      if (!endedF) finishF('.lane-p' + (sideIdx + 1) + ' .side-face', null);
      return;
    }
    if (ui.selectedAttacker) {
      var attacker = findCard(me().table, ui.selectedAttacker);
      clearSelection();
      if (attacker) attackWith(attacker, sideIdx, null);
      if (state.phase === 'player') refresh();
    }
  }

  function endTurn() {
    if (state.phase !== 'player') return;
    clearSelection();
    state.phase = 'ai';
    log('— Giliran lawan —');
    refresh();
    nextSide();
  }

  // ---- Screenshot staging (?shot=title|table|win|loss&mode=2|3|4) ----
  function stageShot(shot, seed, mode) {
    startMatch(mode || 2, seed || 7);
    if (shot === 'title') {
      document.getElementById('overlay').innerHTML = '';
      root.StarRender.showTitle();
      return;
    }
    if (shot === 'table') {
      // A fixed, busy mid-game: tables staffed, hands full, life dented.
      var mk = root.StarCards.makeCard;
      var p = state.sides[0];
      p.life = 14; p.mana = 6;
      state.turn = 5; state.stats.turns = 5; state.stats.cardsPlayed = 9; state.stats.damageDealt = 9;
      p.table = [mk('rubah', 'p1'), mk('kelinci', 'p1'), mk('permata', 'p1')];
      p.table[0].canAttack = true; p.table[0].justPlayed = false;
      p.table[1].canAttack = true; p.table[1].justPlayed = false;
      p.table[2].canAttack = false; p.table[2].justPlayed = true;
      p.table[1].attack = 6; // Tongkat Rasi sudah dipakai
      p.hand = [mk('tongkat', 'p1'), mk('jubah', 'p1'), mk('bulan', 'p1'), mk('ramuan', 'p1'), mk('meteor', 'p1')];
      var e1 = state.sides[1];
      e1.life = 11; e1.mana = 4;
      e1.table = [mk('orb', 'p2'), mk('emas', 'p2')];
      e1.table[0].canAttack = true; e1.table[0].justPlayed = false;
      e1.table[1].canAttack = true; e1.table[1].justPlayed = false;
      e1.hand = [mk('panah', 'p2'), mk('ramalan', 'p2'), mk('berkah', 'p2')];
      if (state.sides[2]) {
        var e2 = state.sides[2];
        e2.life = 16; e2.mana = 5;
        e2.table = [mk('kelinci', 'p3')];
        e2.table[0].canAttack = true; e2.table[0].justPlayed = false;
        e2.hand = [mk('rubah', 'p3'), mk('tongkat', 'p3')];
      }
      if (state.sides[3]) {
        var e3 = state.sides[3];
        e3.life = 18; e3.mana = 3;
        e3.table = [mk('orb', 'p4')];
        e3.table[0].canAttack = true; e3.table[0].justPlayed = false;
        e3.hand = [mk('emas', 'p4')];
      }
      state.log = [
        'Giliran 5: +1 Mana, ambil 1 kartu. Makhluk siap menyerang.',
        'RASI BULAN memainkan Golem Emas (5/2).',
        'Rubah Bintang menyerang Wisp Orb: 6 damage, Orb membalas 2.',
      ];
      state.phase = 'player';
      state.current = 0;
      refresh();
      return;
    }
    if (shot === 'win' || shot === 'loss') {
      me().life = shot === 'win' ? 8 : 0;
      state.sides[1].life = shot === 'win' ? 0 : 9;
      if (shot === 'win') killSide(1);
      state.turn = 8; state.stats.turns = 8; state.stats.cardsPlayed = 17;
      state.stats.damageDealt = shot === 'win' ? 20 : 11;
      state.phase = shot === 'win' ? 'won' : 'lost';
      state.log = [shot === 'win'
        ? 'Rubah Bintang menyerang langsung: 5 damage ke nyawa RASI BULAN!'
        : 'Golem Emas menyerang langsung: 5 damage ke nyawa KAMU!'];
      refresh();
      root.StarRender.showEnd(shot === 'win', state.stats);
      return;
    }
  }

  function boot() {
    var q = params();
    document.getElementById('mute-btn').addEventListener('click', function () {
      muted = !muted;
      document.getElementById('mute-btn').textContent = muted ? 'SUARA OFF' : 'SUARA ON';
      if (root.StarBGM) root.StarBGM.setMuted(muted);
    });
    document.getElementById('exit-btn').addEventListener('click', askExit);
    // Clicking EMPTY table area cancels a selection. The preview covers
    // the whole screen with pointer-events:none, so a tap on it falls
    // through to whatever is underneath — a creature (plays the card!),
    // the TURN button (ends the turn!) or nothing. That is why cancelling
    // "sometimes" failed: the only ways out were tapping the exact small
    // hand card again or pressing Esc (which does not exist on a phone).
    // This delegated handler makes any tap on non-interactive table area
    // a cancel. Card/face/button taps bubble up too, but they are skipped
    // below (their own handlers already ran first), so playing and
    // targeting are unaffected.
    document.getElementById('table').addEventListener('click', function (e) {
      if (!state || state.phase !== 'player') return;
      if (!ui.selectedTool && !ui.selectedAttacker) return;
      var t = e.target;
      if (t && t.closest && t.closest('.card, .side-face, button, .hand-back, a, input')) return;
      clearSelection();
      refresh();
    });
    document.addEventListener('keydown', function (e) {
      if (!state || state.phase !== 'player') return;
      if (e.key >= '1' && e.key <= '7') {
        var idx = Number(e.key) - 1;
        if (me().hand[idx]) onHandCardClick(me().hand[idx]);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        endTurn();
      } else if (e.key === 'Escape') {
        clearSelection(); refresh();
      }
    });
    var shot = q.shot;
    var seed = Number(q.seed || '7');
    var mode = Number(q.mode || '2');
    if (shot) {
      stageShot(shot, seed, mode);
    } else {
      startMatch(mode, seed);
      root.StarRender.showTitle();
    }
  }

  root.StarGame = {
    startMatch: startMatch, boot: boot, playAgain: playAgain,
    pickMode: pickMode, openTutorial: openTutorial, exitToTitle: exitToTitle,
  };
  // Test hook for the play-test driver (not part of the game UI).
  root.__star = {
    getState: function () { return state; },
    ui: ui, endTurn: endTurn, startMatch: startMatch,
    getTutorialSeen: function () { return tutorialSeen; },
    pickMode: pickMode, openTutorial: openTutorial, exitToTitle: exitToTitle,
    bgmState: function () { return root.StarBGM ? root.StarBGM.state() : null; },
  };
})(window);
