import { describe, expect, it } from "vitest";
import {
  createPathModel,
  createTranslationTarget,
} from "../../../src/core/model/path";
import {
  createProjectPathDocument,
  createProjectWorkspaceDocument,
  type ProjectWorkspaceDocument,
} from "../../../src/core/io/projectSchema";
import { createProjectConfig } from "../../../src/core/config/projectConfig";
import {
  autosEditorStatePath,
  autosFieldAssetsPath,
} from "../../../src/core/io/projectFolder";
import {
  createProjectIoService,
  type ProjectFolderExport,
} from "../../../src/platform/projectIo";
import {
  browserWebCapabilities,
  tauriCapabilities,
} from "../../../src/env/capabilities";
import {
  BrowserStorage,
  type FieldAssetPayload,
  type FieldAssetWriteInput,
  type ProjectWorkspaceSummary,
  type StorageAdapter,
  type StorageLike,
  type WriteResult,
} from "../../../src/storage";

describe("ProjectIoService", () => {
  it("stores and restores browser workspaces with multiple paths and active path", async () => {
    const memory = new MemoryStorage();
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    });
    const workspace = exampleWorkspace("workspace-a", "Alpha", ["One", "Two"]);
    const activePathId = workspace.paths[1]?.path_id;
    if (!activePathId) {
      throw new Error("Expected a second path in the test workspace");
    }

    await service.createWorkspace({
      workspace: { ...workspace, active_path_id: activePathId },
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
    expect(restored?.active_path_id).toBe(activePathId);
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
      workspace: exampleWorkspace("workspace-a", "Alpha", ["One", "Two"]),
    });

    const folder = await service.exportProjectFolder();
    expect(folder.files.map((file) => file.relativePath)).toEqual([
      "config.json",
      autosEditorStatePath,
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

    expect(imported.paths.map((path) => path.file_name)).toEqual([
      "One.json",
      "Two.json",
    ]);
    expect(imported.active_path_id).toBe("One.json");
  });

  it("round-trips custom field images through archive and folder exports", async () => {
    const sourceStorage = new FieldAssetMemoryAdapter();
    const sourceService = createProjectIoService(browserWebCapabilities, {
      storage: sourceStorage,
    });
    await sourceService.createWorkspace({
      workspace: exampleWorkspace("workspace-a", "Alpha", ["One"]),
    });

    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    const customField = await sourceService.writeFieldImageAsset({
      file: new File([imageBytes], "practice-field.png", {
        type: "image/png",
      }),
      geometry: {
        length_meters: 12,
        width_meters: 6,
        coordinate_offset_meters: 0.25,
      },
    });
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
      await sourceService.exportProjectArchive()
    ).text();
    const archive = JSON.parse(archiveText) as {
      config: {
        gui: {
          field: {
            selected_field_id: string;
            custom_fields: Array<{ asset_id: string }>;
          };
        };
      };
      field_assets: Array<{
        asset_id: string;
        file_name: string;
        mime_type: string;
        data_base64: string;
      }>;
    };

    expect(archive.config.gui.field.selected_field_id).toBe(customField.id);
    expect(JSON.stringify(archive.config.gui.field)).not.toContain("AQIDBA");
    expect(archive.field_assets).toEqual([
      {
        asset_id: customField.asset_id,
        file_name: "practice-field.png",
        mime_type: "image/png",
        data_base64: "AQIDBA==",
      },
    ]);

    const archiveTarget = createProjectIoService(browserWebCapabilities, {
      storage: new FieldAssetMemoryAdapter(),
    });
    const archiveImported = await archiveTarget.importProjectArchive(
      new File([archiveText], "alpha.bline.json", {
        type: "application/json",
      }),
    );

    expect(archiveImported.config.gui.field.selected_field_id).toBe(
      customField.id,
    );
    await expect(
      imageBlobBytes(
        await archiveTarget.readFieldImageAsset(
          archiveImported.config.gui.field.custom_fields[0],
        ),
      ),
    ).resolves.toEqual([...imageBytes]);

    const folder = await sourceService.exportProjectFolder();
    expect(folder.files.map((file) => file.relativePath)).toContain(
      `${autosFieldAssetsPath}/${customField.asset_id}`,
    );
    const configFile = folder.files.find(
      (file) => file.relativePath === "config.json",
    );
    const stateFile = folder.files.find(
      (file) => file.relativePath === autosEditorStatePath,
    );
    if (!configFile) {
      throw new Error("Expected config.json in folder export");
    }
    if (!stateFile) {
      throw new Error("Expected sidecar state in folder export");
    }
    const folderConfig = JSON.parse(await configFile.blob.text()) as {
      gui?: unknown;
    };
    const folderState = JSON.parse(await stateFile.blob.text()) as {
      editor_config: { gui: { field: unknown } };
    };
    expect(folderConfig.gui).toBeUndefined();
    expect(JSON.stringify(folderState.editor_config.gui.field)).not.toContain(
      "AQIDBA",
    );

    const folderTarget = createProjectIoService(browserWebCapabilities, {
      storage: new FieldAssetMemoryAdapter(),
    });
    const folderImported = await folderTarget.importProjectFolder(
      await importFilesFromProjectFolder(folder),
    );

    expect(folderImported.config.gui.field.selected_field_id).toBe(
      customField.id,
    );
    await expect(
      imageBlobBytes(
        await folderTarget.readFieldImageAsset(
          folderImported.config.gui.field.custom_fields[0],
        ),
      ),
    ).resolves.toEqual([...imageBytes]);
  });

  it("deletes the current browser project and opens the next available workspace", async () => {
    const service = createProjectIoService(browserWebCapabilities, {
      browser: { storage: new MemoryStorage() },
    });
    await service.createWorkspace({
      workspace: exampleWorkspace("workspace-a", "Alpha", ["One"]),
    });
    await service.createWorkspace({
      workspace: exampleWorkspace("workspace-b", "Beta", ["Two"]),
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
      workspace: exampleWorkspace("workspace-a", "Alpha", ["One"]),
    });

    const next = await service.deleteWorkspace("workspace-a");

    expect(next).toBeNull();
    await expect(service.listWorkspaces()).resolves.toEqual([]);
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

class FieldAssetMemoryAdapter implements StorageAdapter {
  private readonly workspaces = new Map<
    string,
    {
      workspace: ProjectWorkspaceDocument;
      version: string;
      updatedAt: string;
    }
  >();
  private readonly assets = new Map<string, FieldAssetPayload>();
  private writes = 0;

  async listWorkspaces(): Promise<ProjectWorkspaceSummary[]> {
    return [...this.workspaces.values()].map((record) => ({
      id: record.workspace.project_id,
      displayName: record.workspace.display_name,
      version: record.version,
      updatedAt: record.updatedAt,
    }));
  }

  async readWorkspace(id?: string): Promise<ProjectWorkspaceDocument> {
    const workspaceId = id ?? [...this.workspaces.keys()][0];
    const record = workspaceId ? this.workspaces.get(workspaceId) : undefined;
    if (!record) {
      throw new Error(`Project not found: ${workspaceId ?? "workspace"}`);
    }

    return structuredClone(record.workspace);
  }

  async writeWorkspace(
    workspace: ProjectWorkspaceDocument,
  ): Promise<WriteResult> {
    this.writes += 1;
    const updatedAt = new Date(
      Date.UTC(2026, 5, 16, 12, 0, this.writes),
    ).toISOString();
    const version = `v${this.writes}`;
    this.workspaces.set(workspace.project_id, {
      workspace: structuredClone(workspace),
      version,
      updatedAt,
    });
    return { version, updatedAt };
  }

  async writeFieldAsset(input: FieldAssetWriteInput): Promise<void> {
    const bytes = new Uint8Array(input.bytes.byteLength);
    bytes.set(input.bytes);
    this.assets.set(assetKey(input.workspaceId, input.assetId), {
      fileName: input.fileName,
      mimeType: input.mimeType,
      bytes,
    });
  }

  async readFieldAsset(
    workspaceId: string,
    assetId: string,
  ): Promise<FieldAssetPayload | null> {
    const payload = this.assets.get(assetKey(workspaceId, assetId));
    if (!payload) {
      return null;
    }

    const bytes = new Uint8Array(payload.bytes.byteLength);
    bytes.set(payload.bytes);
    return {
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      bytes,
    };
  }

  async deleteFieldAsset(workspaceId: string, assetId: string): Promise<void> {
    this.assets.delete(assetKey(workspaceId, assetId));
  }
}

async function importFilesFromProjectFolder(
  folder: ProjectFolderExport,
): Promise<File[]> {
  return Promise.all(
    folder.files.map(async (file) => {
      const name = file.relativePath.split("/").at(-1) ?? file.relativePath;
      const input = new File([await file.blob.arrayBuffer()], name, {
        type: file.blob.type,
      });
      Object.defineProperty(input, "webkitRelativePath", {
        value: `autos/${file.relativePath}`,
      });
      return input;
    }),
  );
}

async function imageBlobBytes(blob: Blob | null): Promise<number[]> {
  if (!blob) {
    throw new Error("Expected field image asset to be readable");
  }

  return [...new Uint8Array(await blob.arrayBuffer())];
}

function assetKey(workspaceId: string, assetId: string): string {
  return `${workspaceId}:${assetId}`;
}
