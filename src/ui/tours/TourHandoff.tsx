import { useEffect, useMemo, useState } from "react";
import { serializeBLineProjectFolder } from "../../core/io/projectFolder";
import { serializeBLineProjectArchive } from "../../core/io/blineProject";
import { downloadBlob } from "../../platform/fileExport";
import { projectStore } from "../../state/projectStore";
import { useStoreSelector } from "../../state/react";
import { createProjectFolderZip } from "../app/projectFolderExport";
import { tourStore } from "./tourStore";

export function KeepPracticeCopy() {
  return (
    <button
      onClick={() => {
        const project = projectStore.getState().project;
        if (!project) return;
        downloadBlob(
          serializeBLineProjectArchive(project, new Date().toISOString()),
          "Pickup-and-delivery.bline-project.json",
        );
        tourStore.getState().recordAction("keepCopy");
      }}
    >
      Keep a practice copy
    </button>
  );
}

export function TourHandoff() {
  const project = useStoreSelector(projectStore, (state) => state.project);
  const folder = useMemo(
    () => (project ? serializeBLineProjectFolder(project) : null),
    [project],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [contents, setContents] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    const file = folder?.files.find((file) => file.relativePath === selected);
    void file?.blob.text().then((text) => {
      if (live) setContents(text);
    });
    return () => {
      live = false;
    };
  }, [folder, selected]);
  if (!project || !folder) return null;
  return (
    <div className="tour-handoff">
      <p>
        Practice robot: {project.config.gui.robot.length_meters.toFixed(2)} ×{" "}
        {project.config.gui.robot.width_meters.toFixed(2)} m. Field: Blank Grid.
      </p>
      <p>Select each file to inspect the actual export.</p>
      <div className="tour-handoff__files">
        {folder.files.map((file) => (
          <button
            key={file.relativePath}
            aria-pressed={selected === file.relativePath}
            onClick={() => {
              setSelected(file.relativePath);
              if (file.relativePath === "config.json")
                tourStore.getState().recordAction("inspectConfig");
              if (file.relativePath === "project.json")
                tourStore.getState().recordAction("inspectProject");
              if (file.relativePath.startsWith("paths/"))
                tourStore.getState().recordAction("inspectPath");
            }}
          >
            {file.relativePath}
          </button>
        ))}
      </div>
      {selected && (
        <>
          <p>
            {selected.startsWith("paths/")
              ? "The path contains ordered elements, event keys, and constraints for the robot."
              : selected === "config.json"
                ? "Runtime motion defaults, including speed, acceleration, tolerances, and handoff radius. Match them to your robot."
                : "Editor metadata, including project organization and the bumper dimensions used for this preview. Robot code configures the physical robot separately."}
          </p>
          <pre aria-label="Export file contents">{contents}</pre>
        </>
      )}
      <button
        onClick={async () => {
          try {
            downloadBlob(
              await createProjectFolderZip(folder),
              "practice-autos.zip",
            );
            tourStore.getState().recordAction("export");
            setMessage(
              "Downloaded practice-autos.zip. Extract autos into src/main/deploy in your robot project.",
            );
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "Export could not be created.",
            );
          }
        }}
      >
        Download practice autos.zip
      </button>
      <p role="status">{message}</p>
    </div>
  );
}
