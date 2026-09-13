import { useState } from "react";
import { Bug } from "lucide-react";
import { detectEnvironmentCapabilities } from "../../env/capabilities";
import {
  createBugReportUrl,
  openDesktopBugReport,
} from "../../platform/bugReport";

export function BugReportButton() {
  const [failed, setFailed] = useState(false);
  const { shell } = detectEnvironmentCapabilities();
  const url = createBugReportUrl({
    ...__BLINE_BUILD__,
    shell,
    userAgent: navigator.userAgent,
  });
  return (
    <div className="bug-report-control">
      <a
        className="bline-icon-button"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Report a bug"
        title="Report a bug on GitHub"
        onClick={(event) => {
          if (shell !== "tauri") return;
          event.preventDefault();
          setFailed(false);
          void openDesktopBugReport(url).catch(() => setFailed(true));
        }}
      >
        <Bug aria-hidden="true" size={16} />
      </a>
      {failed ? (
        <div className="bug-report-error" role="alert">
          <p>
            Could not open your browser. Copy this link into your browser to
            report the bug.
          </p>
          <textarea
            aria-label="Bug report link"
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button type="button" onClick={() => setFailed(false)}>
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
