"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ACTIVITY_STATUS_OPTIONS,
  PHASE_STATUS_OPTIONS,
  emptyActivity,
  emptyPhase,
  type ProjectActivityDraft,
  type ProjectPhaseDraft,
} from "@/lib/project-wbs";
import { Add, Trash } from "iconsax-react";

function averageProgress(activities: ProjectActivityDraft[]) {
  const named = activities.filter((a) => a.name.trim());
  if (!named.length) return "0";
  const sum = named.reduce((acc, a) => acc + (Number(a.progressPercent) || 0), 0);
  return String(Math.round(sum / named.length));
}

function clampInputPercent(raw: string) {
  if (raw.trim() === "") return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return String(Math.max(0, Math.min(100, n)));
}

export function ProjectWbsEditor({
  phases,
  onChange,
  readOnly,
}: {
  phases: ProjectPhaseDraft[];
  onChange: (phases: ProjectPhaseDraft[]) => void;
  readOnly?: boolean;
}) {
  function updatePhase(index: number, patch: Partial<ProjectPhaseDraft>) {
    onChange(
      phases.map((phase, i) => {
        if (i !== index) return phase;
        const next = { ...phase, ...patch };
        if (patch.progressPercent !== undefined) {
          next.progressPercent = clampInputPercent(patch.progressPercent);
        }
        return next;
      }),
    );
  }

  function updateActivity(
    phaseIndex: number,
    activityIndex: number,
    patch: Partial<ProjectActivityDraft>,
  ) {
    onChange(
      phases.map((phase, i) => {
        if (i !== phaseIndex) return phase;
        const activities = phase.activities.map((activity, j) => {
          if (j !== activityIndex) return activity;
          const next = { ...activity, ...patch };
          if (patch.progressPercent !== undefined) {
            next.progressPercent = clampInputPercent(patch.progressPercent);
          }
          return next;
        });
        // Phase % and activity % stay independent — do not auto-overwrite either.
        return { ...phase, activities };
      }),
    );
  }

  function addPhase() {
    onChange([...phases, emptyPhase()]);
  }

  function removePhase(index: number) {
    onChange(phases.filter((_, i) => i !== index));
  }

  function addActivity(phaseIndex: number) {
    onChange(
      phases.map((phase, i) =>
        i === phaseIndex
          ? { ...phase, activities: [...phase.activities, emptyActivity()] }
          : phase,
      ),
    );
  }

  function removeActivity(phaseIndex: number, activityIndex: number) {
    onChange(
      phases.map((phase, i) => {
        if (i !== phaseIndex) return phase;
        const activities = phase.activities.filter((_, j) => j !== activityIndex);
        return {
          ...phase,
          activities: activities.length ? activities : [emptyActivity()],
        };
      }),
    );
  }

  function applyActivityAverageToPhase(phaseIndex: number) {
    onChange(
      phases.map((phase, i) =>
        i === phaseIndex
          ? { ...phase, progressPercent: averageProgress(phase.activities) }
          : phase,
      ),
    );
  }

  return (
    <div className="sm:col-span-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="text-[12px] text-slate-700">Phases & activities</Label>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Set a separate progress % on each phase and each activity. Use “Avg from
            activities” only when you want the phase % rolled up.
          </p>
        </div>
        {!readOnly ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 rounded-lg border-slate-200"
            onClick={addPhase}
          >
            <Add size={14} color="currentColor" /> Add phase
          </Button>
        ) : null}
      </div>

      {!phases.length ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-[12px] text-slate-500">
          No phases yet — click Add phase to start the work breakdown.
        </p>
      ) : null}

      {phases.map((phase, phaseIndex) => (
        <div
          key={phase.key}
          className="space-y-2 rounded-lg border border-slate-200 bg-white p-3"
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[10rem] flex-1">
              <Label className="mb-1 text-[11px] text-slate-600">Phase name</Label>
              <Input
                value={phase.name}
                readOnly={readOnly}
                placeholder={`Phase ${phaseIndex + 1}`}
                onChange={(e) => updatePhase(phaseIndex, { name: e.target.value })}
                className="h-9"
              />
            </div>
            <div className="w-[8.5rem]">
              <Label className="mb-1 text-[11px] text-slate-600">Status</Label>
              <select
                value={phase.status}
                disabled={readOnly}
                onChange={(e) => updatePhase(phaseIndex, { status: e.target.value })}
                className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:bg-slate-50"
              >
                {PHASE_STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-[6.5rem]">
              <Label className="mb-1 text-[11px] text-slate-600">Phase %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={phase.progressPercent}
                readOnly={readOnly}
                onChange={(e) =>
                  updatePhase(phaseIndex, { progressPercent: e.target.value })
                }
                className="h-9"
              />
            </div>
            {!readOnly ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 rounded-lg border-slate-200 px-2 text-[11px] text-slate-600"
                title="Set phase % to the average of named activities"
                onClick={() => applyActivityAverageToPhase(phaseIndex)}
              >
                Avg
              </Button>
            ) : null}
            {!readOnly ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-9 shrink-0 rounded-lg border-rose-200 p-0 text-rose-600 hover:bg-rose-50"
                title="Remove phase"
                aria-label="Remove phase"
                onClick={() => removePhase(phaseIndex)}
              >
                <Trash size={14} color="currentColor" />
              </Button>
            ) : null}
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-slate-600">
                Activities (each has its own %)
              </p>
              {!readOnly ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px] text-slate-600"
                  onClick={() => addActivity(phaseIndex)}
                >
                  <Add size={13} color="currentColor" /> Add activity
                </Button>
              ) : null}
            </div>

            {phase.activities.map((activity, activityIndex) => (
              <div
                key={activity.key}
                className="flex flex-wrap items-end gap-2 rounded-md bg-slate-50/80 p-2"
              >
                <div className="min-w-[10rem] flex-1">
                  <Label className="mb-1 text-[11px] text-slate-500">Activity</Label>
                  <Input
                    value={activity.name}
                    readOnly={readOnly}
                    placeholder={`Activity ${activityIndex + 1}`}
                    onChange={(e) =>
                      updateActivity(phaseIndex, activityIndex, {
                        name: e.target.value,
                      })
                    }
                    className="h-8 bg-white"
                  />
                </div>
                <div className="w-[8.5rem]">
                  <Label className="mb-1 text-[11px] text-slate-500">Status</Label>
                  <select
                    value={activity.status}
                    disabled={readOnly}
                    onChange={(e) =>
                      updateActivity(phaseIndex, activityIndex, {
                        status: e.target.value,
                      })
                    }
                    className="h-8 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:bg-slate-50"
                  >
                    {ACTIVITY_STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-[6.5rem]">
                  <Label className="mb-1 text-[11px] text-slate-500">Activity %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={activity.progressPercent}
                    readOnly={readOnly}
                    onChange={(e) =>
                      updateActivity(phaseIndex, activityIndex, {
                        progressPercent: e.target.value,
                      })
                    }
                    className="h-8 bg-white"
                  />
                </div>
                {!readOnly ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 shrink-0 p-0 text-rose-600 hover:bg-rose-50"
                    title="Remove activity"
                    aria-label="Remove activity"
                    onClick={() => removeActivity(phaseIndex, activityIndex)}
                  >
                    <Trash size={13} color="currentColor" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
