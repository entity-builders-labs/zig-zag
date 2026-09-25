import { PlaceFeatureClass } from '@integrations/google-places/interfaces/places-api.interface';

/**
 * Feature classes a PLACE component can never be, whatever its name:
 *  - `street`: a ROUTE-shaped object -- ROUTE hints belong to the targeted
 *    ROUTE resolver, never to a PLACE text search ("Defensa Street");
 *  - `administrative_area` / `postcode`: an AREA-scale or postal unit
 *    ("San Martín" -> the Partido de General San Martín);
 *  - `transport_stop`: a stop/dock named after the landmark it serves, not
 *    the landmark ("Parque Lezama" bus stops).
 */
const NOT_A_PLACE: ReadonlySet<PlaceFeatureClass> = new Set<PlaceFeatureClass>([
  'street',
  'administrative_area',
  'postcode',
  'transport_stop',
]);

export type PlaceStructuralCompatibility =
  | { verdict: 'COMPATIBLE' }
  | { verdict: 'INCOMPATIBLE'; featureClass: PlaceFeatureClass };

/**
 * Answers only "can this KIND of provider object be a PLACE?" from the
 * provider's own structural declaration -- never "is this the hinted
 * entity?". No name, distance or ranking fact is consulted here; identity
 * stays with IdentityVerifier. An undeclared class is unknown, not a
 * rejection (providers such as Google Text Search only ever return places).
 */
export function evaluatePlaceStructuralCompatibility(
  featureClass: PlaceFeatureClass | undefined,
): PlaceStructuralCompatibility {
  if (featureClass && NOT_A_PLACE.has(featureClass)) {
    return { verdict: 'INCOMPATIBLE', featureClass };
  }
  return { verdict: 'COMPATIBLE' };
}
