import { expect, test } from "@playwright/test";
import { openConstraintsTab } from "./support/app-shell-constraints";
import {
  dismissMobileSupportWarning,
  gotoSampleEditor,
  requiredBox,
} from "./support/app-shell-shared";

test("surfaces a blocked User Data v1 to v2 upgrade instead of loading forever", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const databaseName = "bline-web-user-field-assets-held-v1-test";
    const heldV1 = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.addEventListener("upgradeneeded", () => {
        request.result.createObjectStore("user-field-assets", {
          keyPath: "entryId",
        });
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    heldV1.addEventListener("versionchange", () => {
      // Model a stale v1 owner that does not close cooperatively.
    });

    const adapterModulePath = "/src/userData/adapters.ts";
    const { BrowserUserDataAdapter } = await import(
      /* @vite-ignore */ adapterModulePath
    );
    const adapter = new BrowserUserDataAdapter({
      assetDbName: databaseName,
      openBlockedTimeoutMs: 50,
    });
    let blockedMessage = "";
    try {
      await adapter.read();
    } catch (error) {
      blockedMessage = error instanceof Error ? error.message : String(error);
    }

    heldV1.close();
    await adapter.read();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.addEventListener("success", () => resolve());
      request.addEventListener("error", () => reject(request.error));
      request.addEventListener("blocked", () => {
        reject(
          new Error("User Data connection did not close on versionchange"),
        );
      });
    });
    return { blockedMessage };
  });

  expect(result.blockedMessage).toMatch(
    /User Data storage upgrade is blocked by another BLine tab/,
  );
});

test("closes its User Data connection when a newer database version is requested", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).not.toContainText("Loading");

  await expect(
    page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open("bline-web-user-field-assets", 3);
          const timeout = window.setTimeout(
            () => reject(new Error("User Data versionchange remained blocked")),
            2_000,
          );
          request.addEventListener("success", () => {
            window.clearTimeout(timeout);
            const version = request.result.version;
            request.result.close();
            resolve(version);
          });
          request.addEventListener("error", () => {
            window.clearTimeout(timeout);
            reject(request.error);
          });
        }),
    ),
  ).resolves.toBe(3);
});

test("starts new users in a focused start center", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("mobile-support-warning")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Simple, rapid, robust." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Create project Name the project and its first path.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open sample" })).toBeVisible();

  await page.getByRole("button", { name: "Open sample" }).click();

  await expect(
    page.getByRole("navigation", { name: "Top menu" }),
  ).toBeVisible();
  await expect(page.getByLabel("Editor canvas")).toBeVisible();
  await expect(page.getByTestId("path-stage")).toBeVisible();
  await expect(
    page.getByText("Current Path: Phase 1 Canvas Draft"),
  ).toBeVisible();
  await expect(page.getByText("Path Elements")).toBeVisible();
  await expect(page.getByTestId("path-element-row-0")).toContainText(
    "1. Waypoint",
  );
  await expect(page.getByTestId("path-element-row-0")).toContainText(
    "5.70, 2.50 m",
  );
  await expect(page.getByTestId("path-element-row-5")).toContainText(
    "6. Waypoint",
  );
  await expect(page.getByTestId("path-element-row-5")).toContainText(
    "10.90, 5.50 m",
  );
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fit view" })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Canvas tools" }),
  ).toBeVisible();
  const selectTool = page.getByRole("button", { name: "Select tool" });
  const waypointTool = page.getByRole("button", { name: "Waypoint tool" });
  const translationTool = page.getByRole("button", {
    name: "Translation tool",
  });
  await expect(selectTool).toHaveAttribute("aria-pressed", "true");
  await waypointTool.click();
  await expect(waypointTool).toHaveAttribute("aria-pressed", "true");
  await translationTool.click();
  await expect(translationTool).toHaveAttribute("aria-pressed", "true");
  await selectTool.click();
  await expect(selectTool).toHaveAttribute("aria-pressed", "true");

  const fitView = page.getByRole("button", { name: "Fit view" });
  await expect(fitView).toContainText("100%");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(fitView).toContainText("125%");
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(fitView).toContainText("100%");
  const pathStage = page.getByTestId("path-stage");
  await pathStage.press("=");
  await expect(fitView).toContainText("125%");
  await pathStage.press("0");
  await expect(fitView).toContainText("100%");
  const interfaceZoomModifier =
    process.platform === "darwin" ? "Meta" : "Control";
  await pathStage.press(`${interfaceZoomModifier}+=`);
  await expect(fitView).toContainText("100%");
  await pathStage.press(`${interfaceZoomModifier}+0`);

  const hideLabelOverlays = page.getByRole("button", {
    name: "Hide Collection overlays",
  });
  await expect(hideLabelOverlays).toHaveAttribute("aria-pressed", "true");
  await hideLabelOverlays.click();
  const showLabelOverlays = page.getByRole("button", {
    name: "Show Collection overlays",
  });
  await expect(showLabelOverlays).toHaveAttribute("aria-pressed", "false");
  await showLabelOverlays.click();
  await expect(
    page.getByRole("button", { name: "Hide Collection overlays" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("tab", { name: "Constraints", exact: true }).click();
  const pathConstraintsCard = page.getByRole("article", {
    name: "Path constraints",
  });
  await expect(pathConstraintsCard).toBeVisible();
  await expect(pathConstraintsCard).not.toContainText("Path Constraints");
  await expect(page.getByText("Constraints", { exact: true })).toHaveCount(1);
  const addConstraint = page.getByRole("button", { name: "Add constraint" });
  const addConstraintSurface = page.getByTestId("constraint-add-surface");
  await expect(addConstraint).toBeVisible();
  await expect(addConstraint).toHaveText("Add constraint");
  await expect(
    page.locator(".constraint-list > .constraint-add-surface"),
  ).toHaveCount(1);
  expect(
    await addConstraint.evaluate(
      (button) =>
        button.parentElement?.parentElement ===
        button.parentElement?.parentElement?.parentElement?.lastElementChild,
    ),
  ).toBe(true);
  const optimizerBox = await requiredBox(pathConstraintsCard);
  const addSurfaceBox = await requiredBox(addConstraintSurface);
  expect(addSurfaceBox.y).toBeGreaterThan(optimizerBox.y + optimizerBox.height);
  expect(Math.abs(addSurfaceBox.width - optimizerBox.width)).toBeLessThan(2);
  await expect(
    page.getByTestId("constraint-range-max_velocity_meters_per_sec-0"),
  ).toHaveText("3 m/s");
  await expect(page.getByTestId("sidebar-selection-context")).toHaveCount(0);
  await expect(page.getByText("Element Properties")).toHaveCount(0);
  await expect(page.getByText("Generated constraints ready")).toHaveCount(0);
});

test("collapses and restores the inspector from the top toolbar", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  const toggle = page.getByRole("button", { name: "Toggle inspector" });
  const inspector = page.getByRole("complementary", {
    name: "Path inspector",
  });
  const canvasRegion = page.getByLabel("Editor canvas");
  const expandedCanvasBox = await requiredBox(canvasRegion);

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(inspector).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(inspector).toBeHidden();

  const collapsedCanvasBox = await requiredBox(canvasRegion);
  expect(collapsedCanvasBox.width).toBeGreaterThan(
    expandedCanvasBox.width + 250,
  );

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(inspector).toBeVisible();
});

test("resizes the desktop inspector by dragging its edge", async ({ page }) => {
  await gotoSampleEditor(page);

  const inspector = page.getByRole("complementary", {
    name: "Path inspector",
  });
  const resizeHandle = page.getByRole("separator", {
    name: "Resize inspector",
  });
  const before = await requiredBox(inspector);
  const handleBox = await requiredBox(resizeHandle);

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 80, handleBox.y + handleBox.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  const after = await requiredBox(inspector);
  expect(after.width).toBeGreaterThan(before.width + 60);
  await expect(resizeHandle).toHaveAttribute(
    "aria-valuenow",
    String(Math.round(after.width)),
  );
});

test("warns mobile users that support is limited", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");

  const warning = page.getByRole("dialog", { name: "Mobile support warning" });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("Mobile support is very limited");
  await expect(warning).toContainText("may be buggy");

  await warning.getByRole("button", { name: "Continue" }).click();
  await expect(warning).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("mobile-support-warning")).toHaveCount(0);
});

test("keeps the canvas bounded on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 450, height: 900 });
  await gotoSampleEditor(page);

  await expect(page.getByRole("button", { name: "Actions" })).toBeVisible();

  const documentHeight = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  const stageBox = await requiredBox(page.getByTestId("path-stage"));

  expect(documentHeight).toBeLessThan(1_850);
  expect(stageBox.height).toBeGreaterThan(450);
  expect(stageBox.height).toBeLessThan(850);
});

test("locks document scrolling to the viewport", async ({ page }) => {
  for (const viewport of [
    { width: 1200, height: 900 },
    { width: 390, height: 900 },
    { width: 320, height: 360 },
  ]) {
    await page.setViewportSize(viewport);
    await gotoSampleEditor(page);

    const metrics = await page.evaluate(() => {
      const documentScroller =
        document.scrollingElement ?? document.documentElement;
      const shell = document.querySelector(".app-shell");
      const sidebar = document.querySelector<HTMLElement>(".inspector-sidebar");

      if (!shell || !sidebar) {
        throw new Error("Expected app shell and sidebar to be present");
      }

      const shellBox = shell.getBoundingClientRect();
      sidebar.scrollTop = sidebar.scrollHeight;

      return {
        bodyOverflowY: getComputedStyle(document.body).overflowY,
        documentClientHeight: documentScroller.clientHeight,
        documentScrollHeight: documentScroller.scrollHeight,
        htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
        shellBottom: shellBox.bottom,
        shellTop: shellBox.top,
        sidebarClientHeight: sidebar.clientHeight,
        sidebarScrollHeight: sidebar.scrollHeight,
        sidebarScrollTop: sidebar.scrollTop,
        viewportHeight: window.innerHeight,
      };
    });

    expect(metrics.htmlOverflowY).toBe("hidden");
    expect(metrics.bodyOverflowY).toBe("hidden");
    expect(metrics.documentScrollHeight).toBeLessThanOrEqual(
      metrics.documentClientHeight + 1,
    );
    expect(metrics.shellTop).toBe(0);
    expect(metrics.shellBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);

    expect(metrics.sidebarScrollHeight).toBeGreaterThanOrEqual(
      metrics.sidebarClientHeight,
    );

    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, 1200);
    await page.evaluate(() => window.scrollTo(0, 1_000));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }
});

test("keeps dense sidebar content inside the viewport without horizontal sidebar scroll", async ({
  page,
}) => {
  for (const viewport of [
    { width: 390, height: 900 },
    { width: 1200, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await gotoSampleEditor(page);
    if (viewport.width < 980) {
      await page.getByRole("button", { name: "Toggle inspector" }).click();
    }
    await page.getByRole("tab", { name: /Elements/ }).click();

    for (let index = 0; index < 5; index += 1) {
      await page.getByText("Add element").click();
      await page.getByRole("menuitem", { name: "Waypoint" }).click();
    }

    await openConstraintsTab(page);
    await page.getByRole("button", { name: "Add constraint" }).click();
    await page.getByRole("menuitem", { name: "Max Rot Acceleration" }).click();
    const denseConstraintCard = page.getByTestId(
      "constraint-card-max_acceleration_deg_per_sec2",
    );
    await expect(denseConstraintCard).toBeVisible();
    await expect(
      denseConstraintCard.locator(
        ".ranged-constraint-controls__actions button",
      ),
    ).toHaveCount(4);
    await expect(page.getByTestId("auto-velocity-controls")).toHaveCount(0);
    // Select the segment last (clicking elsewhere clears the selection) so its
    // value control renders for the overflow measurement below.
    await page
      .getByRole("listbox", { name: "Max Rot Acceleration segments" })
      .focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      denseConstraintCard.locator(
        ".ranged-constraint-controls input[role='spinbutton']",
      ),
    ).toBeVisible();

    const metrics = await page.evaluate(() => {
      const documentScroller =
        document.scrollingElement ?? document.documentElement;
      const sidebar = document.querySelector(".inspector-sidebar");
      const denseCard = document.querySelector(
        "[data-testid='constraint-card-max_acceleration_deg_per_sec2']",
      );
      const valueControl = denseCard?.querySelector(
        ".ranged-constraint-controls .sidebar-number-control",
      );
      const valueInput = denseCard?.querySelector<HTMLInputElement>(
        ".ranged-constraint-controls input[role='spinbutton']",
      );
      const actionButtons = Array.from(
        denseCard?.querySelectorAll(
          ".ranged-constraint-controls__actions button",
        ) ?? [],
      );

      if (
        !sidebar ||
        !denseCard ||
        !valueControl ||
        !valueInput ||
        actionButtons.length !== 4
      ) {
        throw new Error("Expected dense sidebar ranged controls to be present");
      }

      const sidebarBox = sidebar.getBoundingClientRect();
      const valueBox = valueControl.getBoundingClientRect();
      const childBoxes = Array.from(sidebar.children).map((child) => {
        const rect = child.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          scrollWidth: child.scrollWidth,
          clientWidth: child.clientWidth,
        };
      });
      const actionButtonBoxes = actionButtons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
        };
      });
      return {
        viewportWidth: window.innerWidth,
        documentClientWidth: documentScroller.clientWidth,
        documentScrollWidth: documentScroller.scrollWidth,
        sidebarClientWidth: sidebar.clientWidth,
        sidebarScrollWidth: sidebar.scrollWidth,
        sidebarLeft: sidebarBox.left,
        sidebarRight: sidebarBox.right,
        childBoxes,
        valueControlBottom: valueBox.bottom,
        valueInputClientWidth: valueInput.clientWidth,
        valueInputScrollWidth: valueInput.scrollWidth,
        actionButtonBoxes,
      };
    });

    expect(metrics.documentScrollWidth).toBeLessThanOrEqual(
      metrics.documentClientWidth + 1,
    );
    expect(metrics.sidebarScrollWidth).toBeLessThanOrEqual(
      metrics.sidebarClientWidth + 1,
    );
    expect(metrics.sidebarLeft).toBeGreaterThanOrEqual(-1);
    expect(metrics.sidebarRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);

    for (const childBox of metrics.childBoxes) {
      expect(childBox.left).toBeGreaterThanOrEqual(-1);
      expect(childBox.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
      expect(childBox.scrollWidth).toBeLessThanOrEqual(
        childBox.clientWidth + 1,
      );
    }

    for (const actionButtonBox of metrics.actionButtonBoxes) {
      expect(
        Math.abs(actionButtonBox.bottom - metrics.valueControlBottom),
      ).toBeLessThanOrEqual(1);
    }

    expect(metrics.valueInputScrollWidth).toBeLessThanOrEqual(
      metrics.valueInputClientWidth + 1,
    );
  }
});

test("opens settings from a narrow portrait top bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await gotoSampleEditor(page);
  await dismissMobileSupportWarning(page);

  await page.getByRole("button", { name: "Settings" }).click();

  await expect(page.getByRole("dialog", { name: "Edit Config" })).toBeVisible();
  await page.getByRole("button", { name: "Robot" }).click();
  await expect(page.getByLabel("Robot Length (m)")).toBeVisible();
});

test("keeps the compact top menu on one row without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await gotoSampleEditor(page);
  await dismissMobileSupportWarning(page);

  const topMenu = page.getByRole("navigation", { name: "Top menu" });
  const metrics = await topMenu.evaluate((element) => {
    const buttonRows = Array.from(element.querySelectorAll("button"))
      .filter((button) => button.getBoundingClientRect().width > 0)
      .map((button) => Math.round(button.getBoundingClientRect().top));

    return {
      clientWidth: element.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth - window.innerWidth,
      scrollWidth: element.scrollWidth,
      rowCount: new Set(buttonRows).size,
      overflowX: getComputedStyle(element).overflowX,
    };
  });

  expect(metrics.overflowX).toBe("auto");
  expect(metrics.scrollWidth).toBeGreaterThanOrEqual(metrics.clientWidth);
  expect(metrics.pageOverflowX).toBeLessThanOrEqual(1);
  expect(metrics.rowCount).toBeLessThanOrEqual(2);

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Edit Config" })).toBeVisible();
});

test("bounds compact dropdown panels to the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 180 });
  await gotoSampleEditor(page);
  await dismissMobileSupportWarning(page);

  await page.getByRole("button", { name: "File", exact: true }).click();

  const panelMetrics = await page
    .getByTestId("top-menu-project")
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();

      return {
        bottom: rect.bottom,
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
        viewportHeight: window.innerHeight,
      };
    });

  expect(panelMetrics.overflowY).toBe("auto");
  expect(panelMetrics.bottom).toBeLessThanOrEqual(panelMetrics.viewportHeight);
  expect(panelMetrics.scrollHeight).toBeGreaterThan(panelMetrics.clientHeight);
});
