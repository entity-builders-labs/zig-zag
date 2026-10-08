import {
  ConvergenceIndependence,
  ConvergenceObservation,
  IdentityEvidence,
  ResolutionStrategy,
  StrongIdentity,
} from '../interfaces/experience-resolution.interface';

/**
 * An IDENTITY_CONVERGENCE fact whose observations really have the stated
 * independence, so a fixture cannot claim INDEPENDENT_ORIGINS over one
 * shared record:
 *  - SHARED_ORIGIN: both strategies read the converged OSM record;
 *  - INDEPENDENT_ORIGINS: the prior read the OSM record, this attempt a
 *    record another dataset authored (linked by the shared identity);
 *  - UNDETERMINED_ORIGIN: this attempt's adapter declared no origin.
 */
export function identityConvergence(
  independence: ConvergenceIndependence,
  identity: StrongIdentity = {
    provider: 'openstreetmap',
    externalId: 'osm:node:1',
  },
  priorStrategy: ResolutionStrategy = 'NOMINATIM',
  strategy: ResolutionStrategy = 'PLACES',
): Extract<IdentityEvidence, { type: 'IDENTITY_CONVERGENCE' }> {
  const prior: ConvergenceObservation = {
    strategy: priorStrategy,
    origins: [{ authority: 'openstreetmap', recordId: identity.externalId }],
  };
  const origins: Record<
    ConvergenceIndependence,
    ConvergenceObservation['origins']
  > = {
    SHARED_ORIGIN: prior.origins,
    INDEPENDENT_ORIGINS: [
      { authority: 'independent_dataset', recordId: 'record-1' },
    ],
    UNDETERMINED_ORIGIN: [],
  };
  return {
    type: 'IDENTITY_CONVERGENCE',
    priorStrategy,
    identity,
    observations: [prior, { strategy, origins: origins[independence] }],
    independence,
  };
}
