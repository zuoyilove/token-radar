// Token launch radar: a ranked board of pre-token protocols, priced by the market's own
// category multiples, with a farm plan and a risk read for every row.
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// builds the board with the model in lib/model.ts, writes /output/board.json and
// /output/data.js, copies this repository's dashboard/ and screenshots/ beside them, and
// last writes /output/dossier.json with the vendored make.fun library — the file the
// scorer rebuilds from the same output and compares byte for byte, so it is written last
// and from the finished tree.
//
// Node 22, standard library only, no network. The same input writes the same bytes twice.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory tree's regular files into `to`, skipping names that start with a dot. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  const copied: string[] = [];
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(from, rel))) {
      if (name.startsWith('.')) continue;
      const r = rel === '' ? name : `${rel}/${name}`;
      const path = join(from, r);
      if (statSync(path).isDirectory()) {
        walk(r);
      } else if (statSync(path).isFile()) {
        mkdirSync(join(to, rel), { recursive: true });
        copyFileSync(path, join(to, r));
        copied.push(r);
      }
    }
  };
  walk('');
  return copied;
}

const dashFiles = copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
if (!dashFiles.includes('index.html')) {
  process.stderr.write('token radar: dashboard/ holds no index.html: the page is part of the deliverable\n');
  process.exit(1);
}
const shots = copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > SCREENSHOT_CAPS.max) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3 or 4, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked ` +
    `(${radar.early_size} early, ${radar.live_size} live set aside), global multiple ${radar.global_multiple}x from ${radar.token_bearing_sample} token-bearing protocols\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images) and dossier.json under ${out}\n`,
);
