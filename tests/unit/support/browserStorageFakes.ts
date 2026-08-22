import type {
  BrowserProjectMutationLock,
  StorageLike,
} from "../../../src/storage";

export class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

export class FailOnceWorkspaceWriteStorage extends MemoryStorage {
  private failedWorkspaceId: string | null = null;

  failNextWorkspaceWrite(id: string): void {
    this.failedWorkspaceId = id;
  }

  override setItem(key: string, value: string): void {
    if (
      this.failedWorkspaceId &&
      key ===
        `bline-web:workspace:${encodeURIComponent(this.failedWorkspaceId)}`
    ) {
      this.failedWorkspaceId = null;
      throw new Error("browser Project write failed");
    }
    super.setItem(key, value);
  }
}

export class ObservedSerialProjectMutationLock implements BrowserProjectMutationLock {
  private tail: Promise<void> = Promise.resolve();
  private requestCount = 0;
  private readonly requestWaiters = new Map<number, () => void>();
  concurrentOwners = 0;
  maximumConcurrentOwners = 0;

  request<T>(_name: string, callback: () => Promise<T> | T): Promise<T> {
    this.requestCount += 1;
    this.requestWaiters.get(this.requestCount)?.();
    this.requestWaiters.delete(this.requestCount);
    const run = this.tail.then(async () => {
      this.concurrentOwners += 1;
      this.maximumConcurrentOwners = Math.max(
        this.maximumConcurrentOwners,
        this.concurrentOwners,
      );
      try {
        return await callback();
      } finally {
        this.concurrentOwners -= 1;
      }
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  waitForRequestCount(count: number): Promise<void> {
    if (this.requestCount >= count) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.requestWaiters.set(count, resolve);
    });
  }
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
