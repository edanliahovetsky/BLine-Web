import { describe, expect, it, vi } from "vitest";
import {
  saveBlobAs,
  type BrowserSaveWindow,
  type FileExportInvoke,
} from "../../../src/platform/fileExport";

describe("saveBlobAs", () => {
  it("keeps the Tauri command behind the platform export boundary", async () => {
    const nativeInvoke: FileExportInvoke = vi.fn(async () => true);

    await expect(
      saveBlobAs(new Blob(['{"ok":true}']), "path.json", {
        nativeInvoke,
        title: "Export BLine Path",
        useNativeSaveDialog: true,
      }),
    ).resolves.toBe(true);

    expect(nativeInvoke).toHaveBeenCalledWith(
      "storage_write_text_file_dialog",
      {
        contents: '{"ok":true}',
        defaultFileName: "path.json",
        title: "Export BLine Path",
      },
    );
  });

  it("writes through the browser file picker when it is available", async () => {
    const write = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({ close, write }),
    }));
    const browserWindow: BrowserSaveWindow = { showSaveFilePicker };
    const blob = new Blob(["path"]);

    await expect(
      saveBlobAs(blob, "path.json", {
        browserWindow,
        title: "Export BLine Path",
        useNativeSaveDialog: false,
      }),
    ).resolves.toBe(true);

    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: "path.json",
      types: [
        {
          accept: { "application/json": [".json"] },
          description: "JSON files",
        },
      ],
    });
    expect(write).toHaveBeenCalledWith(blob);
    expect(close).toHaveBeenCalledOnce();
  });

  it("falls back to a browser download when no picker is available", async () => {
    const downloadFile = vi.fn();
    const blob = new Blob(["path"]);

    await expect(
      saveBlobAs(blob, "path.json", {
        browserWindow: {},
        downloadFile,
        title: "Export BLine Path",
        useNativeSaveDialog: false,
      }),
    ).resolves.toBe(true);

    expect(downloadFile).toHaveBeenCalledWith(blob, "path.json");
  });
});
