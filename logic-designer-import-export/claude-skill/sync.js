#!/usr/bin/env node
/*
 * sync.js — keep the skill's bundled copies in step with the canonical docs.
 *
 * The skill has to be self-contained (an installed skill can't reach back into
 * this repo), so it carries copies of the reference material. `vv-designer-reference/`
 * and `validate-vv-sketch.js` one level up remain the SOURCE OF TRUTH — after
 * editing any of them, re-run this script and commit the result.
 *
 *   node sync.js           copy source -> skill, report what changed
 *   node sync.js --check   report drift and exit 1 if any (no writes)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const SRC = path.join(HERE, '..');

// source (relative to logic-designer-import-export/) -> destination in the skill
const FILES = [
  ['vv-designer-reference/AI-BRIEFING.txt', 'references/briefing.txt'],
  ['vv-designer-reference/AI-EXAMPLES.txt', 'references/examples.txt'],
  ['vv-designer-reference/BLOCKS.md', 'references/blocks.md'],
  ['vv-sketch.schema.json', 'references/vv-sketch.schema.json'],
  ['validate-vv-sketch.js', 'scripts/validate-vv-sketch.js'],
];

const check = process.argv.includes('--check');
let drift = 0;
let copied = 0;

for (const [rel, dest] of FILES) {
  const from = path.join(SRC, rel);
  const to = path.join(HERE, dest);

  if (!fs.existsSync(from)) {
    console.error(`MISSING source: ${rel}`);
    drift++;
    continue;
  }

  const src = fs.readFileSync(from);
  const cur = fs.existsSync(to) ? fs.readFileSync(to) : null;

  if (cur && cur.equals(src)) continue;

  if (check) {
    console.log(`DRIFT  ${dest}  (differs from ${rel})`);
    drift++;
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, src);
    console.log(`copied ${rel} -> ${dest}`);
    copied++;
  }
}

if (check) {
  console.log(drift ? `\n${drift} file(s) out of sync — run: node sync.js` : 'in sync');
  process.exit(drift ? 1 : 0);
}
console.log(copied ? `\n${copied} file(s) updated` : 'already in sync — nothing to do');
