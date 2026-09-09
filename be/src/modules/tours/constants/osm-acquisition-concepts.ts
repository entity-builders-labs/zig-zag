import { OverpassSelector } from '@integrations/osm/interfaces/overpass.interface';

/**
 * Explicit, hand-maintained mapping from an acquisition-plan `concept`
 * (`SourcePlan.osm.concepts`, itself produced by the deterministic routing
 * table in `acquisition-source-routing.ts`) to safe, restricted Overpass tag
 * selectors and the domain `evidenceType` those selectors defensibly imply.
 *
 * Concepts are NEVER interpolated into Overpass QL — only a definition here
 * turns into a query, and every tag token is still re-validated by
 * `buildFeaturesNearQuery`.
 *
 * Deliberately conservative: a concept with no safe, restricted selector is
 * listed in `OSM_UNSUPPORTED_CONCEPTS` instead of being turned into a broad
 * whole-radius query (`nwr["building"]`, `nwr["tourism"]`, …). We prefer
 * losing OSM recall and letting Wikivoyage / Google Places / Web fill
 * coverage over polluting or overloading Overpass.
 */
export interface OsmConceptDefinition {
  selectors: OverpassSelector[];
  evidenceType: 'place' | 'area' | 'route';
}

export const OSM_ACQUISITION_CONCEPTS: Record<string, OsmConceptDefinition> = {
  // --- point-like cultural / civic venues ---
  museum: {
    selectors: [{ key: 'tourism', value: 'museum', requireName: true }],
    evidenceType: 'place',
  },
  gallery: {
    selectors: [{ key: 'tourism', value: 'gallery', requireName: true }],
    evidenceType: 'place',
  },
  arts_centre: {
    selectors: [{ key: 'amenity', value: 'arts_centre', requireName: true }],
    evidenceType: 'place',
  },

  // NOTE: restaurant / cafe / bar / pub / nightclub are intentionally NOT
  // here — see OSM_UNSUPPORTED_CONCEPTS. A generic food/nightlife venue is an
  // operational itinerary stop (lunch, dinner, coffee, a drink), not a
  // gastronomic Experience worth doing in itself. Establishing that a food
  // venue *is* a tourism Experience is left to Wikivoyage / web / curated
  // Places evidence, never a bare OSM `amenity` tag.

  // --- historic / landmark points ---
  monument: {
    selectors: [{ key: 'historic', value: 'monument', requireName: true }],
    evidenceType: 'place',
  },
  historic: {
    selectors: [
      { key: 'historic', value: 'monument', requireName: true },
      { key: 'historic', value: 'memorial', requireName: true },
      { key: 'historic', value: 'castle', requireName: true },
      { key: 'historic', value: 'ruins', requireName: true },
    ],
    evidenceType: 'place',
  },
  viewpoint: {
    selectors: [{ key: 'tourism', value: 'viewpoint', requireName: true }],
    evidenceType: 'place',
  },

  // --- natural points ---
  peak: {
    selectors: [{ key: 'natural', value: 'peak', requireName: true }],
    evidenceType: 'place',
  },
  volcano: {
    selectors: [{ key: 'natural', value: 'volcano', requireName: true }],
    evidenceType: 'place',
  },
  beach: {
    selectors: [{ key: 'natural', value: 'beach', requireName: true }],
    evidenceType: 'place',
  },

  // --- wine ---
  winery: {
    // Only a genuine wine-producing facility. `shop=wine` (a vinoteca / wine
    // shop) is deliberately NOT accepted — it is not a winery Experience.
    selectors: [{ key: 'craft', value: 'winery', requireName: true }],
    evidenceType: 'place',
  },
  vineyard: {
    selectors: [{ key: 'landuse', value: 'vineyard', requireName: true }],
    evidenceType: 'area',
  },

  // --- area-like green spaces. `evidenceType: 'area'` is the intent, but the
  //     provider's classify() downgrades a bare *node* match to `place` (a
  //     point can't defensibly be an AREA); only a way/relation stays AREA. ---
  park: {
    selectors: [{ key: 'leisure', value: 'park', requireName: true }],
    evidenceType: 'area',
  },
  nature_reserve: {
    selectors: [{ key: 'leisure', value: 'nature_reserve', requireName: true }],
    evidenceType: 'area',
  },
  forest: {
    selectors: [{ key: 'landuse', value: 'forest', requireName: true }],
    evidenceType: 'area',
  },
  wood: {
    selectors: [{ key: 'natural', value: 'wood', requireName: true }],
    evidenceType: 'area',
  },

  // --- genuinely route-like ---
  hiking: {
    selectors: [
      {
        key: 'route',
        value: 'hiking',
        requireName: true,
        elementTypes: ['relation'],
      },
    ],
    evidenceType: 'route',
  },
  footway: {
    // A named pedestrian street/plaza — not `highway=footway`, which is
    // ubiquitous and mostly unnamed.
    selectors: [
      {
        key: 'highway',
        value: 'pedestrian',
        requireName: true,
        elementTypes: ['way'],
      },
    ],
    evidenceType: 'route',
  },
};

/**
 * Concepts that appear in `acquisition-source-routing.ts` (`osmConcepts`) but
 * are intentionally NOT proactively acquirable as Experiences via OSM:
 *  - too broad to bound safely / no defensible restricted selector
 *    (`building`, `tourism`, `route`, `scenic`, `waterway`, `coastline`,
 *    `river`, `desert`); OR
 *  - a generic food/nightlife venue that is an operational stop, not a
 *    gastronomic Experience in itself (`restaurant`, `cafe`, `bar`, `pub`,
 *    `nightclub`) — curated Wikivoyage/web/Places evidence, not a bare OSM
 *    tag, must establish that a food venue is a tourism Experience.
 * They are dropped from the OSM source plan rather than turned into a query.
 */
export const OSM_UNSUPPORTED_CONCEPTS: ReadonlySet<string> = new Set([
  'building',
  'tourism',
  'route',
  'scenic',
  'waterway',
  'coastline',
  'river',
  'desert',
  'restaurant',
  'cafe',
  'bar',
  'pub',
  'nightclub',
]);

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort();
}

/**
 * Splits requested concepts into supported (with a registry definition) and
 * unsupported (explicitly listed, or simply unknown), and flattens the
 * supported concepts' selectors into a single list for one union query.
 * `requested` is the normalized (trimmed, non-empty, deduped, sorted) input,
 * surfaced so callers/provenance need not recompute it.
 */
export function resolveOsmConcepts(concepts: string[]): {
  requested: string[];
  selectors: OverpassSelector[];
  supported: string[];
  unsupported: string[];
} {
  const requested = uniqueSorted(concepts ?? []);
  const supported: string[] = [];
  const unsupported: string[] = [];

  for (const concept of requested) {
    if (OSM_ACQUISITION_CONCEPTS[concept]) {
      supported.push(concept);
    } else {
      unsupported.push(concept);
    }
  }

  const selectors = supported.flatMap(
    (concept) => OSM_ACQUISITION_CONCEPTS[concept].selectors,
  );

  return { requested, selectors, supported, unsupported };
}
