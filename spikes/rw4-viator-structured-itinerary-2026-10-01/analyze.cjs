#!/usr/bin/env node
/*
 * Offline analysis of the cached Viator spike evidence (no API calls).
 *
 * Mechanical facts (item semantics, location provider/coords, counts) are
 * computed from products.json + locations.json. The composition class and
 * the PLACE-vs-AREA reading of each itinerary location are spike JUDGMENTS:
 * Viator exposes neither a location type nor an optional/alternative flag,
 * so both are recorded explicitly below with the source evidence quoted.
 */
const fs = require('fs');
const path = require('path');

const products = require('./products.json');
const locs = Object.fromEntries(require('./locations.json').resolved.map((l) => [l.reference, l]));

// Judgment: itinerary locations that are administrative areas/regions, not
// concrete visitable places. Viator's location record carries no type field.
const AREA_NAMES = new Set([
  'Mendoza',
  'Maravillosa Ciudad de Mendoza',
  'Lujan de Cuyo',
  'Maipu',
  'Valle de Uco',
  'Chacras de Coria',
  'Agrelo',
]);

// Judgment per product, with the evidence that decided it.
const CLASSIFICATION = {
  '5573772P5': {
    class: 'STRUCTURED_BUT_AMBIGUOUS',
    reason: 'supplier substitution stated per item in prose',
    evidence: [
      'item 1: "Availability of the wineries in this selection may vary: Vistandes, Viña el Cerno or Domiciano."',
      'item 3: "In case of unavailability in the olive grove is replaced by the Centennial olive grove"',
    ],
  },
  '5530264P4': {
    class: 'STRUCTURED_COMPLETE',
    reason: '2 concrete TRIPADVISOR places (Chandon visit, Sottano lunch); no substitution/option language',
    evidence: ['item 2 fixedDurationInMinutes=4 for a lunch stop — duration data quality is unreliable, membership is not affected'],
  },
  '70442P6': {
    class: 'NO_USABLE_COMPOSITION',
    reason: 'single itinerary item is the region "Valle de Uco"; prose says "visiting three prestigious wineries" without naming any',
    evidence: [],
  },
  '40520P12': {
    class: 'STRUCTURED_BUT_AMBIGUOUS',
    reason: 'every item may be substituted; order and stops explicitly mutable',
    evidence: [
      '"ATTENTION PLEASE: order, stops and times can change about availability for others in the area with same qualities"',
      '"The wineries could change about availability between these selection wineries: Don Manuel Villafañe, Casa Corbel, Cecchin Family, Florio, Esencia 1870"',
    ],
  },
  '199477P2': {
    class: 'STRUCTURED_BUT_AMBIGUOUS',
    reason: 'listed wineries are a pool, not the composition; 2 product options; first item is a region',
    evidence: [
      'item 1: "WE LIST 6 WINERIES but keep in mind that during a day we visit 3 of them."',
      'item 2: "Option: FINCA ADELMA Winery ..." (alternative named only in prose, no location ref)',
      'item 3: "We usually include SALENTEIN; but is also possible to customize your day"',
    ],
  },
  '5674P681': {
    class: 'NO_USABLE_COMPOSITION',
    reason: 'items are only areas (Mendoza pass-by, Lujan de Cuyo, Maipu); "We will visit two wineries" never names them',
    evidence: [],
  },
  '475969P2': {
    class: 'UNSTRUCTURED',
    reason: 'only 1 concrete structured stop (Olivicola Pasrai); the 3 wineries are named only in prose under the "Maipu" area item',
    evidence: ['item 3: "These 3 small regional wineries (Corbel, Esencia, Viña El Cerno) ... will receive us"'],
  },
  '199477P3': {
    class: 'STRUCTURED_COMPLETE',
    reason: '3 concrete TRIPADVISOR places in order (Chandon, Budeguer, Lagarde); no substitution/option language; 1 product option',
    evidence: [],
  },
  '5668946P2': {
    class: 'STRUCTURED_COMPLETE',
    reason: '5 concrete TRIPADVISOR places in order; meet-at-start (no pickup); no substitution/option language; 1 product option',
    evidence: ['item 1 prose never names the winery — identity comes only from the location ref (Bodega Artesanal Viña el Cerno)'],
  },
  '44877P6': {
    class: 'NO_USABLE_COMPOSITION',
    reason: 'UNSTRUCTURED itinerary; prose says "We visit three wineries" without naming any; pointOfInterestLocations are unordered areas (Lujan de Cuyo, Chacras de Coria, Agrelo) + one Google ref; option TG2 lets the traveler choose wineries',
    evidence: ['TG2: "Choose what winery you want"'],
  },
  '5674P1222': {
    class: 'STRUCTURED_BUT_AMBIGUOUS',
    reason: 'HOP_ON_HOP_OFF: route POIs are a weekday-dependent union of three distinct wine routes, sold as 6 product options with "X or Y" alternatives; route stops are Google-only pickup points',
    evidence: [
      'operatingSchedule: "Wine Route “El Sol” – Tuesday ... Casa El Enemigo Vigil and a choice between Bressia or Viña Las Perdices."',
      'option TG5: "Chandon Winery and Zolo or Budeguer Winery."',
    ],
    supplement: true,
  },
};

function describeLoc(ref) {
  const l = locs[ref];
  if (!l) return { ref, resolved: false };
  return {
    ref,
    provider: l.provider,
    name: l.name ?? null,
    providerReferencePresent: Boolean(l.providerReference),
    coordinates: l.center ?? null,
    address: l.address ?? null,
    readingAsArea: l.name ? AREA_NAMES.has(l.name) : null,
  };
}

function itemSemantics(x) {
  if (x.passByWithoutStopping) return 'PASS_BY';
  return 'STOP';
}

const out = [];
for (const p of products) {
  const it = p.itinerary ?? {};
  const items = (it.itineraryItems ?? []).map((x, i) => ({
    order: i + 1,
    semantics: itemSemantics(x),
    admissionIncluded: x.admissionIncluded ?? null,
    durationMinutes: x.duration?.fixedDurationInMinutes ?? null,
    attractionId: x.pointOfInterestLocation?.attractionId ?? null,
    location: describeLoc(x.pointOfInterestLocation?.location?.ref),
  }));
  const concreteStops = items.filter((i) => i.semantics === 'STOP' && i.location.readingAsArea === false);
  const allItemLocRefs = [
    ...items.map((i) => i.location),
    ...(it.pointOfInterestLocations ?? []).map((x) => describeLoc(x.location?.ref)),
    ...(it.routes ?? []).flatMap((r) => (r.pointsOfInterest ?? []).map((x) => describeLoc(x.location?.ref))),
  ];
  const routes = (it.routes ?? []).map((r) => ({
    name: r.name,
    operatingSchedule: r.operatingSchedule,
    stops: (r.stops ?? []).map((s) => ({ ...describeLoc(s.stopLocation?.ref), description: s.description })),
    pointsOfInterest: (r.pointsOfInterest ?? []).map((x) => describeLoc(x.location?.ref)),
  }));
  const logistics = p.logistics ?? {};
  const c = CLASSIFICATION[p.productCode];
  out.push({
    productCode: p.productCode,
    sourceTitle: p.sourceTitle,
    status: p.status,
    selectedBy: p.selectedBy,
    itineraryType: p.itineraryType,
    productOptions: p.productOptions.map((o) => ({ code: o.productOptionCode, title: o.title })),
    items,
    unstructuredDescription: it.unstructuredDescription ?? null,
    unorderedPointOfInterestLocations: (it.pointOfInterestLocations ?? []).map((x) => describeLoc(x.location?.ref)),
    routes,
    logistics: {
      start: (logistics.start ?? []).map((s) => describeLoc(s.location?.ref)),
      end: (logistics.end ?? []).map((s) => describeLoc(s.location?.ref)),
      pickupOptionType: logistics.travelerPickup?.pickupOptionType ?? null,
      pickupLocationCount: (logistics.travelerPickup?.locations ?? []).length,
    },
    facts: {
      concreteStructuredStops: concreteStops.length,
      itineraryLocationsWithCoordinates: allItemLocRefs.filter((l) => l.coordinates).length,
      itineraryLocationsTotal: allItemLocRefs.length,
    },
    classification: c.class,
    classificationReason: c.reason,
    classificationEvidence: c.evidence,
    supplement: Boolean(c.supplement),
  });
}

const main = out.filter((p) => !p.supplement);
const count = (k) => main.filter((p) => p.classification === k).length;
const summary = {
  sampledProducts: main.length,
  STRUCTURED_COMPLETE: count('STRUCTURED_COMPLETE'),
  STRUCTURED_BUT_AMBIGUOUS: count('STRUCTURED_BUT_AMBIGUOUS'),
  UNSTRUCTURED: count('UNSTRUCTURED'),
  NO_USABLE_COMPOSITION: count('NO_USABLE_COMPOSITION'),
  productsWithAtLeast2ConcreteStructuredStops: main.filter((p) => p.facts.concreteStructuredStops >= 2).length,
  productsWhereAllItineraryLocationsHaveCoordinates: main.filter(
    (p) => p.facts.itineraryLocationsTotal > 0 && p.facts.itineraryLocationsWithCoordinates === p.facts.itineraryLocationsTotal,
  ).length,
  productsRequiringTextualExtractionForMembership: count('UNSTRUCTURED'),
  supplementOutOfSample: out.filter((p) => p.supplement).map((p) => ({ productCode: p.productCode, classification: p.classification })),
  locationProviderForms: Object.values(locs).reduce((acc, l) => {
    const k = `${l.provider}:${l.name ? 'name' : 'no-name'}+${l.center ? 'coords' : 'no-coords'}+${l.providerReference ? 'providerReference' : 'no-providerReference'}`;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {}),
};

fs.writeFileSync(path.join(__dirname, 'analysis.json'), JSON.stringify({ summary, products: out }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 1));
for (const p of out) {
  console.log(`${p.productCode}\t${p.itineraryType}\t${p.facts.concreteStructuredStops}\t${p.classification}${p.supplement ? ' (supplement)' : ''}\t${p.sourceTitle}`);
}
