import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIFE_EVENTS } from '../lib/school-life.ts';
import {
  SCENE_IDS,
  EVENT_SCENES,
  EVENT_SCENES_BY_ID,
  CLUB_EVENT_IDS,
  CUP_DRAW_EVENT_IDS,
  getEventScenePanels,
  validateEventScenes,
  type SceneId,
} from '../lib/event-scenes.ts';

// このテストは lib/event-scenes.ts（DOM非依存の純粋データ）だけを検証する。
// app/event-scenes.tsx は JSX を含む DOM 専用ファイルのため、プレーンな
// node:test（--experimental-strip-types は型だけを剥がし、JSXは変換しない）
// からは直接 import できない。代わりに、app/event-scenes.tsx の
// SceneArt が SCENE_IDS の12種すべてを網羅して描画していることを
// 実装として保証し（switch文が SceneId の全メンバーを分岐している）、
// ここでは各イベントが参照する場面IDが SCENE_IDS（＝SVGライブラリが
// 実装している場面の一覧）に含まれることを確認することで、間接的に
// 「参照する場面IDがすべてSVGライブラリに存在する」ことを検証する。

void test('validateEventScenes は例外を投げない（場面対応表そのものの自己検証）', () => {
  assert.doesNotThrow(() => validateEventScenes());
});

void test('場面（SVG背景）は10〜12種として定義されている', () => {
  assert.ok(SCENE_IDS.length >= 10 && SCENE_IDS.length <= 12, `場面数: ${SCENE_IDS.length}`);
  const uniq = new Set(SCENE_IDS);
  assert.equal(uniq.size, SCENE_IDS.length, '場面IDが重複しています');
});

void test('36の学校生活イベントすべてにパネル列（establishing/moment/result）が定義されている', () => {
  assert.equal(LIFE_EVENTS.length, EVENT_SCENES.length - CLUB_EVENT_IDS.length - CUP_DRAW_EVENT_IDS.length);
  for (const e of LIFE_EVENTS) {
    const panels = getEventScenePanels(e.id);
    assert.ok(panels, `${e.id} の場面が見つかりません`);
    assert.ok(panels!.length >= 2 && panels!.length <= 3, `${e.id} のパネル数が2〜3枚の範囲外: ${panels!.length}`);
    assert.equal(panels!.filter((p) => p.role === 'establishing').length, 1, `${e.id}: establishing`);
    assert.equal(panels!.filter((p) => p.role === 'moment').length, 1, `${e.id}: moment`);
    assert.equal(panels!.filter((p) => p.role === 'result').length, 1, `${e.id}: result`);
  }
});

void test('クラブイベント3種すべてにパネル列が定義されている', () => {
  assert.equal(CLUB_EVENT_IDS.length, 3);
  for (const id of CLUB_EVENT_IDS) {
    const panels = getEventScenePanels(id);
    assert.ok(panels, `${id} の場面が見つかりません`);
    assert.ok(panels!.length >= 2 && panels!.length <= 3);
  }
});

void test('T-12: 組み合わせ抽選イベント2種すべてにパネル列が定義されている', () => {
  assert.equal(CUP_DRAW_EVENT_IDS.length, 2);
  for (const id of CUP_DRAW_EVENT_IDS) {
    const panels = getEventScenePanels(id);
    assert.ok(panels, `${id} の場面が見つかりません`);
    assert.ok(panels!.length >= 2 && panels!.length <= 3);
  }
});

void test('未登録のイベントIDには null を返す', () => {
  assert.equal(getEventScenePanels('no_such_event_id'), null);
});

void test('すべてのパネルが参照する場面IDはSVGライブラリ（SCENE_IDS）に存在する', () => {
  const sceneSet = new Set<SceneId>(SCENE_IDS);
  for (const entry of EVENT_SCENES) {
    for (const panel of entry.panels) {
      assert.ok(sceneSet.has(panel.scene), `${entry.id}(${panel.role}) の場面「${panel.scene}」が未実装`);
    }
  }
});

void test('SCENE_IDS の全場面が、少なくとも1つのイベントから使われている（余剰場面がない）', () => {
  const used = new Set<SceneId>();
  for (const entry of EVENT_SCENES) for (const panel of entry.panels) used.add(panel.scene);
  for (const id of SCENE_IDS) assert.ok(used.has(id), `場面「${id}」がどのイベントからも使われていません`);
});

void test('各パネルの aria-label 用の説明文は空でない', () => {
  for (const entry of EVENT_SCENES) {
    for (const panel of entry.panels) {
      const label = panel.ariaLabel('七瀬');
      assert.equal(typeof label, 'string');
      assert.ok(label.trim().length > 0, `${entry.id}(${panel.role}) の aria-label が空です`);
    }
  }
});

void test('establishing パネルのナレーションは空でなく、選手名を差し込んでも壊れない', () => {
  for (const entry of EVENT_SCENES) {
    const establishing = entry.panels.find((p) => p.role === 'establishing');
    assert.ok(establishing, `${entry.id} に establishing がありません`);
    assert.ok(establishing!.narration, `${entry.id} の establishing に narration がありません`);
    const text = establishing!.narration!('七瀬');
    assert.ok(text.trim().length > 0, `${entry.id} の establishing narration が空です`);
    const textForAnother = establishing!.narration!('新入生太郎');
    assert.equal(typeof textForAnother, 'string');
  }
});

void test('EVENT_SCENES_BY_ID は EVENT_SCENES と矛盾しない', () => {
  for (const entry of EVENT_SCENES) {
    assert.equal(EVENT_SCENES_BY_ID[entry.id], entry);
  }
  assert.equal(Object.keys(EVENT_SCENES_BY_ID).length, EVENT_SCENES.length);
});
