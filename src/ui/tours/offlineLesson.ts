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
      body: "BLine automatically prepares for offline use while you’re online. Once ready, open this same address in the same browser on this device—even without internet. You can edit paths, run simulations, and save your work locally. Updates download automatically when you’re connected. Bookmark BLine so it’s easy to find. No installation needed.",
    },
  ],
};
