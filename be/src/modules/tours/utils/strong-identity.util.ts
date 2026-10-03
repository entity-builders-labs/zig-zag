import {
  EntityCandidate,
  StrongIdentity,
} from '../interfaces/experience-resolution.interface';

/**
 * Every strong identity a candidate carries: its declared `identities` when
 * present (multi-identity entities), otherwise its single
 * `(provider, externalId)` pair. Deduplicated, declaration order kept.
 */
export function strongIdentitiesOf(
  candidate: Pick<EntityCandidate, 'provider' | 'externalId' | 'identities'>,
): StrongIdentity[] {
  const declared = candidate.identities?.length
    ? candidate.identities
    : [{ provider: candidate.provider, externalId: candidate.externalId }];
  const seen = new Set<string>();
  const identities: StrongIdentity[] = [];
  for (const identity of declared) {
    if (!identity.provider || !identity.externalId) continue;
    const key = strongIdentityKey(identity);
    if (seen.has(key)) continue;
    seen.add(key);
    identities.push({
      provider: identity.provider,
      externalId: identity.externalId,
    });
  }
  return identities;
}

/** `openstreetmap/osm:node:3348573778` -- exact equality only. */
export function strongIdentityKey(identity: StrongIdentity): string {
  return `${identity.provider}/${identity.externalId}`;
}
