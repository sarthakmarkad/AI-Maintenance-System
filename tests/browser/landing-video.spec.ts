import { test, expect } from "@playwright/test";
import { setup } from "./helpers";

test("tour plays silently, loops and has no playback controls", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  const video = page.locator("video");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  expect(
    await video.evaluate((v: HTMLVideoElement) => ({
      controls: v.controls,
      muted: v.muted,
      loop: v.loop,
      inline: v.playsInline,
    })),
  ).toEqual({ controls: false, muted: true, loop: true, inline: true });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.duration))
    .toBe(50);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = v.duration - 0.2;
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeLessThan(5);
  await expect(page.getByRole("button", { name: /play|pause/i })).toHaveCount(
    0,
  );
});

test("reduced motion uses the poster and walkthrough", async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const video = page.locator("video");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
  await page.getByText("Read the walkthrough").click();
  await expect(page.getByText(/production and process trends/)).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
});

test("failed video keeps the walkthrough available", async ({ page }) => {
  await setup(page);
  await page.route("**/maintenance-demo.mp4", (r) =>
    r.fulfill({ status: 404 }),
  );
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Video unavailable");
  await page.getByText("Read the walkthrough").click();
  await expect(page.getByText(/Explore machine records/)).toBeVisible();
});
