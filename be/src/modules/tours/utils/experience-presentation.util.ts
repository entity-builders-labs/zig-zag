export type GeometryMode = 'POINT' | 'AREA' | 'ROUTE' | 'MULTI_POINT';

export interface ExperiencePresentation {
  geometryMode: GeometryMode;
  geometry?: unknown;
  hasIntrinsicSequence: boolean;
}

export interface ComponentForPresentation {
  role: string | null;
  order: number | null;
  geometry: unknown;
}

function geometryTypeOf(geometry: unknown): string | undefined {
  if (
    geometry &&
    typeof geometry === 'object' &&
    'type' in (geometry as Record<string, unknown>)
  ) {
    return (geometry as { type?: string }).type;
  }
  return undefined;
}

/**
 * Pure function over already-persisted `TourExperienceComponent` fields
 * (`role`, `order`, `geometry`) — no re-validation, no new provider call.
 * The anchor case (ROUTE/AREA for a multi-component Experience) reuses
 * whatever geometry `CompositeGeographicValidationService`'s
 * `canonical_geometry`/`canonical_area` strategy already picked at
 * generation time and persisted onto that one component's own row.
 */
export function deriveExperiencePresentation(
  components: ComponentForPresentation[],
): ExperiencePresentation {
  const hasIntrinsicSequence = components.some((c) => c.order != null);

  if (components.length === 0) {
    return { geometryMode: 'POINT', hasIntrinsicSequence };
  }

  if (components.length === 1) {
    const type = geometryTypeOf(components[0].geometry);
    if (type === 'Polygon' || type === 'MultiPolygon') {
      return {
        geometryMode: 'AREA',
        geometry: components[0].geometry,
        hasIntrinsicSequence,
      };
    }
    return { geometryMode: 'POINT', hasIntrinsicSequence };
  }

  const anchor = components.find((c) => {
    const type = geometryTypeOf(c.geometry);
    return (
      (c.role === 'route' || c.role === 'area') &&
      (type === 'LineString' || type === 'Polygon' || type === 'MultiPolygon')
    );
  });
  if (anchor) {
    const type = geometryTypeOf(anchor.geometry);
    return {
      geometryMode: type === 'LineString' ? 'ROUTE' : 'AREA',
      geometry: anchor.geometry,
      hasIntrinsicSequence,
    };
  }

  return { geometryMode: 'MULTI_POINT', hasIntrinsicSequence };
}
