import type { Project } from "../../core/model/project";
import type { TourResumePoint } from "./tourStore";

const storageKey = "bline-web:lesson-resume";

/** The practice project as it was when the learner left the lesson. */
export interface LessonResumeSnapshot {
  project: Project;
  activePathId: string | null;
  activePathGroupId: string | null;
}

export interface LessonResume {
  point: TourResumePoint;
  snapshot: LessonResumeSnapshot | null;
}

let memory: LessonResume | null = null;

/** The last lesson left part-way, from this page or a previous visit. */
export function readLessonResume(): LessonResume | null {
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<LessonResume>) : null;
    if (
      parsed?.point &&
      typeof parsed.point.tourId === "string" &&
      Number.isInteger(parsed.point.stepIndex)
    ) {
      memory = {
        point: {
          tourId: parsed.point.tourId,
          stepIndex: parsed.point.stepIndex,
          furthestStepIndex: Math.max(
            parsed.point.stepIndex,
            Number(parsed.point.furthestStepIndex) || 0,
          ),
          actions: parsed.point.actions ?? {},
        },
        snapshot: parsed.snapshot ?? null,
      };
    }
  } catch {
    // Resume is a convenience; private or unavailable storage starts fresh.
  }
  return memory;
}

export function rememberLessonResume(resume: LessonResume | null): void {
  memory = resume;
  try {
    if (resume) window.localStorage.setItem(storageKey, JSON.stringify(resume));
    else window.localStorage.removeItem(storageKey);
  } catch {
    // The in-memory copy still resumes within this page.
  }
}
