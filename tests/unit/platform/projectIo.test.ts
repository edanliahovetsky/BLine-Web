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
} from "../../../src/platform/projectIo";
import {
  browserWebCapabilities,
  tauriCapabilities,
} from "../../../src/env/capabilities";
import {
  BrowserStorage,
  ProjectPersistenceDamageError,
  StorageConflictError,
  TauriStorage,
  type StorageLike,
} from "../../../src/storage";

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
    await first.initialize();
    const firstMigration = first.getLegacyProjectViewMigration();

    expect(firstMigration).toMatchObject({
      legacyProjectId: "legacy-locator",
      stableProjectId: "stable-project",
    });
    await first.prepareLegacyProjectMigration(firstMigration!);

    const restarted = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    await restarted.initialize();
    const resumedMigration = restarted.getLegacyProjectViewMigration();

    expect(resumedMigration).toMatchObject({
      legacyProjectId: "legacy-locator",
      stableProjectId: "stable-project",
    });
    await restarted.completeLegacyProjectMigration(resumedMigration!);
    expect(restarted.getLegacyProjectViewMigration()).toBeNull();
  });

  it("stores and restores browser Project content without session navigation", async () => {
    const memory = new MemoryStorage();
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    const workspace = exampleWorkspace("workspace-a", "Alpha", ["One", "Two"]);
    await service.createWorkspace({
      project: workspace,
    });

    const restoredService = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    const restored = await restoredService.initialize();

    expect(restored).toMatchObject({
      project_id: "workspace-a",
      display_name: "Alpha",
    });
    expect(restored?.paths.map((path) => path.display_name)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("restores browser ownership when initial Project creation fails", async () => {
    const memory = new MemoryStorage();
    const storage = new BrowserStorage({ storage: memory });
    const service = createProjectIoService(browserWebCapabilities, { storage });
    const original = exampleWorkspace("project-a", "Alpha", ["One"]);
    await service.createWorkspace({ project: original });
    const originalWriteNew = storage.writeNewProject.bind(storage);
    storage.writeNewProject = async () => {
      throw new Error("initial write failed");
    };

    await expect(
      service.createWorkspace({
        project: exampleWorkspace("project-b", "Beta", ["Two"]),
      }),
    ).rejects.toThrow("initial write failed");
    expect(service.getCurrentWorkspaceSummary()?.id).toBe("project-a");
    expect(memory.getItem("bline-web:current-workspace")).toBe("project-a");

    storage.writeNewProject = originalWriteNew;
    const current = await currentProject(service);
    await service.saveWorkspace(
      { ...current, display_name: "Alpha saved after failure" },
      service.getCurrentVersion(),
    );
    const restarted = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    await expect(restarted.initialize()).resolves.toMatchObject({
      project_id: "project-a",
      display_name: "Alpha saved after failure",
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
    await service.initialize();

    await expect(
      service.createWorkspace({
        project: projectB,
      }),
    ).rejects.toThrow("desktop initial write failed");
    expect(currentLocator).toBe("/repo/a/autos");
    expect(switches).toEqual(["/repo/a/autos"]);
    expect(service.getCurrentWorkspaceSummary()?.id).toBe("/repo/a/autos");

    await service.saveWorkspace(projectA, service.getCurrentVersion());
    const restarted = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    await expect(restarted.initialize()).resolves.toMatchObject({
      project_id: "stable-a",
      display_name: "Alpha",
    });
    expect(currentLocator).toBe("/repo/a/autos");

    rejectCandidateWrite = false;
    await expect(
      service.createWorkspace({ project: projectB }),
    ).resolves.toMatchObject({
      project_id: "stable-b",
      display_name: "Beta",
    });
    expect(currentLocator).toBe("/repo/b/autos");
    expect(switches.at(-1)).toBe("/repo/b/autos");
    const restartedAfterSuccess = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    await expect(restartedAfterSuccess.initialize()).resolves.toMatchObject({
      project_id: "stable-b",
      display_name: "Beta",
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
    await service.initialize();

    await expect(
      service.createWorkspace({ project: projectB }),
    ).resolves.toMatchObject({ project_id: "stable-b" });
    expect(service.getCurrentWorkspaceSummary()?.id).toBe("/repo/b/autos");
    expect(durableCurrent).toBe("/repo/a/autos");

    await service.saveWorkspace(projectB, service.getCurrentVersion());
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
    await service.initialize();

    await expect(service.openWorkspace()).rejects.toThrow(
      "candidate Project is invalid",
    );
    await expect(service.switchWorkspace("/repo/b/autos")).rejects.toThrow(
      "candidate Project is invalid",
    );
    expect(switches).toEqual(["/repo/a/autos", "/repo/a/autos"]);
    expect(durableCurrent).toBe("/repo/a/autos");
    await expect(service.getWorkspace()).resolves.toMatchObject({
      project_id: "stable-a",
    });

    const restarted = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    await expect(restarted.initialize()).resolves.toMatchObject({
      project_id: "stable-a",
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
    expect(service.getCurrentWorkspaceSummary()).toBeNull();
    await expect(service.getWorkspace()).resolves.toBeNull();
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
    await service.initialize();

    await expect(
      service.switchWorkspace("/repo/b/autos"),
    ).rejects.toBeInstanceOf(StorageConflictError);
    expect(expectedVersions).toEqual(["b-v1", "a-v1"]);
    expect(switches).toEqual(["/repo/a/autos"]);
    expect(durableCurrent).toBe("/repo/a/autos");
    expect(service.getCurrentWorkspaceSummary()).toMatchObject({
      id: "/repo/a/autos",
      version: "a-v1",
    });
    await expect(service.getWorkspace()).resolves.toMatchObject({
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
    await service.createWorkspace({
      project: exampleWorkspace("workspace-a", "Alpha", ["One", "Two"]),
    });

    const folder = await service.exportProjectFolder(
      await currentProject(service),
    );
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

    for (const service of [browser, desktop]) {
      await expect(service.importProjectFolder(files)).rejects.toThrow(
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
    await source.createWorkspace({
      project: exampleWorkspace("shared-id", "Imported", ["Imported Path"]),
    });
    const sourceProject = await currentProject(source);
    const folder = await source.exportProjectFolder(sourceProject);
    const archive = await source.exportProjectArchive(sourceProject);

    for (const { collisionId, importProject } of [
      {
        collisionId: "shared-id",
        importProject: (target: ReturnType<typeof createProjectIoService>) =>
          target.importProjectFolder(
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
        importProject: (target: ReturnType<typeof createProjectIoService>) =>
          target.importProjectArchive({
            name: "shared.bline-project.json",
            type: "application/json",
            text: () => archive.text(),
          } as File),
      },
    ]) {
      const target = createProjectIoService(browserWebCapabilities, {
        browser: { storage: new MemoryStorage() },
      });
      await target.createWorkspace({
        project: exampleWorkspace(collisionId, "Existing", ["Kept Path"]),
      });

      await expect(importProject(target)).rejects.toBeInstanceOf(
        StorageConflictError,
      );
      await expect(target.peekWorkspace()).resolves.toMatchObject({
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
    await source.createWorkspace({
      project: exampleWorkspace("imported-id", "Imported", ["Imported Path"]),
    });
    const archive = await source.exportProjectArchive(
      await currentProject(source),
    );

    const target = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    await target.createWorkspace({
      project: exampleWorkspace("prior-id", "Prior", ["Prior Path"]),
    });
    const imported = await target.importProjectArchive({
      name: "imported.bline-project.json",
      type: "application/json",
      text: () => archive.text(),
    } as File);

    expect(imported.project.project_id).toBe("imported-project");
    await expect(target.getWorkspace()).resolves.toMatchObject({
      project_id: "imported-project",
      paths: [{ display_name: "Imported Path" }],
    });
    await expect(target.peekWorkspace()).resolves.toMatchObject({
      project_id: "imported-project",
      paths: [{ display_name: "Imported Path" }],
    });
    await expect(target.reloadCurrentProject()).resolves.toMatchObject({
      project_id: "imported-project",
      paths: [{ display_name: "Imported Path" }],
    });
    expect(
      (await target.listWorkspaces()).map((summary) => summary.id).sort(),
    ).toEqual(["imported-project", "prior-id"]);
    await expect(target.openWorkspace("prior-id")).resolves.toMatchObject({
      project_id: "prior-id",
      paths: [{ display_name: "Prior Path" }],
    });
  });

  it("durably adopts the browser record it opens and keeps damage checks on that record", async () => {
    const memory = new MemoryStorage();
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    await service.createWorkspace({
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

    const recovered = await service.openWorkspace("project-b");

    expect(memory.getItem("bline-web:current-workspace")).toBe("project-b");
    memory.setItem("bline-web:current-workspace", "project-a");
    expect(service.getPersistenceDamage()).toMatchObject({
      sourcePath: "project.json",
      rawText: "{damaged project metadata",
    });
    await expect(
      service.saveWorkspace(recovered!, "damaged-b-v1"),
    ).rejects.toBeInstanceOf(ProjectPersistenceDamageError);
    await service.openWorkspace("project-b");

    const restarted = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    await expect(restarted.initialize()).resolves.toMatchObject({
      project_id: "project-b",
    });
    expect(restarted.getPersistenceDamage()).toMatchObject({
      rawText: "{damaged project metadata",
    });
  });

  it("rejects deletion when a non-current browser Project changed after it was listed", async () => {
    const memory = new MemoryStorage();
    const storage = new BrowserStorage({ storage: memory });
    const service = createProjectIoService(browserWebCapabilities, { storage });
    await service.createWorkspace({
      project: exampleWorkspace("project-a", "Alpha", ["One"]),
    });
    await service.createWorkspace({
      project: exampleWorkspace("project-b", "Beta", ["Two"]),
    });
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
      service.deleteWorkspace("project-a", listed.version),
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
      "damaged-v1",
    );

    expect(service.getCurrentWorkspaceSummary()?.id).toBe("stable-project");
    expect(memory.getItem("bline-web:current-workspace")).toBe(
      "stable-project",
    );
    await expect(
      service.saveWorkspace(recovered!, replacement.version),
    ).resolves.toMatchObject({ version: expect.any(String) });
    expect(memory.getItem("bline-web:workspace:legacy-locator")).toBeNull();
    expect(memory.getItem("bline-web:workspace:stable-project")).not.toBeNull();
  });

  it("excludes local Field Background metadata and bytes from exports", async () => {
    const sourceStorage = new BrowserStorage({ storage: new MemoryStorage() });
    const sourceService = createProjectIoService(browserWebCapabilities, {
      storage: sourceStorage,
    });
    await sourceService.createWorkspace({
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
    const workspace = await sourceService.getWorkspace();
    if (!workspace) {
      throw new Error("Expected workspace to be open");
    }
    await sourceService.saveWorkspace({
      ...workspace,
      config: createProjectConfig({
        ...workspace.config,
        gui: {
          ...workspace.config.gui,
          field: {
            selected_field_id: customField.id,
            custom_fields: [customField],
          },
        },
      }),
    });

    const archiveText = await (
      await sourceService.exportProjectArchive(
        await currentProject(sourceService),
      )
    ).text();
    const archive = JSON.parse(archiveText) as Record<string, unknown>;
    expect(archive).not.toHaveProperty("field_assets");
    expect(archive).not.toHaveProperty("config.gui.field");
    expect(archiveText).not.toContain("AQIDBA");

    const folder = await sourceService.exportProjectFolder(
      await currentProject(sourceService),
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
    await source.createWorkspace({
      project: exampleWorkspace("source", "Source", ["One"]),
    });
    const archive = JSON.parse(
      await (
        await source.exportProjectArchive(await currentProject(source))
      ).text(),
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
    await expect(target.importProjectArchive(file)).rejects.toThrow(
      "migration is required",
    );
    await expect(
      target.importProjectArchive(file, {
        migrateLegacyFieldBackgrounds: async () => undefined as never,
      }),
    ).rejects.toThrow("must return a rollback handle");
    await expect(target.listWorkspaces()).resolves.toEqual([]);
    let migratedBeforeCommit = false;
    const imported = await target.importProjectArchive(file, {
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
    await target.createWorkspace({
      project: exampleWorkspace("imported-project", "Existing", ["Kept"]),
    });
    let preparations = 0;

    await expect(
      target.importProjectArchive(projectArchiveFile(legacyFieldArchive()), {
        migrateLegacyFieldBackgrounds: async () => {
          preparations += 1;
          return noOpImportRollback();
        },
      }),
    ).rejects.toBeInstanceOf(StorageConflictError);

    expect(preparations).toBe(0);
    await expect(target.getWorkspace()).resolves.toMatchObject({
      project_id: "imported-project",
      display_name: "Existing",
    });
  });

  it("rolls back prepared browser Fields when the Project write fails", async () => {
    const storage = new BrowserStorage({ storage: new MemoryStorage() });
    const target = createProjectIoService(browserWebCapabilities, { storage });
    await target.createWorkspace({
      project: exampleWorkspace("existing", "Existing", ["Kept"]),
    });
    storage.writeNewProject = async () => {
      throw new Error("browser Project write failed");
    };
    let rollbacks = 0;

    await expect(
      target.importProjectArchive(projectArchiveFile(legacyFieldArchive()), {
        migrateLegacyFieldBackgrounds: async () => ({
          rollback: async () => {
            rollbacks += 1;
          },
        }),
      }),
    ).rejects.toThrow("browser Project write failed");
    expect(rollbacks).toBe(1);
    await expect(target.getWorkspace()).resolves.toMatchObject({
      project_id: "existing",
    });

    const failure = await target
      .importProjectArchive(projectArchiveFile(legacyFieldArchive()), {
        migrateLegacyFieldBackgrounds: async () => ({
          rollback: async () => {
            throw new Error("User Data rollback failed");
          },
        }),
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
  });

  it("rejects an import with any missing custom Field asset before adopting it", async () => {
    const target = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    await target.createWorkspace({
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
      target.importProjectArchive({
        name: "missing-field.bline-project.json",
        type: "application/json",
        text: async () => JSON.stringify(archive),
      } as File),
    ).rejects.toThrow("missing.png");
    await expect(target.getWorkspace()).resolves.toMatchObject({
      project_id: "existing",
      display_name: "Existing",
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
    await target.initialize();
    const archive = legacyFieldArchive();

    await expect(
      target.importProjectArchive(
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
    await expect(target.getWorkspace()).resolves.toMatchObject({
      project_id: "desktop-current",
      display_name: "Current",
      paths: [{ display_name: "Kept" }],
    });
    const restarted = createProjectIoService(tauriCapabilities, {
      tauri: { invoke },
    });
    await expect(restarted.initialize()).resolves.toMatchObject({
      project_id: "desktop-current",
      paths: [{ display_name: "Kept" }],
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
    await target.initialize();

    await expect(
      target.importProjectArchive(projectArchiveFile(legacyFieldArchive()), {
        migrateLegacyFieldBackgrounds: async () => {
          preparations += 1;
          return noOpImportRollback();
        },
      }),
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
    await target.initialize();

    await expect(
      target.importProjectArchive(projectArchiveFile(legacyFieldArchive()), {
        migrateLegacyFieldBackgrounds: async () => ({
          rollback: async () => {
            rollbacks += 1;
          },
        }),
      }),
    ).rejects.toThrow("desktop Project write failed");
    expect(projectWrites).toBe(1);
    expect(rollbacks).toBe(1);
    await expect(target.getWorkspace()).resolves.toMatchObject({
      project_id: "desktop-current",
      paths: [{ display_name: "Kept" }],
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
    await target.initialize();

    await expect(
      target.importProjectArchive(projectArchiveFile(legacyFieldArchive()), {
        migrateLegacyFieldBackgrounds: async (pending) => {
          intended = structuredClone(pending.project);
          return {
            rollback: async () => {
              rollbacks += 1;
            },
          };
        },
      }),
    ).resolves.toMatchObject({ project: { project_id: "desktop-current" } });
    expect(rollbacks).toBe(0);
    expect(target.getCurrentVersion()).toBe("committed-v2");
    await expect(target.getWorkspace()).resolves.toMatchObject({
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
    await target.initialize();

    await expect(
      target.importProjectArchive(projectArchiveFile(legacyFieldArchive()), {
        migrateLegacyFieldBackgrounds: async () => ({
          rollback: async () => {
            rollbacks += 1;
          },
        }),
      }),
    ).rejects.toBeInstanceOf(ProjectImportOutcomeUncertainError);
    expect(rollbacks).toBe(0);
  });

  it("deletes the current browser project and opens the next available workspace", async () => {
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    await service.createWorkspace({
      project: exampleWorkspace("workspace-a", "Alpha", ["One"]),
    });
    await service.createWorkspace({
      project: exampleWorkspace("workspace-b", "Beta", ["Two"]),
    });

    const next = await service.deleteWorkspace("workspace-b");
    const summaries = await service.listWorkspaces();

    expect(next).toMatchObject({
      changedCurrent: true,
      project: { project_id: "workspace-a" },
    });
    expect(summaries.map((summary) => summary.id)).toEqual(["workspace-a"]);
  });

  it("reports that deleting another browser Project leaves current ownership unchanged", async () => {
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    await service.createWorkspace({
      project: exampleWorkspace("workspace-a", "Alpha", ["One"]),
    });
    await service.createWorkspace({
      project: exampleWorkspace("workspace-b", "Beta", ["Two"]),
    });
    const projectA = (await service.listWorkspaces()).find(
      (summary) => summary.id === "workspace-a",
    );

    const result = await service.deleteWorkspace(
      "workspace-a",
      projectA?.version,
    );

    expect(result).toMatchObject({
      changedCurrent: false,
      project: { project_id: "workspace-b" },
    });
    expect(service.getCurrentWorkspaceSummary()?.id).toBe("workspace-b");
  });

  it("returns to an empty start state after deleting the final project", async () => {
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    await service.createWorkspace({
      project: exampleWorkspace("workspace-a", "Alpha", ["One"]),
    });

    const next = await service.deleteWorkspace("workspace-a");

    expect(next).toEqual({ project: null, changedCurrent: true });
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

    const project = await service.initialize();
    expect(project?.project_id).not.toBe("/repo/autos");
    expect(service.getCurrentVersion()).toBe("runtime-v1");
    expect(service.getCurrentWorkspaceSummary()).toMatchObject({
      id: "/repo/autos",
      directoryPath: "/repo/autos",
      version: "runtime-v1",
    });
    const migration = service.getLegacyProjectViewMigration();
    expect(migration).toMatchObject({
      legacyProjectId: "/repo/autos",
      stableProjectId: project?.project_id,
      pathIdByLegacyReference: { "One.json": "One.json" },
    });

    const prepared = await service.prepareLegacyProjectMigration(migration!);
    expect(prepared).toMatchObject({
      status: "prepared",
      version: "canonical-v2",
    });
    expect(service.getLegacyProjectViewMigration()).toMatchObject({
      legacyProjectId: "/repo/autos",
      stableProjectId: project?.project_id,
    });
    const completed = await service.completeLegacyProjectMigration(migration!);

    expect(completed).toMatchObject({ version: "clean-v3" });
    expect(service.getCurrentVersion()).toBe("clean-v3");
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

    const project = await service.initialize();

    expect(project?.paths).toHaveLength(1);
    expect(service.getLegacyProjectViewMigration()).toBeNull();
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

    const project = await service.initialize();

    expect(project?.paths).toHaveLength(1);
    expect(service.getPersistenceDamage()).toMatchObject({
      sourcePath: "config.json",
      rawText: futureConfig,
    });
    expect(service.getLegacyProjectViewMigration()).toBeNull();
    await expect(service.saveWorkspace(project!)).rejects.toBeInstanceOf(
      ProjectPersistenceDamageError,
    );
    expect(commands).not.toContain("storage_prepare_legacy_project_files");
  });
});

async function currentProject(
  service: ReturnType<typeof createProjectIoService>,
) {
  const workspace = await service.getWorkspace();
  if (!workspace) {
    throw new Error("Expected an open Project");
  }
  return workspace;
}

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
