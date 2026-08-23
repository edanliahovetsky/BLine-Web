import { expect, test, type Page } from "@playwright/test";
import { canvasNodePosition } from "./support/app-shell-canvas";
import { runEditMenuAction } from "./support/app-shell-commands";
import {
  activeFieldImageLoaded,
  activeFieldLabel,
  putLegacyFieldAsset,
  seedLegacyFieldProject,
  tinyPngBuffer,
} from "./support/app-shell-fields";
import {
  installSaveFilePickerSpy,
  savedFile,
  savedFileCount,
} from "./support/app-shell-persistence";
import { openPathMenu } from "./support/app-shell-project-library";
import { gotoSampleEditor } from "./support/app-shell-shared";

test("edits project config with undo support", async ({ page }) => {
  await gotoSampleEditor(page);

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  const saveButton = dialog.getByRole("button", { name: "Save" });
  await expect(dialog).toBeVisible();
  await expect(saveButton).toBeDisabled();
  await expect(dialog.locator(".config-dialog__nav-item")).toHaveText([
    "Robot",
    "Path Defaults",
    "Field",
    "Optimizer",
  ]);
  await expect(
    dialog.getByRole("heading", { name: "Auto Velocity" }),
  ).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Robot" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await dialog.getByRole("button", { name: "Optimizer" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Constraint Generation" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Optimizer" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Robot" }).click();
  await expect(dialog.getByLabel("Protrusion Distance (m)")).toBeDisabled();
  await expect(
    dialog.getByTitle("Increase Protrusion Distance (m)"),
  ).toBeDisabled();
  await expect(dialog.getByLabel("Protrusion Side")).toBeDisabled();
  await expect(dialog.getByTitle("Increase Robot Length (m)")).toBeVisible();
  await page.getByLabel("Robot Length (m)").fill("0.825");
  await expect(saveButton).toBeEnabled();
  await page.getByLabel("Enable Protrusions").check();
  await expect(dialog.getByLabel("Protrusion Distance (m)")).toBeEnabled();
  await expect(
    dialog.getByTitle("Increase Protrusion Distance (m)"),
  ).toBeEnabled();
  await expect(dialog.getByLabel("Protrusion Side")).toBeEnabled();
  await expect(page.getByLabel("Default Protrusion State")).toHaveValue(
    "shown",
  );
  await page.getByLabel("Protrusion Side").selectOption("front");
  await page.getByLabel("Show On Event Keys").fill("intake, deploy");
  await saveButton.click();
  await expect(page.getByTestId("save-status")).toContainText(
    /Autosave pending|Saved/,
  );

  await runEditMenuAction(page, "Undo");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Robot" }).click();
  await expect(page.getByLabel("Robot Length (m)")).toHaveValue("0.8");
  await page.getByRole("button", { name: "Path Defaults" }).click();
  await expect(page.getByLabel("Default Max Accel (m/s2)")).toHaveValue("12");
  await page.getByRole("button", { name: "Robot" }).click();
  await expect(page.getByLabel("Enable Protrusions")).not.toBeChecked();
  await page.getByRole("button", { name: "Close config" }).click();
});

test("uploads and restores a custom field image from Settings", async ({
  page,
}) => {
  await installSaveFilePickerSpy(page);
  await gotoSampleEditor(page);
  await expect(page.getByTestId("path-stage-pixi-canvas")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  await dialog.getByRole("button", { name: "Field" }).click();
  const fieldSelect = dialog.getByLabel("Field Image", { exact: true });
  const saveButton = dialog.getByRole("button", { name: "Save" });
  await expect(dialog).toBeVisible();

  const fieldOptions = await fieldSelect.locator("option").allTextContents();
  expect(fieldOptions).toEqual(
    expect.arrayContaining([
      "Rapid React 2022",
      "Charged Up 2023",
      "Crescendo 2024",
      "Reefscape 2025",
      "Reefscape 2025 (Annotated)",
      "REBUILT 2026",
      "Blank Meter Grid",
    ]),
  );

  await fieldSelect.selectOption("blank-grid");
  await expect(dialog.getByTestId("field-preview")).toBeVisible();
  await dialog.getByLabel("Upload field image").setInputFiles({
    name: "practice-field.png",
    mimeType: "image/png",
    buffer: tinyPngBuffer(),
  });
  await expect(dialog.getByLabel("Field Name")).toBeEnabled();
  await dialog.getByLabel("Field Name").fill("Practice Field");
  await dialog.getByLabel("Field Length (m)").fill("4");
  await dialog.getByLabel("Field Width (m)").fill("2");
  await dialog.getByLabel("Field Padding X (m)").fill("0.25");
  await dialog.getByLabel("Field Padding Y (m)").fill("0.25");
  await saveButton.click();

  await expect(page.getByTestId("save-status")).toContainText("Saved", {
    timeout: 3_000,
  });
  await expect.poll(() => activeFieldLabel(page)).toBe("Practice Field");
  await expect.poll(() => activeFieldImageLoaded(page)).toBe(true);

  // A smaller background changes the viewport, not the saved coordinates.
  await page.getByTestId("path-element-row-0").click();
  await expect(page.getByLabel("X (m)")).toHaveValue("5.7");
  await expect(page.getByLabel("Y (m)")).toHaveValue("2.5");
  await expect(page.getByRole("button", { name: /^Path health/ })).toHaveClass(
    /has-diagnostics--warning/,
  );

  // Numeric edits can recover preserved overflow gradually, but cannot move
  // farther away from the active field's effective coordinate bounds.
  const properties = page.getByTestId("property-editor");
  const xField = properties.getByLabel("X (m)");
  const yField = properties.getByLabel("Y (m)");
  await xField.fill("5.2");
  await xField.blur();
  await expect(xField).toHaveValue("5.2");
  await xField.fill("5.4");
  await xField.blur();
  await expect(xField).toHaveValue("5.2");
  await runEditMenuAction(page, "Undo");
  await expect(xField).toHaveValue("5.7");
  await expect(yField).toHaveValue("2.5");

  // Warnings never block saving or exporting, and export retains the raw
  // coordinates instead of serializing the bounded canvas preview.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await openPathMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await page.getByRole("menuitem", { name: "Export Path..." }).click();
  await expect.poll(() => savedFileCount(page)).toBe(1);
  const exportedPath = JSON.parse((await savedFile(page, 0)).text) as {
    path_elements: Array<{
      translation_target?: { x_meters: number; y_meters: number };
    }>;
  };
  expect(exportedPath.path_elements[0]?.translation_target).toMatchObject({
    x_meters: 5.7,
    y_meters: 2.5,
  });

  // Pointer-down alone keeps the raw coordinates, and a cancelled moved drag
  // discards its bounded preview without creating a Path edit.
  const pathStageCanvas = page.getByTestId("path-stage-canvas");
  let boundedNode = await canvasNodePosition(page, "path-element-node-0");
  await page.mouse.move(boundedNode.x, boundedNode.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(xField).toHaveValue("5.7");
  await expect(yField).toHaveValue("2.5");

  await pathStageCanvas.evaluate((canvas) => {
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        canvas.setAttribute(
          "data-e2e-pointer-id",
          String((event as PointerEvent).pointerId),
        );
      },
      { once: true },
    );
  });
  const cancelledPoint = {
    x: boundedNode.x - 24,
    y: boundedNode.y + 24,
  };
  await page.mouse.move(boundedNode.x, boundedNode.y);
  await page.mouse.down();
  await page.mouse.move(cancelledPoint.x, cancelledPoint.y, { steps: 4 });
  await expect
    .poll(() => pathStageCanvas.getAttribute("data-e2e-pointer-id"))
    .not.toBeNull();
  const pointerId = Number(
    await pathStageCanvas.getAttribute("data-e2e-pointer-id"),
  );
  await pathStageCanvas.dispatchEvent("pointercancel", {
    bubbles: true,
    button: 0,
    buttons: 0,
    cancelable: true,
    clientX: cancelledPoint.x,
    clientY: cancelledPoint.y,
    pointerId,
    pointerType: "mouse",
  });
  await page.mouse.up();
  await expect(xField).toHaveValue("5.7");
  await expect(yField).toHaveValue("2.5");

  // The off-field node is shown at the nearest edge. Its first drag commits
  // the snap as one normal undoable Path edit.
  boundedNode = await canvasNodePosition(page, "path-element-node-0");
  await page.mouse.move(boundedNode.x, boundedNode.y);
  await page.mouse.down();
  await page.mouse.move(boundedNode.x - 24, boundedNode.y + 24, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByLabel("X (m)").inputValue()))
    .toBeLessThanOrEqual(3.5);
  await expect
    .poll(async () => Number(await page.getByLabel("Y (m)").inputValue()))
    .toBeLessThanOrEqual(1.5);
  await runEditMenuAction(page, "Undo");
  await expect(page.getByLabel("X (m)")).toHaveValue("5.7");
  await expect(page.getByLabel("Y (m)")).toHaveValue("2.5");

  await page.reload();
  await expect(page.getByTestId("path-stage-pixi-canvas")).toBeVisible();
  await expect.poll(() => activeFieldLabel(page)).toBe("Practice Field");
  await expect.poll(() => activeFieldImageLoaded(page)).toBe(true);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Field" }).click();
  await expect(page.getByLabel("Field Name")).toHaveValue("Practice Field");
  await expect(page.getByLabel("Field Length (m)")).toHaveValue("4");
  await page.getByRole("button", { name: "Close config" }).click();
});

test("keeps uploaded and replacement Field images as drafts until Settings is saved", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  expect(await userFieldStorageCounts(page)).toEqual({ entries: 0, assets: 0 });

  await page.getByRole("button", { name: "Settings" }).click();
  let dialog = page.getByRole("dialog", { name: "Edit Config" });
  await dialog.getByRole("button", { name: "Field" }).click();
  await dialog.getByLabel("Upload field image").setInputFiles({
    name: "cancelled-field.png",
    mimeType: "image/png",
    buffer: tinyPngBuffer(),
  });
  await expect(dialog.getByLabel("Field Name")).toHaveValue(
    "cancelled field.png",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();

  expect(await userFieldStorageCounts(page)).toEqual({ entries: 0, assets: 0 });
  await page.getByRole("button", { name: "Settings" }).click();
  dialog = page.getByRole("dialog", { name: "Edit Config" });
  await dialog.getByRole("button", { name: "Field" }).click();
  await expect(
    dialog.getByLabel("Field Image", { exact: true }).getByRole("option", {
      name: "cancelled field.png",
    }),
  ).toHaveCount(0);

  await dialog.getByLabel("Upload field image").setInputFiles({
    name: "saved-field.png",
    mimeType: "image/png",
    buffer: tinyPngBuffer(),
  });
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await expect
    .poll(() => userFieldStorageCounts(page))
    .toEqual({ entries: 1, assets: 1 });
  const [savedFieldId] = await userFieldStorageIds(page);
  expect(savedFieldId).toBeTruthy();

  await page.getByRole("button", { name: "Settings" }).click();
  dialog = page.getByRole("dialog", { name: "Edit Config" });
  await dialog.getByRole("button", { name: "Field" }).click();
  await dialog.getByLabel("Upload field image").setInputFiles({
    name: "cancelled-replacement.png",
    mimeType: "image/png",
    buffer: tinyPngBuffer(),
  });
  await expect(dialog.getByLabel("Field Name")).toHaveValue(
    "cancelled replacement.png",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();

  expect(await userFieldStorageCounts(page)).toEqual({ entries: 1, assets: 1 });
  await page.getByRole("button", { name: "Settings" }).click();
  dialog = page.getByRole("dialog", { name: "Edit Config" });
  await dialog.getByRole("button", { name: "Field" }).click();
  await expect(dialog.getByLabel("Field Name")).toHaveValue("saved field.png");
  await dialog.getByLabel("Upload field image").setInputFiles({
    name: "saved-replacement.png",
    mimeType: "image/png",
    buffer: tinyPngBuffer(),
  });
  await expect(dialog.getByLabel("Field Name")).toHaveValue(
    "saved replacement.png",
  );
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  expect(await userFieldStorageCounts(page)).toEqual({ entries: 1, assets: 1 });
  expect(await userFieldStorageIds(page)).toEqual([savedFieldId]);
});

test("does not save an earlier Settings snapshot while a Field upload is decoding", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  await page.getByLabel("Robot Length (m)").fill("0.825");
  await dialog.getByRole("button", { name: "Field" }).click();
  await page.evaluate(() => {
    class NeverLoadingImage {
      naturalWidth = 0;
      naturalHeight = 0;
      width = 0;
      height = 0;
      addEventListener() {}
      set src(_value: string) {}
    }
    Object.defineProperty(window, "Image", {
      configurable: true,
      value: NeverLoadingImage,
    });
  });

  await dialog.getByLabel("Upload field image").setInputFiles({
    name: "slow-field_100.png",
    mimeType: "image/png",
    buffer: tinyPngBuffer(),
  });

  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await userFieldStorageCounts(page)).toEqual({ entries: 0, assets: 0 });
});

test("keeps Settings modal and immutable until its Field save finishes", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  await dialog.getByRole("button", { name: "Field" }).click();
  await dialog.getByLabel("Upload field image").setInputFiles({
    name: "deferred-field.png",
    mimeType: "image/png",
    buffer: tinyPngBuffer(),
  });
  await expect(dialog.getByLabel("Field Name")).toHaveValue(
    "deferred field.png",
  );
  await page.evaluate(() => {
    const originalArrayBuffer = File.prototype.arrayBuffer;
    let release: (() => void) | null = null;
    File.prototype.arrayBuffer = function deferredArrayBuffer() {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        release = () => {
          void originalArrayBuffer.call(this).then(resolve, reject);
        };
      });
    };
    Object.assign(window, {
      __releaseDeferredFieldSave: () => release?.(),
    });
  });

  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(
    dialog.getByRole("button", { name: "Close config" }),
  ).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(dialog.locator(".config-dialog__body")).toHaveAttribute(
    "inert",
    "",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();

  await page.evaluate(() => {
    (
      window as typeof window & {
        __releaseDeferredFieldSave?: () => void;
      }
    ).__releaseDeferredFieldSave?.();
  });
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => userFieldStorageCounts(page))
    .toEqual({ entries: 1, assets: 1 });
});

test("migrates a legacy Project field image before deleting its old bytes", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const imageBytes = [...tinyPngBuffer()];
  const seeded = await seedLegacyFieldProject(page, imageBytes, true);

  await page.reload();
  await expect(page.getByTestId("path-stage-pixi-canvas")).toBeVisible();
  await expect.poll(() => activeFieldLabel(page)).toBe("Legacy Practice Field");
  await expect.poll(() => activeFieldImageLoaded(page)).toBe(true);

  const migrated = await page.evaluate(async ({ assetId, projectId }) => {
    const userDataDatabase = await new Promise<IDBDatabase>(
      (resolve, reject) => {
        const request = indexedDB.open("bline-web-user-field-assets", 2);
        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () => reject(request.error));
      },
    );
    const userData = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const transaction = userDataDatabase.transaction(
          "user-data",
          "readonly",
        );
        const request = transaction.objectStore("user-data").get("global");
        request.addEventListener("success", () => {
          const record = request.result as
            | { data?: Record<string, unknown> }
            | undefined;
          resolve(record?.data ?? {});
        });
        request.addEventListener("error", () => reject(request.error));
      },
    );
    userDataDatabase.close();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bline-web-field-assets", 1);
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    const oldAsset = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction("field-assets", "readonly");
      const request = transaction
        .objectStore("field-assets")
        .get(`${encodeURIComponent(projectId)}:${encodeURIComponent(assetId)}`);
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    database.close();
    return {
      entryCount:
        (
          userData.field_backgrounds as
            | Array<Record<string, unknown>>
            | undefined
        )?.length ?? 0,
      selectedId: (
        userData.project_views as
          | Record<string, { selected_field_background_id?: string }>
          | undefined
      )?.[projectId]?.selected_field_background_id,
      oldAssetPresent: oldAsset !== undefined,
    };
  }, seeded);

  expect(migrated.entryCount).toBe(1);
  expect(migrated.selectedId).toMatch(/^legacy-field-/);
  expect(migrated.oldAssetPresent).toBe(false);
});

test("surfaces and retries a failed legacy Project field migration", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const imageBytes = [...tinyPngBuffer()];
  const seeded = await seedLegacyFieldProject(page, imageBytes, false);

  await page.reload();
  await expect(page.getByTestId("path-stage-pixi-canvas")).toBeVisible();
  const saveStatus = page.getByTestId("save-status");
  await expect(saveStatus).toHaveAttribute(
    "title",
    /Legacy Field Background image is missing/,
  );
  await expect(saveStatus).toContainText("Retry");

  await page.getByTestId("path-element-row-1").click();
  const xField = page.getByLabel("X (m)");
  const originalX = Number(await xField.inputValue());
  await page.keyboard.press("ArrowRight");
  const editedX = Number(await xField.inputValue());
  expect(editedX).toBeGreaterThan(originalX);

  await putLegacyFieldAsset(page, seeded, imageBytes);
  await saveStatus.click();

  await expect.poll(() => activeFieldLabel(page)).toBe("Legacy Practice Field");
  await expect.poll(() => activeFieldImageLoaded(page)).toBe(true);
  await expect(saveStatus).toContainText("Saved");
  const cleanup = await page.evaluate(async ({ assetId, projectId }) => {
    const storageKey = Object.keys(window.localStorage).find((key) =>
      key.startsWith("bline-web:workspace:"),
    );
    const record = JSON.parse(
      window.localStorage.getItem(storageKey ?? "") ?? "null",
    );
    const database = await openLegacyFieldDatabase();
    const oldAsset = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction("field-assets", "readonly");
      const request = transaction
        .objectStore("field-assets")
        .get(`${encodeURIComponent(projectId)}:${encodeURIComponent(assetId)}`);
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    database.close();
    return {
      legacyDocumentPresent: record?.legacyDocument !== undefined,
      oldAssetPresent: oldAsset !== undefined,
    };

    function openLegacyFieldDatabase(): Promise<IDBDatabase> {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open("bline-web-field-assets", 1);
        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () => reject(request.error));
      });
    }
  }, seeded);
  expect(cleanup).toEqual({
    legacyDocumentPresent: false,
    oldAssetPresent: false,
  });

  await page.reload();
  await expect(page.getByTestId("path-stage-pixi-canvas")).toBeVisible();
  await page.getByTestId("path-element-row-1").click();
  await expect
    .poll(async () => Number(await xField.inputValue()))
    .toBe(editedX);
});

test("cancels project config edits with Escape", async ({ page }) => {
  await gotoSampleEditor(page);

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Robot" }).click();
  await page.getByLabel("Robot Width (m)").fill("0.725");
  await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Robot" }).click();
  await expect(page.getByLabel("Robot Width (m)")).toHaveValue("0.8");
  await page.getByRole("button", { name: "Close config" }).click();
});

async function userFieldStorageCounts(
  page: Page,
): Promise<{ entries: number; assets: number }> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bline-web-user-field-assets", 2);
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    const transaction = database.transaction(
      ["user-data", "user-field-assets"],
      "readonly",
    );
    const userData = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const request = transaction.objectStore("user-data").get("global");
        request.addEventListener("success", () => {
          const record = request.result as
            | { data?: Record<string, unknown> }
            | undefined;
          resolve(record?.data ?? {});
        });
        request.addEventListener("error", () => reject(request.error));
      },
    );
    const assets = await new Promise<number>((resolve, reject) => {
      const request = transaction.objectStore("user-field-assets").count();
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("abort", () => reject(transaction.error));
      transaction.addEventListener("error", () => reject(transaction.error));
    });
    database.close();
    return {
      entries:
        (
          userData.field_backgrounds as
            | Array<Record<string, unknown>>
            | undefined
        )?.length ?? 0,
      assets,
    };
  });
}

async function userFieldStorageIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bline-web-user-field-assets", 2);
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    const transaction = database.transaction("user-data", "readonly");
    const userData = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const request = transaction.objectStore("user-data").get("global");
        request.addEventListener("success", () => {
          const record = request.result as
            | { data?: Record<string, unknown> }
            | undefined;
          resolve(record?.data ?? {});
        });
        request.addEventListener("error", () => reject(request.error));
      },
    );
    database.close();
    return (
      (userData.field_backgrounds as Array<{ id?: string }> | undefined) ?? []
    ).flatMap((field) => (field.id ? [field.id] : []));
  });
}
