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
