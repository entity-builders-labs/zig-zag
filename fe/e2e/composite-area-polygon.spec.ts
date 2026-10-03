import { test, expect } from '@playwright/test';
import { apiLogin, seedAuthSession, uniqueTestEmail } from './auth-helper';
import { seedCompositeFixture } from './composite-fixture-helper';

// Fase 6 — verifies the Polygon-rendering plumbing (MapProps.polygons,
// geoJsonBoundaryToPolygonParts, the imperative google.maps.Polygon effect)
// actually draws what CompositeStopCard hands it, via window.__zigzagMapInstances
// (see features/map/index.web.tsx) since a WebGL/canvas map has nothing to
// query for in the DOM. Fixtures are seeded directly via Prisma (see
// be/.../seed-e2e-composite.command.ts) — there's no HTTP endpoint to create
// a composite Activity on purpose.

async function openFixtureTour(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  boundaryKind: 'polygon' | 'polygon-hole' | 'multipolygon' | 'none'
) {
  const email = uniqueTestEmail();
  const session = await apiLogin(request, email);
  const fixture = seedCompositeFixture({ ownerEmail: email, boundaryKind });

  await seedAuthSession(page, session);
  await page.goto(`/tours/${fixture.tourId}`);

  return fixture;
}

test('@live a Polygon boundary (no hole) on a composite stop renders as one polygon part with no holes', async ({
  page,
  request,
}) => {
  const fixture = await openFixtureTour(page, request, 'polygon');
  const instanceKey = `composite-${fixture.tourActivityId}`;

  const polygons = await page.waitForFunction(
    (key) => {
      const instances = (window as any).__zigzagMapInstances;
      const polys = instances?.[key]?.polygons;
      return Array.isArray(polys) && polys.length > 0 ? polys.length : false;
    },
    instanceKey,
    { timeout: 20_000 }
  );
  expect(await polygons.jsonValue()).toBe(1);
});

test('@live a Polygon boundary WITH a hole renders one polygon part carrying a hole ring', async ({
  page,
  request,
}) => {
  const fixture = await openFixtureTour(page, request, 'polygon-hole');
  const instanceKey = `composite-${fixture.tourActivityId}`;

  await page.waitForFunction(
    (key) => {
      const instances = (window as any).__zigzagMapInstances;
      return (instances?.[key]?.polygons?.length ?? 0) > 0;
    },
    instanceKey,
    { timeout: 20_000 }
  );

  const hasHole = await page.evaluate((key) => {
    const polygon = (window as any).__zigzagMapInstances[key].polygons[0];
    // google.maps.Polygon exposes every ring (outer + holes) via getPaths().
    return polygon.getPaths().getLength() > 1;
  }, instanceKey);
  expect(hasHole).toBe(true);
});

test('@live a MultiPolygon boundary renders one entry in window.__zigzagMapInstances per disjoint polygon', async ({
  page,
  request,
}) => {
  const fixture = await openFixtureTour(page, request, 'multipolygon');
  const instanceKey = `composite-${fixture.tourActivityId}`;

  const count = await page.waitForFunction(
    (key) => {
      const instances = (window as any).__zigzagMapInstances;
      const polys = instances?.[key]?.polygons;
      return Array.isArray(polys) && polys.length > 0 ? polys.length : false;
    },
    instanceKey,
    { timeout: 20_000 }
  );
  expect(await count.jsonValue()).toBe(2);
});

test('@live a composite stop with no boundary at all draws no polygons', async ({
  page,
  request,
}) => {
  const fixture = await openFixtureTour(page, request, 'none');
  const instanceKey = `composite-${fixture.tourActivityId}`;

  // Wait for the mini-map's own effect to have run at least once (it always
  // sets `polygons`, even to an empty array) rather than asserting on a
  // fixed timeout, which would be flaky.
  await page.waitForFunction(
    (key) => (window as any).__zigzagMapInstances?.[key]?.polygons !== undefined,
    instanceKey,
    { timeout: 20_000 }
  );

  const polygons = await page.evaluate(
    (key) => (window as any).__zigzagMapInstances[key].polygons,
    instanceKey
  );
  expect(polygons).toEqual([]);
});
