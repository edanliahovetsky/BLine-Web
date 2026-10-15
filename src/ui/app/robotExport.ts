import type { ProjectFolderExport } from "../../platform/projectIo";
import { downloadBlob } from "../../platform/fileExport";
import {
  createProjectFolderZip,
  resolveAutosExportTarget,
  safeFileName,
  writeProjectFolderFiles,
  type ProjectExportDirectoryHandle,
  type ProjectExportWindow,
} from "./projectFolderExport";

/**
 * Export to robot: writes the project's autos folder into the robot code at
 * src/main/deploy/autos. Browsers with folder access remember the robot
 * project between exports; the rest download autos.zip for the user to unzip
 * into src/main/deploy.
 */

export type RobotExportMode = "folder" | "zip";

export interface RobotFolderHandle extends ProjectExportDirectoryHandle {
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: {
    mode: "readwrite";
  }): Promise<PermissionState>;
}

export interface RememberedRobotFolder {
  handle: RobotFolderHandle;
  /** Folder names from the chosen folder down to its autos folder. */
  pathSegments: string[];
  robotProject: boolean;
}

export interface RobotFolderMemory {
  recall(): Promise<RememberedRobotFolder | null>;
  remember(folder: RememberedRobotFolder): Promise<void>;
  forget(): Promise<void>;
}

/**
 * A lesson's practice export always asks for a folder and never reads or
 * replaces the remembered robot project, so practice files cannot overwrite
 * a team's real autos.
 */
export const practiceRobotFolderMemory: RobotFolderMemory = {
  async recall() {
    return null;
  },
  async remember() {},
  async forget() {},
};

export type RobotExportResult =
  | {
      mode: "folder";
      pathSegments: string[];
      robotProject: boolean;
      pathCount: number;
    }
  | { mode: "zip"; fileName: string; pathCount: number };

type DirectoryPicker = (options: {
  mode: "readwrite";
  id?: string;
}) => Promise<RobotFolderHandle>;

export const robotDeployAutosPath = "src/main/deploy/autos";

export function robotExportMode(
  browserWindow: ProjectExportWindow | undefined = typeof window === "undefined"
    ? undefined
    : (window as ProjectExportWindow),
): RobotExportMode {
  return browserWindow?.showDirectoryPicker ? "folder" : "zip";
}

export async function exportToRobot(
  projectFolder: ProjectFolderExport,
  {
    chooseFolder = false,
    memory = browserRobotFolderMemory,
    directoryPicker,
    downloadFile = downloadBlob,
  }: {
    /** Ask for a robot project even when one is remembered. */
    chooseFolder?: boolean;
    memory?: RobotFolderMemory;
    directoryPicker?: DirectoryPicker;
    downloadFile?: (blob: Blob, fileName: string) => void;
  } = {},
): Promise<RobotExportResult> {
  const pathCount = projectFolder.files.filter((file) =>
    /^paths\/[^/]+\.json$/i.test(file.relativePath),
  ).length;
  const browserWindow =
    typeof window === "undefined" ? undefined : (window as ProjectExportWindow);
  const picker =
    directoryPicker ??
    (browserWindow?.showDirectoryPicker
      ? (browserWindow.showDirectoryPicker.bind(
          browserWindow,
        ) as unknown as DirectoryPicker)
      : undefined);

  if (!picker) {
    const fileName = `${safeFileName(projectFolder.folderName)}.zip`;
    downloadFile(await createProjectFolderZip(projectFolder), fileName);
    return { mode: "zip", fileName, pathCount };
  }

  const remembered = chooseFolder ? null : await memory.recall();
  const handle =
    remembered && (await canWrite(remembered.handle))
      ? remembered.handle
      : await picker({ mode: "readwrite", id: "bline-robot-project" });
  const target = await resolveAutosExportTarget(
    handle,
    projectFolder.folderName,
  );
  await writeProjectFolderFiles(target.directory, projectFolder);
  await memory.remember({
    handle,
    pathSegments: target.pathSegments,
    robotProject: target.robotProject,
  });
  return {
    mode: "folder",
    pathSegments: target.pathSegments,
    robotProject: target.robotProject,
    pathCount,
  };
}

/** A remembered folder needs the user's permission again in a new session. */
async function canWrite(handle: RobotFolderHandle): Promise<boolean> {
  try {
    const descriptor = { mode: "readwrite" } as const;
    if ((await handle.queryPermission?.(descriptor)) === "granted") return true;
    if (!handle.requestPermission) return !handle.queryPermission;
    return (await handle.requestPermission(descriptor)) === "granted";
  } catch {
    return false;
  }
}

const memoryDbName = "bline-robot-export";
const memoryStoreName = "folders";
const memoryKey = "robot-project";

function openMemoryDb(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(memoryDbName, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(memoryStoreName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withMemoryStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  try {
    const db = await openMemoryDb();
    if (!db) return null;
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = run(
          db.transaction(memoryStoreName, mode).objectStore(memoryStoreName),
        );
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Private windows and blocked storage just mean asking again next time.
    return null;
  }
}

/** Folder handles survive reloads only in IndexedDB, not localStorage. */
export const browserRobotFolderMemory: RobotFolderMemory = {
  async recall() {
    const value = await withMemoryStore<RememberedRobotFolder | undefined>(
      "readonly",
      (store) => store.get(memoryKey),
    );
    return value?.handle ? value : null;
  },
  async remember(folder) {
    await withMemoryStore("readwrite", (store) => store.put(folder, memoryKey));
  },
  async forget() {
    await withMemoryStore("readwrite", (store) => store.delete(memoryKey));
  },
};
