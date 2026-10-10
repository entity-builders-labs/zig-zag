import { PlacesProvider } from '@integrations/google-places/interfaces/places-api.interface';
import { ExperienceAcquisitionProvider } from '../interfaces/experience-acquisition.interface';

/**
 * The single canonical mapping between a Places backend
 * (`IPlacesApiService.provider`) and the `ExperienceAcquisitionProvider`
 * label a `SourceObservation` produced by that same backend carries.
 * This is the single canonical mapping, consumed by both acquisition and
 * resolution paths.
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
 * Every real runtime `SourceObservation.provider` label the Places
 * CAPABILITY can produce, regardless of which `IPlacesApiService` backend
 * (`PlacesApiConfig.PLACES_PROVIDER`) is actually configured. The historical
 * `google_places` `SourcePlan`/capability discriminator names "route this
 * deficit to Places", not "Google specifically served it" — a plan routed to
 * that capability may be fulfilled by Google OR Geoapify. Callers that need
 * to associate observations back to the capability that requested them (e.g.
 * the generation Bitácora) must match against this set, never against the
 * literal `SourcePlan.provider` string.
 */
export const PLACES_ACQUISITION_PROVIDER_LABELS: ExperienceAcquisitionProvider[] =
  Object.values(ACQUISITION_LABEL_BY_PLACES_PROVIDER);

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
