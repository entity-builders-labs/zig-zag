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
      : t.amenity === 'grave_yard' || t.historic === 'grave_yard'
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
]);

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
