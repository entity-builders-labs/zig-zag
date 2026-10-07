import { CandidateStructuralKind } from '../interfaces/component-identity-context.interface';

/**
 * Structural kinds a PLACE component can never be, whatever its name:
 *  - ROAD: a ROUTE-shaped object -- ROUTE hints belong to the targeted
 *    ROUTE resolver, never to a PLACE ("Defensa Street");
 *  - ADMINISTRATIVE_AREA / POSTAL_UNIT: an AREA-scale or postal unit
 *    ("San Martín" -> the Partido de General San Martín);
 *  - TRANSPORT_STOP: a stop, platform or station named after the landmark
 *    it serves, not the landmark ("Parque Lezama" bus stops).
 */
const NOT_A_PLACE: ReadonlySet<CandidateStructuralKind> = new Set([
  'ROAD',
  'ADMINISTRATIVE_AREA',
  'POSTAL_UNIT',
  'TRANSPORT_STOP',
] as const);

export type StructuralCompatibility = 'COMPATIBLE' | 'INCOMPATIBLE';

/**
 * The single authority for "can this KIND of record be the hinted
 * component?", read from the provider-neutral structural kind every
 * provider adapter normalizes to. It never answers "is this the hinted
 * entity?": no name, distance or ranking fact is consulted, and identity
 * stays with IdentityVerifier. It gates both which records a PLACE search
 * may select and which records can be material competitors
 * (`examineCompetitors`), for every provider alike. An unknown structure,
 * or an expected kind with no defined exclusions, is not a rejection.
 */
export function evaluateStructuralCompatibility(
  expectedKind: string | undefined,
  structuralKind: CandidateStructuralKind | undefined,
): StructuralCompatibility {
  if (
    expectedKind === 'PLACE' &&
    structuralKind &&
    NOT_A_PLACE.has(structuralKind)
  ) {
    return 'INCOMPATIBLE';
  }
  return 'COMPATIBLE';
}
