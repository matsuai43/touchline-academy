// v3 統合ハブ。State には `v3` という1フィールドのみを追加し、各ワークストリームは
// この下に自分の名前空間を持つ（W1: squad。W2/W3 は後から competition / life を足す）。
import type { State } from './game.ts';
import { hydrateSquad, validateSquad, type SquadState } from './squad.ts';
import { hydrateLife, validateLife, defaultLifeState, type LifeState } from './school-life.ts';
import { hydrateCompetition, validateCompetition, type CompState } from './competition.ts';

export type V3State = {
  schema: 3;
  squad: SquadState;
  life: LifeState;
  competition: CompState;
};

export function hydrateV3(s: State): void {
  if (!s.v3 || s.v3.schema !== 3) {
    s.v3 = {
      schema: 3,
      squad: { schema: 1, players: {} },
      life: defaultLifeState(),
      // hydrateCompetition() が直後に必ず決定的な値で埋めるため、ここでは未設定のままでよい。
      competition: null!,
    };
  } else if (!s.v3.squad || s.v3.squad.schema !== 1) {
    s.v3.squad = { schema: 1, players: {} };
  }
  hydrateSquad(s);
  hydrateLife(s);
  hydrateCompetition(s);
}

export function validateV3(s: State): State {
  if (!s.v3 || s.v3.schema !== 3) throw Error('v3データが不正です。');
  validateSquad(s);
  validateLife(s);
  validateCompetition(s);
  return s;
}
