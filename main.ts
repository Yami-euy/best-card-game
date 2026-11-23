// main.ts — STARLIGHT DUEL: Duel Kartu Rasi Bintang (Node 22, standard library only).
//
// The entry is the static card game in game/ plus the 4 screenshots in
// screenshots/. This program hands them in: it copies both folders beside
// this file into the grader's output directory and writes dossier.json,
// the summary the judge reads, with the vendored make.fun library.
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The program runs twice and both runs must write identical bytes: copying
// whole folders and one deterministic dossier call guarantees that.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The game first: every static file under game/, nothing left behind.
mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });

// Then the screenshots, if the maker has taken them (they live beside the
// game in this repository, named 01-… to 04-… with the cover first).
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

// The dossier is byte for byte what the vendored library writes from the
// output just built, under the same caps the sealed gate enforces.
writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
