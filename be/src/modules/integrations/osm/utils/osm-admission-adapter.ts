import {
  AdmissionExclusionClass,
  AdmissionSignal,
  AdmissionSignalEvidence,
  AdmissionSignalType,
  admissionSignal,
  CanonicalPlaceClass,
  ChildPlaceClass,
  ParentPlaceClass,
} from '@tours/admission/structured-admission-policy';
import { PerInstanceEvidence } from '@tours/admission/parent-site-visit-unit.policy';
import {
  HeritageScope,
  ProminenceEvidenceFact,
} from '@tours/prominence/structured-prominence.policy';
import { StructuredPlaceCoverage } from '@tours/constants/acquisition-source-routing';
import { TargetObservationFact } from '@tours/preferences/target-knowledge.interface';
import { ReconciliationGeometry } from '@tours/utils/structured-identity-reconciliation.policy';
import { GeoJsonGeometry } from '@shared/geo/geojson-geometry';

/** Normalize OSM geometry to the canonical identity-correspondence shape. */
export function osmGeometryToReconciliationGeometry(
  geometry: GeoJsonGeometry,
): ReconciliationGeometry | undefined {
  if (geometry.type === 'Point') {
    return {
      kind: 'POINT',
      longitude: geometry.coordinates[0],
      latitude: geometry.coordinates[1],
    };
  }
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
    return undefined;
  }
  const points =
    geometry.type === 'Polygon'
      ? geometry.coordinates.flat()
      : geometry.coordinates.flat(2);
  if (points.length === 0) return undefined;
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  return {
    kind: 'AREA',
    west: Math.min(...longitudes),
    south: Math.min(...latitudes),
    east: Math.max(...longitudes),
    north: Math.max(...latitudes),
  };
}

export interface OsmVisitUnitFacts {
  childClass?: ChildPlaceClass;
  parentClass?: ParentPlaceClass;
  perInstanceEvidence: PerInstanceEvidence;
}

export interface OsmVisitDurationEvidence {
  typicalMinutes: number;
  rawValue: string;
  field: 'visit_duration_minutes';
}

/** Normalize only an explicit provider duration; missing or invalid stays absent. */
export function osmTagsToVisitDurationEvidence(
  tags: Record<string, string> | undefined,
): OsmVisitDurationEvidence | undefined {
  const rawValue = tags?.visit_duration_minutes?.trim();
  if (!rawValue || !/^\d+$/.test(rawValue)) return undefined;
  const typicalMinutes = Number(rawValue);
  if (!Number.isSafeInteger(typicalMinutes) || typicalMinutes <= 0) {
    return undefined;
  }
  return {
    typicalMinutes,
    rawValue,
    field: 'visit_duration_minutes',
  };
}

/** Convert explicit OSM structural tags into the canonical visit-unit inputs. */
export function osmTagsToVisitUnitFacts(
  tags: Record<string, string> | undefined,
): OsmVisitUnitFacts {
  const t = tags ?? {};
  const childClass: ChildPlaceClass | undefined =
    t.tourism === 'artwork' || t.historic === 'memorial'
      ? 'artwork'
      : t.amenity === 'grave_yard' ||
          t.historic === 'grave_yard' ||
          t.historic === 'tomb'
        ? 'grave'
        : t.amenity !== undefined ||
            t.shop !== undefined ||
            t.craft !== undefined
          ? 'venue'
          : undefined;
  const parentClass: ParentPlaceClass | undefined =
    t.amenity === 'cemetery' ||
    t.landuse === 'cemetery' ||
    t.historic === 'cemetery'
      ? 'cemetery'
      : t.tourism === 'museum'
        ? 'museum'
        : t.leisure === 'park' ||
            t.tourism === 'theme_park' ||
            t.leisure === 'nature_reserve'
          ? 'park_or_complex'
          : undefined;

  return {
    childClass,
    parentClass,
    perInstanceEvidence: {
      ...(t.separate_entrance === 'yes' ? { separateEntrance: true } : {}),
      ...(t.separate_opening_hours === 'yes'
        ? { separateOpeningHours: true }
        : {}),
      ...(t.independent_venue === 'yes' ? { explicitVenueEvidence: true } : {}),
    },
  };
}

/**
 * OSM → canonical admission mapping (design C7, task 37.1). The OSM adapter
 * translates OSM tags into canonical admission signals, exclusion classes and
 * place classes. Downstream admission/ranking read only these canonical facts,
 * never the raw tags.
 *
 * This is the single authority for the OSM tag → signal/exclusion mapping:
 * `overpass-query.util.ts` derives its destination-scope discovery selectors
 * from `OSM_ADMISSION_DISCOVERY_SELECTORS` below, and nothing else may
 * maintain a hand-written tourism/admission selector or exclusion list.
 */

/**
 * `tourism=*` values that are accommodation, mapped to the ACCOMMODATION
 * exclusion class (overridable by a decisive signal). Order is significant:
 * the Overpass discovery query renders it as a regex alternation, and tests
 * pin that exact rendering.
 */
export const OSM_ACCOMMODATION_TOURISM_VALUES: readonly string[] = [
  'hotel',
  'hostel',
  'guest_house',
  'motel',
  'apartment',
  'camp_site',
  'caravan_site',
  'chalet',
  'wilderness_hut',
];

/**
 * `tourism=*` values that denote a standalone visitor destination (decisive
 * EXPLICIT_VISITOR_CLASSIFICATION). Object-level values such as `artwork` are
 * deliberately absent: a bare artwork is at most a supporting
 * VISITABLE_PLACE_CLASS, never decisive on its own (approved rule).
 */
const OSM_VISITOR_DESTINATION_TOURISM_VALUES = new Set([
  'attraction',
  'museum',
  'gallery',
  'viewpoint',
  'zoo',
  'aquarium',
  'theme_park',
]);

/** Non-visitable tourism infrastructure (INFORMATION_OR_SIGNAGE exclusion). */
const OSM_INFORMATION_TOURISM_VALUES = new Set(['information']);

/** Amenity values the public typically visits (supporting visitable class). */
const OSM_VISITABLE_AMENITY_VALUES = new Set([
  'marketplace',
  'place_of_worship',
  ...['cafe', 'restaurant', 'food_court'],
]);

/**
 * Food-and-drink venue classes. Supporting evidence only: an ordinary venue
 * class never admits on its own (C6); it needs independent notability or a
 * decisive signal.
 */
const OSM_FOOD_AND_DRINK_CLASSES: ReadonlyArray<{
  key: string;
  value: string;
}> = [
  { key: 'amenity', value: 'cafe' },
  { key: 'amenity', value: 'restaurant' },
  { key: 'amenity', value: 'food_court' },
  { key: 'amenity', value: 'marketplace' },
  { key: 'shop', value: 'bakery' },
];

/** Shop values the public typically visits (supporting visitable class). */
const OSM_VISITABLE_SHOP_VALUES = new Set(['bakery']);

/** Leisure values the public typically visits (supporting visitable class). */
const OSM_VISITABLE_LEISURE_VALUES = new Set([
  'park',
  'square',
  'beach_resort',
]);

export interface OsmAdmissionFacts {
  signals: AdmissionSignal[];
  signalEvidence: AdmissionSignalEvidence[];
  exclusions: AdmissionExclusionClass[];
  placeClasses: CanonicalPlaceClass[];
}

/** Preserve explicit OSM opening-hours evidence without guessing a parser or timezone. */
export function osmTagsToOpeningHoursEvidence(
  tags: Record<string, string> | undefined,
): string | undefined {
  const raw = tags?.opening_hours?.trim();
  return raw || undefined;
}

export function osmTagsToAdmissionFacts(
  tags: Record<string, string> | undefined,
): OsmAdmissionFacts {
  const signals: AdmissionSignal[] = [];
  const signalEvidence: AdmissionSignalEvidence[] = [];
  const exclusions: AdmissionExclusionClass[] = [];
  const placeClasses: CanonicalPlaceClass[] = [];
  const t = tags ?? {};
  const addSignal = (
    signal: AdmissionSignalType,
    field: string,
    value: string,
  ) => {
    signals.push(admissionSignal(signal));
    signalEvidence.push({ signal, field, value });
  };

  // Structural exclusions first (a record is not an ordinary PLACE).
  if (t.boundary !== undefined) exclusions.push('ADMINISTRATIVE_OR_LOCALITY');
  if (t.place !== undefined) exclusions.push('ADMINISTRATIVE_OR_LOCALITY');
  if (t.highway !== undefined && t.highway !== 'corridor') {
    exclusions.push('ROAD_OR_ROUTE');
  }
  if (t.public_transport !== undefined || t.railway !== undefined) {
    exclusions.push('TRANSPORT_SERVICE');
  }

  if (t.tourism !== undefined) {
    const value = t.tourism;
    if (OSM_ACCOMMODATION_TOURISM_VALUES.includes(value)) {
      exclusions.push('ACCOMMODATION');
    } else if (OSM_INFORMATION_TOURISM_VALUES.has(value)) {
      exclusions.push('INFORMATION_OR_SIGNAGE');
    } else if (OSM_VISITOR_DESTINATION_TOURISM_VALUES.has(value)) {
      addSignal('EXPLICIT_VISITOR_CLASSIFICATION', 'tourism', value);
      placeClasses.push(`tourism:${value}`);
    } else {
      // `tourism=artwork`, `tourism=yes` and any other value that does not
      // denote a standalone visitor destination is supporting evidence only.
      addSignal('VISITABLE_PLACE_CLASS', 'tourism', value);
      placeClasses.push(`tourism:${value}`);
    }
  }

  if (t.historic !== undefined) {
    addSignal('HISTORIC_CLASSIFICATION', 'historic', t.historic);
    placeClasses.push(`historic:${t.historic}`);
  }
  if (t.heritage !== undefined) {
    addSignal('HERITAGE_DESIGNATION', 'heritage', t.heritage);
  }
  if (t.amenity !== undefined && OSM_VISITABLE_AMENITY_VALUES.has(t.amenity)) {
    addSignal('VISITABLE_PLACE_CLASS', 'amenity', t.amenity);
    placeClasses.push(`amenity:${t.amenity}`);
  }
  if (t.shop !== undefined && OSM_VISITABLE_SHOP_VALUES.has(t.shop)) {
    addSignal('VISITABLE_PLACE_CLASS', 'shop', t.shop);
    placeClasses.push(`shop:${t.shop}`);
  }
  if (t.leisure !== undefined && OSM_VISITABLE_LEISURE_VALUES.has(t.leisure)) {
    addSignal('VISITABLE_PLACE_CLASS', 'leisure', t.leisure);
    placeClasses.push(`leisure:${t.leisure}`);
  }
  if (t.natural === 'beach') {
    addSignal('VISITABLE_PLACE_CLASS', 'natural', t.natural);
    placeClasses.push('natural:beach');
  }
  if (t.highway === 'corridor') {
    addSignal('VISITABLE_PLACE_CLASS', 'highway', t.highway);
    placeClasses.push('highway:corridor');
  }
  if (t.wikidata !== undefined) {
    // An encyclopedic identity link: the Wikidata adapter turns this into
    // ENCYCLOPEDIC_NOTABILITY when the linked item carries sitelinks. Recorded
    // here as a ranking-readable class, never as an admission signal.
    placeClasses.push('encyclopedic_link');
  }

  return { signals, signalEvidence, exclusions, placeClasses };
}

/**
 * OSM `heritage=*` carries the administrative level of the protecting
 * authority: 1 international, 2 national, 3-11 subnational. Any other value
 * exposes no authority level, so no scope is claimed (prominence-v2).
 */
function osmHeritageScope(value: string): HeritageScope {
  if (!/^\d{1,2}$/.test(value)) return 'UNSPECIFIED';
  const level = Number(value);
  if (level === 1) return 'INTERNATIONAL';
  if (level === 2) return 'NATIONAL';
  if (level >= 3 && level <= 11) return 'SUBNATIONAL';
  return 'UNSPECIFIED';
}

/**
 * OSM → typed prominence evidence (design C17, task 39.3). It references the
 * canonical admission evidence rather than remapping tags: a heritage record
 * (with its issuer only when `heritage:operator` names one) and an explicit
 * visitor-destination classification. OSM supplies no provider prominence,
 * and a `wikidata` tag is identity only.
 */
export function osmTagsToProminenceEvidence(
  tags: Record<string, string> | undefined,
  sourceRecordId: string,
  observedAt: Date,
): ProminenceEvidenceFact[] {
  const t = tags ?? {};
  const base = {
    sourceProvider: 'openstreetmap',
    providerIdentity: sourceRecordId,
    sourceRecordId,
    observedAt,
  };
  return osmTagsToAdmissionFacts(t).signalEvidence.flatMap(
    (evidence): ProminenceEvidenceFact[] => {
      if (evidence.signal === 'HERITAGE_DESIGNATION') {
        const operator = t['heritage:operator']?.trim();
        return [
          {
            ...base,
            kind: 'HERITAGE_DESIGNATION',
            fieldPath: `tags.${evidence.field}`,
            designationLevel: String(evidence.value),
            heritageScope: osmHeritageScope(String(evidence.value)),
            ...(operator ? { authority: operator } : {}),
          },
        ];
      }
      if (evidence.signal === 'EXPLICIT_VISITOR_CLASSIFICATION') {
        return [
          {
            ...base,
            kind: 'EXPLICIT_VISITOR_CLASSIFICATION',
            fieldPath: `tags.${evidence.field}`,
            textValue: `${evidence.field}=${evidence.value}`,
          },
        ];
      }
      return [];
    },
  );
}

/** Museum subtypes whose collections are historical (history theme). */
const OSM_HISTORY_MUSEUM_VALUES = new Set([
  'history',
  'local_history',
  'military',
]);

/** Historic classes that are buildings or built structures (architecture). */
const OSM_HISTORIC_ARCHITECTURE_VALUES = new Set([
  'building',
  'castle',
  'church',
  'palace',
  'manor',
  'tower',
  'city_gate',
  'fort',
  'monastery',
]);

/**
 * OSM classes → typed concept observations on the closed preference schema
 * (design C18). A versioned catalog-side classification of provider classes:
 * class identity only — never names, text or keywords. Only positive
 * observations are produced; absence stays UNKNOWN.
 */
export function osmTagsToTargetObservations(
  tags: Record<string, string> | undefined,
  sourceRecordId: string,
): TargetObservationFact[] {
  const t = tags ?? {};
  const observations: TargetObservationFact[] = [];
  const add = (
    field: string,
    value: string,
    dimension: 'theme' | 'intent',
    key: string,
  ) =>
    observations.push({
      target: { dimension, key },
      observation: {
        sourceFactId: `${sourceRecordId}#${field}=${value}>${dimension}:${key}`,
        state: 'SATISFIES',
      },
    });

  if (t.historic !== undefined) add('historic', t.historic, 'theme', 'history');
  else if (t.heritage !== undefined)
    add('heritage', t.heritage, 'theme', 'history');
  if (
    t.historic !== undefined &&
    OSM_HISTORIC_ARCHITECTURE_VALUES.has(t.historic)
  ) {
    add('historic', t.historic, 'theme', 'architecture');
  }
  if (t.amenity === 'place_of_worship') {
    add('amenity', t.amenity, 'theme', 'architecture');
  }
  const food = OSM_FOOD_AND_DRINK_CLASSES.find(
    (klass) => t[klass.key] === klass.value,
  );
  if (food) {
    add(food.key, food.value, 'theme', 'gastronomy');
    add(food.key, food.value, 'theme', 'food');
    add(food.key, food.value, 'intent', 'food');
  }
  if (t.tourism === 'gallery' || t.tourism === 'artwork') {
    add('tourism', t.tourism, 'theme', 'art');
  }
  if (t.tourism === 'museum' && t.museum === 'art') {
    add('museum', t.museum, 'theme', 'art');
  }
  if (t.tourism === 'museum' && OSM_HISTORY_MUSEUM_VALUES.has(t.museum ?? '')) {
    add('museum', t.museum!, 'theme', 'history');
  }
  return observations;
}

/**
 * Destination-scope discovery selectors derived from the signal mapping
 * (design C7, task 37.2): every key/value pair whose presence can carry a
 * decisive or supporting signal, so discovery retrieves records whose base
 * category is normally non-touristic but that carry a signal-bearing tag.
 * Acquisition strategy, never admission truth.
 */
export interface OsmAdmissionDiscoverySelector {
  key: string;
  /** Exact values to include; omitted = any value. */
  includeValues?: readonly string[];
  /** Values to exclude from a bare-key selector. */
  excludeValues?: readonly string[];
}

/**
 * Gap-scoped discovery coverage (canonical coverage → OSM classes). Food venue classes are requested only with an encyclopedic
 * identity link: their decisive-signal subset (visitor classification,
 * heritage) is already reached by base discovery, and an unlinked ordinary
 * venue could only be rejected (its class alone never admits).
 */
export function osmCoverageDiscoverySelectors(
  coverage: readonly StructuredPlaceCoverage[],
): Array<{ key: string; value: string; requireKeys: string[] }> {
  return coverage.includes('FOOD_AND_DRINK')
    ? OSM_FOOD_AND_DRINK_CLASSES.map((klass) => ({
        ...klass,
        requireKeys: ['wikidata'],
      }))
    : [];
}

export const OSM_ADMISSION_DISCOVERY_SELECTORS: readonly OsmAdmissionDiscoverySelector[] =
  [
    { key: 'tourism', excludeValues: OSM_ACCOMMODATION_TOURISM_VALUES },
    { key: 'amenity', includeValues: ['marketplace', 'place_of_worship'] },
    { key: 'historic' },
    { key: 'heritage' },
    { key: 'leisure', includeValues: ['park', 'square', 'beach_resort'] },
    { key: 'natural', includeValues: ['beach'] },
    { key: 'highway', includeValues: ['corridor'] },
  ];
