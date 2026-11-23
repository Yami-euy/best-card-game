# STARLIGHT DUEL — Duel Kartu Rasi Bintang

[![make.fun](https://make.fun/badge/best-card-game-20261122-1826.svg)](https://make.fun/bounty/best-card-game-20261122-1826?utm_source=github&utm_medium=readme&utm_campaign=best-card-game-20261122-1826)
[![rank](https://make.fun/badge/best-card-game-20261122-1826/Yami-euy/best-card-game/rank.svg)](https://make.fun/bounty/best-card-game-20261122-1826/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-card-game-20261122-1826)
[![reward](https://make.fun/badge/best-card-game-20261122-1826/Yami-euy/best-card-game/reward.svg)](https://make.fun/bounty/best-card-game-20261122-1826?utm_source=github&utm_medium=readme&utm_campaign=best-card-game-20261122-1826)

A celestial card duel for the make.fun **best-card-game-20261122-1826** bounty: you, the Star Duelist, face the AI duelists of the night sky — RASI BULAN, AWAN UNGU, SENJA MERAH — across a constellation table. Play star creatures, pay Mana, buff with tools, cast loot, and bring every other side's life to zero. The last side standing wins.

## How it plays

- **2, 3 or 4 players.** Pick a mode on the title screen (the three parchment panels). Turns rotate P1 → P2 → P3 → P4; a side at 0 life is out.
- **Life 20 each.** Mana starts at 3, +1 each turn, max 10.
- **Hand of 4, draw 1 a turn.** Play creatures to the table (max 5), tools onto creatures, loot straight away.
- **Attack:** click your creature, then an enemy creature (it hits back) or an enemy portrait (face damage).
- **Combos:** Tongkat Rasi +2 attack on a creature, Jubah Kabut dodges one hit, Meteor Jatuh hits a chosen face for 3, Berkah Bulan heals 4, Penjaga Bulan draws a card when played.
- **The AI reads:** it always hits the weakest creature among ALL its enemies first and spends Mana on its biggest creature — bait it, then counter.
- **Hand states (all working):** hover raises a card with a gold glow, click selects it into a big glowing preview, played cards slide to the table, targeted enemies get a red reticle, AI cards flip open with a purple swirl, and every draw flies in from the deck with a star-light trail.
- **Keyboard:** 1–7 pick a hand card, Enter ends the turn, Esc cancels.

## Files

- `game/` — the playable game, static files only, no network: `index.html`, `style.css`, `src/cards.js` (16 card defs), `src/deck.js` (seeded shuffle), `src/ai.js` (one brain for every AI seat), `src/render.js` (DOM table, 2/3/4-player layouts, hand states, animations), `src/game.js` (turns, combat, staging), `src/assets/` (29 crops from Yami's design sheets).
- `screenshots/` — 4 real renders: mid-game table (cover), title, win, loss.
- `shots.mjs` — the headless-Chrome driver: screenshots + auto-play + hand-state checks.
- `main.ts` — copies `game/` + `screenshots/` to `/output` and writes `dossier.json` (deterministic, verified twice).
- `vendor/makefun-game.ts` — the kit's dossier library, unchanged.
- `design-sheet*.jpg` (repo root) — the four design sheets Yami sent; every panel is used as art, layout, or an animation spec.

## Art

Every asset is cropped from the four design sheets Yami sent — nothing else, no heist sprites:

- **Sheet 1 (celestial):** title background + gold frame, 2-player table, moon card back, winged fox / bunny / gem / orb creatures, star potions, Turn compass, victory (wings + fireworks + gold ribbon) and defeat (dark crystal + chain + cracked ribbon) screens.
- **Sheet 2 (3–4 player):** 3-player gold frame, P2/P3 diagonal fans, P2/P3/P4 badges and vertical stacks, the complete Turn compass.
- **Sheet 3 (hand states):** fanned player hand, hidden opponent hand, red target + reticle, flip reveal — all implemented as working CSS/JS states, and the three panels illustrate the title screen's how-to row.
- **Sheet 4 (card actions):** draw (fly from deck), holding POV (big selected-card preview), sliding (play to the table), casting (star burst + pink-blue cloud) — all four are real animations, and the panels illustrate the title screen too.

Card values stay readable at thumbnail size: cost is a gold star, attack a red triangle, health a green diamond — colour AND shape, never text alone.

## Design notes

- The selected-card preview (Holding Card POV) floats over the table but never intercepts clicks — the player picks a target on the table while the big card is shown, exactly like the sheet's interaction panel.
- The 4-screenshot cap means only the 2-player table is shown as the cover; the 3- and 4-player layouts are proven by the play-test logs below (rotation, fans, stacks, badges all render and run), not by a fifth screenshot.

## Play it

```sh
python3 -m http.server 8080 --directory game   # then open http://localhost:8080
```

Or open `game/index.html` from any static server. Screenshot staging: `?shot=title|table|win|loss&mode=2|3|4&seed=7`.

## Play-tested

Full matches driven through real clicks in headless Chrome, 0 console errors in every run:

- **Win path (2-player):** smart driver won 3 of 5 seeds — seed 5 (turn 4), seed 21 (turn 13), seed 33 (turn 12).
- **Loss path (2-player):** smart driver lost seeds 11 and 42 (turn 7); idle driver (never played a card) lost turn 4 — the AI finishes games on its own.
- **3-player:** rotation P1 → P2 → P3 verified, meteor hit P2's face 20 → 17, 0 errors.
- **4-player:** rotation P1 → P2 → P3 → P4 verified, 0 errors.
- **Hand states + animations (7/7 checks):** hover-raise, select-preview, target-reticle, cast-burst (16 particles), slide-play, draw-fly, AI flip-reveal — all PASS via real CDP clicks.

Screenshots are real renders of the game's code at 1280×800: `01-table.jpg` (cover), `02-title.jpg`, `03-win.jpg`, `04-loss.jpg`.
