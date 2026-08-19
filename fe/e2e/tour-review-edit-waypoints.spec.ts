import { test, expect } from '@playwright/test';
import { API_URL } from './playwright.config';
import { apiLogin, seedAuthSession, uniqueTestEmail } from './auth-helper';
import { seedCompositeFixture } from './composite-fixture-helper';

// Fase 7 — the pre-confirmation review screen's "exclude a stop" affordance.
// Navigates directly to /tours/:id/review (it works standalone once
// generationStatus is 'completed', regardless of how the user got there —
// see review.tsx) against a fixture with 3 snapshot waypoints, seeded
// directly via Prisma (be/.../seed-e2e-composite.command.ts).

test('@live deselecting a waypoint and confirming shows the reduced subset on the final detail screen', async ({
  page,
  request,
}) => {
  const email = uniqueTestEmail();
  const session = await apiLogin(request, email);
  const fixture = seedCompositeFixture({
    ownerEmail: email,
    boundaryKind: 'none',
    waypointCount: 3,
  });

  await seedAuthSession(page, session);
  await page.goto(`/tours/${fixture.tourId}/review`);

  const [, , thirdWaypointId] = fixture.waypointIds;
  await page.getByTestId(`waypoint-checkbox-${thirdWaypointId}`).click();
  await page.getByTestId('confirm-tour-button').click();

  await page.waitForURL(new RegExp(`/tours/${fixture.tourId}$`), {
    timeout: 15_000,
  });

  const card = page.getByTestId(`composite-stop-${fixture.tourActivityId}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  const text = await card.textContent();
  expect(text).toContain('E2E Fixture Stop 1');
  expect(text).toContain('E2E Fixture Stop 2');
  expect(text).not.toContain('E2E Fixture Stop 3');
});

test('@live deselecting below the minimum of 2 blocks that exclusion and keeps the full snapshot', async ({
  page,
  request,
}) => {
  const email = uniqueTestEmail();
  const session = await apiLogin(request, email);
  const fixture = seedCompositeFixture({
    ownerEmail: email,
    boundaryKind: 'none',
    waypointCount: 3,
  });

  await seedAuthSession(page, session);
  await page.goto(`/tours/${fixture.tourId}/review`);

  const [firstWaypointId, secondWaypointId] = fixture.waypointIds;
  await page.getByTestId(`waypoint-checkbox-${firstWaypointId}`).click();
  await page.getByTestId(`waypoint-checkbox-${secondWaypointId}`).click();

  await expect(
    page.getByText(/Elegí al menos 2 paradas/i)
  ).toBeVisible();

  await page.getByTestId('confirm-tour-button').click();
  await page.waitForURL(new RegExp(`/tours/${fixture.tourId}$`), {
    timeout: 15_000,
  });

  // The invalid edit was never sent — the final screen still shows all 3
  // original stops.
  const card = page.getByTestId(`composite-stop-${fixture.tourActivityId}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  const text = await card.textContent();
  expect(text).toContain('E2E Fixture Stop 1');
  expect(text).toContain('E2E Fixture Stop 2');
  expect(text).toContain('E2E Fixture Stop 3');
});

test('@live confirming without any edits fires no PATCH request', async ({
  page,
  request,
}) => {
  const email = uniqueTestEmail();
  const session = await apiLogin(request, email);
  const fixture = seedCompositeFixture({
    ownerEmail: email,
    boundaryKind: 'none',
    waypointCount: 3,
  });

  await seedAuthSession(page, session);

  let patchCalled = false;
  await page.route(
    `${API_URL}/tours/${fixture.tourId}/activities/**/waypoints`,
    (route) => {
      patchCalled = true;
      route.continue();
    }
  );

  await page.goto(`/tours/${fixture.tourId}/review`);
  await page.getByTestId('confirm-tour-button').click();
  await page.waitForURL(new RegExp(`/tours/${fixture.tourId}$`), {
    timeout: 15_000,
  });

  expect(patchCalled).toBe(false);
});
