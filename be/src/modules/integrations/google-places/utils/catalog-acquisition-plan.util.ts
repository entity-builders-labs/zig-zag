import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import {
  CatalogAcquisitionOperation,
  PlacesProvider,
  PlacesRectangle,
} from '../interfaces/places-api.interface';
import {
  CATALOG_ACQUISITION_TYPE_GROUPS,
  CatalogAcquisitionCategory,
  INTEREST_ACQUISITION_CATEGORIES,
} from './catalog-place-taxonomy';

export interface CatalogAcquisitionAnchor {
  id: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface CatalogAcquisitionPlanInput {
  provider: PlacesProvider;
  anchors: CatalogAcquisitionAnchor[];
  requestedInterests?: string[];
  destinationLabel?: string;
  destinationBoundary?: GeoJsonGeometry;
  maxProviderCalls: number;
  resultBudget: number;
}

interface NearbyGroup {
  category: CatalogAcquisitionCategory;
  primaryTypes: readonly string[];
  preferredTime: string;
}

export function buildCatalogAcquisitionPlan(
  input: CatalogAcquisitionPlanInput,
): CatalogAcquisitionOperation[] {
  const operations: CatalogAcquisitionOperation[] = [];
  const textSupported = input.provider === 'google';
  const seedGeography = destinationSeedGeography(input);

  if (input.destinationLabel && seedGeography) {
    const seeds = [
      {
        operationId: 'seed:tourist-attractions',
        category: 'visitor_landmarks',
        textQuery: `top tourist attractions in ${input.destinationLabel}`,
        includedType: 'tourist_attraction',
      },
      {
        operationId: 'seed:culture-history',
        category: 'museums_and_arts',
        textQuery: `museums, historic sites and cultural landmarks in ${input.destinationLabel}`,
        includedType: 'museum',
      },
    ];
    for (const seed of seeds) {
      operations.push({
        ...seed,
        purpose: 'destination_seed',
        providerOperation: 'text',
        strictTypeFiltering: false,
        geographicConstraint: seedGeography,
        resultBudget: input.resultBudget,
        preferredTime: 'day',
        supported: textSupported,
        ...(!textSupported
          ? { unsupportedReason: 'provider_capability' as const }
          : {}),
      });
    }
  }

  const supportedSeedCount = operations.filter(
    (operation) => operation.supported,
  ).length;
  const coverageBudget = Math.max(
    0,
    input.maxProviderCalls - supportedSeedCount,
  );
  const groups = selectedNearbyGroups(input.requestedInterests);
  let coverageCount = 0;
  // Traverse the anchor × category matrix diagonally. Every round touches
  // each anchor once while rotating its category, so a tight call budget is
  // distributed both geographically and thematically instead of being spent
  // entirely on the first anchor or first category.
  for (let round = 0; round < groups.length; round++) {
    for (
      let anchorIndex = 0;
      anchorIndex < input.anchors.length;
      anchorIndex++
    ) {
      if (coverageCount >= coverageBudget) return operations;
      const anchor = input.anchors[anchorIndex];
      const group = groups[(anchorIndex + round) % groups.length];
      operations.push({
        operationId: `coverage:${anchor.id}:${group.category}`,
        purpose: 'geographic_coverage',
        providerOperation: 'nearby',
        category: group.category,
        requestedPrimaryTypes: [...group.primaryTypes],
        rankPreference: 'POPULARITY',
        geographicConstraint: {
          kind: 'circle',
          circle: {
            center: {
              latitude: anchor.latitude,
              longitude: anchor.longitude,
            },
            radius: anchor.radiusMeters,
          },
        },
        resultBudget: input.resultBudget,
        anchorId: anchor.id,
        preferredTime: group.preferredTime,
        supported: true,
      });
      coverageCount++;
    }
  }
  return operations;
}

function selectedNearbyGroups(interests?: string[]): NearbyGroup[] {
  const categories = new Set<CatalogAcquisitionCategory>();
  for (const interest of interests ?? []) {
    for (const category of INTEREST_ACQUISITION_CATEGORIES[
      interest.trim().toLowerCase()
    ] ?? []) {
      categories.add(category);
    }
  }
  if (categories.size === 0) {
    categories.add('visitor_landmarks');
    categories.add('museums_and_arts');
    categories.add('outdoor');
  }
  return [...categories].map((category) => ({
    category,
    ...CATALOG_ACQUISITION_TYPE_GROUPS[category],
  }));
}

function destinationSeedGeography(
  input: CatalogAcquisitionPlanInput,
): CatalogAcquisitionOperation['geographicConstraint'] | undefined {
  if (input.destinationBoundary) {
    const rectangle = geometryRectangle(input.destinationBoundary);
    if (rectangle) return { kind: 'rectangle', rectangle };
  }
  const firstAnchor = input.anchors[0];
  return firstAnchor
    ? {
        kind: 'circle',
        circle: {
          center: {
            latitude: firstAnchor.latitude,
            longitude: firstAnchor.longitude,
          },
          radius: firstAnchor.radiusMeters,
        },
      }
    : undefined;
}

function geometryRectangle(
  geometry: GeoJsonGeometry,
): PlacesRectangle | undefined {
  const coordinates: [number, number][] = [];
  if (geometry.type === 'Point') coordinates.push(geometry.coordinates);
  if (geometry.type === 'LineString') coordinates.push(...geometry.coordinates);
  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach((ring) => coordinates.push(...ring));
  }
  if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((polygon) =>
      polygon.forEach((ring) => coordinates.push(...ring)),
    );
  }
  if (coordinates.length === 0) return undefined;
  const longitudes = coordinates.map(([longitude]) => longitude);
  const latitudes = coordinates.map(([, latitude]) => latitude);
  return {
    low: {
      latitude: Math.min(...latitudes),
      longitude: Math.min(...longitudes),
    },
    high: {
      latitude: Math.max(...latitudes),
      longitude: Math.max(...longitudes),
    },
  };
}
