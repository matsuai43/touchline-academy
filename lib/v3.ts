// v3 統合ハブ。State には `v3` という1フィールドのみを追加し、各ワークストリームは
// この下に自分の名前空間を持つ（W1: squad。W2/W3 は後から competition / life を足す）。
import type { State } from './game.ts';
import { hydrateSquad, validateSquad, type SquadState } from './squad.ts';

export type V3State = {
  schema: 3;
  squad: SquadState;
};

export function hydrateV3(s: State): void {
  if (!s.v3 || s.v3.schema !== 3) {
    s.v3 = { schema: 3, squad: { schema: 1, players: {} } };
  } else if (!s.v3.squad || s.v3.squad.schema !== 1) {
    s.v3.squad = { schema: 1, players: {} };
  }
  hydrateSquad(s);
}

export function validateV3(s: State): State {
  if (!s.v3 || s.v3.schema !== 3) throw Error('v3データが不正です。');
  validateSquad(s);
  return s;
}
