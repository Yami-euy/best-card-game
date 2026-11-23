// ai.js — the AI duelists of STARLIGHT DUEL. One brain for every AI side
// (P2, P3, P4): its rules are written to be read and countered. It always
// hits the weakest creature among ALL its enemies first, it spends its
// Mana on the biggest creature it can afford, and it saves its Panah
// Bintang for the strongest thing anyone puts down. If you know that, you
// can bait it.
(function (root) {
  'use strict';

  function weakestCrew(table) {
    var best = null;
    for (var i = 0; i < table.length; i++) {
      if (!best || table[i].hp < best.hp ||
          (table[i].hp === best.hp && table[i].attack < best.attack)) best = table[i];
    }
    return best;
  }

  function strongestCrew(table) {
    var best = null;
    for (var i = 0; i < table.length; i++) {
      if (!best || table[i].attack > best.attack) best = table[i];
    }
    return best;
  }

  // All living enemies of one side, in seat order.
  function enemiesOf(sides, selfIdx) {
    var out = [];
    for (var i = 0; i < sides.length; i++) {
      if (i !== selfIdx && sides[i].alive) out.push({ side: sides[i], idx: i });
    }
    return out;
  }

  function weakestEnemyCrew(sides, selfIdx) {
    var best = null, bestSide = -1;
    var foes = enemiesOf(sides, selfIdx);
    for (var i = 0; i < foes.length; i++) {
      var w = weakestCrew(foes[i].side.table);
      if (w && (!best || w.hp < best.hp ||
          (w.hp === best.hp && w.attack < best.attack))) {
        best = w; bestSide = foes[i].idx;
      }
    }
    return best ? { card: best, sideIdx: bestSide } : null;
  }

  function strongestEnemyCrew(sides, selfIdx) {
    var best = null, bestSide = -1;
    var foes = enemiesOf(sides, selfIdx);
    for (var i = 0; i < foes.length; i++) {
      var s = strongestCrew(foes[i].side.table);
      if (s && (!best || s.attack > best.attack)) { best = s; bestSide = foes[i].idx; }
    }
    return best ? { card: best, sideIdx: bestSide } : null;
  }

  function lowestLifeEnemy(sides, selfIdx) {
    var best = null, bestIdx = -1;
    var foes = enemiesOf(sides, selfIdx);
    for (var i = 0; i < foes.length; i++) {
      if (!best || foes[i].side.life < best.life) { best = foes[i].side; bestIdx = foes[i].idx; }
    }
    return { side: best, idx: bestIdx };
  }

  // Decide the AI's whole turn up front as a list of plain actions the
  // engine then plays out one by one, so the log can narrate each move.
  // An action is {type:'play', card} | {type:'playTarget', card, targetUid,
  // targetSide} | {type:'playFace', card, targetSide} | {type:'attack',
  // attackerUid, targetUid|null, targetSide}.
  function planTurn(ai, sides, selfIdx) {
    var actions = [];
    var mana = ai.mana;
    var hand = ai.hand.slice();
    var table = ai.table.slice();
    var enemyTables = {};
    var foes = enemiesOf(sides, selfIdx);
    for (var f = 0; f < foes.length; f++) enemyTables[foes[f].idx] = foes[f].side.table.slice();

    // 1) Spend Mana: biggest affordable creature first while the table has room.
    var progressed = true;
    while (progressed) {
      progressed = false;
      var crewPick = null;
      for (var i = 0; i < hand.length; i++) {
        var c = hand[i];
        if (c.kind !== 'creature' || c.cost > mana) continue;
        if (table.length >= 5) continue;
        if (!crewPick || c.attack > crewPick.attack) crewPick = c;
      }
      if (crewPick) {
        actions.push({ type: 'play', card: crewPick });
        mana -= crewPick.cost;
        hand.splice(hand.indexOf(crewPick), 1);
        table.push(crewPick);
        progressed = true;
        continue;
      }
      // Tools: buff the strongest own creature, shield the weakest, break
      // the strongest enemy creature. Loot: finish with the meteor, heal
      // when hurt, draw when the hand runs thin.
      var toolPick = null, toolTarget = null, toolSide = -1;
      for (var j = 0; j < hand.length; j++) {
        var t = hand[j];
        if (t.cost > mana) continue;
        if (t.effect === 'buffAttack2' && table.length) {
          toolPick = t; toolTarget = strongestCrew(table); toolSide = selfIdx;
        } else if (t.effect === 'dodgeOnce' && table.length) {
          toolPick = t; toolTarget = weakestCrew(table); toolSide = selfIdx;
        } else if (t.effect === 'damageCrew2') {
          var vic = strongestEnemyCrew(sides, selfIdx);
          if (vic) { toolPick = t; toolTarget = vic.card; toolSide = vic.sideIdx; }
        } else if (t.effect === 'draw2' && hand.length <= 3) {
          toolPick = t; toolTarget = null; toolSide = -1;
        } else if (t.effect === 'faceDamage3') {
          var low = lowestLifeEnemy(sides, selfIdx);
          if (low.side && (low.side.life <= 3 || mana >= 6)) {
            toolPick = t; toolTarget = null; toolSide = low.idx;
          }
        } else if (t.effect === 'heal4' && ai.life <= 12) {
          toolPick = t; toolTarget = null; toolSide = -1;
        } else if ((t.effect === 'mana2' || t.effect === 'mana3') &&
                   hand.some(function (h) { return h.kind === 'creature' && h.cost > mana; })) {
          toolPick = t; toolTarget = null; toolSide = -1;
        }
        if (toolPick) break;
      }
      if (toolPick) {
        if (toolPick.effect === 'faceDamage3') {
          actions.push({ type: 'playFace', card: toolPick, targetSide: toolSide });
        } else {
          actions.push({ type: 'playTarget', card: toolPick,
            targetUid: toolTarget ? toolTarget.uid : null, targetSide: toolSide });
        }
        mana -= toolPick.cost;
        hand.splice(hand.indexOf(toolPick), 1);
        if (toolPick.effect === 'damageCrew2' && toolTarget) {
          var et = enemyTables[toolSide];
          if (et) et.splice(et.indexOf(toolTarget), 1);
        }
        progressed = true;
      }
    }

    // 2) Attack: every ready creature hits the weakest enemy creature
    // across all enemies; with no creature out, the face of the weakest
    // enemy side.
    for (var k = 0; k < table.length; k++) {
      var attacker = table[k];
      if (!attacker.canAttack) continue;
      var victim = weakestEnemyCrew(sides, selfIdx);
      var faceTarget = -1;
      if (!victim) {
        var lf = lowestLifeEnemy(sides, selfIdx);
        faceTarget = lf.idx;
      }
      actions.push({ type: 'attack', attackerUid: attacker.uid,
        targetUid: victim ? victim.card.uid : null,
        targetSide: victim ? victim.sideIdx : faceTarget });
    }
    return actions;
  }

  root.StarAI = {
    planTurn: planTurn, weakestCrew: weakestCrew,
    strongestCrew: strongestCrew, enemiesOf: enemiesOf,
  };
})(window);
