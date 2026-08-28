import { test, expect } from "@playwright/test";

/**
 * These flows assume the dev seed has run (npm run db:seed) so the following
 * accounts exist:
 *   admin@example.com    / AdminPass123!
 *   operator@example.com / OperatorPass123!
 *   viewer@example.com   / ViewerPass123!
 */

test("unauthenticated users are redirected to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("admin can sign in and see administration nav", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("AdminPass123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("link", { name: "Administration" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Emergency stop/i })).toBeVisible();
});

test("viewer cannot see New test or Administration and cannot start tests", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("viewer@example.com");
  await page.getByLabel("Password").fill("ViewerPass123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("link", { name: "New test" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);

  // Direct API call is rejected server-side regardless of UI.
  const res = await page.request.post("/api/tests", {
    data: { targetId: "x", method: "GET", path: "/", requestsPerSecond: 1, concurrency: 1, durationSeconds: 1, requestTimeoutMs: 1000 },
  });
  expect([401, 403]).toContain(res.status());
});

test("operator can open the New test page", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("operator@example.com");
  await page.getByLabel("Password").fill("OperatorPass123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New test" }).click();
  await expect(page.getByRole("heading", { name: "New load test" })).toBeVisible();
});
