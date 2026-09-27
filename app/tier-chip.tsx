'use client';
// V4-4/V4-8: 対戦相手の所属の札（DESIGN_V4 3.2章）。「県1部」「地域・関東」「全国EAST」のように
// 階層＋（地域リーグ・全国リーグは）地域名/EAST・WESTを文字で示す（色だけに頼らない）。
// 全国大会の代表チーム（`asRepresentative`）は「◯◯代表」を先頭に付け足す。
// tier が無い（旧セーブ由来などで所属が分からない）場合は何も描画しない。
//
// 元々 app/competition-ui.tsx にのみ置かれていたが、app/game-ui.tsx の対戦カード
// （試合日カード）でも同じ見た目を使うため、共通ファイルに切り出した。
import { districtById, tierLabel, districtRegion, type SchoolTier, type DistrictId } from '@/lib/competition';

export function TierChip({
  tier,
  districtId,
  asRepresentative,
}: {
  tier?: SchoolTier;
  districtId?: DistrictId;
  asRepresentative?: boolean;
}) {
  if (!tier) return null;
  const region = districtId ? districtRegion(districtId) : undefined;
  const label = tierLabel(tier, region);
  const repPrefix = asRepresentative && districtId ? `${districtById(districtId).name}代表・` : '';
  return (
    <span className={`school-tier-chip${tier === 'national' ? ' school-tier-chip--national' : ''}`}>
      {repPrefix}
      {label}
    </span>
  );
}
