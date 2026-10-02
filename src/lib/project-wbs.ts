/**
 * Project form WBS draft: phases → activities with status + progress %.
 * Persisted into projects → phases / activities entity stores.
 */
import type { ManagerRecord } from "@/lib/manager-entities";
import { nextEntityCode } from "@/lib/document-references";
import { loadRecords, saveRecordsAsync, notifyPersistFailure } from "@/lib/records-store";

export type ProjectActivityDraft = {
  key: string;
  id?: string;
  name: string;
  status: string;
  progressPercent: string;
};

export type ProjectPhaseDraft = {
  key: string;
  id?: string;
  name: string;
  status: string;
  progressPercent: string;
  activities: ProjectActivityDraft[];
};

export const PHASE_STATUS_OPTIONS = [
  "Planned",
  "In progress",
  "Completed",
  "On hold",
  "Cancelled",
] as const;

export const ACTIVITY_STATUS_OPTIONS = [
  "Todo",
  "In progress",
  "Blocked",
  "Done",
  "Cancelled",
] as const;

function newKey() {
  return globalThis.crypto?.randomUUID?.() ?? `wbs-${Date.now()}-${Math.random()}`;
}

export function emptyActivity(): ProjectActivityDraft {
  return {
    key: newKey(),
    name: "",
    status: "Todo",
    progressPercent: "0",
  };
}

export function emptyPhase(): ProjectPhaseDraft {
  return {
    key: newKey(),
    name: "",
    status: "Planned",
    progressPercent: "0",
    activities: [emptyActivity()],
  };
}

function sameProject(row: ManagerRecord, projectName: string) {
  return (row.project || "").trim().toLowerCase() === projectName.trim().toLowerCase();
}

function samePhase(row: ManagerRecord, phaseName: string) {
  return (row.phase || "").trim().toLowerCase() === phaseName.trim().toLowerCase();
}

/** Load existing WBS rows for a project into the form editor. */
export function loadProjectWbsDraft(projectName: string): ProjectPhaseDraft[] {
  const name = (projectName || "").trim();
  if (!name) return [];

  const phases = loadRecords("projects", "phases")
    .filter((row) => sameProject(row, name))
    .sort((a, b) => {
      const ao = Number(a.sortOrder || 0);
      const bo = Number(b.sortOrder || 0);
      if (ao !== bo) return ao - bo;
      return (a.name || "").localeCompare(b.name || "");
    });

  const activities = [
    ...loadRecords("projects", "activities"),
    ...loadRecords("projects", "tasks"),
  ].filter((row) => sameProject(row, name));

  if (!phases.length && !activities.length) return [];

  return phases.map((phase) => {
    const phaseName = (phase.name || phase.code || "").trim();
    const phaseActivities = activities
      .filter((row) => samePhase(row, phaseName))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((row) => ({
        key: row.id || newKey(),
        id: row.id,
        name: row.name || "",
        status: row.status || "Todo",
        progressPercent: row.progressPercent || "0",
      }));

    return {
      key: phase.id || newKey(),
      id: phase.id,
      name: phaseName,
      status: phase.status || "Planned",
      progressPercent: phase.progressPercent || "0",
      activities: phaseActivities.length ? phaseActivities : [emptyActivity()],
    };
  });
}

export function parseWbsDraft(raw?: string): ProjectPhaseDraft[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as ProjectPhaseDraft[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((phase) => ({
      key: phase.key || newKey(),
      id: phase.id,
      name: phase.name || "",
      status: phase.status || "Planned",
      progressPercent: phase.progressPercent || "0",
      activities: Array.isArray(phase.activities)
        ? phase.activities.map((activity) => ({
            key: activity.key || newKey(),
            id: activity.id,
            name: activity.name || "",
            status: activity.status || "Todo",
            progressPercent: activity.progressPercent || "0",
          }))
        : [],
    }));
  } catch {
    return [];
  }
}

function clampPercent(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(Math.max(0, Math.min(100, Math.round(n))));
}

function newRecord(values: Record<string, string>): ManagerRecord {
  const now = new Date().toISOString();
  return {
    ...values,
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Replace this project's phases/activities with the draft from the New Project form.
 * Keeps ids when present so edits update in place; drops removed rows.
 */
export async function syncProjectWbs(opts: {
  projectName: string;
  previousProjectName?: string;
  draft: ProjectPhaseDraft[];
}): Promise<{ ok: boolean; error?: string }> {
  const projectName = opts.projectName.trim();
  if (!projectName) return { ok: true };

  const previousName = (opts.previousProjectName || projectName).trim();
  const draft = opts.draft
    .map((phase) => ({
      ...phase,
      name: phase.name.trim(),
      status: phase.status || "Planned",
      progressPercent: clampPercent(phase.progressPercent),
      activities: phase.activities
        .map((activity) => ({
          ...activity,
          name: activity.name.trim(),
          status: activity.status || "Todo",
          progressPercent: clampPercent(activity.progressPercent),
        }))
        .filter((activity) => activity.name),
    }))
    .filter((phase) => phase.name);

  const existingPhases = loadRecords("projects", "phases");
  const existingActivities = loadRecords("projects", "activities");
  const existingTasks = loadRecords("projects", "tasks");

  const keepPhaseIds = new Set(draft.map((p) => p.id).filter(Boolean) as string[]);
  const keepActivityIds = new Set(
    draft.flatMap((p) => p.activities.map((a) => a.id).filter(Boolean) as string[]),
  );

  const nextPhases: ManagerRecord[] = existingPhases.filter(
    (row) => !sameProject(row, previousName) && !sameProject(row, projectName),
  );
  const nextActivities: ManagerRecord[] = existingActivities.filter(
    (row) => !sameProject(row, previousName) && !sameProject(row, projectName),
  );
  // Drop legacy tasks that belonged to this project (migrated into activities).
  const nextTasks: ManagerRecord[] = existingTasks.filter(
    (row) => !sameProject(row, previousName) && !sameProject(row, projectName),
  );

  draft.forEach((phase, index) => {
    const phaseValues: Record<string, string> = {
      name: phase.name,
      project: projectName,
      sortOrder: String(index + 1),
      status: phase.status,
      progressPercent: phase.progressPercent,
      code:
        (phase.id
          ? existingPhases.find((r) => r.id === phase.id)?.code
          : "") ||
        nextEntityCode("phases", [...existingPhases, ...nextPhases], "Phases"),
    };

    let phaseRecord: ManagerRecord;
    if (phase.id && keepPhaseIds.has(phase.id)) {
      const prev = existingPhases.find((r) => r.id === phase.id);
      phaseRecord = {
        ...(prev || newRecord(phaseValues)),
        ...phaseValues,
        id: phase.id,
        updatedAt: new Date().toISOString(),
        createdAt: prev?.createdAt || new Date().toISOString(),
      };
    } else {
      phaseRecord = newRecord(phaseValues);
    }
    nextPhases.push(phaseRecord);

    for (const activity of phase.activities) {
      const activityValues: Record<string, string> = {
        name: activity.name,
        project: projectName,
        phase: phase.name,
        status: activity.status,
        progressPercent: activity.progressPercent,
        code:
          (activity.id
            ? existingActivities.find((r) => r.id === activity.id)?.code ||
              existingTasks.find((r) => r.id === activity.id)?.code
            : "") ||
          nextEntityCode(
            "activities",
            [...existingActivities, ...nextActivities],
            "Activities",
          ),
      };

      if (activity.id && keepActivityIds.has(activity.id)) {
        const prev =
          existingActivities.find((r) => r.id === activity.id) ||
          existingTasks.find((r) => r.id === activity.id);
        nextActivities.push({
          ...(prev || newRecord(activityValues)),
          ...activityValues,
          id: activity.id,
          updatedAt: new Date().toISOString(),
          createdAt: prev?.createdAt || new Date().toISOString(),
        });
      } else {
        nextActivities.push(newRecord(activityValues));
      }
    }
  });

  const phasesSave = await saveRecordsAsync("projects", "phases", nextPhases);
  if (!phasesSave.ok || phasesSave.durable !== "postgres") {
    return { ok: false, error: phasesSave.error || "Could not save phases." };
  }
  const activitiesSave = await saveRecordsAsync("projects", "activities", nextActivities);
  if (!activitiesSave.ok || activitiesSave.durable !== "postgres") {
    // Roll back the phases we just saved so phases and activities don't drift apart.
    const rolledBack = await saveRecordsAsync("projects", "phases", existingPhases).catch(
      () => ({ ok: false, durable: "none" as const }),
    );
    if (!rolledBack.ok || rolledBack.durable !== "postgres") {
      notifyPersistFailure(
        "projects/phases",
        "Activities failed to save, and rolling back the already-saved phases also failed. Phases and activities may be out of sync — review this project's WBS.",
      );
    }
    return { ok: false, error: activitiesSave.error || "Could not save activities." };
  }
  if (nextTasks.length !== existingTasks.length) {
    const tasksSave = await saveRecordsAsync("projects", "tasks", nextTasks);
    if (!tasksSave.ok || tasksSave.durable !== "postgres") {
      // Roll back phases and activities so the WBS stays consistent.
      const [phasesRolledBack, activitiesRolledBack] = await Promise.all([
        saveRecordsAsync("projects", "phases", existingPhases).catch(
          () => ({ ok: false, durable: "none" as const }),
        ),
        saveRecordsAsync("projects", "activities", existingActivities).catch(
          () => ({ ok: false, durable: "none" as const }),
        ),
      ]);
      if (
        !phasesRolledBack.ok ||
        phasesRolledBack.durable !== "postgres" ||
        !activitiesRolledBack.ok ||
        activitiesRolledBack.durable !== "postgres"
      ) {
        notifyPersistFailure(
          "projects/phases",
          "Legacy task migration failed, and rolling back phases/activities also failed. This project's WBS may be inconsistent — review it.",
        );
      }
      return { ok: false, error: tasksSave.error || "Could not update legacy tasks." };
    }
  }
  return { ok: true };
}
