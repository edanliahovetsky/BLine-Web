import { createFundamentalsDemoPath } from "./courseScenarios";
import type { TourDefinition } from "./tourStore";

export const offlineTour: TourDefinition = {
  id: "use-bline-offline",
  title: "How to use BLine offline",
  summary: "Keep editing in your browser without internet",
  durationMinutes: 1,
  recap: [
    "BLine keeps a complete offline copy in this browser.",
    "Open the same address in the same browser to use it without internet.",
  ],
  practicePath: createFundamentalsDemoPath,
  steps: [
    {
      title: "The offline icon",
      body: "This Wi-Fi-off icon beside Save appears when BLine runs from its offline copy. You can still edit, preview, and save in this browser.",
      why: "BLine prepares the offline copy automatically while you’re online. Updates download quietly and apply after you save and finish editing.",
      target: "offline-indicator",
      visible: ["path-canvas"],
      prepare: { inspector: "closed", navigator: "closed" },
    },
    {
      title: "Same address, same browser",
      body: "Bookmark this address and open it in the same browser on this device, with or without internet. No installation needed.",
      visible: ["path-canvas"],
    },
  ],
};
