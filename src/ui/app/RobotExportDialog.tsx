import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { ActionButton, CloseButton } from "../controls";
import {
  browserRobotFolderMemory,
  practiceRobotFolderMemory,
  robotDeployAutosPath,
  type RememberedRobotFolder,
  type RobotExportMode,
  type RobotExportResult,
  type RobotFolderMemory,
} from "./robotExport";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
import "./ProjectDialogs.css";

type Status =
  | { kind: "ready" }
  | { kind: "exporting" }
  | { kind: "done"; result: RobotExportResult }
  | { kind: "failed"; message: string };

/**
 * Says where autos will land before anything is written: the remembered
 * robot project on browsers with folder access, or autos.zip and the folder
 * to unzip it into on the rest.
 */
export function RobotExportDialog({
  mode,
  practice = false,
  memory = practice ? practiceRobotFolderMemory : browserRobotFolderMemory,
  onExport,
  onClose,
}: {
  mode: RobotExportMode;
  /** A lesson export: ask for a spare folder and leave the remembered one alone. */
  practice?: boolean;
  memory?: RobotFolderMemory;
  /** Resolves null when the user cancels the folder picker. */
  onExport(options: {
    chooseFolder: boolean;
  }): Promise<RobotExportResult | null>;
  onClose(): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  const [remembered, setRemembered] = useState<RememberedRobotFolder | null>(
    null,
  );
  const [status, setStatus] = useState<Status>({ kind: "ready" });

  useEffect(() => {
    if (mode !== "folder") return;
    let current = true;
    void memory.recall().then((folder) => {
      if (current) setRemembered(folder);
    });
    return () => {
      current = false;
    };
  }, [memory, mode]);

  useEffect(() => {
    dialogRef.current
      ?.querySelector<HTMLButtonElement>(".bline-control-button--primary")
      ?.focus();
  }, [dialogRef, status.kind, remembered]);

  const run = async (chooseFolder: boolean) => {
    setStatus({ kind: "exporting" });
    try {
      const result = await onExport({ chooseFolder });
      setStatus(result ? { kind: "done", result } : { kind: "ready" });
      if (result?.mode === "folder") {
        setRemembered(await memory.recall());
      }
    } catch (error) {
      setStatus({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const exporting = status.kind === "exporting";
  const destination = remembered ? remembered.pathSegments.join("/") : null;

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="project-dialog robot-export-dialog"
        data-tour="robot-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="robot-export-title"
        aria-busy={exporting || undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !exporting) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="project-dialog__header">
          <span className="project-dialog__icon" aria-hidden="true">
            <Bot size={18} />
          </span>
          <h2 id="robot-export-title">Export to robot</h2>
          <CloseButton
            ariaLabel="Close export to robot"
            disabled={exporting}
            onClick={onClose}
          />
        </header>
        <div className="project-dialog__body" data-testid="robot-export-body">
          {status.kind === "done" ? (
            <ExportDone result={status.result} />
          ) : mode === "zip" ? (
            <p>
              This browser can’t save into folders, so BLine downloads{" "}
              <code>autos.zip</code>. Unzip it into your robot project’s{" "}
              <code>src/main/deploy</code> folder so the files land in{" "}
              <code>{robotDeployAutosPath}</code>, then deploy your robot code.
            </p>
          ) : destination ? (
            <p>
              Saves this project’s paths to <code>{destination}</code>,
              replacing files with the same names.
              {remembered?.robotProject
                ? ""
                : " That folder isn’t a robot project, so you may want to choose another."}
            </p>
          ) : practice ? (
            <p>
              Choose a spare folder for this practice export. BLine saves the
              practice paths inside it and won’t remember it as your robot
              project.
            </p>
          ) : (
            <p>
              Choose your robot project folder. BLine saves this project’s paths
              to <code>{robotDeployAutosPath}</code> inside it and remembers the
              folder for next time.
            </p>
          )}
          {status.kind === "failed" ? (
            <p className="robot-export-dialog__error" role="alert">
              Couldn’t export: {status.message}
            </p>
          ) : null}
        </div>
        <footer className="project-dialog__footer">
          {status.kind === "done" ? (
            <ActionButton tone="primary" onClick={onClose}>
              Done
            </ActionButton>
          ) : mode === "zip" ? (
            <>
              <ActionButton disabled={exporting} onClick={onClose}>
                Cancel
              </ActionButton>
              <ActionButton
                tone="primary"
                disabled={exporting}
                onClick={() => void run(false)}
              >
                Download autos.zip
              </ActionButton>
            </>
          ) : (
            <>
              {destination ? (
                <ActionButton
                  disabled={exporting}
                  onClick={() => void run(true)}
                >
                  Choose another folder…
                </ActionButton>
              ) : (
                <ActionButton disabled={exporting} onClick={onClose}>
                  Cancel
                </ActionButton>
              )}
              <ActionButton
                tone="primary"
                disabled={exporting}
                onClick={() => void run(!destination)}
              >
                {exporting
                  ? "Exporting…"
                  : destination
                    ? "Export"
                    : practice
                      ? "Choose folder…"
                      : "Choose robot project…"}
              </ActionButton>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

function ExportDone({ result }: { result: RobotExportResult }) {
  const paths = `${result.pathCount} ${result.pathCount === 1 ? "path" : "paths"}`;
  if (result.mode === "zip") {
    return (
      <p role="status">
        Downloaded <code>{result.fileName}</code> with {paths}. Unzip it into
        your robot project’s <code>src/main/deploy</code> folder, then deploy
        your robot code.
      </p>
    );
  }
  return (
    <p role="status">
      Saved {paths} to <code>{result.pathSegments.join("/")}</code>.{" "}
      {result.robotProject
        ? "Deploy your robot code to use them."
        : `This folder isn’t a robot project; copy the autos folder into ${robotDeployAutosPath} before deploying.`}
    </p>
  );
}
