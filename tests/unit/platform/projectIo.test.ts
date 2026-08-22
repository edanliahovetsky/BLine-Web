import { describe, expect, it } from "vitest";
import {
  createPathModel,
  createTranslationTarget,
} from "../../../src/core/model/path";
import type { Project } from "../../../src/core/model/project";
import {
  createProjectPathDocument,
  createProjectWorkspaceDocument,
} from "../../../src/core/io/projectSchema";
import { createProjectConfig } from "../../../src/core/config/projectConfig";
import { serializeProjectFiles } from "../../../src/core/io/projectFiles";
import { serializeProjectWorkspaceDocument } from "../../../src/core/io/workspaceSerde";
import {
  createProjectIoService,
  ProjectImportOutcomeUncertainError,
  type ProjectImportResult,
  type ProjectImportRollback,
  type ProjectIoWorkspace,
} from "../../../src/platform/projectIo";
import {
  browserWebCapabilities,
  tauriCapabilities,
} from "../../../src/env/capabilities";
import {
  BrowserStorage,
  type BrowserProjectMutationLock,
  ProjectPersistenceDamageError,
  StorageConflictError,
  TauriStorage,
  type StorageLike,
} from "../../../src/storage";
import {
  initializeUserData,
  readFieldBackgroundImage,
  readUserData,
} from "../../../src/userData";
import { migrateImportedLegacyFieldBackgrounds } from "../../../src/userData/legacyFieldMigration";
import type { UserData } from "../../../src/userData/model";

describe("ProjectIoService", () => {
  it("retains browser migration provenance across a restart", async () => {
    const memory = new MemoryStorage();
    const project = exampleWorkspace("stable-project", "Alpha", ["One"]);
    memory.setItem(
      "bline-web:workspace:legacy-locator",
      JSON.stringify({
        document: serializeProjectWorkspaceDocument(project),
        version: "legacy-v1",
        updatedAt: "2026-08-21T11:00:00.000Z",
      }),
    );
    memory.setItem("bline-web:current-workspace", "legacy-locator");
    const first = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    let firstWorkspace = (await first.initialize())!;
    const firstMigration = firstWorkspace.legacyMigration;

    expect(firstMigration).toMatchObject({
      legacyProjectId: "legacy-locator",
      stableProjectId: "stable-project",
    });
    firstWorkspace = (
      await first.prepareLegacyProjectMigration(firstWorkspace, firstMigration!)
    ).workspace;

    const restarted = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    let restartedWorkspace = (await restarted.initialize())!;
    const resumedMigration = restartedWorkspace.legacyMigration;

    expect(resumedMigration).toMatchObject({
      legacyProjectId: "legacy-locator",
      stableProjectId: "stable-project",
    });
    restartedWorkspace = (await restarted.completeLegacyProjectMigration(
      restartedWorkspace,
      resumedMigration!,
    ))!.workspace;
    expect(restartedWorkspace.legacyMigration).toBeNull();
  });

  it("stores and restores browser Project content without session navigation", async () => {
    const memory = new MemoryStorage();
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    const workspace = exampleWorkspace("workspace-a", "Alpha", ["One", "Two"]);
    const created = await service.createWorkspace({
      project: workspace,
    });

    expect(created.handle).toEqual({ storageId: "workspace-a" });
    expect(created.summary).toMatchObject({ id: "workspace-a" });

    const restoredService = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    const restored = await restoredService.initialize();

    expect(restored?.project).toMatchObject({
      project_id: "workspace-a",
      display_name: "Alpha",
    });
    expect(restored?.project.paths.map((path) => path.display_name)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("restores browser ownership when initial Project creation fails", async () => {
    const memory = new MemoryStorage();
    const storage = new BrowserStorage({ storage: memory });
    const service = createProjectIoService(browserWebCapabilities, { storage });
    const original = exampleWorkspace("project-a", "Alpha", ["One"]);
    let currentWorkspace = await service.createWorkspace({ project: original });
    const originalWriteNew = storage.writeNewProject.bind(storage);
    storage.writeNewProject = async () => {
      throw new Error("initial write failed");
    };

    await expect(
      service.createWorkspace(
        {
          project: exampleWorkspace("project-b", "Beta", ["Two"]),
        },
        currentWorkspace,
      ),
    ).rejects.toThrow("initial write failed");
    expect(currentWorkspace.summary?.id).toBe("project-a");
    expect(memory.getItem("bline-web:current-workspace")).toBe("project-a");

    storage.writeNewProject = originalWriteNew;
    const outcome = await service.saveWorkspace(
      currentWorkspace,
      {
        ...currentWorkspace.project,
        display_name: "Alpha saved after failure",
      },
      currentWorkspace.version,
    );
    expect(Object.keys(outcome).sort()).toEqual(["result", "workspace"]);
    currentWorkspace = outcome.workspace;
    const restarted = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    await expect(restarted.initialize()).resolves.toMatchObject({
      project: {
        project_id: "project-a",
        display_name: "Alpha saved after failure",
      },
    });
    await expect(restarted.listWorkspaces()).resolves.toHaveLength(1);
  });

  it("does not activate a desktop create target until its initial save succeeds", async () => {
    const projectA = exampleWorkspace("stable-a", "Alpha", ["One"]);
    const projectB = exampleWorkspace("stable-b", "Beta", ["Two"]);
    let currentLocator = "/repo/a/autos";
    let storedProject = projectA;
    let version = "a-v1";
    let rejectCandidateWrite = true;
    const switches: string[] = [];
    const summary = (id: string) => ({
      id,
      displayName: id === "/repo/a/autos" ? "Alpha" : "Beta",
      directoryPath: id,
      version,
      updatedAt: "2026-08-22T14:00:00.000Z",
    });
    const invoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      if (command === "storage_get_current_workspace") {
        return summary(currentLocator) as T;
      }
      if (command === "storage_list_recent_workspaces") {
        return [summary(currentLocator)] as T;
      }
      if (command === "storage_read_project_files") {
        return {
          directoryLocator: String(args?.directoryLocator ?? currentLocator),
          files: serializeProjectFiles(storedProject).map((file) => ({
            relativePath: file.relativePath,
            contents: file.text,
          })),
          legacyFiles: [],
          version,
          updatedAt: "2026-08-22T14:00:00.000Z",
        } as T;
      }
      if (command === "storage_create_workspace_dialog") {
        return summary("/repo/b/autos") as T;
      }
      if (command === "storage_write_project_files") {
        const locator = String(args?.directoryLocator);
        if (locator === "/repo/b/autos" && rejectCandidateWrite) {
          throw new Error("desktop initial write failed");
        }
        storedProject = locator === "/repo/b/autos" ? projectB : projectA;
        version = locator === "/repo/b/autos" ? "b-v1" : "a-v2";
        return {
          directoryLocator: locator,
          version,
          updatedAt: "2026-08-22T14:01:00.000Z",
        } as T;
      }
      if (command === "storage_switch_workspace") {
        currentLocator = String(args?.id);
        switches.push(currentLocator);
        return summary(currentLocator) as T;
      }
      throw new Error(`Unexpected command ${command}`);
    };
    const service = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    let currentWorkspace = (await service.initialize())!;

    await expect(
      service.createWorkspace(
        {
          project: projectB,
        },
        currentWorkspace,
      ),
    ).rejects.toThrow("desktop initial write failed");
    expect(currentLocator).toBe("/repo/a/autos");
    expect(switches).toEqual(["/repo/a/autos"]);
    expect(currentWorkspace.summary?.id).toBe("/repo/a/autos");

    currentWorkspace = (
      await service.saveWorkspace(
        currentWorkspace,
        projectA,
        currentWorkspace.version,
      )
    ).workspace;
    const restarted = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    await expect(restarted.initialize()).resolves.toMatchObject({
      project: { project_id: "stable-a", display_name: "Alpha" },
    });
    expect(currentLocator).toBe("/repo/a/autos");

    rejectCandidateWrite = false;
    await expect(
      service.createWorkspace({ project: projectB }, currentWorkspace),
    ).resolves.toMatchObject({
      project: { project_id: "stable-b", display_name: "Beta" },
    });
    expect(currentLocator).toBe("/repo/b/autos");
    expect(switches.at(-1)).toBe("/repo/b/autos");
    const restartedAfterSuccess = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    await expect(restartedAfterSuccess.initialize()).resolves.toMatchObject({
      project: { project_id: "stable-b", display_name: "Beta" },
    });
  });

  it("keeps a durably created desktop Project open when activation persistence fails", async () => {
    const projectA = exampleWorkspace("stable-a", "Alpha", ["One"]);
    const projectB = exampleWorkspace("stable-b", "Beta", ["Two"]);
    let durableCurrent = "/repo/a/autos";
    let storedB = projectB;
    const writeLocators: string[] = [];
    const summary = (id: string, version: string) => ({
      id,
      displayName: id === "/repo/a/autos" ? "Alpha" : "Beta",
      directoryPath: id,
      version,
      updatedAt: "2026-08-22T14:00:00.000Z",
    });
    const invoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      if (command === "storage_get_current_workspace") {
        return summary(durableCurrent, "a-v1") as T;
      }
      if (command === "storage_list_recent_workspaces") {
        return [summary(durableCurrent, "a-v1")] as T;
      }
      if (command === "storage_read_project_files") {
        const locator = String(args?.directoryLocator ?? durableCurrent);
        const project = locator === "/repo/b/autos" ? storedB : projectA;
        return {
          directoryLocator: locator,
          files: serializeProjectFiles(project).map((file) => ({
            relativePath: file.relativePath,
            contents: file.text,
          })),
          legacyFiles: [],
          version: locator === "/repo/b/autos" ? "b-v1" : "a-v1",
          updatedAt: "2026-08-22T14:00:00.000Z",
        } as T;
      }
      if (command === "storage_create_workspace_dialog") {
        return summary("/repo/b/autos", "empty") as T;
      }
      if (command === "storage_write_project_files") {
        const locator = String(args?.directoryLocator);
        writeLocators.push(locator);
        if (locator === "/repo/b/autos") {
          storedB = projectB;
        }
        return {
          directoryLocator: locator,
          version: "b-v1",
          updatedAt: "2026-08-22T14:01:00.000Z",
        } as T;
      }
      if (command === "storage_switch_workspace") {
        if (args?.id === "/repo/b/autos") {
          throw new Error("could not persist desktop session");
        }
        durableCurrent = String(args?.id);
        return summary(durableCurrent, "a-v1") as T;
      }
      throw new Error(`Unexpected command ${command}`);
    };
    const service = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    let currentWorkspace = (await service.initialize())!;

    currentWorkspace = await service.createWorkspace(
      { project: projectB },
      currentWorkspace,
    );
    expect(currentWorkspace.project).toMatchObject({ project_id: "stable-b" });
    expect(currentWorkspace.summary?.id).toBe("/repo/b/autos");
    expect(durableCurrent).toBe("/repo/a/autos");

    currentWorkspace = (
      await service.saveWorkspace(
        currentWorkspace,
        projectB,
        currentWorkspace.version,
      )
    ).workspace;
    expect(writeLocators).toEqual(["/repo/b/autos", "/repo/b/autos"]);
  });

  it("does not activate a desktop open or switch candidate that fails to read", async () => {
    const projectA = exampleWorkspace("stable-a", "Alpha", ["One"]);
    let durableCurrent = "/repo/a/autos";
    const switches: string[] = [];
    const summary = (id: string) => ({
      id,
      displayName: id === "/repo/a/autos" ? "Alpha" : "Broken",
      directoryPath: id,
      version: "a-v1",
      updatedAt: "2026-08-22T14:00:00.000Z",
    });
    const invoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      if (command === "storage_get_current_workspace") {
        return summary(durableCurrent) as T;
      }
      if (command === "storage_list_recent_workspaces") {
        return [summary("/repo/a/autos")] as T;
      }
      if (command === "storage_open_workspace_dialog") {
        return summary("/repo/b/autos") as T;
      }
      if (command === "storage_read_project_files") {
        const locator = String(args?.directoryLocator ?? durableCurrent);
        if (locator === "/repo/b/autos") {
          throw new Error("candidate Project is invalid");
        }
        return {
          directoryLocator: locator,
          files: serializeProjectFiles(projectA).map((file) => ({
            relativePath: file.relativePath,
            contents: file.text,
          })),
          legacyFiles: [],
          version: "a-v1",
          updatedAt: "2026-08-22T14:00:00.000Z",
        } as T;
      }
      if (command === "storage_switch_workspace") {
        durableCurrent = String(args?.id);
        switches.push(durableCurrent);
        return summary(durableCurrent) as T;
      }
      throw new Error(`Unexpected command ${command}`);
    };
    const service = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    const currentWorkspace = (await service.initialize())!;

    await expect(
      service.openWorkspace(undefined, currentWorkspace),
    ).rejects.toThrow("candidate Project is invalid");
    await expect(
      service.switchWorkspace("/repo/b/autos", currentWorkspace),
    ).rejects.toThrow("candidate Project is invalid");
    expect(switches).toEqual(["/repo/a/autos", "/repo/a/autos"]);
    expect(durableCurrent).toBe("/repo/a/autos");
    expect(currentWorkspace.project).toMatchObject({
      project_id: "stable-a",
    });

    const restarted = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    await expect(restarted.initialize()).resolves.toMatchObject({
      project: { project_id: "stable-a" },
    });
  });

  it("does not cache or activate a failed first desktop open candidate", async () => {
    const calls: string[] = [];
    let implicitWriteLocator: unknown = "not-called";
    const invoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      calls.push(command);
      if (command === "storage_get_current_workspace") return null as T;
      if (command === "storage_open_workspace_dialog") {
        return {
          id: "/repo/broken/autos",
          displayName: "Broken",
          directoryPath: "/repo/broken/autos",
          version: "broken-v1",
          updatedAt: "2026-08-22T14:00:00.000Z",
        } as T;
      }
      if (command === "storage_read_project_files") {
        throw new Error("candidate Project is invalid");
      }
      if (command === "storage_write_project_files") {
        implicitWriteLocator = args?.directoryLocator;
        return {
          directoryLocator: "/repo/recovery/autos",
          version: "recovery-v1",
          updatedAt: "2026-08-22T14:01:00.000Z",
        } as T;
      }
      throw new Error(`Unexpected command ${command}`);
    };
    const storage = new TauriStorage({ invoke });
    const service = createProjectIoService(tauriCapabilities, { storage });

    await expect(service.initialize()).rejects.toThrow(
      "candidate Project is invalid",
    );
    expect(calls).not.toContain("storage_switch_workspace");
    await storage.writeProject(
      exampleWorkspace("recovery", "Recovery", ["One"]),
    );
    expect(implicitWriteLocator).toBeNull();
  });

  it("rejects desktop activation when the Project changes after its snapshot read", async () => {
    const projectA = exampleWorkspace("stable-a", "Alpha", ["One"]);
    const projectB = exampleWorkspace("stable-b", "Beta", ["Two"]);
    let durableCurrent = "/repo/a/autos";
    const switches: string[] = [];
    const expectedVersions: unknown[] = [];
    const summary = (id: string, version: string) => ({
      id,
      displayName: id === "/repo/a/autos" ? "Alpha" : "Beta",
      directoryPath: id,
      version,
      updatedAt: "2026-08-22T14:00:00.000Z",
    });
    const invoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      if (command === "storage_get_current_workspace") {
        return summary(durableCurrent, "a-v1") as T;
      }
      if (command === "storage_list_recent_workspaces") {
        return [summary("/repo/a/autos", "a-v1")] as T;
      }
      if (command === "storage_read_project_files") {
        const locator = String(args?.directoryLocator ?? durableCurrent);
        const project = locator === "/repo/b/autos" ? projectB : projectA;
        return {
          directoryLocator: locator,
          files: serializeProjectFiles(project).map((file) => ({
            relativePath: file.relativePath,
            contents: file.text,
          })),
          legacyFiles: [],
          version: locator === "/repo/b/autos" ? "b-v1" : "a-v1",
          updatedAt: "2026-08-22T14:00:00.000Z",
        } as T;
      }
      if (command === "storage_switch_workspace") {
        const id = String(args?.id);
        expectedVersions.push(args?.expectedVersion);
        const actualVersion = id === "/repo/b/autos" ? "b-v2" : "a-v1";
        if (args?.expectedVersion !== actualVersion) {
          throw "storage-conflict: project changed before activation";
        }
        durableCurrent = id;
        switches.push(id);
        return summary(id, actualVersion) as T;
      }
      throw new Error(`Unexpected command ${command}`);
    };
    const service = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    const currentWorkspace = (await service.initialize())!;

    await expect(
      service.switchWorkspace("/repo/b/autos", currentWorkspace),
    ).rejects.toBeInstanceOf(StorageConflictError);
    expect(expectedVersions).toEqual(["b-v1", "a-v1"]);
    expect(switches).toEqual(["/repo/a/autos"]);
    expect(durableCurrent).toBe("/repo/a/autos");
    expect(currentWorkspace.summary).toMatchObject({
      id: "/repo/a/autos",
      version: "a-v1",
    });
    expect(currentWorkspace.project).toMatchObject({
      project_id: "stable-a",
    });
  });

  it("exposes browser and desktop primary actions from capabilities", () => {
    const browserService = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const desktopService = createProjectIoService(tauriCapabilities, {
      storage: new BrowserStorage({ storage: new MemoryStorage() }),
    });

    expect(browserService.capabilities.primaryToolbarActions).toEqual([
      "open-workspace",
      "import-project",
      "export-project",
      "save",
    ]);
    expect(desktopService.capabilities.primaryToolbarActions).toEqual([
      "open-folder",
      "new-path",
      "save",
    ]);
  });

  it("imports and exports browser projects as expanded autos folders", async () => {
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const workspace = await service.createWorkspace({
      project: exampleWorkspace("workspace-a", "Alpha", ["One", "Two"]),
    });

    const folder = await service.exportProjectFolder(workspace.project);
    expect(folder.files.map((file) => file.relativePath)).toEqual([
      "config.json",
      "project.json",
      "paths/One.json",
      "paths/Two.json",
    ]);

    const targetService = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const imported = await targetService.importProjectFolder(
      workspace,
      folder.files.map(
        (file) =>
          ({
            name: file.relativePath.split("/").at(-1) ?? file.relativePath,
            webkitRelativePath: `autos/${file.relativePath}`,
            text: () => file.blob.text(),
          }) as File,
      ),
    );

    expect(imported.project.paths.map((path) => path.file_name)).toEqual([
      "One.json",
      "Two.json",
    ]);
  });

  it("rejects case-colliding folder Paths before browser or desktop persistence", async () => {
    const files = [
      projectFolderFile("autos/paths/Foo.json"),
      projectFolderFile("autos/paths/foo.json"),
    ];
    const browserStorage = new MemoryStorage();
    const browser = createProjectIoService(browserWebCapabilities, {
      browser: { storage: browserStorage },
    });
    const desktopCommands: string[] = [];
    const desktop = createProjectIoService(tauriCapabilities, {
      tauri: {
        invoke: async () => {
          desktopCommands.push("unexpected persistence command");
          throw new Error("Folder parsing must finish before desktop I/O");
        },
      },
    });
    const contextService = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const context = await contextService.createWorkspace();

    for (const service of [browser, desktop]) {
      await expect(service.importProjectFolder(context, files)).rejects.toThrow(
        /duplicate or case-colliding normalized Path file names\/IDs: (Foo\.json and foo\.json|foo\.json and Foo\.json)/,
      );
    }
    expect(browserStorage.length).toBe(0);
    expect(desktopCommands).toEqual([]);
  });

  it("rejects browser folder and archive imports that collide with a saved Project ID", async () => {
    const source = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const sourceWorkspace = await source.createWorkspace({
      project: exampleWorkspace("shared-id", "Imported", ["Imported Path"]),
    });
    const folder = await source.exportProjectFolder(sourceWorkspace.project);
    const archive = await source.exportProjectArchive(sourceWorkspace.project);

    for (const { collisionId, importProject } of [
      {
        collisionId: "shared-id",
        importProject: (
          target: ReturnType<typeof createProjectIoService>,
          workspace: ProjectIoWorkspace,
        ) =>
          target.importProjectFolder(
            workspace,
            folder.files.map(
              (file) =>
                ({
                  name:
                    file.relativePath.split("/").at(-1) ?? file.relativePath,
                  webkitRelativePath: `autos/${file.relativePath}`,
                  text: () => file.blob.text(),
                }) as File,
            ),
          ),
      },
      {
        collisionId: "imported-project",
        importProject: (
          target: ReturnType<typeof createProjectIoService>,
          workspace: ProjectIoWorkspace,
        ) =>
          target.importProjectArchive(workspace, {
            name: "shared.bline-project.json",
            type: "application/json",
            text: () => archive.text(),
          } as File),
      },
    ]) {
      const target = createProjectIoService(browserWebCapabilities, {
        browser: { storage: new MemoryStorage() },
      });
      const targetWorkspace = await target.createWorkspace({
        project: exampleWorkspace(collisionId, "Existing", ["Kept Path"]),
      });

      await expect(
        importProject(target, targetWorkspace),
      ).rejects.toBeInstanceOf(StorageConflictError);
      await expect(
        target.peekWorkspace(targetWorkspace.handle),
      ).resolves.toMatchObject({
        project_id: collisionId,
        display_name: "Existing",
        paths: [{ display_name: "Kept Path" }],
      });
      expect(await target.listWorkspaces()).toHaveLength(1);
    }
  });

  it("rebinds browser Project IO to an identity-changing import", async () => {
    const source = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const sourceWorkspace = await source.createWorkspace({
      project: exampleWorkspace("imported-id", "Imported", ["Imported Path"]),
    });
    const archive = await source.exportProjectArchive(sourceWorkspace.project);

    const target = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    let targetWorkspace = await target.createWorkspace({
      project: exampleWorkspace("prior-id", "Prior", ["Prior Path"]),
    });
    const imported = await target.importProjectArchive(targetWorkspace, {
      name: "imported.bline-project.json",
      type: "application/json",
      text: () => archive.text(),
    } as File);
    targetWorkspace = imported.workspace;

    expect(imported.project.project_id).toBe("imported-project");
    await expect(
      target.peekWorkspace(targetWorkspace.handle),
    ).resolves.toMatchObject({
      project_id: "imported-project",
      paths: [{ display_name: "Imported Path" }],
    });
    await expect(
      target.reloadWorkspace(targetWorkspace.handle),
    ).resolves.toMatchObject({
      project: {
        project_id: "imported-project",
        paths: [{ display_name: "Imported Path" }],
      },
    });
    expect(
      (await target.listWorkspaces()).map((summary) => summary.id).sort(),
    ).toEqual(["imported-project", "prior-id"]);
    await expect(
      target.openWorkspace("prior-id", targetWorkspace),
    ).resolves.toMatchObject({
      project: {
        project_id: "prior-id",
        paths: [{ display_name: "Prior Path" }],
      },
    });
  });

  it("durably adopts the browser record it opens and keeps damage checks on that record", async () => {
    const memory = new MemoryStorage();
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    const originalWorkspace = await service.createWorkspace({
      project: exampleWorkspace("project-a", "Alpha", ["One"]),
    });
    const damagedProject = exampleWorkspace("project-b", "Beta", ["Two"]);
    const damagedFiles = serializeProjectFiles(damagedProject).map((file) =>
      file.relativePath === "project.json"
        ? { ...file, text: "{damaged project metadata" }
        : file,
    );
    memory.setItem(
      "bline-web:workspace:project-b",
      JSON.stringify({
        files: damagedFiles,
        version: "damaged-b-v1",
        updatedAt: "2026-08-22T13:00:00.000Z",
      }),
    );

    const recovered = await service.openWorkspace(
      "project-b",
      originalWorkspace,
    );

    expect(memory.getItem("bline-web:current-workspace")).toBe("project-b");
    memory.setItem("bline-web:current-workspace", "project-a");
    expect(recovered?.persistenceDamage).toMatchObject({
      sourcePath: "project.json",
      rawText: "{damaged project metadata",
    });
    await expect(
      service.saveWorkspace(recovered!, recovered!.project, "damaged-b-v1"),
    ).rejects.toBeInstanceOf(ProjectPersistenceDamageError);
    await service.openWorkspace("project-b");

    const restarted = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    const restartedWorkspace = await restarted.initialize();
    expect(restartedWorkspace?.project).toMatchObject({
      project_id: "project-b",
    });
    expect(restartedWorkspace?.persistenceDamage).toMatchObject({
      rawText: "{damaged project metadata",
    });
  });

  it("rejects deletion when a non-current browser Project changed after it was listed", async () => {
    const memory = new MemoryStorage();
    const storage = new BrowserStorage({ storage: memory });
    const service = createProjectIoService(browserWebCapabilities, { storage });
    const projectAWorkspace = await service.createWorkspace({
      project: exampleWorkspace("project-a", "Alpha", ["One"]),
    });
    const currentWorkspace = await service.createWorkspace(
      {
        project: exampleWorkspace("project-b", "Beta", ["Two"]),
      },
      projectAWorkspace,
    );
    const listed = (await service.listWorkspaces()).find(
      ({ id }) => id === "project-a",
    )!;
    const external = new BrowserStorage({ storage: memory });
    await external.writeProject(
      exampleWorkspace("project-a", "Externally changed", ["New"]),
      listed.version,
      "project-a",
    );

    await expect(
      service.deleteWorkspace(currentWorkspace, "project-a", listed.version),
    ).rejects.toBeInstanceOf(StorageConflictError);
    await expect(storage.readProject("project-a")).resolves.toMatchObject({
      display_name: "Externally changed",
    });
  });

  it("tracks the canonical browser locator after replacing a damaged legacy record", async () => {
    const memory = new MemoryStorage();
    const recoveredProject = exampleWorkspace("stable-project", "Recovered", [
      "One",
    ]);
    memory.setItem(
      "bline-web:workspace:legacy-locator",
      JSON.stringify({
        document: serializeProjectWorkspaceDocument(recoveredProject),
        version: "damaged-v1",
        updatedAt: "2026-08-22T13:00:00.000Z",
        futureEnvelope: true,
      }),
    );
    memory.setItem("bline-web:current-workspace", "legacy-locator");
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    const recovered = await service.initialize();

    const replacement = await service.replaceDamagedProject(
      recovered!,
      recovered!.project,
      "damaged-v1",
    );

    expect(replacement.workspace.summary?.id).toBe("stable-project");
    expect(memory.getItem("bline-web:current-workspace")).toBe(
      "stable-project",
    );
    await expect(
      service.saveWorkspace(
        replacement.workspace,
        replacement.workspace.project,
        replacement.workspace.version,
      ),
    ).resolves.toMatchObject({ result: { version: expect.any(String) } });
    expect(memory.getItem("bline-web:workspace:legacy-locator")).toBeNull();
    expect(memory.getItem("bline-web:workspace:stable-project")).not.toBeNull();
  });

  it("excludes local Field Background metadata and bytes from exports", async () => {
    const sourceStorage = new BrowserStorage({ storage: new MemoryStorage() });
    const sourceService = createProjectIoService(browserWebCapabilities, {
      storage: sourceStorage,
    });
    let sourceWorkspace = await sourceService.createWorkspace({
      project: exampleWorkspace("workspace-a", "Alpha", ["One"]),
    });

    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    const customField = {
      id: "custom:practice-field",
      name: "Practice Field",
      asset_id: "practice-field.png",
      file_name: "practice-field.png",
      mime_type: "image/png",
      size_bytes: imageBytes.byteLength,
      created_at: "2026-08-21T12:00:00.000Z",
      geometry: {
        length_meters: 12,
        width_meters: 6,
        coordinate_offset_meters: 0.25,
      },
    };
    sourceWorkspace = (
      await sourceService.saveWorkspace(
        sourceWorkspace,
        {
          ...sourceWorkspace.project,
          config: createProjectConfig({
            ...sourceWorkspace.project.config,
            gui: {
              ...sourceWorkspace.project.config.gui,
              field: {
                selected_field_id: customField.id,
                custom_fields: [customField],
              },
            },
          }),
        },
        sourceWorkspace.version,
      )
    ).workspace;

    const archiveText = await (
      await sourceService.exportProjectArchive(sourceWorkspace.project)
    ).text();
    const archive = JSON.parse(archiveText) as Record<string, unknown>;
    expect(archive).not.toHaveProperty("field_assets");
    expect(archive).not.toHaveProperty("config.gui.field");
    expect(archiveText).not.toContain("AQIDBA");

    const folder = await sourceService.exportProjectFolder(
      sourceWorkspace.project,
    );
    expect(folder.files.map((file) => file.relativePath)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("assets/fields")]),
    );
    const configFile = folder.files.find(
      (file) => file.relativePath === "config.json",
    );
    const projectFile = folder.files.find(
      (file) => file.relativePath === "project.json",
    );
    if (!configFile) {
      throw new Error("Expected config.json in folder export");
    }
    if (!projectFile) {
      throw new Error("Expected project.json in folder export");
    }
    const folderConfig = JSON.parse(await configFile.blob.text()) as {
      gui?: unknown;
    };
    const folderProject = JSON.parse(await projectFile.blob.text()) as Record<
      string,
      unknown
    >;
    expect(folderConfig.gui).toBeUndefined();
    expect(folderProject).not.toHaveProperty("editor_config.gui.field");
    expect(folderProject).not.toHaveProperty("field_assets");
  });

  it("returns legacy imported Field Backgrounds for direct User Data migration", async () => {
    const source = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const sourceWorkspace = await source.createWorkspace({
      project: exampleWorkspace("source", "Source", ["One"]),
    });
    const archive = JSON.parse(
      await (await source.exportProjectArchive(sourceWorkspace.project)).text(),
    ) as Record<string, unknown>;
    const field = {
      id: "legacy-field",
      name: "Legacy Field",
      asset_id: "legacy.png",
      file_name: "legacy.png",
      mime_type: "image/png",
      size_bytes: 4,
      created_at: "2026-08-21T12:00:00.000Z",
      geometry: {
        length_meters: 12,
        width_meters: 6,
        coordinate_offset_meters: 0.25,
      },
    };
    archive.config = createProjectConfig({
      gui: {
        field: {
          selected_field_id: field.id,
          custom_fields: [field],
        },
      },
    });
    archive.field_assets = [
      {
        asset_id: field.asset_id,
        file_name: field.file_name,
        mime_type: field.mime_type,
        data_base64: "AQIDBA==",
      },
    ];

    const target = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const file = {
      name: "legacy.bline-project.json",
      type: "application/json",
      text: async () => JSON.stringify(archive),
    } as File;
    await expect(
      target.importProjectArchive(sourceWorkspace, file),
    ).rejects.toThrow("migration is required");
    await expect(
      target.importProjectArchive(sourceWorkspace, file, {
        migrateLegacyFieldBackgrounds: async () => undefined as never,
      }),
    ).rejects.toThrow("must return a rollback handle");
    await expect(target.listWorkspaces()).resolves.toEqual([]);
    let migratedBeforeCommit = false;
    const imported = await target.importProjectArchive(sourceWorkspace, file, {
      migrateLegacyFieldBackgrounds: async () => {
        migratedBeforeCommit = true;
        expect(await target.listWorkspaces()).toEqual([]);
        return noOpImportRollback();
      },
    });

    expect(migratedBeforeCommit).toBe(true);
    expect(imported.legacySelectedFieldId).toBe(field.id);
    expect(imported.legacyFieldBackgrounds).toEqual([
      {
        field: expect.objectContaining({ id: field.id }),
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    ]);
    expect(imported.project.config.gui.field.custom_fields).toEqual([]);
  });

  it("preflights browser import collisions before preparing legacy Fields", async () => {
    const target = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const targetWorkspace = await target.createWorkspace({
      project: exampleWorkspace("imported-project", "Existing", ["Kept"]),
    });
    let preparations = 0;

    await expect(
      target.importProjectArchive(
        targetWorkspace,
        projectArchiveFile(legacyFieldArchive()),
        {
          migrateLegacyFieldBackgrounds: async () => {
            preparations += 1;
            return noOpImportRollback();
          },
        },
      ),
    ).rejects.toBeInstanceOf(StorageConflictError);

    expect(preparations).toBe(0);
    await expect(
      target.reloadWorkspace(targetWorkspace.handle),
    ).resolves.toMatchObject({
      project: {
        project_id: "imported-project",
        display_name: "Existing",
      },
    });
  });

  it("retains deterministic Fields when a concurrent browser import wins after preparation", async () => {
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
    const rejected = outcomes.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(StorageConflictError),
    });
    expect(preparations).toBe(1);
    expect(rollbacks).toBe(0);
    await expect(first.listWorkspaces()).resolves.toHaveLength(1);
  });

  it("serializes same-ID browser preparation before distinct Projects can share deterministic Fields", async () => {
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

  it("serializes legacy Field selection with its same-ID stripped Project winner", async () => {
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

  it("rolls back prepared browser Fields when the Project write fails", async () => {
    const memory = new FailOnceWorkspaceWriteStorage();
    const storage = new BrowserStorage({ storage: memory });
    const target = createProjectIoService(browserWebCapabilities, { storage });
    const targetWorkspace = await target.createWorkspace({
      project: exampleWorkspace("existing", "Existing", ["Kept"]),
    });
    memory.failNextWorkspaceWrite("imported-project");
    let rollbacks = 0;

    await expect(
      target.importProjectArchive(
        targetWorkspace,
        projectArchiveFile(legacyFieldArchive()),
        {
          migrateLegacyFieldBackgrounds: async () => ({
            rollback: async () => {
              rollbacks += 1;
            },
          }),
        },
      ),
    ).rejects.toThrow("browser Project write failed");
    expect(rollbacks).toBe(1);
    expect(memory.getItem("bline-web:current-workspace")).toBe("existing");
    await expect(
      target.reloadWorkspace(targetWorkspace.handle),
    ).resolves.toMatchObject({
      project: { project_id: "existing" },
    });

    memory.failNextWorkspaceWrite("imported-project");
    const failure = await target
      .importProjectArchive(
        targetWorkspace,
        projectArchiveFile(legacyFieldArchive()),
        {
          migrateLegacyFieldBackgrounds: async () => ({
            rollback: async () => {
              throw new Error("User Data rollback failed");
            },
          }),
        },
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "browser Project write failed" }),
      expect.objectContaining({ message: "User Data rollback failed" }),
    ]);
  });

  it("keeps failed browser import rollback inside the Project lock before an identical import prepares", async () => {
    const memory = new FailOnceWorkspaceWriteStorage();
    const lock = new ObservableProjectMutationLock();
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

    let allowFirstRollback!: () => void;
    const firstRollbackMayComplete = new Promise<void>((resolve) => {
      allowFirstRollback = resolve;
    });
    let firstRollbackStarted!: () => void;
    const firstRollbackHasStarted = new Promise<void>((resolve) => {
      firstRollbackStarted = resolve;
    });
    let allowSecondPreparation!: () => void;
    const secondPreparationMayComplete = new Promise<void>((resolve) => {
      allowSecondPreparation = resolve;
    });
    let secondPreparationStarted!: () => void;
    const secondPreparationHasStarted = new Promise<void>((resolve) => {
      secondPreparationStarted = resolve;
    });
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
            firstRollbackStarted();
            await firstRollbackMayComplete;
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
      secondPreparationStarted();
      await secondPreparationMayComplete;
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
    await firstRollbackHasStarted;
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

    allowFirstRollback();
    await secondPreparationHasStarted;
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

    allowSecondPreparation();
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

  it("rejects an import with any missing custom Field asset before adopting it", async () => {
    const target = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const targetWorkspace = await target.createWorkspace({
      project: exampleWorkspace("existing", "Existing", ["Kept"]),
    });
    const archive = {
      bline_project_schema_version: 1,
      exported_at: "2026-08-22T13:00:00.000Z",
      config: createProjectConfig({
        gui: {
          field: {
            selected_field_id: "available-field",
            custom_fields: [
              legacyField("available-field", "available.png"),
              legacyField("unselected-missing-field", "missing.png"),
            ],
          },
        },
      }),
      paths: [],
      field_assets: [
        {
          asset_id: "available.png",
          file_name: "available.png",
          mime_type: "image/png",
          data_base64: "AQID",
        },
      ],
    };

    await expect(
      target.importProjectArchive(targetWorkspace, {
        name: "missing-field.bline-project.json",
        type: "application/json",
        text: async () => JSON.stringify(archive),
      } as File),
    ).rejects.toThrow("missing.png");
    await expect(
      target.reloadWorkspace(targetWorkspace.handle),
    ).resolves.toMatchObject({
      project: { project_id: "existing", display_name: "Existing" },
    });
    await expect(target.listWorkspaces()).resolves.toHaveLength(1);
  });

  it("does not commit a desktop-facing import when Field migration fails", async () => {
    const current = exampleWorkspace("desktop-current", "Current", ["Kept"]);
    let projectWrites = 0;
    const invoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      const summary = {
        id: "/repo/current/autos",
        displayName: "Current",
        directoryPath: "/repo/current/autos",
        version: "current-v1",
        updatedAt: "2026-08-22T14:00:00.000Z",
      };
      if (command === "storage_get_current_workspace") {
        return summary as T;
      }
      if (command === "storage_list_recent_workspaces") {
        return [summary] as T;
      }
      if (command === "storage_read_project_files") {
        return {
          directoryLocator: String(args?.directoryLocator ?? summary.id),
          files: serializeProjectFiles(current).map((file) => ({
            relativePath: file.relativePath,
            contents: file.text,
          })),
          legacyFiles: [],
          version: summary.version,
          updatedAt: summary.updatedAt,
        } as T;
      }
      if (command === "storage_write_project_files") {
        projectWrites += 1;
        throw new Error("Project content should not be written");
      }
      throw new Error(`Unexpected command ${command}`);
    };
    const target = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    const targetWorkspace = (await target.initialize())!;
    const archive = legacyFieldArchive();

    await expect(
      target.importProjectArchive(
        targetWorkspace,
        {
          name: "legacy.bline-project.json",
          type: "application/json",
          text: async () => JSON.stringify(archive),
        } as File,
        {
          migrateLegacyFieldBackgrounds: async () => {
            throw new Error("User Data write failed");
          },
        },
      ),
    ).rejects.toThrow("User Data write failed");

    expect(projectWrites).toBe(0);
    await expect(
      target.reloadWorkspace(targetWorkspace.handle),
    ).resolves.toMatchObject({
      project: {
        project_id: "desktop-current",
        display_name: "Current",
        paths: [{ display_name: "Kept" }],
      },
    });
    const restarted = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    await expect(restarted.initialize()).resolves.toMatchObject({
      project: {
        project_id: "desktop-current",
        paths: [{ display_name: "Kept" }],
      },
    });
  });

  it("preflights a desktop version conflict before preparing legacy Fields", async () => {
    const current = exampleWorkspace("desktop-current", "Current", ["Kept"]);
    let projectReads = 0;
    let preparations = 0;
    let projectWrites = 0;
    const summary = {
      id: "/repo/current/autos",
      displayName: "Current",
      directoryPath: "/repo/current/autos",
      version: "current-v1",
      updatedAt: "2026-08-22T14:00:00.000Z",
    };
    const invoke = async <T>(command: string): Promise<T> => {
      if (command === "storage_get_current_workspace") return summary as T;
      if (command === "storage_list_recent_workspaces") return [summary] as T;
      if (command === "storage_read_project_files") {
        projectReads += 1;
        return {
          directoryLocator: summary.id,
          files: serializeProjectFiles(current).map((file) => ({
            relativePath: file.relativePath,
            contents: file.text,
          })),
          legacyFiles: [],
          version: projectReads === 1 ? "current-v1" : "external-v2",
          updatedAt: summary.updatedAt,
        } as T;
      }
      if (command === "storage_write_project_files") {
        projectWrites += 1;
        throw new Error("Project content should not be written");
      }
      throw new Error(`Unexpected command ${command}`);
    };
    const target = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    const targetWorkspace = (await target.initialize())!;

    await expect(
      target.importProjectArchive(
        targetWorkspace,
        projectArchiveFile(legacyFieldArchive()),
        {
          migrateLegacyFieldBackgrounds: async () => {
            preparations += 1;
            return noOpImportRollback();
          },
        },
      ),
    ).rejects.toBeInstanceOf(StorageConflictError);
    expect(preparations).toBe(0);
    expect(projectWrites).toBe(0);
  });

  it("rolls back prepared desktop Fields when the Project write fails", async () => {
    const current = exampleWorkspace("desktop-current", "Current", ["Kept"]);
    let rollbacks = 0;
    let projectWrites = 0;
    const summary = {
      id: "/repo/current/autos",
      displayName: "Current",
      directoryPath: "/repo/current/autos",
      version: "current-v1",
      updatedAt: "2026-08-22T14:00:00.000Z",
    };
    const invoke = async <T>(command: string): Promise<T> => {
      if (command === "storage_get_current_workspace") return summary as T;
      if (command === "storage_list_recent_workspaces") return [summary] as T;
      if (command === "storage_read_project_files") {
        return {
          directoryLocator: summary.id,
          files: serializeProjectFiles(current).map((file) => ({
            relativePath: file.relativePath,
            contents: file.text,
          })),
          legacyFiles: [],
          version: summary.version,
          updatedAt: summary.updatedAt,
        } as T;
      }
      if (command === "storage_write_project_files") {
        projectWrites += 1;
        throw new Error("desktop Project write failed");
      }
      throw new Error(`Unexpected command ${command}`);
    };
    const target = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    const targetWorkspace = (await target.initialize())!;

    await expect(
      target.importProjectArchive(
        targetWorkspace,
        projectArchiveFile(legacyFieldArchive()),
        {
          migrateLegacyFieldBackgrounds: async () => ({
            rollback: async () => {
              rollbacks += 1;
            },
          }),
        },
      ),
    ).rejects.toThrow("desktop Project write failed");
    expect(projectWrites).toBe(1);
    expect(rollbacks).toBe(1);
    await expect(
      target.reloadWorkspace(targetWorkspace.handle),
    ).resolves.toMatchObject({
      project: {
        project_id: "desktop-current",
        paths: [{ display_name: "Kept" }],
      },
    });
  });

  it("retains prepared Fields when a desktop write commits before reporting an error", async () => {
    const current = exampleWorkspace("desktop-current", "Current", ["Kept"]);
    let committed: Project | null = null;
    let intended: Project | null = null;
    let rollbacks = 0;
    const summary = {
      id: "/repo/current/autos",
      displayName: "Current",
      directoryPath: "/repo/current/autos",
      version: "current-v1",
      updatedAt: "2026-08-22T14:00:00.000Z",
    };
    const invoke = async <T>(command: string): Promise<T> => {
      if (command === "storage_get_current_workspace") return summary as T;
      if (command === "storage_list_recent_workspaces") return [summary] as T;
      if (command === "storage_read_project_files") {
        const project = committed ?? current;
        return {
          directoryLocator: summary.id,
          files: serializeProjectFiles(project).map((file) => ({
            relativePath: file.relativePath,
            contents: file.text,
          })),
          legacyFiles: [],
          version: committed ? "committed-v2" : summary.version,
          updatedAt: committed ? "2026-08-22T14:01:00.000Z" : summary.updatedAt,
        } as T;
      }
      if (command === "storage_write_project_files") {
        committed = intended;
        throw new Error("desktop response was lost after commit");
      }
      throw new Error(`Unexpected command ${command}`);
    };
    const target = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    const targetWorkspace = (await target.initialize())!;

    const imported = await target.importProjectArchive(
      targetWorkspace,
      projectArchiveFile(legacyFieldArchive()),
      {
        migrateLegacyFieldBackgrounds: async (pending) => {
          intended = structuredClone(pending.project);
          return {
            rollback: async () => {
              rollbacks += 1;
            },
          };
        },
      },
    );
    expect(imported).toMatchObject({
      project: { project_id: "desktop-current" },
    });
    expect(rollbacks).toBe(0);
    expect(imported.workspace.version).toBe("committed-v2");
    expect(imported.workspace.project).toMatchObject({
      project_id: "desktop-current",
      paths: [],
    });
  });

  it("retains prepared Fields when a desktop write outcome cannot be reconciled", async () => {
    const current = exampleWorkspace("desktop-current", "Current", ["Kept"]);
    let projectReads = 0;
    let rollbacks = 0;
    const summary = {
      id: "/repo/current/autos",
      displayName: "Current",
      directoryPath: "/repo/current/autos",
      version: "current-v1",
      updatedAt: "2026-08-22T14:00:00.000Z",
    };
    const invoke = async <T>(command: string): Promise<T> => {
      if (command === "storage_get_current_workspace") return summary as T;
      if (command === "storage_list_recent_workspaces") return [summary] as T;
      if (command === "storage_read_project_files") {
        projectReads += 1;
        if (projectReads > 2) {
          throw new Error("disk outcome is unreadable");
        }
        return {
          directoryLocator: summary.id,
          files: serializeProjectFiles(current).map((file) => ({
            relativePath: file.relativePath,
            contents: file.text,
          })),
          legacyFiles: [],
          version: summary.version,
          updatedAt: summary.updatedAt,
        } as T;
      }
      if (command === "storage_write_project_files") {
        throw new Error("desktop write outcome is unknown");
      }
      throw new Error(`Unexpected command ${command}`);
    };
    const target = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    const targetWorkspace = (await target.initialize())!;

    await expect(
      target.importProjectArchive(
        targetWorkspace,
        projectArchiveFile(legacyFieldArchive()),
        {
          migrateLegacyFieldBackgrounds: async () => ({
            rollback: async () => {
              rollbacks += 1;
            },
          }),
        },
      ),
    ).rejects.toBeInstanceOf(ProjectImportOutcomeUncertainError);
    expect(rollbacks).toBe(0);
  });

  it("deletes the current browser project and opens the next available workspace", async () => {
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const workspaceA = await service.createWorkspace({
      project: exampleWorkspace("workspace-a", "Alpha", ["One"]),
    });
    const workspaceB = await service.createWorkspace(
      {
        project: exampleWorkspace("workspace-b", "Beta", ["Two"]),
      },
      workspaceA,
    );

    const next = await service.deleteWorkspace(workspaceB, "workspace-b");
    const summaries = await service.listWorkspaces();

    expect(next).toMatchObject({
      changedCurrent: true,
      workspace: { project: { project_id: "workspace-a" } },
    });
    expect(summaries.map((summary) => summary.id)).toEqual(["workspace-a"]);
  });

  it("reports that deleting another browser Project leaves current ownership unchanged", async () => {
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const workspaceA = await service.createWorkspace({
      project: exampleWorkspace("workspace-a", "Alpha", ["One"]),
    });
    const workspaceB = await service.createWorkspace(
      {
        project: exampleWorkspace("workspace-b", "Beta", ["Two"]),
      },
      workspaceA,
    );
    const projectA = (await service.listWorkspaces()).find(
      (summary) => summary.id === "workspace-a",
    );

    const result = await service.deleteWorkspace(
      workspaceB,
      "workspace-a",
      projectA?.version,
    );

    expect(result).toMatchObject({
      changedCurrent: false,
      workspace: { project: { project_id: "workspace-b" } },
    });
    expect(result.workspace?.summary?.id).toBe("workspace-b");
  });

  it("returns to an empty start state after deleting the final project", async () => {
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    const workspace = await service.createWorkspace({
      project: exampleWorkspace("workspace-a", "Alpha", ["One"]),
    });

    const next = await service.deleteWorkspace(workspace, "workspace-a");

    expect(next).toEqual({ workspace: null, changedCurrent: true });
    await expect(service.listWorkspaces()).resolves.toEqual([]);
  });

  it("keeps the desktop directory locator separate through canonical migration", async () => {
    const source = exampleWorkspace("discarded", "Runtime Autos", ["One"]);
    const runtimeFiles = serializeProjectFiles(source)
      .filter((file) => file.relativePath !== "project.json")
      .map((file) => ({
        relativePath: file.relativePath,
        contents: file.text,
      }));
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const summary = {
      id: "/repo/autos",
      displayName: "autos",
      directoryPath: "/repo/autos",
      version: "summary-version",
      updatedAt: "2026-08-21T12:00:00.000Z",
    };
    const storage = new TauriStorage({
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "storage_get_current_workspace") {
          return summary as T;
        }
        if (command === "storage_read_project_files") {
          return {
            directoryLocator: "/repo/autos",
            files: runtimeFiles,
            legacyFiles: [
              {
                relativePath: "pathgroups.json",
                contents: '{"schema_version":1,"groups":[]}',
              },
            ],
            version: "runtime-v1",
            updatedAt: "2026-08-21T12:01:00.000Z",
          } as T;
        }
        if (command === "storage_list_recent_workspaces") {
          return [summary] as T;
        }
        if (command === "storage_prepare_legacy_project_files") {
          return {
            directoryLocator: "/repo/autos",
            version: "canonical-v2",
            updatedAt: "2026-08-21T12:02:00.000Z",
          } as T;
        }
        if (command === "storage_delete_legacy_project_files") {
          return {
            directoryLocator: "/repo/autos",
            version: "clean-v3",
            updatedAt: "2026-08-21T12:03:00.000Z",
          } as T;
        }
        throw new Error(`Unexpected command ${command}`);
      },
    });
    const service = createProjectIoService(tauriCapabilities, { storage });

    let workspace = (await service.initialize())!;
    expect(workspace.project.project_id).not.toBe("/repo/autos");
    expect(workspace.version).toBe("runtime-v1");
    expect(workspace.summary).toMatchObject({
      id: "/repo/autos",
      directoryPath: "/repo/autos",
      version: "runtime-v1",
    });
    const migration = workspace.legacyMigration;
    expect(migration).toMatchObject({
      legacyProjectId: "/repo/autos",
      stableProjectId: workspace.project.project_id,
      pathIdByLegacyReference: { "One.json": "One.json" },
    });

    const prepared = await service.prepareLegacyProjectMigration(
      workspace,
      migration!,
    );
    workspace = prepared.workspace;
    expect(prepared.preparation).toMatchObject({
      status: "prepared",
      version: "canonical-v2",
    });
    expect(workspace.legacyMigration).toMatchObject({
      legacyProjectId: "/repo/autos",
      stableProjectId: workspace.project.project_id,
    });
    const completed = await service.completeLegacyProjectMigration(
      workspace,
      migration!,
    );
    workspace = completed!.workspace;

    expect(completed).toMatchObject({ result: { version: "clean-v3" } });
    expect(workspace.version).toBe("clean-v3");
    const write = calls.find(
      (call) => call.command === "storage_prepare_legacy_project_files",
    );
    const cleanup = calls.find(
      (call) => call.command === "storage_delete_legacy_project_files",
    );
    expect(write?.args).toMatchObject({
      directoryLocator: "/repo/autos",
      expected: "runtime-v1",
    });
    expect(cleanup?.args).toEqual({
      directoryLocator: "/repo/autos",
      expected: "canonical-v2",
    });
  });

  it("opens a runtime-only desktop folder without preparing metadata", async () => {
    const source = exampleWorkspace("discarded", "Runtime Autos", ["One"]);
    const runtimeFiles = serializeProjectFiles(source)
      .filter((file) => file.relativePath !== "project.json")
      .map((file) => ({
        relativePath: file.relativePath,
        contents: file.text,
      }));
    const commands: string[] = [];
    const summary = {
      id: "/repo/runtime-only/autos",
      displayName: "autos",
      directoryPath: "/repo/runtime-only/autos",
      version: "runtime-v1",
      updatedAt: "2026-08-21T12:00:00.000Z",
    };
    const storage = new TauriStorage({
      invoke: async <T>(command: string) => {
        commands.push(command);
        if (command === "storage_get_current_workspace") {
          return summary as T;
        }
        if (command === "storage_read_project_files") {
          return {
            directoryLocator: summary.id,
            files: runtimeFiles,
            legacyFiles: [],
            version: summary.version,
            updatedAt: summary.updatedAt,
          } as T;
        }
        if (command === "storage_list_recent_workspaces") {
          return [summary] as T;
        }
        throw new Error(`Unexpected command ${command}`);
      },
    });
    const service = createProjectIoService(tauriCapabilities, { storage });

    const workspace = await service.initialize();

    expect(workspace?.project.paths).toHaveLength(1);
    expect(workspace?.legacyMigration).toBeNull();
    expect(commands).not.toContain("storage_prepare_legacy_project_files");
  });

  it("opens unsupported desktop runtime data as damaged without migrating it", async () => {
    const source = exampleWorkspace("discarded", "Runtime Autos", ["One"]);
    const futureConfig = JSON.stringify({
      ...source.config,
      future_runtime_setting: true,
    });
    const runtimeFiles = serializeProjectFiles(source)
      .filter((file) => file.relativePath !== "project.json")
      .map((file) => ({
        relativePath: file.relativePath,
        contents:
          file.relativePath === "config.json" ? futureConfig : file.text,
      }));
    const summary = {
      id: "/repo/future/autos",
      displayName: "autos",
      directoryPath: "/repo/future/autos",
      version: "runtime-v1",
      updatedAt: "2026-08-21T12:00:00.000Z",
    };
    const commands: string[] = [];
    const storage = new TauriStorage({
      invoke: async <T>(command: string) => {
        commands.push(command);
        if (command === "storage_get_current_workspace") {
          return summary as T;
        }
        if (command === "storage_read_project_files") {
          return {
            directoryLocator: summary.id,
            files: runtimeFiles,
            legacyFiles: [
              {
                relativePath: "pathgroups.json",
                contents: '{"schema_version":1,"groups":[]}',
              },
            ],
            version: summary.version,
            updatedAt: summary.updatedAt,
          } as T;
        }
        if (command === "storage_list_recent_workspaces") {
          return [summary] as T;
        }
        throw new Error(`Unexpected command ${command}`);
      },
    });
    const service = createProjectIoService(tauriCapabilities, { storage });

    const workspace = await service.initialize();

    expect(workspace?.project.paths).toHaveLength(1);
    expect(workspace?.persistenceDamage).toMatchObject({
      sourcePath: "config.json",
      rawText: futureConfig,
    });
    expect(workspace?.legacyMigration).toBeNull();
    await expect(
      service.saveWorkspace(workspace!, workspace!.project, workspace!.version),
    ).rejects.toBeInstanceOf(ProjectPersistenceDamageError);
    expect(commands).not.toContain("storage_prepare_legacy_project_files");
  });
});

function exampleWorkspace(
  project_id: string,
  display_name: string,
  pathNames: string[],
) {
  const paths = pathNames.map((name, index) =>
    createProjectPathDocument({
      path_id: `path-${index + 1}`,
      display_name: name,
      file_name: `${name}.json`,
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: index + 1, y_meters: index + 2 }),
        ],
      }),
    }),
  );

  return createProjectWorkspaceDocument({
    project_id,
    display_name,
    paths,
    active_path_id: paths[0]?.path_id ?? null,
  });
}

function legacyField(id: string, assetId: string) {
  return {
    id,
    name: id,
    asset_id: assetId,
    file_name: assetId,
    mime_type: "image/png",
    size_bytes: 3,
    created_at: "2026-08-22T13:00:00.000Z",
    geometry: {
      length_meters: 12,
      width_meters: 6,
      coordinate_offset_meters: 0,
    },
  };
}

function legacyFieldArchive() {
  const field = legacyField("legacy-field", "legacy.png");
  return {
    bline_project_schema_version: 1,
    exported_at: "2026-08-22T13:00:00.000Z",
    config: createProjectConfig({
      gui: {
        field: {
          selected_field_id: field.id,
          custom_fields: [field],
        },
      },
    }),
    paths: [],
    field_assets: [
      {
        asset_id: field.asset_id,
        file_name: field.file_name,
        mime_type: field.mime_type,
        data_base64: "AQID",
      },
    ],
  };
}

function projectArchiveFile(archive: unknown): File {
  return {
    name: "legacy.bline-project.json",
    type: "application/json",
    text: async () => JSON.stringify(archive),
  } as File;
}

async function migrateImportedFields(
  pending: ProjectImportResult,
): Promise<ProjectImportRollback> {
  const migration = await migrateImportedLegacyFieldBackgrounds({
    projectId: pending.project.project_id,
    selectedFieldId: pending.legacySelectedFieldId,
    entries: pending.legacyFieldBackgrounds,
  });
  if (migration.errors[0]) {
    await migration.rollback();
    throw migration.errors[0];
  }
  return migration;
}

async function initializeImportUserData(): Promise<{
  assets: Map<string, number[]>;
}> {
  let persisted: UserData | null = null;
  let revision = 0;
  const assets = new Map<string, number[]>();
  await initializeUserData(tauriCapabilities, {
    tauriInvoke: async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      if (command === "storage_read_user_data") {
        return (
          persisted === null
            ? null
            : { revision, data: structuredClone(persisted) }
        ) as T;
      }
      if (command === "storage_compare_and_swap_user_data") {
        if (args?.expectedRevision !== revision && persisted) {
          return {
            status: "conflict",
            document: { revision, data: structuredClone(persisted) },
          } as T;
        }
        persisted = structuredClone(args?.data as UserData);
        revision += 1;
        return { status: "written", revision } as T;
      }
      if (command === "storage_write_user_field_asset") {
        assets.set(String(args?.entryId), [...(args?.bytes as number[])]);
        return undefined as T;
      }
      if (command === "storage_read_user_field_asset") {
        return (assets.get(String(args?.entryId)) ?? null) as T;
      }
      if (command === "storage_delete_user_field_asset") {
        assets.delete(String(args?.entryId));
        return undefined as T;
      }
      throw new Error(`Unexpected User Data command: ${command}`);
    },
  });
  return { assets };
}

function projectFolderFile(webkitRelativePath: string): File {
  return {
    name: webkitRelativePath.split("/").at(-1) ?? "path.json",
    webkitRelativePath,
    text: async () =>
      JSON.stringify({
        path_elements: [{ type: "translation", x_meters: 1, y_meters: 2 }],
      }),
  } as File;
}

function noOpImportRollback() {
  return { rollback: async () => {} };
}

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class FailOnceWorkspaceWriteStorage extends MemoryStorage {
  private failedWorkspaceId: string | null = null;

  failNextWorkspaceWrite(id: string): void {
    this.failedWorkspaceId = id;
  }

  override setItem(key: string, value: string): void {
    if (
      this.failedWorkspaceId &&
      key ===
        `bline-web:workspace:${encodeURIComponent(this.failedWorkspaceId)}`
    ) {
      this.failedWorkspaceId = null;
      throw new Error("browser Project write failed");
    }
    super.setItem(key, value);
  }
}

class ObservableProjectMutationLock implements BrowserProjectMutationLock {
  private tail: Promise<void> = Promise.resolve();
  private requestCount = 0;
  private readonly requestWaiters = new Map<number, () => void>();
  concurrentOwners = 0;
  maximumConcurrentOwners = 0;

  request<T>(_name: string, callback: () => Promise<T> | T): Promise<T> {
    this.requestCount += 1;
    this.requestWaiters.get(this.requestCount)?.();
    this.requestWaiters.delete(this.requestCount);
    const run = this.tail.then(async () => {
      this.concurrentOwners += 1;
      this.maximumConcurrentOwners = Math.max(
        this.maximumConcurrentOwners,
        this.concurrentOwners,
      );
      try {
        return await callback();
      } finally {
        this.concurrentOwners -= 1;
      }
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  waitForRequestCount(count: number): Promise<void> {
    if (this.requestCount >= count) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.requestWaiters.set(count, resolve);
    });
  }
}
