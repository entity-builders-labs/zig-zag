import { expect, test } from "@playwright/test";
import { API_URL } from "./playwright.config";
import { apiLogin, seedAuthSession } from "./auth-helper";

test("renders generic v5 facts and unknown future steps", async ({
  context,
  page,
  request,
}) => {
  const session = await apiLogin(request);
  const createResponse = await request.post(`${API_URL}/tours`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: {
      name: "Bitacora v5 fixture",
      totalDays: 1,
      metadata: {
        generationTrace: {
          version: 5,
          runtime: { buildCommit: "fixture" },
          result: {
            status: "COMPLETED",
            outcome: "TOUR_MATERIALIZED",
            reasonCodes: ["COMPLETE"],
            facts: { materialized: 1 },
          },
          steps: [
            {
              id: "future-1",
              sequence: 1,
              name: "future.producer.step",
              decision: {
                status: "WARN",
                outcome: "DEGRADED",
                reasonCodes: ["PROVIDER_UNAVAILABLE"],
              },
              rules: [
                {
                  id: "expected-actual",
                  name: "Expected versus actual",
                  status: "WARN",
                  facts: { input: "x", expected: "y", actual: "z" },
                },
              ],
              facts: { provider: "gemini", httpStatus: 503 },
            },
          ],
        },
      },
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { id: tourId } = await createResponse.json();

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await seedAuthSession(page, session);
  await page.goto(`/tours/${tourId}`);
  await page.getByTestId("bitacora-toggle").first().click();

  await expect(page.getByText("future.producer.step").first()).toBeVisible();
  await expect(page.getByText("PROVIDER_UNAVAILABLE").first()).toBeVisible();
  await page.getByText("Rule facts").click();
  await expect(page.getByText(/"expected": "y"/).first()).toBeVisible();
  await page.getByText("Result facts").click();
  await expect(page.getByText(/"materialized": 1/).first()).toBeVisible();
});

test("does not render historical v1-v4 data as v5", async ({
  page,
  request,
}) => {
  const session = await apiLogin(request);
  const createResponse = await request.post(`${API_URL}/tours`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: {
      name: "Legacy bitacora fixture",
      totalDays: 1,
      metadata: { generationTrace: { version: 4, steps: [] } },
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { id: tourId } = await createResponse.json();
  await seedAuthSession(page, session);
  await page.goto(`/tours/${tourId}`);

  await expect(
    page.getByText(
      "Esta Bitácora pertenece a una versión histórica no compatible.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("bitacora-toggle")).toHaveCount(0);
});
