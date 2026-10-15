import { describe, expect, it } from "vitest";
import type { ProjectFolderExport } from "../../../src/platform/projectIo";
import {
  exportToRobot,
  practiceRobotFolderMemory,
  robotExportMode,
  type RememberedRobotFolder,
  type RobotFolderHandle,
  type RobotFolderMemory,
} from "../../../src/ui/app/robotExport";

class Folder implements RobotFolderHandle {
  readonly folders = new Map<string, Folder>();
  readonly files = new Map<string, string>();
  queryPermission?: () => Promise<PermissionState>;
  requestPermission?: () => Promise<PermissionState>;

  constructor(
    readonly name: string,
    permission: PermissionState | null = null,
  ) {
    if (permission) {
      this.queryPermission = async () => permission;
      this.requestPermission = async () => permission;
    }
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    let folder = this.folders.get(name);
    if (!folder && options.create) {
      folder = new Folder(name);
      this.folders.set(name, folder);
    }
    if (!folder) throw new DOMException(name, "NotFoundError");
    return folder;
  }

  async getFileHandle(name: string) {
    return {
      createWritable: async () => ({
        write: async (data: Blob) => {
          this.files.set(name, await data.text());
        },
        close: async () => {},
      }),
    };
  }

  at(path: string): Folder | undefined {
    return path
      .split("/")
      .reduce<
        Folder | undefined
      >((folder, name) => folder?.folders.get(name), this);
  }
}

function robotProject(permission: PermissionState | null = null): Folder {
  const root = new Folder("RobotCode", permission);
  const deploy = ["src", "main", "deploy"].reduce((folder, name) => {
    const next = new Folder(name);
    folder.folders.set(name, next);
    return next;
  }, root);
  void deploy;
  return root;
}

function memoryWith(folder: RememberedRobotFolder | null = null) {
  const memory: RobotFolderMemory & { value: RememberedRobotFolder | null } = {
    value: folder,
    recall: async () => memory.value,
    remember: async (next) => {
      memory.value = next;
    },
    forget: async () => {
      memory.value = null;
    },
  };
  return memory;
}

const autos: ProjectFolderExport = {
  folderName: "autos",
  files: [
    { relativePath: "config.json", blob: new Blob(["{}"]) },
    { relativePath: "paths/One.json", blob: new Blob(['{"one":1}']) },
    { relativePath: "paths/Two.json", blob: new Blob(['{"two":2}']) },
  ],
};

describe("export to robot", () => {
  it("writes into src/main/deploy/autos and remembers the robot project", async () => {
    const robot = robotProject();
    const memory = memoryWith();
    let picks = 0;
    const result = await exportToRobot(autos, {
      memory,
      directoryPicker: async () => {
        picks += 1;
        return robot;
      },
    });

    expect(result).toEqual({
      mode: "folder",
      pathSegments: ["RobotCode", "src", "main", "deploy", "autos"],
      robotProject: true,
      pathCount: 2,
    });
    expect(robot.at("src/main/deploy/autos/paths")?.files.get("One.json")).toBe(
      '{"one":1}',
    );
    expect(memory.value?.handle).toBe(robot);

    // A remembered folder with permission skips the picker.
    await exportToRobot(autos, {
      memory,
      directoryPicker: async () => {
        picks += 1;
        return robot;
      },
    });
    expect(picks).toBe(1);
  });

  it("never reads or replaces the remembered robot project during a lesson", async () => {
    const robot = robotProject("granted");
    const spare = new Folder("Spare");
    const remembered = {
      handle: robot,
      pathSegments: ["RobotCode", "src", "main", "deploy", "autos"],
      robotProject: true,
    };
    const memory = memoryWith(remembered);
    await exportToRobot(autos, {
      chooseFolder: true,
      memory: practiceRobotFolderMemory,
      directoryPicker: async () => spare,
    });
    expect(robot.at("src/main/deploy/autos")).toBeUndefined();
    expect(spare.at("autos/paths")?.files.size).toBe(2);
    expect(await practiceRobotFolderMemory.recall()).toBeNull();
    expect(memory.value).toBe(remembered);
  });

  it("asks for a folder again when told to or when permission is refused", async () => {
    const refused = robotProject("denied");
    const fresh = robotProject();
    const memory = memoryWith({
      handle: refused,
      pathSegments: ["RobotCode", "src", "main", "deploy", "autos"],
      robotProject: true,
    });
    await exportToRobot(autos, {
      memory,
      directoryPicker: async () => fresh,
    });
    expect(refused.at("src/main/deploy/autos")).toBeUndefined();
    expect(fresh.at("src/main/deploy/autos/paths")?.files.size).toBe(2);
    expect(memory.value?.handle).toBe(fresh);

    const other = new Folder("Downloads");
    const result = await exportToRobot(autos, {
      memory,
      chooseFolder: true,
      directoryPicker: async () => other,
    });
    expect(result).toMatchObject({
      pathSegments: ["Downloads", "autos"],
      robotProject: false,
    });
  });

  it("downloads autos.zip when the browser cannot write folders", async () => {
    const downloads: string[] = [];
    const result = await exportToRobot(autos, {
      memory: memoryWith(),
      downloadFile: (_blob, name) => downloads.push(name),
    });
    expect(result).toEqual({
      mode: "zip",
      fileName: "autos.zip",
      pathCount: 2,
    });
    expect(downloads).toEqual(["autos.zip"]);
  });

  it("detects folder access", () => {
    expect(robotExportMode(undefined)).toBe("zip");
    expect(
      robotExportMode({
        showDirectoryPicker: async () => new Folder("x"),
      } as unknown as Window),
    ).toBe("folder");
  });
});
