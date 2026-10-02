/**
 * Project work-breakdown helpers: Project → Phase → Activity → Sub-activity.
 * Parent links are stored as display names (same pattern as the rest of Project Manager).
 */
import type { EntityField, ManagerRecord } from "@/lib/manager-entities";
import { loadRecords } from "@/lib/records-store";

export const PROJECT_WBS_ENTITIES = new Set([
  "phases",
  "activities",
  "sub-activities",
  "tasks",
  "milestones",
  "risks",
  "procurement-list",
  "requisitions",
  "payment-requests",
  "progress-certificates",
  "contractor-invoices",
  "requirements",
  "time-entries",
  "project-expenses",
  "project-billing",
  "project-updates",
  "equipment-and-vehicle-requests",
  "document-requests",
  "work-programs",
  "variations-of-work",
]);

function uniqueNames(rows: ManagerRecord[], project?: string, phase?: string): string[] {
  const projectKey = (project || "").trim().toLowerCase();
  const phaseKey = (phase || "").trim().toLowerCase();
  const names = rows
    .filter((row) => {
      if (projectKey && (row.project || "").trim().toLowerCase() !== projectKey) return false;
      if (phaseKey && (row.phase || "").trim().toLowerCase() !== phaseKey) return false;
      return Boolean((row.name || row.code || "").trim());
    })
    .map((row) => (row.name || row.code || "").trim());
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

export function projectNameOptions(): string[] {
  return uniqueNames(loadRecords("projects", "projects"));
}

export function phaseNameOptions(project?: string): string[] {
  return uniqueNames(loadRecords("projects", "phases"), project);
}

export function activityNameOptions(project?: string, phase?: string): string[] {
  const fromActivities = uniqueNames(loadRecords("projects", "activities"), project, phase);
  if (fromActivities.length) return fromActivities;
  // Legacy Tasks rows still count as activities until migrated.
  return uniqueNames(loadRecords("projects", "tasks"), project, phase);
}

/** Turn free-text parent fields into selects populated from sibling lists. */
export function withProjectHierarchyOptions(
  fields: EntityField[],
  values: { project?: string; phase?: string },
): EntityField[] {
  const projects = projectNameOptions();
  const phases = phaseNameOptions(values.project);
  const activities = activityNameOptions(values.project, values.phase);

  return fields.map((field) => {
    if (field.key === "project") {
      return {
        ...field,
        type: "select" as const,
        options: projects,
        placeholder: field.placeholder || "Select project",
      };
    }
    if (field.key === "phase" && (phases.length || field.required || values.project)) {
      return {
        ...field,
        type: "select" as const,
        options: phases.length ? phases : ["(create phases under Phases first)"],
        placeholder: field.placeholder || "Select phase",
      };
    }
    if (field.key === "activity" && (activities.length || field.required)) {
      return {
        ...field,
        type: "select" as const,
        options: activities.length ? activities : ["(create activities under Activities first)"],
        placeholder: field.placeholder || "Select activity",
      };
    }
    return field;
  });
}
