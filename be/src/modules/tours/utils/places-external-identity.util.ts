import { PlacesProvider } from '@integrations/google-places/interfaces/places-api.interface';
import { ExperienceAcquisitionProvider } from '../interfaces/experience-acquisition.interface';

/**
 * The single canonical mapping between a Places backend
 * (`IPlacesApiService.provider`) and the `ExperienceAcquisitionProvider`
 * label a `SourceObservation` produced by that same backend carries.
 * Intentionally a separate, self-contained mapping from
 * `google-places-acquisition.provider.ts`'s own (private, forward-only)
 * `ACQUISITION_PROVIDER_BY_PLACES_PROVIDER` rather than importing it --
 * this one is consumed by the resolver, which has no reason to depend on
 * the acquisition provider module, and the two are trivially kept in sync
 * (both are exhaustive `Record`s over the same two-value `PlacesProvider`
 * union, so a missing/renamed case fails to typecheck in either file).
 */
const ACQUISITION_LABEL_BY_PLACES_PROVIDER = {
  google: 'google_places',
  geoapify: 'geoapify',
} satisfies Record<PlacesProvider, ExperienceAcquisitionProvider>;

const PLACES_PROVIDER_BY_ACQUISITION_LABEL: Partial<
  Record<ExperienceAcquisitionProvider, PlacesProvider>
> = {
  google_places: 'google',
  geoapify: 'geoapify',
};

/**
 * The `ExperienceAcquisitionProvider` label a `SourceObservation` produced
 * by this Places backend carries (e.g. `'google_places'` for `'google'`).
 */
export function placesAcquisitionLabel(
  provider: PlacesProvider,
): ExperienceAcquisitionProvider {
  return ACQUISITION_LABEL_BY_PLACES_PROVIDER[provider];
}

/**
 * The Places backend that must have produced a `SourceObservation` carrying
 * this acquisition provider label, or `undefined` when the label does not
 * name a Places backend at all (e.g. `'wikivoyage'`, `'wikidata'`, `'web'`)
 * -- those never carry a Places-fetchable `externalId`.
 */
export function acquisitionLabelToPlacesProvider(
  provider: ExperienceAcquisitionProvider,
): PlacesProvider | undefined {
  return PLACES_PROVIDER_BY_ACQUISITION_LABEL[provider];
}

/**
 * The ONE canonical persisted external-identity string for a Places record,
 * shared by every code path that ever persists one (today: `resolveViaPlaces`
 * and the trusted-observation reuse path) -- `GeoEntityService.upsertGeoEntity`
 * dedupes on the exact `(provider, externalId)` pair, so any two paths
 * producing a different string for the SAME real record (e.g. a bare
 * `"ChIJ..."` from one path and a `"google_places:ChIJ..."` from another)
 * silently fragments one real place into two `GeoEntityIdentity` rows.
 */
export function canonicalPlacesExternalId(
  provider: PlacesProvider,
  rawPlaceId: string,
): string {
  return `${placesAcquisitionLabel(provider)}:${rawPlaceId}`;
}
