// deck.js — seeded random and deck handling for STARLIGHT DUEL.
// One tiny generator (mulberry32) so a screenshot seed replays the same
// shuffle and the same opening hand every time.
(function (root) {
  'use strict';

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rand) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  // Build a shuffled deck of live card objects for one side.
  function buildDeck(defIds, owner, rand) {
    var order = shuffle(defIds, rand);
    var deck = [];
    for (var i = 0; i < order.length; i++) {
      deck.push(root.StarCards.makeCard(order[i], owner));
    }
    return deck;
  }

  // Draw n cards from a deck into a hand; returns what was actually drawn
  // (a deck can run dry, and an empty draw is a legal, visible event).
  function drawCards(deck, hand, n, maxHand) {
    var drawn = [];
    for (var i = 0; i < n; i++) {
      if (hand.length >= maxHand || deck.length === 0) break;
      var card = deck.pop();
      hand.push(card);
      drawn.push(card);
    }
    return drawn;
  }

  root.StarDeck = {
    mulberry32: mulberry32, shuffle: shuffle,
    buildDeck: buildDeck, drawCards: drawCards,
  };
})(window);
