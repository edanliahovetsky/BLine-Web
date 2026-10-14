import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  deserializeBLineProjectFolder,
  serializeBLineProjectFolder,
} from "../../../src/core/io/projectFolder";
import {
  calculateCrc32,
  createProjectFolderZip,
} from "../../../src/ui/app/projectFolderExport";
import {
  filesFromAutosZip,
  isZipFile,
  readZipEntries,
} from "../../../src/ui/app/projectFolderZip";
import { createSampleProject } from "../../../src/ui/app/initialProject";

const decoder = new TextDecoder();

function text(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** A minimal zip writer for entries BLine does not write itself. */
function zipOf(
  entries: Array<{ path: string; content: string; deflate?: boolean }>,
  options: { corruptCrc?: boolean } = {},
): Blob {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = encoder.encode(entry.content);
    const data = entry.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const name = encoder.encode(entry.path);
    const crc = (calculateCrc32(raw) ^ (options.corruptCrc ? 1 : 0)) >>> 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, entry.deflate ? 8 : 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.byteLength, true);
    local.setUint32(22, raw.byteLength, true);
    local.setUint16(26, name.byteLength, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, entry.deflate ? 8 : 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.byteLength, true);
    central.setUint32(24, raw.byteLength, true);
    central.setUint16(28, name.byteLength, true);
    central.setUint32(42, offset, true);
    locals.push(new Uint8Array(local.buffer), name, data);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.byteLength + data.byteLength;
  }
  const directorySize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob(
    [...locals, ...centrals, new Uint8Array(end.buffer)].map(
      (part) => part.slice().buffer,
    ),
  );
}

describe("autos zip import", () => {
  it("reads back the autos.zip BLine downloads", async () => {
    const project = createSampleProject();
    const folder = serializeBLineProjectFolder(project);
    const entries = await readZipEntries(await createProjectFolderZip(folder));
    expect(entries.map((entry) => entry.path).sort()).toEqual(
      folder.files.map((file) => `autos/${file.relativePath}`).sort(),
    );
    const config = entries.find((entry) => entry.path === "autos/config.json");
    expect(text(config!.bytes)).toBe(
      await folder.files
        .find((file) => file.relativePath === "config.json")!
        .blob.text(),
    );
  });

  it("imports a downloaded autos.zip like the autos folder itself", async () => {
    const project = createSampleProject();
    const zip = new File(
      [await createProjectFolderZip(serializeBLineProjectFolder(project))],
      "autos.zip",
      { type: "application/zip" },
    );
    const files = await filesFromAutosZip(zip);
    expect(files.map((file) => file.webkitRelativePath)).toContain(
      "autos.zip/autos/config.json",
    );
    const imported = await deserializeBLineProjectFolder(files);
    expect(imported.paths.map((path) => path.file_name)).toEqual(
      project.paths.map((path) => path.file_name),
    );
  });

  it("reads deflated entries and skips folders and macOS metadata", async () => {
    const zip = new File(
      [
        zipOf([
          { path: "autos/", content: "" },
          { path: "autos/config.json", content: '{"a":1}', deflate: true },
          { path: "autos/paths/One.json", content: '{"b":2}' },
          { path: "__MACOSX/autos/._config.json", content: "junk" },
          { path: "autos/.DS_Store", content: "junk" },
        ]),
      ],
      "Robot autos.zip",
    );
    const files = await filesFromAutosZip(zip);
    expect(files.map((file) => file.webkitRelativePath)).toEqual([
      "Robot autos.zip/autos/config.json",
      "Robot autos.zip/autos/paths/One.json",
    ]);
    expect(await files[0]!.text()).toBe('{"a":1}');
    expect(files[1]!.name).toBe("One.json");
  });

  it("explains files that are not usable zips", async () => {
    await expect(
      readZipEntries(new Blob(["not a zip at all, just text"])),
    ).rejects.toThrow("isn't a ZIP archive");
    await expect(
      readZipEntries(
        zipOf([{ path: "autos/config.json", content: "{}" }], {
          corruptCrc: true,
        }),
      ),
    ).rejects.toThrow("damaged");
    await expect(
      filesFromAutosZip(new File([zipOf([])], "empty.zip")),
    ).rejects.toThrow("empty");
  });

  it("recognizes zip files by name or type", () => {
    expect(isZipFile({ name: "autos.zip", type: "" })).toBe(true);
    expect(isZipFile({ name: "autos", type: "application/zip" })).toBe(true);
    expect(isZipFile({ name: "config.json", type: "application/json" })).toBe(
      false,
    );
  });
});
