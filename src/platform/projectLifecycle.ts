import type { Project } from "../core/model/project";
import {
  isProjectIoConflict,
  type CreateWorkspaceInput,
  type ProjectIoWorkspace,
  type ProjectIoWriteOutcome,
} from "./projectIo";

export interface ProjectRecoverySnapshot {
  project: Project | null;
  expectedVersion?: string;
  dirty?: boolean;
}

export interface AutosaveRecoveryJournal {
  ready?(): Promise<void>;
  read(): ProjectRecoverySnapshot | null;
  write(snapshot: ProjectRecoverySnapshot): void;
  clear(): void;
  recoverOutstanding?(
    recover: (snapshot: ProjectRecoverySnapshot) => Promise<void>,
  ): Promise<number>;
  releaseOwnership?(): void;
}

interface ProjectRecoveryIo {
  initialize(): Promise<ProjectIoWorkspace | null>;
  saveWorkspace(
    current: ProjectIoWorkspace,
    project: Project,
    expectedVersion?: string,
  ): Promise<ProjectIoWriteOutcome>;
  createWorkspace(
    input?: CreateWorkspaceInput,
    previous?: ProjectIoWorkspace,
  ): Promise<ProjectIoWorkspace>;
}

export interface ProjectRecoveryLifecycle {
  checkpoint(snapshot: ProjectRecoverySnapshot): boolean;
  protectSnapshot(snapshot: ProjectRecoverySnapshot): boolean;
  releaseSnapshotProtection(): void;
  completeInitialization(): void;
  markInitializationFailed(): void;
  clearIfReady(): void;
}

export interface DurableCloseTarget {
  onCloseRequested(
    handler: (event: { preventDefault(): void }) => void | Promise<void>,
  ): Promise<() => void>;
  destroy(): Promise<void>;
}

export interface ProjectCloseState {
  dirty: boolean;
  activeSave: unknown | null;
  blocked: boolean;
}

export interface DurableProjectCloseOptions {
  prepareClose?(): void;
  getProjectState(): ProjectCloseState;
  flushProject(): Promise<unknown>;
  flushUserData(): Promise<void>;
  onError?(error: unknown): void;
  timeoutMs?: number;
}

interface AutosaveRecoveryRecord {
  format: 2;
  ownerId: string;
  project: Project;
  expectedVersion?: string;
}

export interface BrowserRecoveryLockManager {
  request<T>(
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: { name: string } | null) => Promise<T> | T,
  ): Promise<T>;
}

export interface BrowserAutosaveRecoveryJournalOptions {
  lockManager?: BrowserRecoveryLockManager | null;
  ownerId?: string;
  sessionStorage?: Pick<Storage, "getItem" | "setItem">;
}

interface BrowserUnloadTarget {
  addEventListener(
    type: "beforeunload" | "pagehide",
    listener: EventListener,
  ): void;
  removeEventListener(
    type: "beforeunload" | "pagehide",
    listener: EventListener,
  ): void;
}

const browserRecoveryJournalKey = "bline.autosave-recovery.v1";
const browserRecoveryOwnerKey = "bline.autosave-recovery.owner.v1";
const browserRecoveryLockPrefix = "bline:autosave-recovery:";

export function createBrowserAutosaveRecoveryJournal(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> &
    Partial<Pick<Storage, "length" | "key">> = localStorage,
  options: BrowserAutosaveRecoveryJournalOptions = {},
): AutosaveRecoveryJournal {
  const ownerStorage = options.sessionStorage ?? browserSessionStorage();
  const canReplaceInheritedOwner = options.ownerId === undefined;
  let ownerId = options.ownerId ?? readOrCreateRecoveryOwnerId(ownerStorage);
  const lockManager =
    options.lockManager === undefined
      ? browserLockManager()
      : (options.lockManager ?? undefined);
  let entryKey = recoveryEntryKey(ownerId);
  let ownershipStarted = false;
  let ownershipReleased = false;
  let ownsEntry = false;
  let ownershipError: Error | null = null;
  let releaseLease: (() => void) | null = null;
  const leaseReleased = new Promise<void>((resolve) => {
    releaseLease = resolve;
  });
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ownershipReady = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A caller can inspect ownership later without creating an unhandled rejection
  // while the app is still constructing its startup pipeline.
  void ownershipReady.catch(() => undefined);

  const startOwnership = () => {
    if (ownershipStarted) {
      return;
    }
    ownershipStarted = true;
    if (ownershipReleased) {
      ownershipError = new AutosaveRecoveryOwnershipError(
        "Recovery-journal ownership was already released",
      );
      rejectReady(ownershipError);
      return;
    }
    if (!lockManager) {
      ownershipError = new AutosaveRecoveryOwnershipError(
        "The browser cannot establish an exclusive recovery-journal lease",
      );
      rejectReady(ownershipError);
      return;
    }
    const acquireOwnership = async (
      replaceLiveInheritedOwner: boolean,
    ): Promise<void> => {
      await lockManager.request(
        recoveryLockName(ownerId),
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) {
            if (replaceLiveInheritedOwner) {
              ownerId = createAndStoreRecoveryOwnerId(ownerStorage);
              entryKey = recoveryEntryKey(ownerId);
              await acquireOwnership(false);
              return;
            }
            ownershipError = new AutosaveRecoveryOwnershipError(
              "This recovery-journal owner is already active in another tab",
            );
            rejectReady(ownershipError);
            return;
          }
          if (ownershipReleased) {
            return;
          }
          ownsEntry = true;
          resolveReady();
          await leaseReleased;
          ownsEntry = false;
        },
      );
    };
    void acquireOwnership(canReplaceInheritedOwner).catch((error: unknown) => {
      if (ownsEntry) {
        ownsEntry = false;
      }
      if (!ownershipError) {
        ownershipError = new AutosaveRecoveryOwnershipError(
          "The recovery-journal lease failed",
          error,
        );
        rejectReady(ownershipError);
      }
    });
  };

  const assertOwnership = () => {
    startOwnership();
    if (!ownsEntry) {
      throw (
        ownershipError ??
        new AutosaveRecoveryOwnershipError(
          "Recovery-journal ownership is not established yet",
        )
      );
    }
  };

  return {
    ready() {
      startOwnership();
      return ownershipReady;
    },
    read() {
      assertOwnership();
      return readRecoveryEntry(storage, entryKey, ownerId);
    },
    write(snapshot) {
      assertOwnership();
      if (!snapshot.project || snapshot.dirty === false) {
        return;
      }
      storage.setItem(
        entryKey,
        JSON.stringify({
          format: 2,
          ownerId,
          project: snapshot.project,
          expectedVersion: snapshot.expectedVersion,
        } satisfies AutosaveRecoveryRecord),
      );
    },
    clear() {
      assertOwnership();
      storage.removeItem(entryKey);
    },
    async recoverOutstanding(recover) {
      startOwnership();
      await ownershipReady;
      const entries = recoveryEntryOwners(storage);
      let recovered = 0;
      for (const candidateOwnerId of entries) {
        if (candidateOwnerId === ownerId) {
          const snapshot = readRecoveryEntry(
            storage,
            recoveryEntryKey(candidateOwnerId),
            candidateOwnerId,
          );
          if (snapshot) {
            await recover(snapshot);
            storage.removeItem(recoveryEntryKey(candidateOwnerId));
            recovered += 1;
          }
          continue;
        }
        if (!lockManager) {
          throw new AutosaveRecoveryOwnershipError(
            "The browser cannot verify recovery-journal ownership",
          );
        }
        recovered += await lockManager.request(
          recoveryLockName(candidateOwnerId),
          { mode: "exclusive", ifAvailable: true },
          async (lock) => {
            if (!lock) {
              return 0;
            }
            const candidateKey = recoveryEntryKey(candidateOwnerId);
            const snapshot = readRecoveryEntry(
              storage,
              candidateKey,
              candidateOwnerId,
            );
            if (!snapshot) {
              return 0;
            }
            await recover(snapshot);
            storage.removeItem(candidateKey);
            return 1;
          },
        );
      }
      return recovered;
    },
    releaseOwnership() {
      ownershipReleased = true;
      if (ownershipStarted && !ownsEntry && !ownershipError) {
        ownershipError = new AutosaveRecoveryOwnershipError(
          "Recovery-journal ownership was released before it was established",
        );
        rejectReady(ownershipError);
      }
      releaseLease?.();
      releaseLease = null;
    },
  };
}

export class AutosaveRecoveryOwnershipError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AutosaveRecoveryOwnershipError";
  }
}

export function createProjectRecoveryLifecycle(
  journal: AutosaveRecoveryJournal | null,
): ProjectRecoveryLifecycle {
  let initialized = false;
  let initializationFailed = false;
  let protectedSnapshots = 0;

  const checkpoint = (snapshot: ProjectRecoverySnapshot) => {
    if (!journal || !snapshot.project || snapshot.dirty === false) {
      return !journal || snapshot.dirty === false;
    }
    try {
      journal.write(snapshot);
      return true;
    } catch {
      return false;
    }
  };

  return {
    checkpoint,
    protectSnapshot(snapshot) {
      if (!checkpoint(snapshot)) {
        return false;
      }
      protectedSnapshots += 1;
      return true;
    },
    releaseSnapshotProtection() {
      protectedSnapshots = Math.max(0, protectedSnapshots - 1);
    },
    completeInitialization() {
      initialized = true;
      initializationFailed = false;
    },
    markInitializationFailed() {
      initialized = true;
      initializationFailed = true;
    },
    clearIfReady() {
      if (
        !journal ||
        !initialized ||
        initializationFailed ||
        protectedSnapshots > 0
      ) {
        return;
      }
      try {
        journal.clear();
      } catch {
        // A durable Project remains authoritative if stale recovery cannot clear.
      }
    },
  };
}

export async function restoreAutosaveRecoveryJournal(
  io: ProjectRecoveryIo,
  journal: AutosaveRecoveryJournal,
): Promise<boolean> {
  let workspace = await io.initialize();
  await journal.ready?.();
  const recover = async (snapshot: ProjectRecoverySnapshot) => {
    workspace = await restoreAutosaveRecoverySnapshot(io, workspace, snapshot);
  };
  if (journal.recoverOutstanding) {
    return (await journal.recoverOutstanding(recover)) > 0;
  }
  const snapshot = journal.read();
  if (!snapshot?.project) {
    return false;
  }

  await recover(snapshot);
  journal.clear();
  return true;
}

async function restoreAutosaveRecoverySnapshot(
  io: ProjectRecoveryIo,
  workspace: ProjectIoWorkspace | null,
  snapshot: ProjectRecoverySnapshot,
): Promise<ProjectIoWorkspace | null> {
  if (!snapshot.project) {
    return workspace;
  }

  if (workspace?.project.project_id === snapshot.project.project_id) {
    try {
      return (
        await io.saveWorkspace(
          workspace,
          snapshot.project,
          snapshot.expectedVersion,
        )
      ).workspace;
    } catch (error) {
      if (!isProjectIoConflict(error)) {
        throw error;
      }
    }
  }

  const recoveredProject = {
    ...snapshot.project,
    project_id: `${snapshot.project.project_id}-recovered-${crypto.randomUUID()}`,
    display_name: `${snapshot.project.display_name} (Recovered)`,
  };
  return io.createWorkspace(
    { project: recoveredProject },
    workspace ?? undefined,
  );
}

function readRecoveryEntry(
  storage: Pick<Storage, "getItem" | "removeItem">,
  key: string,
  ownerId: string,
): ProjectRecoverySnapshot | null {
  const raw = storage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    const record = JSON.parse(raw) as Partial<AutosaveRecoveryRecord>;
    if (
      record.format !== 2 ||
      record.ownerId !== ownerId ||
      !record.project ||
      typeof record.project !== "object" ||
      typeof record.project.project_id !== "string"
    ) {
      throw new Error("Invalid autosave recovery journal");
    }
    return {
      project: record.project,
      expectedVersion: record.expectedVersion,
      dirty: true,
    };
  } catch {
    storage.removeItem(key);
    return null;
  }
}

function recoveryEntryOwners(
  storage: Partial<Pick<Storage, "length" | "key">>,
): string[] {
  if (typeof storage.length !== "number" || typeof storage.key !== "function") {
    throw new AutosaveRecoveryOwnershipError(
      "Recovery storage cannot enumerate outstanding journal entries",
    );
  }
  const owners: string[] = [];
  const prefix = `${browserRecoveryJournalKey}:`;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) {
      owners.push(decodeURIComponent(key.slice(prefix.length)));
    }
  }
  return owners;
}

function recoveryEntryKey(ownerId: string): string {
  return `${browserRecoveryJournalKey}:${encodeURIComponent(ownerId)}`;
}

function recoveryLockName(ownerId: string): string {
  return `${browserRecoveryLockPrefix}${ownerId}`;
}

function browserLockManager(): BrowserRecoveryLockManager | undefined {
  if (typeof navigator === "undefined" || !navigator.locks) {
    return undefined;
  }
  return navigator.locks as unknown as BrowserRecoveryLockManager;
}

function browserSessionStorage():
  | Pick<Storage, "getItem" | "setItem">
  | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

function readOrCreateRecoveryOwnerId(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
): string {
  try {
    const existing = storage?.getItem(browserRecoveryOwnerKey);
    if (existing) {
      return existing;
    }
  } catch {
    // A fresh ID still permits recovery; it just cannot be reused on reload.
  }
  return createAndStoreRecoveryOwnerId(storage);
}

function createAndStoreRecoveryOwnerId(
  storage: Pick<Storage, "setItem"> | undefined,
): string {
  const ownerId = globalThis.crypto.randomUUID();
  try {
    storage?.setItem(browserRecoveryOwnerKey, ownerId);
  } catch {
    // The per-entry Web Lock remains the source of ownership truth.
  }
  return ownerId;
}

export function installBrowserProjectUnloadHandler(
  target: BrowserUnloadTarget,
  options: {
    prepareClose?(): void;
    checkpoint(): boolean;
  },
): () => void {
  const checkpoint = () => {
    options.prepareClose?.();
    options.checkpoint();
  };
  const checkpointBeforeUnload = (event: Event) => {
    options.prepareClose?.();
    if (!options.checkpoint()) {
      event.preventDefault();
      (event as BeforeUnloadEvent).returnValue = "";
    }
  };
  target.addEventListener("beforeunload", checkpointBeforeUnload);
  target.addEventListener("pagehide", checkpoint);
  return () => {
    target.removeEventListener("beforeunload", checkpointBeforeUnload);
    target.removeEventListener("pagehide", checkpoint);
  };
}

export function installDurableProjectCloseHandler(
  target: DurableCloseTarget,
  options: DurableProjectCloseOptions,
): Promise<() => void> {
  let closing = false;
  return target.onCloseRequested(async (event) => {
    event.preventDefault();
    if (closing) {
      return;
    }
    closing = true;
    try {
      options.prepareClose?.();
      await withTimeout(
        Promise.all([drainProject(options), options.flushUserData()]),
        options.timeoutMs ?? 5_000,
      );
      const state = options.getProjectState();
      if (state.blocked || state.dirty || state.activeSave) {
        throw new Error("Project persistence is not safe to close");
      }
      await target.destroy();
    } catch (error) {
      options.onError?.(error);
      closing = false;
    }
  });
}

async function drainProject(
  options: DurableProjectCloseOptions,
): Promise<void> {
  while (true) {
    const state = options.getProjectState();
    if (state.blocked) {
      throw new Error("Project persistence is blocked");
    }
    if (!state.dirty && !state.activeSave) {
      return;
    }
    await options.flushProject();
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Close-time persistence timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
