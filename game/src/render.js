// render.js — everything the player sees, as plain DOM. Cards are divs
// (not canvas) so their numbers stay crisp at any size and the judge's
// screenshots read them at a glance. Cost is a gold star, attack a red
// triangle, hp a green diamond: shape plus colour, never text alone.
// All art is cropped from the four design sheets Yami sent.
(function (root) {
  'use strict';

  var KIND_LABEL = { creature: 'MAKHLUK', tool: 'PERKAKAS', loot: 'JARAHAN' };

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined && text !== null) d.textContent = text;
    return d;
  }

  function imgEl(src, alt, cls) {
    var im = document.createElement('img');
    im.src = src; im.alt = alt || ''; im.draggable = false;
    if (cls) im.className = cls;
    return im;
  }

  // One card face. opts: {playable, selected, tired, targetable, small, preview}
  function cardElement(card, opts) {
    opts = opts || {};
    var c = el('div', 'card fac-' + card.owner +
      (opts.small ? ' card-small' : '') +
      (opts.preview ? ' card-preview' : '') +
      (opts.playable ? ' playable' : '') +
      (opts.selected ? ' selected' : '') +
      (opts.tired ? ' tired' : '') +
      (opts.targetable ? ' targetable' : ''));
    c.dataset.uid = card.uid;

    var cost = el('div', 'badge badge-cost', String(card.cost));
    cost.title = 'Cost in Mana';
    c.appendChild(cost);

    var art = el('div', 'card-art');
    art.appendChild(imgEl(card.art, card.name));
    c.appendChild(art);

    c.appendChild(el('div', 'card-name', card.name));
    c.appendChild(el('div', 'card-kind', KIND_LABEL[card.kind]));
    c.appendChild(el('div', 'card-text', card.text));

    if (card.kind === 'creature') {
      var atk = el('div', 'badge badge-atk', String(card.attack));
      atk.title = 'Attack';
      var hp = el('div', 'badge badge-hp');
      hp.title = 'Health';
      hp.appendChild(el('span', null, String(card.hp)));
      c.appendChild(atk);
      c.appendChild(hp);
      if (card.dodge) c.appendChild(el('div', 'dodge-tag', 'MENGHINDAR'));
      // "BARU" only makes sense on the table: a hand card has not been
      // played yet, so it is never tired.
      if (card.justPlayed && opts.small) c.appendChild(el('div', 'sick-tag', 'BARU'));
    }
    return c;
  }

  function lifeBar(side, life, maxLife) {
    var wrap = el('div', 'life-wrap');
    wrap.appendChild(el('div', 'life-label', side.name + '  ·  NYAWA ' + life + '/' + maxLife));
    var bar = el('div', 'life-bar');
    var fill = el('div', 'life-fill');
    fill.style.width = Math.max(0, (life / maxLife) * 100) + '%';
    if (life <= 6) fill.classList.add('life-low');
    bar.appendChild(fill);
    wrap.appendChild(bar);
    return wrap;
  }

  function manaPips(mana, maxMana) {
    var wrap = el('div', 'mana-wrap');
    wrap.appendChild(el('span', 'mana-label', 'MANA ' + mana + '/' + maxMana));
    for (var i = 0; i < maxMana; i++) {
      wrap.appendChild(el('span', 'mana-pip' + (i < mana ? ' on' : '')));
    }
    return wrap;
  }

  // A fan of face-down cards (the opponent hand: never show its contents).
  function handBacks(count, fanClass) {
    var wrap = el('div', 'hand-backs ' + (fanClass || ''));
    for (var i = 0; i < count; i++) {
      var back = el('div', 'hand-back');
      back.appendChild(imgEl('assets/card-back.png', 'kartu tertutup'));
      wrap.appendChild(back);
    }
    wrap.appendChild(el('span', 'hand-count', count + ' kartu'));
    return wrap;
  }

  // One side's lane: face (clickable target), life, mana, table cards.
  function laneElement(state, side, idx, ui) {
    var lane = el('div', 'lane lane-' + side.id + (side.alive ? '' : ' lane-dead'));
    var head = el('div', 'lane-head');
    var face = el('div', 'side-face fac-' + side.id);
    face.dataset.side = String(idx);
    if (idx !== 0) {
      face.appendChild(imgEl('assets/card-back.png', side.name));
      face.classList.add('enemy-face');
    } else {
      face.appendChild(imgEl('assets/moon.png', 'Kamu'));
    }
    face.addEventListener('click', function () { ui.onFaceClick(idx); });
    if (ui.selectedAttacker || (ui.selectedTool && ui.selectedTool.target === 'enemyFace')) {
      if (idx !== 0 && side.alive) face.classList.add('targetable');
    }
    head.appendChild(face);
    var info = el('div', 'lane-info');
    info.appendChild(lifeBar(side, side.life, state.maxLife));
    info.appendChild(manaPips(side.mana, state.maxMana));
    head.appendChild(info);
    lane.appendChild(head);

    var row = el('div', 'table-row');
    for (var i = 0; i < side.table.length; i++) {
      (function (card) {
        var isMine = idx === 0;
        var opts = { small: true };
        if (isMine) {
          opts.selected = ui.selectedAttacker === card.uid;
          opts.tired = !card.canAttack;
          opts.targetable = ui.selectedTool && ui.selectedTool.target === 'allyCrew';
        } else {
          opts.targetable = (ui.selectedAttacker && !card.dodge) ||
            (ui.selectedTool && ui.selectedTool.target === 'enemyCrew');
        }
        var cardEl = cardElement(card, opts);
        // One-time entrance: your creature slides in with petals, an AI
        // creature flips open with a purple swirl.
        if (card.justPlayed && !card._animDone) {
          cardEl.classList.add(isMine ? 'slide-in' : 'flip-in');
          card._animDone = true;
        }
        cardEl.addEventListener('click', function () { ui.onTableCardClick(card, idx); });
        row.appendChild(cardEl);
      })(side.table[i]);
    }
    for (var s = side.table.length; s < 5; s++) row.appendChild(el('div', 'slot-empty'));
    lane.appendChild(row);
    return lane;
  }

  function opponentHands(state, ui) {
    var wrap = el('div', 'opp-hands');
    var foes = state.sides.slice(1);
    if (state.mode === 2) {
      wrap.appendChild(handBacks(foes[0].hand.length, 'fan-top'));
    } else if (state.mode === 3) {
      var left = el('div', 'fan-side fan-left');
      left.appendChild(el('span', 'fan-label', 'P2 · ' + foes[0].name));
      left.appendChild(handBacks(foes[0].hand.length, 'fan-diag-left'));
      var right = el('div', 'fan-side fan-right');
      right.appendChild(el('span', 'fan-label', 'P3 · ' + foes[1].name));
      right.appendChild(handBacks(foes[1].hand.length, 'fan-diag-right'));
      wrap.appendChild(left);
      wrap.appendChild(right);
    } else {
      var l = el('div', 'fan-side fan-left');
      l.appendChild(imgEl('assets/badge-p2.png', 'P2', 'seat-badge'));
      l.appendChild(handBacks(foes[0].hand.length, 'stack-vertical'));
      var t = el('div', 'fan-side fan-top4');
      t.appendChild(imgEl('assets/badge-p3.png', 'P3', 'seat-badge'));
      t.appendChild(handBacks(foes[1].hand.length, 'fan-top'));
      var r = el('div', 'fan-side fan-right');
      r.appendChild(imgEl('assets/badge-p4.png', 'P4', 'seat-badge'));
      r.appendChild(handBacks(foes[2].hand.length, 'stack-vertical'));
      wrap.appendChild(l);
      wrap.appendChild(t);
      wrap.appendChild(r);
    }
    return wrap;
  }

  // Full table render. state is the game state (see game.js); ui carries
  // the click handlers and the current selection.
  function renderTable(state, ui) {
    var rootEl = document.getElementById('table');
    rootEl.innerHTML = '';
    rootEl.className = 'mode-' + state.mode;

    var tableBg = el('div', 'table-bg');
    if (state.mode === 3) tableBg.style.backgroundImage = "url('assets/frame-3p.png')";
    else tableBg.style.backgroundImage = "url('assets/table-bg.png')";
    rootEl.appendChild(tableBg);

    rootEl.appendChild(opponentHands(state, ui));

    // --- Lanes: every side's creatures, player last ---
    var lanes = el('div', 'lanes');
    var order = [];
    for (var i = 1; i < state.sides.length; i++) order.push(i);
    order.push(0);
    for (var k = 0; k < order.length; k++) {
      lanes.appendChild(laneElement(state, state.sides[order[k]], order[k], ui));
    }
    rootEl.appendChild(lanes);

    // --- Middle: turn banner + log + end-turn compass ---
    var mid = el('div', 'mid-row');
    var cur = state.sides[state.current];
    mid.appendChild(el('div', 'turn-banner',
      state.phase === 'player' ? 'GILIRANMU — main kartu, lalu serang' :
      state.phase === 'ai' ? cur.name + ' BERMAIN…' :
      state.phase === 'won' ? 'DUEL DIMENANGKAN!' :
      state.phase === 'lost' ? 'BINTANGMU PADAM!' : ''));
    var log = el('div', 'log');
    var lines = state.log.slice(-3);
    for (var l = 0; l < lines.length; l++) log.appendChild(el('div', 'log-line', lines[l]));
    mid.appendChild(log);
    var endBtn = el('button', 'end-turn', '');
    endBtn.appendChild(imgEl('assets/compass.png', 'Akhiri giliran', 'turn-compass'));
    endBtn.appendChild(el('span', 'turn-word', 'TURN'));
    endBtn.disabled = state.phase !== 'player';
    endBtn.addEventListener('click', ui.onEndTurn);
    mid.appendChild(endBtn);
    rootEl.appendChild(mid);

    // --- Player hand (fanned, with potions at the sides) ---
    var handWrap = el('div', 'hand-wrap');
    handWrap.appendChild(imgEl('assets/potion-pink.png', 'Ramuan Bintang', 'side-potion'));
    var hand = el('div', 'hand-row');
    var player = state.sides[0];
    for (var h = 0; h < player.hand.length; h++) {
      (function (card) {
        var playable = state.phase === 'player' && card.cost <= player.mana &&
          (card.kind !== 'creature' || player.table.length < 5);
        var cardEl = cardElement(card, {
          playable: playable,
          selected: ui.selectedHand === card.uid,
        });
        // Draw animation: the card just drawn flies in from the deck.
        if (card.uid === state.lastDrawnUid && !card._drawShown) {
          cardEl.classList.add('draw-fly');
          card._drawShown = true;
        }
        cardEl.addEventListener('click', function () { ui.onHandCardClick(card); });
        hand.appendChild(cardEl);
      })(player.hand[h]);
    }
    handWrap.appendChild(hand);
    handWrap.appendChild(imgEl('assets/potion-blue.png', 'Ramuan Bulan', 'side-potion'));
    rootEl.appendChild(handWrap);
  }

  // ---- Overlays ----
  function setExitVisible(v) {
    var b = document.getElementById('exit-btn');
    // NOTE: '' does NOT work here — the stylesheet sets #exit-btn to
    // display:none, so an empty inline style leaves it hidden.
    if (b) b.style.display = v ? 'inline-block' : 'none';
  }

  // Small exit confirmation: its own layer (#confirm), never the shared
  // #overlay, so it can appear over a running duel without touching the
  // title or end screens — and its buttons always receive clicks.
  function showConfirmExit(onYes, onNo) {
    var box = document.getElementById('confirm');
    box.innerHTML = '';
    var card = el('div', 'confirm-card');
    card.appendChild(el('div', 'confirm-title', 'KELUAR DARI DUEL?'));
    card.appendChild(el('div', 'confirm-text',
      'Yakin keluar dari duel? Progress duel ini hilang.'));
    var row = el('div', 'confirm-row');
    var yes = el('button', 'confirm-yes', 'YA, KELUAR');
    yes.addEventListener('click', function () { hideConfirm(); onYes(); });
    var no = el('button', 'confirm-no', 'LANJUT MAIN');
    no.addEventListener('click', function () { hideConfirm(); onNo(); });
    row.appendChild(yes); row.appendChild(no);
    card.appendChild(row);
    box.appendChild(card);
    box.classList.add('on');
  }

  function hideConfirm() {
    var box = document.getElementById('confirm');
    if (box) { box.innerHTML = ''; box.classList.remove('on'); }
  }

  // ---- Tutorial: 6 short steps, read before the first duel. ----
  // mode: the mode the player picked (2/3/4), or null when opened from
  // the title's TUTORIAL button (browse mode: closing returns to title).
  var TUT_STEPS = [
    { img: 'assets/victory.png', title: '1 · TUJUANMU',
      text: 'Kurangi Nyawa lawan jadi 0 — yang hidup terakhir menang. Kamu dan lawan sama-sama mulai dengan 20 Nyawa. Di mode 3 dan 4 pemain, yang terakhir hidup di antara semua kursi yang menang.' },
    { img: 'assets/draw-pick.png', title: '2 · MANA & AMBIL KARTU',
      text: 'Tiap kartu butuh Mana — bintang emas di pojok kiri atas kartu. Tiap awal giliranmu kamu dapat +1 Mana (maksimal 10) dan mengambil 1 kartu dari deck. Kartu yang Mananya tidak cukup tidak bisa dimainkan.' },
    { img: 'assets/hand-normal.png', title: '3 · MAIN KARTU',
      text: 'Klik kartu di tanganmu — kartu membesar (preview) di tengah layar. Lalu klik targetnya: makhluk lawan, makhlukmu sendiri, atau wajah lawan. Kartu meluncur ke meja. Perkakas dan jarahan langsung memberi efek saat dimainkan.' },
    { img: 'assets/opp-target.png', title: '4 · MENYERANG',
      text: 'Makhluk di meja bisa menyerang sekali tiap giliran (yang baru dimainkan harus menunggu giliran berikutnya). Klik makhlukmu, lalu klik makhluk lawan — lawan membalas serangan! — atau klik wajah lawan untuk damage langsung ke Nyawanya.' },
    { img: 'assets/compass.png', title: '5 · AKHIRI GILIRAN',
      text: 'Kalau sudah selesai main kartu dan menyerang, tekan tombol TURN (kompas emas) atau tombol Enter. Giliran berputar ke lawan (AI) — mereka main sendiri, lalu giliran kembali padamu dengan +1 Mana dan 1 kartu baru.' },
    { img: 'assets/defeat.png', title: '6 · MENANG / KALAH',
      text: 'Nyawa 0 berarti keluar dari duel. Menang kalau semua lawan kehabisan Nyawa; kalah kalau Nyawamu habis duluan. Layar kemenangan atau kekalahan muncul dengan statistik duelmu — giliran, kartu yang dimainkan, dan damage yang kamu berikan.' },
  ];

  function showTutorial(mode, cb) {
    var overlay = document.getElementById('overlay');
    overlay.innerHTML = '';
    var step = 0;
    var browse = mode === null || mode === undefined;

    var ov = el('div', 'overlay-card tut-card');
    ov.appendChild(el('div', 'tut-kicker', 'CARA MAIN  ·  STARLIGHT DUEL'));
    var titleEl = el('div', 'tut-title', '');
    var imgWrap = el('div', 'tut-img');
    var img = imgEl('', 'Tutorial');
    imgWrap.appendChild(img);
    var textEl = el('div', 'tut-text', '');
    var dots = el('div', 'tut-dots');
    for (var d = 0; d < TUT_STEPS.length; d++) dots.appendChild(el('span', 'tut-dot'));
    var nav = el('div', 'tut-nav');
    var back = el('button', 'tut-btn-nav ghost', '◀ KEMBALI');
    var next = el('button', 'tut-btn-nav', 'LANJUT ▶');
    var skip = el('button', 'tut-skip', browse ? 'TUTUP' : 'LEWATI');
    nav.appendChild(back); nav.appendChild(next); nav.appendChild(skip);
    ov.appendChild(titleEl); ov.appendChild(imgWrap); ov.appendChild(textEl);
    ov.appendChild(dots); ov.appendChild(nav);
    overlay.appendChild(ov);

    function draw() {
      var s = TUT_STEPS[step];
      titleEl.textContent = s.title;
      img.src = s.img;
      textEl.textContent = s.text;
      var ds = dots.children;
      for (var i = 0; i < ds.length; i++) ds[i].classList.toggle('on', i === step);
      back.disabled = step === 0;
      next.textContent = step === TUT_STEPS.length - 1
        ? (browse ? 'KEMBALI KE TITLE' : '⚔ MULAI DUEL') : 'LANJUT ▶';
    }
    back.addEventListener('click', function () { if (step > 0) { step--; draw(); } });
    next.addEventListener('click', function () {
      if (step < TUT_STEPS.length - 1) { step++; draw(); return; }
      overlay.innerHTML = '';
      if (browse) { if (cb.onClose) cb.onClose(); }
      else if (cb.onStart) cb.onStart(mode);
    });
    skip.addEventListener('click', function () {
      overlay.innerHTML = '';
      if (browse) { if (cb.onClose) cb.onClose(); }
      else if (cb.onSkip) cb.onSkip(mode);
    });
    draw();
  }

  function showTitle() {
    var overlay = document.getElementById('overlay');
    overlay.innerHTML = '';
    setExitVisible(false);
    var ov = el('div', 'overlay-card title-card');
    ov.style.backgroundImage = "url('assets/title-bg.png')";
    ov.appendChild(el('div', 'game-kicker', 'MAKE.FUN  ·  BEST CARD GAME'));
    ov.appendChild(el('h1', 'game-title', 'STARLIGHT DUEL'));
    ov.appendChild(el('div', 'game-sub', 'DUEL KARTU RASI BINTANG — 2 · 3 · 4 PEMAIN'));
    ov.appendChild(el('div', 'title-rules',
      'Main kartu makhluk ke meja, bayar Mana, serang makhluk lawan atau langsung ke nyawa lawan. ' +
      'Nyawa 0 berarti keluar dari duel — yang terakhir hidup menang. Perkakas memperkuat makhluk, ' +
      'jarahan menambah Mana. Klik kartu lalu klik target. Tombol 1–7 memilih kartu, Enter mengakhiri giliran.'));
    var modes = el('div', 'mode-row');
    [['2', '2 PLAYER', 'Duel klasik: kamu vs RASI BULAN.'],
     ['3', '3 PLAYER', 'Tiga kursi: + AWAN UNGU di kanan.'],
     ['4', '4 PLAYER', 'Empat kursi: + AWAN UNGU & SENJA MERAH.']].forEach(function (m) {
      var b = el('button', 'mode-btn parchment', '');
      b.dataset.mode = m[0];
      b.appendChild(el('div', 'mode-name', m[1]));
      b.appendChild(el('div', 'mode-desc', m[2]));
      b.addEventListener('click', function () {
        root.StarGame.pickMode(Number(m[0]));
      });
      modes.appendChild(b);
    });
    ov.appendChild(modes);
    var tutBtn = el('button', 'tut-btn', '?  CARA MAIN — TUTORIAL');
    tutBtn.addEventListener('click', function () { root.StarGame.openTutorial(); });
    ov.appendChild(tutBtn);
    var how = el('div', 'how-row');
    [['assets/draw-pick.png', 'DRAW — kartu terbang dari deck'],
     ['assets/slide-play.png', 'PLAY — kartu meluncur ke meja'],
     ['assets/cast.png', 'CAST — efek meledak bintang'],
     ['assets/hand-normal.png', 'TANGANMU — 5 kartu mengipas'],
     ['assets/opp-hidden.png', 'TANGAN LAWAN — selalu tertutup'],
     ['assets/opp-target.png', 'TARGET — merah + reticle']].forEach(function (h) {
      var cell = el('div', 'how-cell');
      cell.appendChild(imgEl(h[0], h[1]));
      cell.appendChild(el('div', 'how-cap', h[1]));
      how.appendChild(cell);
    });
    ov.appendChild(how);
    ov.appendChild(el('div', 'title-foot', 'Semua seni dari lembar desain Yami  ·  20 nyawa  ·  10 Mana maks'));
    overlay.appendChild(ov);
  }

  function hideTitle() {
    document.getElementById('overlay').innerHTML = '';
  }

  function showEnd(won, stats) {
    var overlay = document.getElementById('overlay');
    overlay.innerHTML = '';
    setExitVisible(false);
    var ov = el('div', 'overlay-card ' + (won ? 'win-card' : 'loss-card'));
    ov.style.backgroundImage = won
      ? "url('assets/victory.png')" : "url('assets/defeat.png')";
    ov.appendChild(el('h1', 'end-title', won ? '★ DUEL DIMENANGKAN! ★' : 'BINTANGMU PADAM!'));
    ov.appendChild(el('div', 'end-sub', won
      ? 'Rasi berpihak padamu — semua lawan keluar dari duel. Cahaya bintangmu bersinar paling terang.'
      : 'Lawamu menutup langit. Bintangmu padam — coba lagi dengan rencana baru.'));
    ov.appendChild(el('div', 'end-stats',
      'Giliran: ' + stats.turns + '  ·  Kartu dimainkan: ' + stats.cardsPlayed +
      '  ·  Damage diberikan: ' + stats.damageDealt));
    var btn = el('button', 'big-btn', '↻  MAIN LAGI');
    btn.addEventListener('click', function () {
      overlay.innerHTML = '';
      showTitle();
    });
    ov.appendChild(btn);
    overlay.appendChild(ov);
  }

  // Big selected-card preview (Holding Card POV): the chosen card, large,
  // over the holding-hands art, glowing with sparkles.
  function showPreview(card) {
    var pv = document.getElementById('preview');
    pv.innerHTML = '';
    pv.style.backgroundImage = "url('assets/hold-pov.png')";
    pv.appendChild(cardElement(card, { preview: true }));
    pv.appendChild(el('div', 'preview-hint',
      card.target === 'none' ? 'Klik lagi untuk batal' :
      card.target === 'enemyFace' ? 'Pilih wajah lawan untuk target' :
      'Pilih target di meja — klik lagi untuk batal'));
    pv.classList.add('on');
  }

  function hidePreview() {
    var pv = document.getElementById('preview');
    if (pv) { pv.innerHTML = ''; pv.classList.remove('on'); }
  }

  // ---- FX: star bursts (cast) and petals (slide) ----
  function spawnBurst(kind) {
    var layer = document.getElementById('fx-layer');
    if (!layer) return;
    var table = document.getElementById('table');
    var r = table ? table.getBoundingClientRect() : { left: 0, top: 0, width: 800, height: 600 };
    var cx = r.left + r.width / 2, cy = r.top + r.height * 0.45;
    var glyphs = kind === 'cast'
      ? ['✦', '✧', '★', '✶'] : ['❀', '✿', '❁', '✦'];
    var colors = kind === 'cast'
      ? ['#ffd700', '#ff9de2', '#7dd3fc', '#c4b5fd']
      : ['#f9a8d4', '#fda4af', '#fbcfe8', '#ffd700'];
    for (var i = 0; i < 16; i++) {
      var s = el('span', 'fx-particle ' + (kind === 'cast' ? 'fx-star' : 'fx-petal'), glyphs[i % glyphs.length]);
      var ang = (i / 16) * Math.PI * 2 + Math.random() * 0.5;
      var dist = 60 + Math.random() * 130;
      s.style.left = cx + 'px';
      s.style.top = cy + 'px';
      s.style.color = colors[i % colors.length];
      s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(ang) * dist - 40 + 'px');
      s.style.setProperty('--rot', (Math.random() * 360 - 180) + 'deg');
      s.style.fontSize = (14 + Math.random() * 18) + 'px';
      layer.appendChild(s);
      (function (node) { setTimeout(function () { node.remove(); }, 750); })(s);
    }
    // A soft pink-blue cloud at the burst centre (cast only).
    if (kind === 'cast') {
      var cloud = el('div', 'fx-cloud');
      cloud.style.left = (cx - 90) + 'px';
      cloud.style.top = (cy - 60) + 'px';
      layer.appendChild(cloud);
      setTimeout(function () { cloud.remove(); }, 650);
    }
  }

  root.StarRender = {
    cardElement: cardElement, renderTable: renderTable,
    showTitle: showTitle, hideTitle: hideTitle, showEnd: showEnd,
    showPreview: showPreview, hidePreview: hidePreview,
    spawnBurst: spawnBurst, setExitVisible: setExitVisible,
    showConfirmExit: showConfirmExit, hideConfirm: hideConfirm,
    showTutorial: showTutorial,
  };
})(window);
