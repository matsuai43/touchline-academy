import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BGM_SCENES,
  SFX_LIST,
  getAudioSettings,
  setAudioSettings,
  subscribeAudioSettings,
  isAudioSupported,
  primeAudio,
  playScene,
  playSfx,
  stopAll,
  type BgmScene,
  type SfxName,
} from '../lib/audio.ts';

// このテストは Node.js の `node:test` ランナー上で実行される。
// window / document / localStorage / AudioContext はすべて存在しない。
// W7 の最重要条件は「そうした環境で例外を投げず、安全に無効化されること」。
// 以下のテストは一貫してそれを検証する（=「落ちない」ことそのものがテストの主眼）。

void test('AudioContext が存在しない環境では isAudioSupported が false を返す', () => {
  assert.equal(typeof window, 'undefined');
  assert.equal(typeof (globalThis as { AudioContext?: unknown }).AudioContext, 'undefined');
  assert.equal(isAudioSupported(), false);
});

void test('初期状態は消音（BGM・SE ともに OFF）', () => {
  const s = getAudioSettings();
  assert.equal(s.bgmOn, false);
  assert.equal(s.seOn, false);
  assert.ok(s.bgmVolume >= 0 && s.bgmVolume <= 1);
  assert.ok(s.seVolume >= 0 && s.seVolume <= 1);
});

void test('BGM 場面は 3〜5 つ定義され、必須の5場面をすべて含む', () => {
  const ids = BGM_SCENES.map((s) => s.id);
  assert.ok(ids.length >= 3 && ids.length <= 5);
  const required: BgmScene[] = ['clubhouse', 'prematch', 'match', 'victory', 'defeat'];
  for (const r of required) assert.ok(ids.includes(r), `missing scene: ${r}`);
  assert.equal(new Set(ids).size, ids.length);
  for (const scene of BGM_SCENES) {
    assert.ok(scene.label.length > 0);
    assert.ok(scene.desc.length > 0);
  }
});

void test('効果音は必須の5種をすべて含む', () => {
  const ids = SFX_LIST.map((s) => s.id);
  const required: SfxName[] = ['click', 'whistle', 'kick', 'goal', 'cheer'];
  for (const r of required) assert.ok(ids.includes(r), `missing sfx: ${r}`);
  assert.equal(new Set(ids).size, ids.length);
});

void test('setAudioSettings は 0..1 にクランプし、in-memory の設定を更新する（例外なし）', () => {
  const next = setAudioSettings({ bgmOn: true, bgmVolume: 5, seVolume: -3 });
  assert.equal(next.bgmOn, true);
  assert.equal(next.bgmVolume, 1);
  assert.equal(next.seVolume, 0);
  assert.deepEqual(getAudioSettings(), next);
  // 部分更新は他フィールドを保持する。
  const next2 = setAudioSettings({ seOn: true });
  assert.equal(next2.bgmOn, true);
  assert.equal(next2.seOn, true);
  assert.equal(next2.bgmVolume, 1);
  // 元に戻す（後続テストへの影響を避ける）。
  setAudioSettings({ bgmOn: false, seOn: false, bgmVolume: 0.55, seVolume: 0.6 });
});

void test('subscribeAudioSettings は変更を通知し、解除後は呼ばれない', () => {
  const seen: boolean[] = [];
  const unsub = subscribeAudioSettings((s) => seen.push(s.bgmOn));
  setAudioSettings({ bgmOn: true });
  assert.deepEqual(seen, [true]);
  unsub();
  setAudioSettings({ bgmOn: false });
  assert.deepEqual(seen, [true]); // 解除後は増えない
});

void test('AudioContext のない環境でも primeAudio / playScene / playSfx / stopAll は一切例外を投げない', () => {
  assert.doesNotThrow(() => primeAudio());
  const scenes: (BgmScene | null)[] = ['clubhouse', 'prematch', 'match', 'victory', 'defeat', null];
  for (const scene of scenes) {
    assert.doesNotThrow(() => playScene(scene));
  }
  const sfx: SfxName[] = ['click', 'whistle', 'kick', 'goal', 'cheer'];
  for (const name of sfx) {
    assert.doesNotThrow(() => playSfx(name));
  }
  assert.doesNotThrow(() => stopAll());
});

void test('BGM/SE が ON でも、非対応環境では設定値が変わるだけで音の再生自体は安全に無視される', () => {
  setAudioSettings({ bgmOn: true, seOn: true, bgmVolume: 0.8, seVolume: 0.9 });
  assert.doesNotThrow(() => playScene('match'));
  assert.doesNotThrow(() => playScene('victory'));
  assert.doesNotThrow(() => playSfx('goal'));
  assert.equal(getAudioSettings().bgmOn, true);
  setAudioSettings({ bgmOn: false, seOn: false });
});

void test('繰り返し呼び出しても例外を投げない（画面遷移での多重呼び出しを想定）', () => {
  for (let i = 0; i < 50; i++) {
    playScene(i % 2 === 0 ? 'clubhouse' : 'match');
    playSfx('click');
  }
  stopAll();
});
