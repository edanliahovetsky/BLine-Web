import type { Page } from "@playwright/test";

type FieldDebugWindow = Window & {
  __blinePixiDebug?: {
    fieldState(): {
      id: string;
      label: string;
      kind: string;
      imageLoaded: boolean;
    };
  };
};

interface LegacyFieldSeed {
  assetId: string;
  projectId: string;
}

export async function activeFieldLabel(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      (window as FieldDebugWindow).__blinePixiDebug?.fieldState().label ?? null,
  );
}

export async function activeFieldImageLoaded(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as FieldDebugWindow).__blinePixiDebug?.fieldState().imageLoaded ??
      false,
  );
}

export function tinyPngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  );
}

export async function seedLegacyFieldProject(
  page: Page,
  bytes: readonly number[],
  includeAsset: boolean,
): Promise<LegacyFieldSeed> {
  const seeded = await page.evaluate(
    async ({ bytes, includeAsset }) => {
      const storageKey = Object.keys(window.localStorage).find((key) =>
        key.startsWith("bline-web:workspace:"),
      );
      if (!storageKey) {
        throw new Error("Expected a saved browser Project");
      }
      const record = JSON.parse(window.localStorage.getItem(storageKey) ?? "");
      const projectMetadata = JSON.parse(
        record.files.find(
          (file: { relativePath: string }) =>
            file.relativePath === "project.json",
        ).text,
      );
      const projectId = String(projectMetadata.project_id);
      const assetId = "legacy-practice.png";
      const fieldId = "custom:legacy-practice";
      const paths = projectMetadata.paths.map(
        (path: {
          path_id: string;
          display_name: string;
          file_name: string;
        }) => ({
          ...path,
          path: JSON.parse(
            record.files.find(
              (file: { relativePath: string }) =>
                file.relativePath === `paths/${path.file_name}`,
            ).text,
          ),
        }),
      );
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          document: {
            schema_version: 1,
            project_id: projectId,
            display_name: projectMetadata.display_name,
            config: {
              gui: {
                field: {
                  selected_field_id: fieldId,
                  custom_fields: [
                    {
                      id: fieldId,
                      name: "Legacy Practice Field",
                      asset_id: assetId,
                      file_name: assetId,
                      mime_type: "image/png",
                      size_bytes: bytes.length,
                      created_at: "2026-08-21T12:00:00.000Z",
                      geometry: {
                        length_meters: 8,
                        width_meters: 4,
                        coordinate_offset_meters: 0,
                      },
                    },
                  ],
                },
              },
            },
            paths,
            path_groups: projectMetadata.path_groups,
            ...(projectMetadata.linked_targets?.length
              ? { linked_targets: projectMetadata.linked_targets }
              : {}),
            active_path_id: paths[0]?.path_id ?? null,
            active_path_group_id: null,
          },
          version: record.version,
          updatedAt: record.updatedAt,
        }),
      );
      window.localStorage.removeItem("bline-web:user-data");
      if (includeAsset) {
        await putAsset(projectId, assetId, bytes);
      }
      return { assetId, projectId };

      async function putAsset(
        workspaceId: string,
        legacyAssetId: string,
        assetBytes: readonly number[],
      ): Promise<void> {
        const database = await openDatabase();
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction("field-assets", "readwrite");
          transaction.objectStore("field-assets").put({
            key: `${encodeURIComponent(workspaceId)}:${encodeURIComponent(legacyAssetId)}`,
            workspaceId,
            assetId: legacyAssetId,
            fileName: legacyAssetId,
            mimeType: "image/png",
            bytes: new Uint8Array(assetBytes).buffer,
            updatedAt: new Date().toISOString(),
          });
          transaction.addEventListener("complete", () => resolve());
          transaction.addEventListener("error", () =>
            reject(transaction.error),
          );
        });
        database.close();
      }

      function openDatabase(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open("bline-web-field-assets", 1);
          request.addEventListener("upgradeneeded", () => {
            request.result.createObjectStore("field-assets", {
              keyPath: "key",
            });
          });
          request.addEventListener("success", () => resolve(request.result));
          request.addEventListener("error", () => reject(request.error));
        });
      }
    },
    { bytes: [...bytes], includeAsset },
  );
  return seeded;
}

export async function putLegacyFieldAsset(
  page: Page,
  seed: LegacyFieldSeed,
  bytes: readonly number[],
): Promise<void> {
  await page.evaluate(
    async ({ assetId, projectId, bytes }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("bline-web-field-assets", 1);
        request.addEventListener("upgradeneeded", () => {
          request.result.createObjectStore("field-assets", { keyPath: "key" });
        });
        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () => reject(request.error));
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("field-assets", "readwrite");
        transaction.objectStore("field-assets").put({
          key: `${encodeURIComponent(projectId)}:${encodeURIComponent(assetId)}`,
          workspaceId: projectId,
          assetId,
          fileName: assetId,
          mimeType: "image/png",
          bytes: new Uint8Array(bytes).buffer,
          updatedAt: new Date().toISOString(),
        });
        transaction.addEventListener("complete", () => resolve());
        transaction.addEventListener("error", () => reject(transaction.error));
      });
      database.close();
    },
    { ...seed, bytes: [...bytes] },
  );
}
