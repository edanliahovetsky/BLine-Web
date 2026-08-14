import type { ProjectFolderExport } from "../../platform/projectIo";
import { downloadBlob } from "../../platform/fileExport";

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
  downloadFile(
    await createProjectFolderZip(projectFolder),
    `${safeFileName(projectFolder.folderName)}.zip`,
  );
}

export async function createProjectFolderZip(
  projectFolder: ProjectFolderExport,
): Promise<Blob> {
  const timestamp = new Date();
  const entries = await Promise.all(
    projectFolder.files.map(async (file) => {
      const bytes = new Uint8Array(await file.blob.arrayBuffer());
      return {
        bytes,
        crc32: calculateCrc32(bytes),
        name: zipEntryPath(projectFolder.folderName, file.relativePath),
      };
    }),
  );
  const localFileParts: Uint8Array[] = [];
  const centralDirectoryParts: Uint8Array[] = [];
  let offset = 0;

  assertZip16Value(entries.length);
  for (const entry of entries) {
    const encodedName = textEncoder.encode(entry.name);
    assertZip16Value(encodedName.byteLength);
    assertZip32Value(entry.bytes.byteLength);
    assertZip32Value(offset);

    const localHeader = createLocalFileHeader({
      crc32: entry.crc32,
      fileNameLength: encodedName.byteLength,
      size: entry.bytes.byteLength,
      timestamp,
    });
    const localHeaderWithName = appendBytes(localHeader, encodedName);
    localFileParts.push(localHeaderWithName, entry.bytes);

    centralDirectoryParts.push(
      appendBytes(
        createCentralDirectoryHeader({
          crc32: entry.crc32,
          fileNameLength: encodedName.byteLength,
          localHeaderOffset: offset,
          size: entry.bytes.byteLength,
          timestamp,
        }),
        encodedName,
      ),
    );

    offset += localHeaderWithName.byteLength + entry.bytes.byteLength;
  }

  const centralDirectoryStart = offset;
  const centralDirectorySize = centralDirectoryParts.reduce(
    (total, part) => total + part.byteLength,
    0,
  );
  assertZip32Value(centralDirectoryStart);
  assertZip32Value(centralDirectorySize);

  const endOfCentralDirectory = createEndOfCentralDirectory({
    centralDirectoryOffset: centralDirectoryStart,
    centralDirectorySize,
    entries: entries.length,
  });

  return new Blob(
    [...localFileParts, ...centralDirectoryParts, endOfCentralDirectory].map(
      bytesToArrayBuffer,
    ),
    { type: "application/zip" },
  );
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
    return deployDirectory.getDirectoryHandle(autosFolderName, {
      create: true,
    });
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

const textEncoder = new TextEncoder();
const utf8FileNameFlag = 0x0800;
const localFileHeaderSignature = 0x04034b50;
const centralDirectoryHeaderSignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;

function createLocalFileHeader({
  crc32,
  fileNameLength,
  size,
  timestamp,
}: {
  crc32: number;
  fileNameLength: number;
  size: number;
  timestamp: Date;
}): Uint8Array {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  view.setUint32(0, localFileHeaderSignature, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, utf8FileNameFlag, true);
  view.setUint16(8, 0, true);
  writeDosTimestamp(view, 10, timestamp);
  view.setUint32(14, crc32, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, fileNameLength, true);
  view.setUint16(28, 0, true);
  return header;
}

function createCentralDirectoryHeader({
  crc32,
  fileNameLength,
  localHeaderOffset,
  size,
  timestamp,
}: {
  crc32: number;
  fileNameLength: number;
  localHeaderOffset: number;
  size: number;
  timestamp: Date;
}): Uint8Array {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  view.setUint32(0, centralDirectoryHeaderSignature, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, utf8FileNameFlag, true);
  view.setUint16(10, 0, true);
  writeDosTimestamp(view, 12, timestamp);
  view.setUint32(16, crc32, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, fileNameLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localHeaderOffset, true);
  return header;
}

function createEndOfCentralDirectory({
  centralDirectoryOffset,
  centralDirectorySize,
  entries,
}: {
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  entries: number;
}): Uint8Array {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, endOfCentralDirectorySignature, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entries, true);
  view.setUint16(10, entries, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);
  return header;
}

function writeDosTimestamp(
  view: DataView,
  offset: number,
  timestamp: Date,
): void {
  const year = Math.max(timestamp.getFullYear(), 1980);
  const dosTime =
    (timestamp.getHours() << 11) |
    (timestamp.getMinutes() << 5) |
    Math.floor(timestamp.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((timestamp.getMonth() + 1) << 5) |
    timestamp.getDate();
  view.setUint16(offset, dosTime, true);
  view.setUint16(offset + 2, dosDate, true);
}

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(left.byteLength + right.byteLength);
  combined.set(left);
  combined.set(right, left.byteLength);
  return combined;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function zipEntryPath(folderName: string, relativePath: string): string {
  const folder = safePathSegments(folderName).join("/") || "autos";
  const filePath = safePathSegments(relativePath).join("/");
  return filePath ? `${folder}/${filePath}` : folder;
}

function safePathSegments(path: string): string[] {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..");
}

function safeFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/\.[^.]*$/i, "")
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/(^-|-$)/g, "") || "autos"
  );
}

const crc32Table = createCrc32Table();

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function calculateCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crc32Table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertZip32Value(value: number): void {
  if (!Number.isSafeInteger(value) || value > 0xffffffff) {
    throw new Error("Project folder export is too large for ZIP32");
  }
}

function assertZip16Value(value: number): void {
  if (!Number.isSafeInteger(value) || value > 0xffff) {
    throw new Error("Project folder export has too many ZIP entries");
  }
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
