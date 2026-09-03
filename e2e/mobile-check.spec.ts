import { test, expect } from "@playwright/test";

/**
 * Mobile responsiveness + metadata smoke check.
 * Run against a running, seeded app:  npm run build && npm run start
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... npx playwright test e2e/mobile-check.spec.ts
 */
const EMAIL = process.env.ADMIN_EMAIL ?? "";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";

// iPhone-13-ish viewport, but keep the default (chromium) browser.
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

const PAGES = [
  { path: "/dashboard", title: "Dashboard" },
  { path: "/tests", title: "Tests" },
  { path: "/tests/new", title: "New test" },
  { path: "/targets", title: "Targets" },
  { path: "/audit", title: "Audit log" },
  { path: "/admin", title: "Administration" },
  { path: "/settings", title: "Settings" },
];

test.beforeEach(async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, "ADMIN_EMAIL/ADMIN_PASSWORD not set");
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
});

for (const p of PAGES) {
  test(`${p.path} — no horizontal overflow + correct title`, async ({ page }) => {
    await page.goto(p.path);
    await page.waitForLoadState("domcontentloaded");
    await page.locator("main").waitFor();
    await page.waitForTimeout(1200); // let first data render

    // No page-level horizontal scroll.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `${p.path} overflows by ${overflow}px`).toBeLessThanOrEqual(1);

    await expect(page).toHaveTitle(new RegExp(p.title));
  });
}

test("mobile menu opens and navigates", async ({ page }) => {
  await page.goto("/dashboard");
  const menuBtn = page.getByRole("button", { name: "Open menu" });
  await expect(menuBtn).toBeVisible(); // hamburger shows only on mobile widths

  // Sidebar is off-canvas until opened.
  const targetsLink = page.getByRole("link", { name: "Targets" });
  const before = await targetsLink.boundingBox();
  expect(before && before.x < 0).toBeTruthy();

  await menuBtn.click();
  await expect(targetsLink).toBeInViewport();
  await targetsLink.click();
  await expect(page).toHaveURL(/\/targets/);
});

test("404 page renders", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page.getByText("404")).toBeVisible();
  await expect(page).toHaveTitle(/Page not found/);
});

test("head has viewport + description + icon", async ({ page }) => {
  await page.goto("/login");
  expect(
    await page.locator('meta[name="viewport"]').getAttribute("content"),
  ).toContain("width=device-width");
  expect(
    await page.locator('meta[name="description"]').getAttribute("content"),
  ).toBeTruthy();
  expect(await page.locator('link[rel="icon"]').count()).toBeGreaterThan(0);
});
