import { createFundamentalsDemoPath } from "./courseScenarios";
import type { TourDefinition } from "./tourStore";

export const offlineTour: TourDefinition = {
  id: "use-bline-offline",
  title: "How to use BLine offline",
  summary: "Keep editing in your browser without internet",
  durationMinutes: 1,
  completionMessage: "Lesson complete.",
  practicePath: createFundamentalsDemoPath,
  steps: [
    {
      title: "Same address, same browser",
      body: "BLine automatically prepares a complete offline copy while you’re online. Open or refresh this same address in the same browser on this device to try the latest version. If the website is unavailable or too slow, BLine opens your last complete offline copy. The Wi-Fi-off icon beside Save tells you when you’re using it. You can edit, simulate, and save locally. Updates download quietly without restarting your editor. Bookmark BLine so it’s easy to find. No installation needed.",
    },
  ],
};
