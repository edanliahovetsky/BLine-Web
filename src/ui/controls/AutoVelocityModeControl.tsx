export function AutoVelocityModeControl({
  mode,
  disabled,
  ariaLabel = "Velocity constraint mode",
  onModeChange,
}: {
  mode: "auto" | "manual" | null;
  disabled: boolean;
  ariaLabel?: string;
  onModeChange(mode: "auto" | "manual"): void;
}) {
  return (
    <div className="auto-velocity-mode" role="group" aria-label={ariaLabel}>
      {(["auto", "manual"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={[`is-${option}`, mode === option ? "is-active" : ""]
            .filter(Boolean)
            .join(" ")}
          aria-pressed={mode === option}
          disabled={disabled}
          onClick={() => {
            if (mode === option) {
              return;
            }
            onModeChange(option);
          }}
        >
          {option === "auto" ? "Auto" : "Manual"}
        </button>
      ))}
    </div>
  );
}
