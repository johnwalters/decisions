export type HealthyThresholds = { enabled: boolean; minHealthy: number; maxRotten: number };
export type PolicyAnswer = { type: string; choice?: string; probabilities?: { value: string; probability: number }[] };
export const defaultThresholds: HealthyThresholds = { enabled: false, minHealthy: 70, maxRotten: 25 };
export function normalizeThresholds(value: unknown): HealthyThresholds {
  if (!value || typeof value !== 'object') return { ...defaultThresholds };
  const candidate = value as Partial<HealthyThresholds>;
  const bounded = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : fallback;
  return { enabled: candidate.enabled === true, minHealthy: bounded(candidate.minHealthy,70), maxRotten: bounded(candidate.maxRotten,25) };
}
export function apiCategory(answer?: PolicyAnswer): string {
  return !answer ? 'pending' : answer.type === 'refusal' ? 'refused' : answer.choice || 'unclear';
}
export function routedCategory(answer: PolicyAnswer | undefined, thresholds: HealthyThresholds): string {
  const category = apiCategory(answer);
  if (!thresholds.enabled || category !== 'healthy') return category;
  const healthy = answer?.probabilities?.find(p=>p.value==='healthy')?.probability;
  const rotten = answer?.probabilities?.find(p=>p.value==='rotten')?.probability;
  if (healthy === undefined || rotten === undefined || !Number.isFinite(healthy) || !Number.isFinite(rotten)) return 'unclear';
  // Compare against fractional thresholds to avoid multiplying floating-point probabilities.
  return healthy >= thresholds.minHealthy/100 && rotten <= thresholds.maxRotten/100 ? 'healthy' : 'unclear';
}
