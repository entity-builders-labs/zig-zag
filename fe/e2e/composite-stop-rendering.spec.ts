import { test, expect } from '@playwright/test';
import { apiLogin, seedAuthSession, uniqueTestEmail } from './auth-helper';
import { seedCompositeFixture } from './composite-fixture-helper';

// Fase 7 — verifies a composite (neighborhood_walk) tour pick renders via
// CompositeStopCard, not the plain TourStopCard, and that everything it
// shows (waypoint list + mini-map route) comes from THIS tour's
// TourActivityWaypoint snapshot — never the shared variant's current/live
// content, even after that content has since been edited.

test('@live a composite pick renders CompositeStopCard (not TourStopCard) with its name and theme', async ({
  page,
  request,
}) => {
  const email = uniqueTestEmail();
  const session = await apiLogin(request, email);
  const fixture = seedCompositeFixture({ ownerEmail: email, boundaryKind: 'none' });

  await seedAuthSession(page, session);
  await page.goto(`/tours/${fixture.tourId}`);

  const card = page.getByTestId(`composite-stop-${fixture.tourActivityId}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('E2E Fixture Walk');
  await expect(card).toContainText('Caminata'); // KIND_LABELS.neighborhood_walk
});

test('@live the composite stop lists its waypoints in the snapshot order and draws a route between them', async ({
  page,
  request,
}) => {
  const email = uniqueTestEmail();
  const session = await apiLogin(request, email);
  const fixture = seedCompositeFixture({ ownerEmail: email, boundaryKind: 'none' });

  await seedAuthSession(page, session);
  await page.goto(`/tours/${fixture.tourId}`);

  const card = page.getByTestId(`composite-stop-${fixture.tourActivityId}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  const text = await card.textContent();
  expect(text).toContain('E2E Fixture Stop 1');
  expect(text).toContain('E2E Fixture Stop 2');
  expect(text!.indexOf('E2E Fixture Stop 1')).toBeLessThan(
    text!.indexOf('E2E Fixture Stop 2')
  );

  const instanceKey = `composite-${fixture.tourActivityId}`;
  await page.waitForFunction(
    (key) => {
      const instances = (window as any).__zigzagMapInstances;
      const polylines = instances?.[key]?.polylines;
      return (
        Array.isArray(polylines) &&
        polylines.length > 0 &&
        polylines[0].getPath().getLength() > 1
      );
    },
    instanceKey,
    { timeout: 20_000 }
  );
});

test('@live the card keeps showing the tour\'s original snapshot after the shared variant is edited later', async ({
  page,
  request,
}) => {
  const email = uniqueTestEmail();
  const session = await apiLogin(request, email);
  const fixture = seedCompositeFixture({
    ownerEmail: email,
    boundaryKind: 'none',
    simulateLaterEdit: true,
  });
  // Sanity-check the fixture itself did what it claims: the live variant now
  // has 3 waypoints, reordered, while this tour's own snapshot still has 2.
  expect(fixture.liveWaypointIdsAfterEdit).toHaveLength(3);
  expect(fixture.waypointIds).toHaveLength(2);

  await seedAuthSession(page, session);
  await page.goto(`/tours/${fixture.tourId}`);

  const card = page.getByTestId(`composite-stop-${fixture.tourActivityId}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  const text = await card.textContent();

  // Only the ORIGINAL two stops from generation time — never the third one
  // added to the shared variant afterward.
  expect(text).toContain('E2E Fixture Stop 1');
  expect(text).toContain('E2E Fixture Stop 2');
  expect(text).not.toContain('E2E Fixture Stop 3');
  // And still in the snapshot's own order (1 before 2), not the live
  // variant's post-edit order (2, 3, 1).
  expect(text!.indexOf('E2E Fixture Stop 1')).toBeLessThan(
    text!.indexOf('E2E Fixture Stop 2')
  );
});
