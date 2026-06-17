import { describe, expect, it } from "vitest";
import type { ProjectFolderExport } from "../../../src/platform/projectIo";
import {
  resolveAutosExportDirectory,
  writeProjectFolder,
  type ProjectExportDirectoryHandle,
  type ProjectExportFileHandle,
  type ProjectExportWritableFileStream,
} from "../../../src/ui/app/projectFolderExport";

describe("project folder export", () => {
  it("writes autos exports into a selected FRC project deploy autos folder", async () => {
    const root = new MemoryDirectory("RobotCode");
    root.mkdir("src/main/deploy/autos");

    await writeProjectFolder(exampleProjectFolder(), {
      directoryPicker: async () => root,
    });

    expect(root.fileText("src/main/deploy/autos/config.json")).toBe(
      '{"config":true}',
    );
    expect(root.fileText("src/main/deploy/autos/paths/One.json")).toBe(
      '{"path":true}',
    );
    expect(root.hasDirectory("autos")).toBe(false);
  });

  it("creates deploy autos when the selected FRC project has a deploy folder", async () => {
    const root = new MemoryDirectory("RobotCode");
    root.mkdir("src/main/deploy");

    const autosDirectory = await resolveAutosExportDirectory(root, "autos");

    expect(autosDirectory).toBe(root.dir("src/main/deploy/autos"));
    expect(root.hasDirectory("autos")).toBe(false);
  });

  it("uses the selected folder directly when it is already an autos folder", async () => {
    const autos = new MemoryDirectory("autos");

    await writeProjectFolder(exampleProjectFolder(), {
      directoryPicker: async () => autos,
    });

    expect(autos.fileText("config.json")).toBe('{"config":true}');
    expect(autos.fileText("paths/One.json")).toBe('{"path":true}');
  });

  it("falls back to creating autos under non-FRC folders", async () => {
    const root = new MemoryDirectory("Downloads");

    const autosDirectory = await resolveAutosExportDirectory(root, "autos");

    expect(autosDirectory).toBe(root.dir("autos"));
  });

  it("downloads one zip with the autos folder tree when directory writing is unavailable", async () => {
    const downloads: Array<{ blob: Blob; fileName: string }> = [];

    await writeProjectFolder(exampleProjectFolder(), {
      downloadFile: (blob, fileName) => downloads.push({ blob, fileName }),
    });

    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.fileName).toBe("autos.zip");
    expect(downloads[0]?.blob.type).toBe("application/zip");

    const entries = await readStoredZip(downloads[0]!.blob);
    expect([...entries.keys()].sort()).toEqual([
      "autos/config.json",
      "autos/paths/One.json",
    ]);
    expect(entries.get("autos/config.json")).toBe('{"config":true}');
    expect(entries.get("autos/paths/One.json")).toBe('{"path":true}');
  });
});

function exampleProjectFolder(): ProjectFolderExport {
  return {
    folderName: "autos",
    files: [
      {
        relativePath: "config.json",
        blob: new Blob(['{"config":true}'], { type: "application/json" }),
      },
      {
        relativePath: "paths/One.json",
        blob: new Blob(['{"path":true}'], { type: "application/json" }),
      },
    ],
  };
}

class MemoryDirectory implements ProjectExportDirectoryHandle {
  readonly directories = new Map<string, MemoryDirectory>();
  readonly files = new Map<string, MemoryFile>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<MemoryDirectory> {
    const directory = this.directories.get(name);
    if (directory) {
      return directory;
    }

    if (options.create) {
      return this.addDirectory(name);
    }

    throw new DOMException(`Directory not found: ${name}`, "NotFoundError");
  }

  async getFileHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<MemoryFile> {
    const file = this.files.get(name);
    if (file) {
      return file;
    }

    if (options.create) {
      const next = new MemoryFile();
      this.files.set(name, next);
      return next;
    }

    throw new DOMException(`File not found: ${name}`, "NotFoundError");
  }

  mkdir(path: string): MemoryDirectory {
    return this.mkdirSegments(path.split("/").filter(Boolean));
  }

  dir(path: string): MemoryDirectory | undefined {
    return this.dirSegments(path.split("/").filter(Boolean));
  }

  hasDirectory(path: string): boolean {
    return Boolean(this.dir(path));
  }

  fileText(path: string): string | undefined {
    const segments = path.split("/").filter(Boolean);
    const fileName = segments.at(-1);
    const directory = this.dir(segments.slice(0, -1).join("/"));

    return fileName ? directory?.files.get(fileName)?.text : undefined;
  }

  private addDirectory(name: string): MemoryDirectory {
    const existing = this.directories.get(name);
    if (existing) {
      return existing;
    }

    const next = new MemoryDirectory(name);
    this.directories.set(name, next);
    return next;
  }

  private mkdirSegments(segments: readonly string[]): MemoryDirectory {
    const [segment, ...remaining] = segments;
    if (!segment) {
      return this;
    }

    return this.addDirectory(segment).mkdirSegments(remaining);
  }

  private dirSegments(
    segments: readonly string[],
  ): MemoryDirectory | undefined {
    const [segment, ...remaining] = segments;
    if (!segment) {
      return this;
    }

    return this.directories.get(segment)?.dirSegments(remaining);
  }
}

class MemoryFile implements ProjectExportFileHandle {
  text = "";

  async createWritable(): Promise<ProjectExportWritableFileStream> {
    return {
      close: async () => {},
      write: async (data: Blob) => {
        this.text = await data.text();
      },
    };
  }
}

async function readStoredZip(blob: Blob): Promise<Map<string, string>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  let offset = 0;

  while (offset < bytes.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) {
      break;
    }

    expect(signature).toBe(0x04034b50);
    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraFieldLength = view.getUint16(offset + 28, true);
    expect(compressionMethod).toBe(0);
    expect(compressedSize).toBe(uncompressedSize);

    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const dataStart = fileNameEnd + extraFieldLength;
    const dataEnd = dataStart + compressedSize;
    const fileName = decoder.decode(bytes.subarray(fileNameStart, fileNameEnd));
    const fileText = decoder.decode(bytes.subarray(dataStart, dataEnd));
    entries.set(fileName, fileText);
    offset = dataEnd;
  }

  return entries;
}
