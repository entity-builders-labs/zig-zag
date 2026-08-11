export interface ActivityVerificationResult<T> {
  verified: T[];
  hallucinatedCount: number;
  duplicateCount: number;
}

/**
 * Keeps only activities that trace back to a real candidate the model was
 * offered (drops hallucinations), then removes repeated picks of the same
 * place (drops duplicates). Order is preserved.
 */
export function verifyAndDedupeActivities<T extends { activityId?: string }>(
  rawActivities: T[],
  candidateActivityIds: Set<string>,
): ActivityVerificationResult<T> {
  const verified = rawActivities.filter(
    (act) => act.activityId != null && candidateActivityIds.has(act.activityId),
  );
  const hallucinatedCount = rawActivities.length - verified.length;

  const seenActivityIds = new Set<string>();
  const unique = verified.filter((act) => {
    if (seenActivityIds.has(act.activityId as string)) return false;
    seenActivityIds.add(act.activityId as string);
    return true;
  });
  const duplicateCount = verified.length - unique.length;

  return { verified: unique, hallucinatedCount, duplicateCount };
}
