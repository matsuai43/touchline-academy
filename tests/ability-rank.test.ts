import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RANKS,
  RANK_IDS,
  RANK_BY_ID,
  rankOf,
  rankLetterOf,
  rankAriaLabel,
  contrastRatio,
  type RankId,
} from '../lib/ability-rank.ts';

void test('rankOf classifies every documented boundary value into the right rank (A is the top)', () => {
  const cases: [number, RankId][] = [
    [19, 'G'],
    [20, 'F'],
    [39, 'F'],
    [40, 'E'],
    [49, 'E'],
    [50, 'D'],
    [59, 'D'],
    [60, 'C'],
    [69, 'C'],
    [70, 'B'],
    [79, 'B'],
    [80, 'A'],
    [99, 'A'],
  ];
  for (const [value, expected] of cases) {
    assert.equal(
      rankOf(value).id,
      expected,
      `value ${value} should be rank ${expected}, got ${rankOf(value).id}`,
    );
  }
});

void test('rankOf handles out-of-range values by clamping to the nearest end (never throws, never undefined)', () => {
  assert.equal(rankOf(0).id, 'G');
  assert.equal(rankOf(-5).id, 'G');
  assert.equal(rankOf(150).id, 'A');
});

void test('rankLetterOf returns the same letter as rankOf(...).letter', () => {
  for (let v = 0; v <= 99; v++) assert.equal(rankLetterOf(v), rankOf(v).letter);
});

void test('all 7 ranks are present, ordered A (highest) to G (lowest), each with a unique letter matching its id', () => {
  const expectedIds: RankId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  assert.deepEqual(RANK_IDS, expectedIds);
  assert.equal(RANKS.length, 7);
  const letters = new Set(RANKS.map((r) => r.letter));
  assert.equal(letters.size, 7, 'each rank must have a distinct letter');
  assert.equal(RANKS[0].letter, 'A');
  assert.equal(RANKS[RANKS.length - 1].letter, 'G');
  // the letter always matches the rank id (single uppercase A-G, no Greek/other chars).
  for (const r of RANKS) assert.equal(r.letter, r.id);
  // strictly descending thresholds
  for (let i = 1; i < RANKS.length; i++) {
    assert.ok(
      RANKS[i - 1].min > RANKS[i].min,
      `${RANKS[i - 1].id} min (${RANKS[i - 1].min}) should be greater than ${RANKS[i].id} min (${RANKS[i].min})`,
    );
  }
  // every rank has full light/dark color info
  for (const r of RANKS) {
    assert.ok(/^#[0-9a-f]{6}$/i.test(r.colors.light.fg));
    assert.ok(/^#[0-9a-f]{6}$/i.test(r.colors.light.bg));
    assert.ok(/^#[0-9a-f]{6}$/i.test(r.colors.dark.fg));
    assert.ok(/^#[0-9a-f]{6}$/i.test(r.colors.dark.bg));
    assert.equal(RANK_BY_ID[r.id], r);
  }
});

void test('rankAriaLabel includes the letter and numeric value, with an optional label prefix, in the "ランクA" form', () => {
  const label = rankAriaLabel(85);
  assert.match(label, /ランクA/);
  assert.match(label, /85/);
  const withName = rankAriaLabel(85, '総合力');
  assert.match(withName, /^総合力：/);
});

void test('contrastRatio matches known WCAG reference pairs (black/white = 21:1, identical colors = 1:1)', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.05);
  assert.equal(contrastRatio('#123456', '#123456'), 1);
  assert.equal(contrastRatio('#abcabc', '#123456'), contrastRatio('#123456', '#abcabc'));
});

void test('every rank’s text/background combination clears 4.5:1 in both light and dark themes', () => {
  for (const r of RANKS) {
    const lightRatio = contrastRatio(r.colors.light.fg, r.colors.light.bg);
    const darkRatio = contrastRatio(r.colors.dark.fg, r.colors.dark.bg);
    assert.ok(
      lightRatio >= 4.5,
      `${r.id} light fg/bg contrast is ${lightRatio.toFixed(2)}, must be >= 4.5`,
    );
    assert.ok(
      darkRatio >= 4.5,
      `${r.id} dark fg/bg contrast is ${darkRatio.toFixed(2)}, must be >= 4.5`,
    );
  }
});

void test('every rank’s foreground (reused as the gauge fill) clears 3:1 against both the page background and the muted track color, in both themes', () => {
  // app/globals.css: --background (light #ffffff / dark #0c1316), --muted (light #f2f2f2 / dark #26333a).
  const backgrounds = {
    light: ['#ffffff', '#f2f2f2'],
    dark: ['#0c1316', '#26333a'],
  } as const;
  for (const r of RANKS) {
    for (const bg of backgrounds.light) {
      const ratio = contrastRatio(r.colors.light.fg, bg);
      assert.ok(
        ratio >= 3,
        `${r.id} light fg vs ${bg} contrast is ${ratio.toFixed(2)}, must be >= 3`,
      );
    }
    for (const bg of backgrounds.dark) {
      const ratio = contrastRatio(r.colors.dark.fg, bg);
      assert.ok(
        ratio >= 3,
        `${r.id} dark fg vs ${bg} contrast is ${ratio.toFixed(2)}, must be >= 3`,
      );
    }
  }
});

void test('the good-skill blue tokens used for positive special-ability chips also clear 4.5:1 in both themes', () => {
  // app/globals.css --skill-good-fg / --skill-good-bg (kept in sync with these values by hand).
  const light = { fg: '#1d4ed8', bg: '#e3edfb' };
  const dark = { fg: '#a8c6fb', bg: '#1a2740' };
  assert.ok(contrastRatio(light.fg, light.bg) >= 4.5);
  assert.ok(contrastRatio(dark.fg, dark.bg) >= 4.5);
});
