import { invoke } from "@tauri-apps/api/core";

export type FileExportInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export interface BrowserSaveWindow {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      accept: Record<string, string[]>;
      description: string;
    }>;
  }) => Promise<BrowserFileHandle>;
}

export interface BrowserFileHandle {
  createWritable(): Promise<BrowserWritableFileStream>;
}

export interface BrowserWritableFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

export interface SaveBlobAsOptions {
  title: string;
  useNativeSaveDialog: boolean;
  nativeInvoke?: FileExportInvoke;
  browserWindow?: BrowserSaveWindow;
  downloadFile?: (blob: Blob, fileName: string) => void;
}

export async function saveBlobAs(
  blob: Blob,
  fileName: string,
  options: SaveBlobAsOptions,
): Promise<boolean> {
  if (options.useNativeSaveDialog) {
    const nativeInvoke = options.nativeInvoke ?? invoke;
    return (await nativeInvoke("storage_write_text_file_dialog", {
      contents: await blob.text(),
      defaultFileName: fileName,
      title: options.title,
    })) as boolean;
  }

  const browserWindow =
    options.browserWindow ??
    (typeof window === "undefined"
      ? undefined
      : (window as unknown as BrowserSaveWindow));
  const saveFilePicker = browserWindow?.showSaveFilePicker;
  if (saveFilePicker && browserWindow) {
    const fileHandle = await saveFilePicker.call(browserWindow, {
      suggestedName: fileName,
      types: [
        {
          accept: {
            "application/json": [".json"],
          },
          description: "JSON files",
        },
      ],
    });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }

  (options.downloadFile ?? downloadBlob)(blob, fileName);
  return true;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
