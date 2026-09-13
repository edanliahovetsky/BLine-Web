import type { Worker } from "@playwright/test";

// Observe the real requests passed to Cache.match. Page JavaScript cannot
// reproduce their Origin headers by constructing synthetic Requests.
export async function recordCacheLookups(worker: Worker) {
  await worker.evaluate(() => {
    const state = globalThis as typeof globalThis & { cacheLookups: unknown[] };
    state.cacheLookups = [];
    const match = Cache.prototype.match;
    Cache.prototype.match = async function (request, options) {
      const response = await match.call(this, request, options);
      if (
        request instanceof Request &&
        /\.(js|css)$/.test(new URL(request.url).pathname)
      ) {
        const stored = (await this.keys()).find(
          (key) => key.url === request.url,
        );
        if (stored)
          state.cacheLookups.push({
            url: request.url,
            requestOrigin: request.headers.get("Origin"),
            storedOrigin: stored.headers.get("Origin"),
            vary: (await match.call(this, stored))?.headers.get("Vary"),
            selectedMatch: !!response,
            normalMatch: !!(await match.call(this, request, {
              ...options,
              ignoreVary: false,
            })),
            ignoreVaryMatch: !!(await match.call(this, request, {
              ignoreVary: true,
            })),
          });
      }
      return response;
    };
  });
  return () =>
    worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { cacheLookups: unknown[] })
          .cacheLookups,
    );
}
