// cards.js — every card in STARLIGHT DUEL, a celestial card duel.
// A card is a plain object: id, name, kind (creature | tool | loot),
// cost in Mana, art file, flavour text, and the numbers that matter on
// the table: attack and hp for creatures; effect for the rest. Values are
// big and few so a card stays readable at thumbnail size. All art is
// cropped from the four design sheets Yami sent (celestial theme).
(function (root) {
  'use strict';

  // Cost is shown as a gold star, attack as a red triangle, hp as a green
  // diamond: colour AND shape, never text alone.
  var CREATURE = 'creature';
  var TOOL = 'tool';
  var LOOT = 'loot';

  var CARD_DEFS = [
    // ---- Makhluk langit (crew di meja) ----
    { id: 'rubah', name: 'Rubah Bintang', kind: CREATURE,
      cost: 3, attack: 4, hp: 3, art: 'assets/fox.png',
      text: 'Ekornya menyapu rasi, langkahnya tak terdengar.' },
    { id: 'kelinci', name: 'Kelinci Bulan', kind: CREATURE,
      cost: 2, attack: 3, hp: 2, art: 'assets/bunny.png',
      text: 'Melompat dari kawah ke kawah.' },
    { id: 'permata', name: 'Golem Permata', kind: CREATURE,
      cost: 2, attack: 2, hp: 3, art: 'assets/gem-red.png',
      text: 'Ditempa di jantung bintang merah.' },
    { id: 'orb', name: 'Wisp Orb', kind: CREATURE,
      cost: 3, attack: 2, hp: 4, art: 'assets/orb-blue.png',
      text: 'Cahaya kecil yang tak pernah padam.' },
    { id: 'emas', name: 'Golem Emas', kind: CREATURE,
      cost: 4, attack: 5, hp: 2, art: 'assets/gem-gold.png',
      text: 'Satu pukulan, satu bintang jatuh.' },
    { id: 'bulan', name: 'Penjaga Bulan', kind: CREATURE,
      cost: 4, attack: 4, hp: 4, art: 'assets/card-back.png',
      text: 'Masuk: ambil 1 kartu saat dimainkan.',
      onPlay: 'draw1' },

    // ---- Perkakas rasi (butuh target di meja) ----
    { id: 'tongkat', name: 'Tongkat Rasi', kind: TOOL,
      cost: 1, attack: 0, hp: 0, art: 'assets/compass.png',
      text: 'Makhluk kawan +2 serangan.', target: 'allyCrew', effect: 'buffAttack2' },
    { id: 'jubah', name: 'Jubah Kabut', kind: TOOL,
      cost: 1, attack: 0, hp: 0, art: 'assets/potion-blue.png',
      text: 'Makhluk kawan menghindar dari 1 serangan.', target: 'allyCrew', effect: 'dodgeOnce' },
    { id: 'panah', name: 'Panah Bintang', kind: TOOL,
      cost: 1, attack: 0, hp: 0, art: 'assets/slide.png',
      text: 'Beri 2 damage ke satu makhluk lawan.', target: 'enemyCrew', effect: 'damageCrew2' },
    { id: 'ramalan', name: 'Ramalan Rasi', kind: TOOL,
      cost: 2, attack: 0, hp: 0, art: 'assets/star-blue.png',
      text: 'Ambil 2 kartu.', target: 'none', effect: 'draw2' },

    // ---- Jarahan langit (langsung jalan) ----
    { id: 'ramuan', name: 'Ramuan Bintang', kind: LOOT,
      cost: 0, attack: 0, hp: 0, art: 'assets/potion-pink.png',
      text: '+2 Mana.', target: 'none', effect: 'mana2' },
    { id: 'bintangemas', name: 'Bintang Emas', kind: LOOT,
      cost: 0, attack: 0, hp: 0, art: 'assets/star-gold.png',
      text: '+3 Mana.', target: 'none', effect: 'mana3' },
    { id: 'meteor', name: 'Meteor Jatuh', kind: LOOT,
      cost: 2, attack: 0, hp: 0, art: 'assets/star-pink.png',
      text: '3 damage langsung ke nyawa lawan yang dipilih.', target: 'enemyFace', effect: 'faceDamage3' },
    { id: 'berkah', name: 'Berkah Bulan', kind: LOOT,
      cost: 2, attack: 0, hp: 0, art: 'assets/moon.png',
      text: 'Pulihkan 4 nyawa.', target: 'none', effect: 'heal4' },
  ];

  function defById(id) {
    for (var i = 0; i < CARD_DEFS.length; i++) {
      if (CARD_DEFS[i].id === id) return CARD_DEFS[i];
    }
    return null;
  }

  // Fresh table copy of a card: hp can fall, dodge/buff flags live here.
  function makeCard(defId, owner) {
    var def = defById(defId);
    return {
      uid: owner + '-' + defId + '-' + Math.floor(Math.random() * 1e9).toString(36),
      defId: def.id, name: def.name, kind: def.kind,
      cost: def.cost, attack: def.attack, maxHp: def.hp, hp: def.hp,
      art: def.art, text: def.text, target: def.target || 'none',
      effect: def.effect || null, onPlay: def.onPlay || null,
      owner: owner, canAttack: false, justPlayed: true, dodge: false,
    };
  }

  // One shared 20-card deck for every side: two copies of the workhorses,
  // one of the swing cards, so every hand is a decision and no game plays
  // the same twice.
  var SHARED_DECK = ['rubah', 'rubah', 'kelinci', 'kelinci', 'permata',
    'permata', 'orb', 'orb', 'emas', 'bulan', 'tongkat', 'tongkat', 'jubah',
    'panah', 'panah', 'ramalan', 'ramuan', 'bintangemas', 'meteor', 'berkah'];

  root.StarCards = {
    CREATURE: CREATURE, TOOL: TOOL, LOOT: LOOT,
    defs: CARD_DEFS, defById: defById, makeCard: makeCard,
    sharedDeck: SHARED_DECK,
  };
})(window);
