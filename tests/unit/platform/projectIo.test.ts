import { describe, expect, it } from "vitest";
import {
  createPathModel,
  createTranslationTarget,
} from "../../../src/core/model/path";
import {
  createProjectPathDocument,
  createProjectWorkspaceDocument,
} from "../../../src/core/io/projectSchema";
import { createProjectConfig } from "../../../src/core/config/projectConfig";
import { serializeProjectFiles } from "../../../src/core/io/projectFiles";
import { createProjectIoService } from "../../../src/platform/projectIo";
import {
  browserWebCapabilities,
  tauriCapabilities,
} from "../../../src/env/capabilities";
import {
  BrowserStorage,
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
        document: project,
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
    const imported = await target.importProjectArchive({
      name: "legacy.bline-project.json",
      type: "application/json",
      text: async () => JSON.stringify(archive),
    } as File);

    expect(imported.legacySelectedFieldId).toBe(field.id);
    expect(imported.legacyFieldBackgrounds).toEqual([
      {
        field: expect.objectContaining({ id: field.id }),
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    ]);
    expect(imported.project.config.gui.field.custom_fields).toEqual([]);
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

    expect(next?.project_id).toBe("workspace-a");
    expect(summaries.map((summary) => summary.id)).toEqual(["workspace-a"]);
  });

  it("returns to an empty start state after deleting the final project", async () => {
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    await service.createWorkspace({
      project: exampleWorkspace("workspace-a", "Alpha", ["One"]),
    });

    const next = await service.deleteWorkspace("workspace-a");

    expect(next).toBeNull();
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
    const migration = service.getLegacyProjectViewMigration();
    expect(migration).toMatchObject({
      legacyProjectId: "/repo/autos",
      stableProjectId: project?.project_id,
      pathIdByLegacyReference: { "One.json": "One.json" },
    });

    const prepared = await service.prepareLegacyProjectMigration(migration!);
    expect(prepared).toMatchObject({ version: "canonical-v2" });
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
