import type { UserDataAdapter, UserDataStorage } from "./adapters";
import {
  UnsupportedUserDataVersionError,
  cloneUserData,
  defaultUserData,
  isUserDataRecord,
  migrateUserData,
  type UserData,
} from "./model";

export interface UserDataServiceOptions {
  legacyStorage?: UserDataStorage;
}

export class UserDataService {
  private snapshot = cloneUserData(defaultUserData);
  private pendingWrite: Promise<void> = Promise.resolve();
  private initialized = false;
  private writable = true;

  constructor(
    private readonly adapter: UserDataAdapter,
    private readonly options: UserDataServiceOptions = {},
  ) {}

  async initialize(): Promise<UserData> {
    if (this.initialized) {
      return this.getSnapshot();
    }

    let persisted: unknown | null;
    try {
      persisted = await this.adapter.read();
    } catch {
      this.writable = false;
      this.initialized = true;
      return this.getSnapshot();
    }
    if (persisted !== null && !isUserDataRecord(persisted)) {
      this.writable = false;
      this.initialized = true;
      return this.getSnapshot();
    }

    try {
      this.snapshot = migrateUserData(persisted, this.options.legacyStorage);
    } catch (error) {
      if (!(error instanceof UnsupportedUserDataVersionError)) {
        throw error;
      }
      this.snapshot = cloneUserData(defaultUserData);
      this.writable = false;
      this.initialized = true;
      return this.getSnapshot();
    }

    this.initialized = true;
    this.queueWrite();
    await this.flush();
    return this.getSnapshot();
  }

  getSnapshot(): UserData {
    return cloneUserData(this.snapshot);
  }

  update(update: (current: UserData) => UserData): UserData {
    this.snapshot = migrateUserData(update(this.getSnapshot()));
    this.queueWrite();
    return this.getSnapshot();
  }

  async flush(): Promise<void> {
    await this.pendingWrite;
  }

  private queueWrite(): void {
    if (!this.writable) {
      return;
    }
    const queuedSnapshot = this.getSnapshot();
    this.pendingWrite = this.pendingWrite.then(
      () => this.tryWrite(queuedSnapshot),
      () => this.tryWrite(queuedSnapshot),
    );
  }

  private async tryWrite(snapshot: UserData): Promise<void> {
    try {
      await this.adapter.write(snapshot);
    } catch {
      // Keep the newer in-memory snapshot usable and allow subsequent writes.
    }
  }
}
