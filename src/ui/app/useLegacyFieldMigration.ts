import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FieldBackgroundEntry } from "../../core/field/fieldConfig";
import type { Project } from "../../core/model/project";
import type { ProjectIoService } from "../../platform/projectIo";
import { projectStore } from "../../state/projectStore";
import {
  listFieldBackgrounds,
  migrateProjectViewIdentity,
  selectedFieldBackgroundForProject,
} from "../../userData";
import { migrateLegacyProjectFieldBackgrounds } from "../../userData/legacyFieldMigration";

export type LegacyFieldMigrationPhase = "running" | "failed" | null;

interface UseLegacyFieldMigrationOptions {
  project: Project | null;
  projectIo: ProjectIoService | null;
  projectSessionId: string | null;
  defaultFieldId: string;
  onFieldBackgroundsChange(fields: FieldBackgroundEntry[]): void;
  onFieldSelectionChange(selection: {
    projectId: string;
    fieldId: string;
  }): void;
}

interface MigrationAttempt {
  key: string;
  phase: Exclude<LegacyFieldMigrationPhase, null>;
}

export function useLegacyFieldMigration({
  project,
  projectIo,
  projectSessionId,
  defaultFieldId,
  onFieldBackgroundsChange,
  onFieldSelectionChange,
}: UseLegacyFieldMigrationOptions): {
  phase: LegacyFieldMigrationPhase;
  retry(): void;
} {
  const [attempt, setAttempt] = useState<MigrationAttempt | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const attemptedKeysRef = useRef(new Set<string>());
  const migrationKey = useMemo(
    () =>
      project && projectSessionId
        ? JSON.stringify({
            projectSessionId,
            projectId: project.project_id,
            field: project.config.gui.field,
          })
        : null,
    [project, projectSessionId],
  );

  useEffect(() => {
    const migrationProject = projectStore.getState().project;
    if (!migrationProject || !projectSessionId) {
      return;
    }

    const projectId = migrationProject.project_id;
    const migrationSessionId = projectSessionId;
    const migration = projectStore.getState().legacyProjectViewMigration;
    if (
      !projectIo ||
      !migration ||
      migration.stableProjectId !== projectId ||
      !migrationKey ||
      attemptedKeysRef.current.has(migrationKey)
    ) {
      return;
    }

    attemptedKeysRef.current.add(migrationKey);
    setAttempt({ key: migrationKey, phase: "running" });
    let cancelled = false;
    let finished = false;
    const ownsMigrationSession = () => {
      const state = projectStore.getState();
      return (
        !cancelled &&
        state.io === projectIo &&
        state.projectSessionId === migrationSessionId &&
        state.project?.project_id === projectId
      );
    };
    const abandonAttempt = () => {
      attemptedKeysRef.current.delete(migrationKey);
    };

    void (async () => {
      const preparation = await projectStore
        .getState()
        .prepareLegacyProjectMigration(migrationSessionId, migration);
      if (!ownsMigrationSession()) {
        abandonAttempt();
        return;
      }
      if (preparation.status === "rejected") {
        throw new Error("Legacy Project migration could not be prepared");
      }
      await migrateProjectViewIdentity(
        migration.legacyProjectId,
        migration.stableProjectId,
        migration.pathIdByLegacyReference,
      );
      if (!ownsMigrationSession()) {
        abandonAttempt();
        return;
      }
      const { errors } = await migrateLegacyProjectFieldBackgrounds(
        migrationProject,
        projectIo,
        migration.legacyProjectId,
      );
      if (!ownsMigrationSession()) {
        abandonAttempt();
        return;
      }
      if (errors[0]) {
        throw errors[0];
      }
      await projectStore
        .getState()
        .completeLegacyProjectMigration(migrationSessionId, migration);
      if (!ownsMigrationSession()) {
        abandonAttempt();
        return;
      }
      onFieldBackgroundsChange(listFieldBackgrounds());
      onFieldSelectionChange({
        projectId,
        fieldId:
          selectedFieldBackgroundForProject(projectId, defaultFieldId) ??
          defaultFieldId,
      });
      finished = true;
      setAttempt(null);
    })().catch((migrationError: unknown) => {
      abandonAttempt();
      if (ownsMigrationSession()) {
        setAttempt({ key: migrationKey, phase: "failed" });
        projectStore.getState().markLegacyMigrationError(migrationError);
      }
    });

    return () => {
      cancelled = true;
      if (!finished) {
        abandonAttempt();
      }
    };
  }, [
    defaultFieldId,
    migrationKey,
    onFieldBackgroundsChange,
    onFieldSelectionChange,
    projectIo,
    projectSessionId,
    retryGeneration,
  ]);

  const retry = useCallback(() => {
    setRetryGeneration((generation) => generation + 1);
  }, []);

  return {
    phase: attempt?.key === migrationKey ? attempt.phase : null,
    retry,
  };
}
