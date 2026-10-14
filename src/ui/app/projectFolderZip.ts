import { calculateCrc32 } from "./projectFolderExport";

/**
 * Reads the autos.zip that BLine downloads on browsers without folder access
 * (or one zipped by hand), so it imports without unzipping first. Supports
 * the stored and deflated entries that BLine, Finder, Windows Explorer and
 * common zip tools write.
 */

export interface ZipEntry {
  path: string;
  bytes: Uint8Array;
}

const endOfCentralDirectorySignature = 0x06054b50;
const centralDirectoryHeaderSignature = 0x02014b50;
const localFileHeaderSignature = 0x04034b50;
const maxCommentLength = 0xffff;

export function isZipFile(file: Pick<File, "name" | "type">): boolean {
  return /\.zip$/i.test(file.name) || /zip/i.test(file.type);
}

export async function readZipEntries(blob: Blob): Promise<ZipEntry[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (
    entryCount === 0xffff ||
    directoryOffset === 0xffffffff ||
    directoryOffset + directorySize > end
  ) {
    throw new Error(
      "This ZIP file uses a format BLine can't read. Unzip it and import the autos folder instead.",
    );
  }

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== centralDirectoryHeaderSignature) {
      throw damagedZipError();
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc32 = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const path = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    offset += 46 + nameLength + extraLength + commentLength;

    if (path.endsWith("/")) continue;
    if (flags & 0x1) {
      throw new Error(
        "This ZIP file is password-protected. Unzip it and import the autos folder instead.",
      );
    }
    if (view.getUint32(localOffset, true) !== localFileHeaderSignature) {
      throw damagedZipError();
    }
    const dataStart =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (data.byteLength !== compressedSize) throw damagedZipError();

    const content =
      method === 0
        ? data.slice()
        : method === 8
          ? await inflateRaw(data)
          : null;
    if (!content) {
      throw new Error(
        `This ZIP file compresses ${path} in a way BLine can't read. Unzip it and import the autos folder instead.`,
      );
    }
    if (content.byteLength !== size || calculateCrc32(content) !== crc32) {
      throw damagedZipError();
    }
    entries.push({ path, bytes: content });
  }
  return entries;
}

/**
 * The zip's files as if its folder had been chosen in a folder picker, so the
 * folder importer reads them unchanged. macOS resource forks are skipped.
 */
export async function filesFromAutosZip(zip: File): Promise<File[]> {
  const root = zip.name.replace(/[\\/]/g, "_") || "autos.zip";
  const entries = (await readZipEntries(zip)).filter(
    ({ path }) =>
      !path.startsWith("__MACOSX/") &&
      !/(^|\/)\._/.test(path) &&
      !/(^|\/)\.DS_Store$/.test(path),
  );
  if (entries.length === 0) {
    throw new Error("This ZIP file is empty.");
  }
  return entries.map(({ path, bytes }) => {
    const relativePath = `${root}/${path.replace(/\\/g, "/").replace(/^\/+/, "")}`;
    const file = new File(
      [bytesToArrayBuffer(bytes)],
      relativePath.split("/").at(-1)!,
      {
        type: /\.json$/i.test(path) ? "application/json" : "",
      },
    );
    // Folder pickers expose each file's place in the tree this way.
    Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
    return file;
  });
}

function findEndOfCentralDirectory(view: DataView): number {
  const earliest = Math.max(0, view.byteLength - 22 - maxCommentLength);
  for (let offset = view.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === endOfCentralDirectorySignature) {
      return offset;
    }
  }
  throw new Error("This file isn't a ZIP archive.");
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  try {
    const stream = new Blob([bytesToArrayBuffer(data)])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw damagedZipError();
  }
}

function damagedZipError(): Error {
  return new Error("This ZIP file is damaged. Download or zip it again.");
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
