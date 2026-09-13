import { describe, expect, it } from "vitest";
import {
  createProjectIoService,
  isProjectIoConflict,
} from "../../../src/platform/projectIo";
import { browserWebCapabilities } from "../../../src/env/capabilities";
import { createBLineProjectArchive } from "../../../src/core/io/blineProject";
import { MemoryStorage } from "../support/browserStorageFakes";
import {
  exampleWorkspace,
  projectArchiveFile,
} from "../support/projectIoFixtures";

function setup() {
  const memory = new MemoryStorage();
  return {
    memory,
    io: createProjectIoService(browserWebCapabilities, {
      browser: { storage: memory },
    }),
  };
}

describe("user file import validation", () => {
  it("imports two identity-less archives independently without overwriting earlier work", async () => {
    const { io } = setup();
    const existing = await io.createWorkspace({
      project: exampleWorkspace("imported-project", "Existing", ["Keep this"]),
    });
    const makeLegacy = (id: string, name: string) => {
      const archive = createBLineProjectArchive(
        exampleWorkspace(id, name, [name]),
        "2026-09-13T00:00:00Z",
      ) as unknown as Record<string, unknown>;
      delete archive.project_id;
      delete archive.display_name;
      return projectArchiveFile(archive);
    };
    const first = await io.importProjectArchive(
      existing,
      makeLegacy("first", "First path"),
    );
    const second = await io.importProjectArchive(
      first.workspace,
      makeLegacy("second", "Second path"),
    );
    expect(
      new Set([
        existing.project.project_id,
        first.project.project_id,
        second.project.project_id,
      ]).size,
    ).toBe(3);
    expect(
      (await io.reloadWorkspace(first.workspace.handle))?.project.paths[0]
        .display_name,
    ).toBe("First path");
    expect(
      (await io.reloadWorkspace(second.workspace.handle))?.project.paths[0]
        .display_name,
    ).toBe("Second path");
    expect(
      (await io.reloadWorkspace(existing.handle))?.project.paths[0]
        .display_name,
    ).toBe("Keep this");
  });

  it("preserves exported identity and rejects a duplicate without offering disk-conflict recovery", async () => {
    const { io } = setup();
    const source = exampleWorkspace("real-project-id", "Competition", [
      "Score",
    ]);
    const file = projectArchiveFile(
      createBLineProjectArchive(source, "2026-09-13T00:00:00Z"),
    );
    const first = await io.importProjectArchive(null, file);
    expect(first.project).toMatchObject({
      project_id: "real-project-id",
      display_name: "Competition",
    });
    const before = await io.peekWorkspace(first.workspace.handle);
    const error = await io
      .importProjectArchive(first.workspace, file)
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/already saved/);
    expect(isProjectIoConflict(error)).toBe(false);
    expect(await io.peekWorkspace(first.workspace.handle)).toEqual(before);
    expect(await io.listWorkspaces()).toHaveLength(1);
  });

  it("retains explicit IDs in supported legacy workspace archives", async () => {
    const { io } = setup();
    const input = {
      schema_version: 1,
      project_id: "legacy-id",
      display_name: "Legacy",
      config: {},
      paths: [],
      active_path_id: null,
    };
    const result = await io.importProjectArchive(
      null,
      projectArchiveFile(input),
    );
    expect(result.project.project_id).toBe("legacy-id");
  });

  it.each(
    [
      { unexpected: "not a path" },
      {},
      null,
      42,
      { path_elements: null },
      { path: { unexpected: true } },
      [{ unrelated: true }],
    ].map((input) => ({ input })),
  )(
    "rejects unrelated JSON without modifying the saved project: $input",
    async ({ input }) => {
      const { io } = setup();
      const current = await io.createWorkspace({
        project: exampleWorkspace("kept", "Kept", ["Original"]),
      });
      const before = await io.peekWorkspace(current.handle);
      const beforeInput = structuredClone(current.project);
      await expect(
        io.importPath(current.project, projectArchiveFile(input)),
      ).rejects.toThrow(/BLine path/);
      expect(await io.peekWorkspace(current.handle)).toEqual(before);
      expect(current.project).toEqual(beforeInput);
    },
  );

  it.each(
    [
      [],
      { path_elements: [] },
      { path: { path_elements: [] }, config: {} },
      { path: [] },
    ].map((input) => ({ input })),
  )("accepts an intentional empty path: $input", async ({ input }) => {
    const { io } = setup();
    const current = await io.createWorkspace({
      project: exampleWorkspace("kept", "Kept", ["Original"]),
    });
    const next = await io.importPath(
      current.project,
      projectArchiveFile(input),
    );
    expect(next.paths).toHaveLength(2);
    expect(next.paths.at(-1)?.path.path_elements).toHaveLength(0);
  });
});
