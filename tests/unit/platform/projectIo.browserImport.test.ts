import { describe, expect, it } from "vitest";
import {
  createProjectIoService,
  type ProjectImportResult,
  type ProjectImportRollback,
} from "../../../src/platform/projectIo";
import { browserWebCapabilities } from "../../../src/env/capabilities";
import { BrowserStorage, StorageConflictError } from "../../../src/storage";
import { readFieldBackgroundImage, readUserData } from "../../../src/userData";
import {
  deferred,
  FailOnceWorkspaceWriteStorage,
  MemoryStorage,
  ObservedSerialProjectMutationLock,
} from "../support/browserStorageFakes";
import {
  exampleWorkspace,
  initializeImportUserData,
  legacyField,
  legacyFieldArchive,
  migrateImportedFields,
  projectArchiveFile,
} from "../support/projectIoFixtures";

describe("browser Project import transactions", () => {
  it("retains deterministic Fields when an identical concurrent import wins", async () => {
    const storage = new BrowserStorage({ storage: new MemoryStorage() });
    const first = createProjectIoService(browserWebCapabilities, { storage });
    const second = createProjectIoService(browserWebCapabilities, { storage });
    const contextService = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const context = await contextService.createWorkspace();
    let preparations = 0;
    let rollbacks = 0;
    const migrateLegacyFieldBackgrounds = async () => {
      preparations += 1;
      return {
        rollback: async () => {
          rollbacks += 1;
        },
      };
    };
    const archive = projectArchiveFile(legacyFieldArchive());

    const outcomes = await Promise.allSettled([
      first.importProjectArchive(context, archive, {
        migrateLegacyFieldBackgrounds,
      }),
      second.importProjectArchive(context, archive, {
        migrateLegacyFieldBackgrounds,
      }),
    ]);

    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
      status: "rejected",
      reason: expect.any(StorageConflictError),
    });
    expect(preparations).toBe(1);
    expect(rollbacks).toBe(0);
    await expect(first.listWorkspaces()).resolves.toHaveLength(1);
  });

  it("serializes same-ID preparation before distinct Projects can share deterministic Fields", async () => {
    const storage = new BrowserStorage({ storage: new MemoryStorage() });
    const first = createProjectIoService(browserWebCapabilities, { storage });
    const second = createProjectIoService(browserWebCapabilities, { storage });
    const contextService = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const context = await contextService.createWorkspace();
    const userData = await initializeImportUserData();
    let preparations = 0;
    const migrateLegacyFieldBackgrounds = async (
      pending: ProjectImportResult,
    ) => {
      preparations += 1;
      return migrateImportedFields(pending);
    };
    const firstArchive = legacyFieldArchive();
    const secondArchive = legacyFieldArchive();
    secondArchive.config.gui.robot.length_meters = 1.2;

    const outcomes = await Promise.allSettled([
      first.importProjectArchive(context, projectArchiveFile(firstArchive), {
        migrateLegacyFieldBackgrounds,
      }),
      second.importProjectArchive(context, projectArchiveFile(secondArchive), {
        migrateLegacyFieldBackgrounds,
      }),
    ]);

    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
      status: "rejected",
      reason: expect.any(StorageConflictError),
    });
    const fulfilled = outcomes.find(
      (outcome) => outcome.status === "fulfilled",
    );
    expect(preparations).toBe(1);
    expect(readUserData().field_backgrounds).toHaveLength(1);
    const selectedId =
      readUserData().project_views["imported-project"]
        ?.selected_field_background_id;
    expect(selectedId).toBe(readUserData().field_backgrounds[0]?.id);
    expect(await readFieldBackgroundImage(selectedId!)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(userData.assets.size).toBe(1);
    await expect(first.listWorkspaces()).resolves.toHaveLength(1);
    const durableWinner = await first.reloadWorkspace({
      storageId: "imported-project",
    });
    if (!durableWinner) {
      throw new Error("Expected the winning imported Project");
    }
    expect(durableWinner.project.config.gui.robot.length_meters).toBe(
      fulfilled?.value.project.config.gui.robot.length_meters,
    );
  });

  it("keeps Field selection with its same-ID stripped Project winner", async () => {
    const storage = new BrowserStorage({ storage: new MemoryStorage() });
    const first = createProjectIoService(browserWebCapabilities, { storage });
    const second = createProjectIoService(browserWebCapabilities, { storage });
    const contextService = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const context = await contextService.createWorkspace();
    const userData = await initializeImportUserData();
    let preparations = 0;
    const migrateLegacyFieldBackgrounds = async (
      pending: ProjectImportResult,
    ) => {
      preparations += 1;
      return migrateImportedFields(pending);
    };
    const firstArchive = legacyFieldArchive();
    const secondArchive = legacyFieldArchive();
    const secondField = legacyField("other-field", "other.png");
    secondArchive.config.gui.field = {
      selected_field_id: secondField.id,
      custom_fields: [secondField],
    };
    secondArchive.field_assets = [
      {
        asset_id: secondField.asset_id,
        file_name: secondField.file_name,
        mime_type: secondField.mime_type,
        data_base64: "BAUG",
      },
    ];

    const outcomes = await Promise.allSettled([
      first.importProjectArchive(context, projectArchiveFile(firstArchive), {
        migrateLegacyFieldBackgrounds,
      }),
      second.importProjectArchive(context, projectArchiveFile(secondArchive), {
        migrateLegacyFieldBackgrounds,
      }),
    ]);

    const fulfilled = outcomes.find(
      (
        outcome,
      ): outcome is PromiseFulfilledResult<
        Awaited<ReturnType<typeof first.importProjectArchive>>
      > => outcome.status === "fulfilled",
    );
    expect(fulfilled).toBeDefined();
    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(preparations).toBe(1);
    const snapshot = readUserData();
    expect(snapshot.field_backgrounds).toHaveLength(1);
    const selectedId =
      snapshot.project_views["imported-project"]?.selected_field_background_id;
    expect(selectedId).toBe(snapshot.field_backgrounds[0]?.id);
    expect(snapshot.field_backgrounds[0]?.name).toBe(
      fulfilled?.value.legacySelectedFieldId,
    );
    const expectedBytes =
      fulfilled?.value.legacySelectedFieldId === "other-field"
        ? new Uint8Array([4, 5, 6])
        : new Uint8Array([1, 2, 3]);
    expect(await readFieldBackgroundImage(selectedId!)).toEqual(expectedBytes);
    expect(userData.assets.size).toBe(1);
  });

  it("finishes failed rollback under the Project lock before a queued import prepares", async () => {
    const memory = new FailOnceWorkspaceWriteStorage();
    const lock = new ObservedSerialProjectMutationLock();
    const storage = new BrowserStorage({
      storage: memory,
      projectMutationLock: lock,
    });
    const target = createProjectIoService(browserWebCapabilities, { storage });
    const targetWorkspace = await target.createWorkspace({
      project: exampleWorkspace("existing", "Existing", ["Kept"]),
    });
    const userData = await initializeImportUserData();
    memory.failNextWorkspaceWrite("imported-project");

    const firstRollbackMayComplete = deferred();
    const firstRollbackHasStarted = deferred();
    const secondPreparationMayComplete = deferred();
    const secondPreparationHasStarted = deferred();
    const events: string[] = [];
    let preparations = 0;
    const migrateLegacyFieldBackgrounds = async (
      pending: ProjectImportResult,
    ): Promise<ProjectImportRollback> => {
      preparations += 1;
      if (preparations === 1) {
        events.push("first-preparation-started");
        const migration = await migrateImportedFields(pending);
        events.push("first-prepared");
        return {
          rollback: async () => {
            events.push("first-rollback-started");
            firstRollbackHasStarted.resolve();
            await firstRollbackMayComplete.promise;
            await migration.rollback();
            events.push("first-rollback-completed");
          },
        };
      }

      events.push("second-preparation-started");
      expect(readUserData().field_backgrounds).toHaveLength(0);
      expect(
        readUserData().project_views["imported-project"]
          ?.selected_field_background_id,
      ).toBeUndefined();
      const migration = await migrateImportedFields(pending);
      events.push("second-prepared");
      expect(readUserData().field_backgrounds).toHaveLength(1);
      secondPreparationHasStarted.resolve();
      await secondPreparationMayComplete.promise;
      return migration;
    };

    const firstOutcome = target
      .importProjectArchive(
        targetWorkspace,
        projectArchiveFile(legacyFieldArchive()),
        { migrateLegacyFieldBackgrounds },
      )
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
    await firstRollbackHasStarted.promise;
    expect(memory.getItem("bline-web:current-workspace")).toBe("existing");

    const secondImport = target.importProjectArchive(
      targetWorkspace,
      projectArchiveFile(legacyFieldArchive()),
      { migrateLegacyFieldBackgrounds },
    );
    await lock.waitForRequestCount(3);
    expect(preparations).toBe(1);
    expect(events).toEqual([
      "first-preparation-started",
      "first-prepared",
      "first-rollback-started",
    ]);

    firstRollbackMayComplete.resolve();
    await secondPreparationHasStarted.promise;
    expect(await firstOutcome).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        message: "browser Project write failed",
      }),
    });
    expect(events).toEqual([
      "first-preparation-started",
      "first-prepared",
      "first-rollback-started",
      "first-rollback-completed",
      "second-preparation-started",
      "second-prepared",
    ]);
    expect(memory.getItem("bline-web:current-workspace")).toBe("existing");

    secondPreparationMayComplete.resolve();
    const imported = await secondImport;
    expect(imported.workspace.project.project_id).toBe("imported-project");
    const snapshot = readUserData();
    expect(snapshot.field_backgrounds).toHaveLength(1);
    const field = snapshot.field_backgrounds[0]!;
    expect(field).toMatchObject({
      name: "legacy-field",
      file_name: "legacy.png",
      mime_type: "image/png",
      geometry: {
        length_meters: 12,
        width_meters: 6,
        coordinate_offset_meters: 0,
      },
    });
    expect(
      snapshot.project_views["imported-project"]?.selected_field_background_id,
    ).toBe(field.id);
    expect(await readFieldBackgroundImage(field.id)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(userData.assets.size).toBe(1);
    expect(memory.getItem("bline-web:current-workspace")).toBe(
      "imported-project",
    );
    expect(lock.maximumConcurrentOwners).toBe(1);
    expect(lock.concurrentOwners).toBe(0);
  });
});
