import { expect, test } from "@playwright/test";
import { gotoSampleEditor } from "./support/app-shell-shared";
import { readFileSync } from "node:fs";
import { releaseMetadata } from "../../scripts/release-config";

test("bug reporting follows the build flag and opens a prefilled issue", async ({
  page,
  context,
}) => {
  await gotoSampleEditor(page);
  const link = page.getByRole("link", { name: "Report a bug", exact: true });
  if (process.env.VITE_ENABLE_BUG_REPORT !== "true") {
    await expect(link).toHaveCount(0);
    return;
  }
  const navigator = page.locator(".path-toolbar-navigator");
  const pathBox = (await navigator.boundingBox())!;
  const bugBox = (await link.boundingBox())!;
  expect(bugBox.x).toBeGreaterThanOrEqual(pathBox.x + pathBox.width);
  expect(
    Math.abs(bugBox.y + bugBox.height / 2 - pathBox.y - pathBox.height / 2),
  ).toBeLessThanOrEqual(1);
  // Capture the new tab locally; never submit an issue or contact GitHub in a test.
  await context.route("https://github.com/**", (route) =>
    route.fulfill({ body: "Issue draft" }),
  );
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  const url = new URL(popup.url());
  expect(url.pathname).toBe("/edanliahovetsky/BLine-Web/issues/new");
  expect(url.searchParams.get("body")).toContain("App: Browser");
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const build = releaseMetadata(version, process.env.VITE_RELEASE_CHANNEL);
  expect(url.searchParams.get("body")).toContain(
    `Release: ${build.releaseName}`,
  );
  expect(await popup.evaluate(() => window.opener)).toBe(null);
});
