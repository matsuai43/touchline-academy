// Shared strength-to-chance curve for played matches and simulated rival matches.
export const STRENGTH_RATIO_K = 27;

export function strengthRatio(diff: number): number {
  return Math.exp(diff / STRENGTH_RATIO_K);
}
