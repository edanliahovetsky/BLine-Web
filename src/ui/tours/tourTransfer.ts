import {
  deserializeBLineProjectFolder,
  type ProjectFolderImportFile,
} from "../../core/io/projectFolder";
import { openProjectFromLegacyWorkspace } from "../../core/io/legacyWorkspace";
import { projectStore } from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import { tourStore } from "./tourStore";

/** Bind an asynchronous file operation to the practice step that opened it. */
export function capturePracticeTransfer() {
  const lesson = tourStore.getState();
  const state = projectStore.getState();
  if (lesson.activeTourId !== "import-export" || state.io || !state.project)
    return null;
  return {
    sessionId: state.projectSessionId,
    attemptId: lesson.attemptId,
    stepIndex: lesson.stepIndex,
  };
}

type PracticeTransfer = NonNullable<ReturnType<typeof capturePracticeTransfer>>;

export function isCurrentPracticeTransfer(token: PracticeTransfer): boolean {
  const current = capturePracticeTransfer();
  return (
    !!current &&
    current.sessionId === token.sessionId &&
    current.attemptId === token.attemptId &&
    current.stepIndex === token.stepIndex
  );
}

/** Read the normal autos format without attaching storage or replacing the user's project. */
export async function importPracticeFolder(
  files: readonly ProjectFolderImportFile[],
  token: PracticeTransfer,
): Promise<boolean> {
  const opened = openProjectFromLegacyWorkspace(
    await deserializeBLineProjectFolder(files),
  );
  if (!isCurrentPracticeTransfer(token)) return false;
  const state = projectStore.getState();
  projectStore.setState({
    project: { ...opened.project, project_id: state.project!.project_id },
    ...opened.navigation,
    dirty: false,
    status: "idle",
    error: null,
    revision: state.revision + 1,
  });
  state.history.setState({
    undoStack: [],
    redoStack: [],
    canUndo: false,
    canRedo: false,
  });
  selectionStore.getState().clearSelection();
  tourStore.getState().recordAction("importFolder");
  return true;
}

/**
 * Import for the lesson, reporting a failure in the lesson card instead of
 * the editor's save status, which the practice project does not use.
 */
export async function importPracticeFolderWithFeedback(
  files: readonly ProjectFolderImportFile[],
  token: PracticeTransfer,
): Promise<boolean> {
  try {
    const imported = await importPracticeFolder(files, token);
    if (imported) tourStore.getState().reportTransferError(null);
    return imported;
  } catch (caughtError) {
    if (isCurrentPracticeTransfer(token))
      tourStore
        .getState()
        .reportTransferError(
          caughtError instanceof Error && caughtError.message
            ? caughtError.message
            : String(caughtError),
        );
    return false;
  }
}

/** The failure reported for the current lesson step, if any. */
export function currentPracticeTransferError(): string | null {
  const { transferError, attemptId, stepIndex } = tourStore.getState();
  return transferError?.attemptId === attemptId &&
    transferError.stepIndex === stepIndex
    ? transferError.message
    : null;
}
