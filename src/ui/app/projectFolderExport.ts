import type { ProjectFolderExport } from "../../platform/projectIo";

export interface ProjectExportWindow extends Window {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<ProjectExportDirectoryHandle>;
}

export interface ProjectExportDirectoryHandle {
  name: string;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ProjectExportDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ProjectExportFileHandle>;
}

export interface ProjectExportFileHandle {
  createWritable(): Promise<ProjectExportWritableFileStream>;
}

export interface ProjectExportWritableFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface WriteProjectFolderOptions {
  directoryPicker?: ProjectExportWindow["showDirectoryPicker"];
  downloadFile?: (blob: Blob, fileName: string) => void;
}

export async function writeProjectFolder(
  projectFolder: ProjectFolderExport,
  options: WriteProjectFolderOptions = {},
): Promise<void> {
  const browserWindow =
    typeof window === "undefined" ? undefined : (window as ProjectExportWindow);
  const directoryPicker =
    options.directoryPicker ?? browserWindow?.showDirectoryPicker;

  if (directoryPicker) {
    const selectedDirectory = browserWindow
      ? await directoryPicker.call(browserWindow, { mode: "readwrite" })
      : await directoryPicker({ mode: "readwrite" });
    const autosDirectory = await resolveAutosExportDirectory(
      selectedDirectory,
      projectFolder.folderName,
    );

    for (const file of projectFolder.files) {
      await writeFolderFile(autosDirectory, file.relativePath, file.blob);
    }
    return;
  }

  const downloadFile = options.downloadFile ?? downloadBlob;
  for (const file of projectFolder.files) {
    downloadFile(
      file.blob,
      `${projectFolder.folderName}-${file.relativePath.replace(/\//g, "-")}`,
    );
  }
}

export async function resolveAutosExportDirectory(
  selectedDirectory: ProjectExportDirectoryHandle,
  autosFolderName: string,
): Promise<ProjectExportDirectoryHandle> {
  if (sameFolderName(selectedDirectory.name, autosFolderName)) {
    return selectedDirectory;
  }

  const deployDirectory = await getNestedDirectoryIfPresent(selectedDirectory, [
    "src",
    "main",
    "deploy",
  ]);
  if (deployDirectory) {
    return deployDirectory.getDirectoryHandle(autosFolderName, { create: true });
  }

  return selectedDirectory.getDirectoryHandle(autosFolderName, {
    create: true,
  });
}

async function getNestedDirectoryIfPresent(
  root: ProjectExportDirectoryHandle,
  segments: readonly string[],
): Promise<ProjectExportDirectoryHandle | null> {
  let current = root;
  for (const segment of segments) {
    const next = await getDirectoryIfPresent(current, segment);
    if (!next) {
      return null;
    }
    current = next;
  }

  return current;
}

async function getDirectoryIfPresent(
  directory: ProjectExportDirectoryHandle,
  name: string,
): Promise<ProjectExportDirectoryHandle | null> {
  try {
    return await directory.getDirectoryHandle(name);
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingDirectoryError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotFoundError" || error.name === "TypeMismatchError")
  );
}

function sameFolderName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

async function writeFolderFile(
  directory: ProjectExportDirectoryHandle,
  relativePath: string,
  blob: Blob,
): Promise<void> {
  const segments = relativePath.split("/").filter(Boolean);
  const fileName = segments.at(-1);

  if (!fileName) {
    return;
  }

  let currentDirectory = directory;
  for (const segment of segments.slice(0, -1)) {
    currentDirectory = await currentDirectory.getDirectoryHandle(segment, {
      create: true,
    });
  }

  const fileHandle = await currentDirectory.getFileHandle(fileName, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
