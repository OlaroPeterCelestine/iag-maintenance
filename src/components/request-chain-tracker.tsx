"use client";

import { cn } from "@/lib/utils";
import {
  REQUISITION_CHAIN_LABEL,
  requisitionChainProgress,
  requisitionChainStepDates,
  type RequisitionTrackerStepId,
} from "@/lib/requisition-chain";
import {
  Briefcase,
  Box,
  Calculator,
  Profile2User,
  Teacher,
  TickCircle,
  UserTick,
  WalletMoney,
} from "iconsax-react";
import type { ComponentType } from "react";

type StepIcon = ComponentType<{
  size?: string | number;
  color?: string;
  variant?: "Linear" | "Bold";
}>;

const DEFAULT_STEP_ICON: Record<RequisitionTrackerStepId, StepIcon> = {
  requestor: Profile2User,
  pm: Teacher,
  accounts: Calculator,
  gm: Briefcase,
  ceo: UserTick,
  finance: WalletMoney,
  paid: TickCircle,
};

const FALLBACK_ICONS: StepIcon[] = [
  Profile2User,
  Teacher,
  Calculator,
  Briefcase,
  UserTick,
  WalletMoney,
  Box,
  TickCircle,
];

const STEP_TONE: Record<
  "done" | "current" | "todo",
  { ring: string; fill: string; icon: string; label: string; line: string }
> = {
  done: {
    ring: "ring-teal-300",
    fill: "bg-teal-50",
    icon: "#0d9488",
    label: "text-teal-800",
    line: "from-teal-400 to-teal-300",
  },
  current: {
    ring: "ring-amber-300",
    fill: "bg-amber-50",
    icon: "#d97706",
    label: "text-amber-900",
    line: "from-amber-300 to-slate-200",
  },
  todo: {
    ring: "ring-slate-200",
    fill: "bg-slate-50",
    icon: "#94a3b8",
    label: "text-slate-500",
    line: "from-slate-200 to-slate-200",
  },
};

export type ChainTrackerStep = {
  id: string;
  label: string;
  done: boolean;
  current: boolean;
};

/**
 * Visual chain-of-command tracker with optional approval dates per step.
 * Pass `steps` + `chainLabel` to render a custom chain (e.g. material requests).
 */
export function RequestChainTracker({
  status,
  record,
  className,
  compact = false,
  title = "Chain of command",
  chainLabel,
  steps: stepsProp,
  stepDates: stepDatesProp,
}: {
  status: string;
  /** Request record — used to show approved/paid dates under each step. */
  record?: Record<string, string | undefined | null> | null;
  className?: string;
  compact?: boolean;
  title?: string;
  chainLabel?: string;
  steps?: ChainTrackerStep[];
  stepDates?: Record<string, string>;
}) {
  const defaultProgress = requisitionChainProgress(status);
  const steps = stepsProp || defaultProgress.steps;
  const dates: Record<string, string> = stepDatesProp
    ? stepDatesProp
    : (requisitionChainStepDates(record) as Record<string, string>);
  const label = chainLabel || REQUISITION_CHAIN_LABEL;
  const waitingOn = stepsProp
    ? steps.find((s) => s.current)?.label || ""
    : defaultProgress.waitingOn;

  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200/80 bg-white",
        compact ? "px-3 py-3" : "px-4 py-4 sm:px-6 sm:py-5",
        className,
      )}
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase">
            {title}
          </p>
          <p className="mt-1 text-[13px] text-slate-600">
            {label}
            {waitingOn && waitingOn !== "—"
              ? ` · Waiting on ${waitingOn}`
              : ""}
          </p>
        </div>
      </div>

      <ol className="flex w-full items-start justify-between gap-1 sm:gap-2">
        {steps.map((step, index) => {
          const toneKey = step.done ? "done" : step.current ? "current" : "todo";
          const tone = STEP_TONE[toneKey];
          const Icon =
            DEFAULT_STEP_ICON[step.id as RequisitionTrackerStepId] ||
            FALLBACK_ICONS[index % FALLBACK_ICONS.length]!;
          const next = steps[index + 1];
          const lineTone =
            step.done && next?.done
              ? STEP_TONE.done
              : step.done || step.current
                ? STEP_TONE.current
                : STEP_TONE.todo;
          const dateLabel = dates[step.id] || "";

          return (
            <li key={step.id} className="relative flex min-w-0 flex-1 flex-col items-center">
              {index < steps.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-5 left-[calc(50%+22px)] right-[calc(-50%+22px)] h-0.5 bg-gradient-to-r",
                    lineTone.line,
                  )}
                />
              ) : null}
              <span
                className={cn(
                  "relative z-[1] flex h-10 w-10 items-center justify-center rounded-full ring-2 sm:h-11 sm:w-11",
                  tone.fill,
                  tone.ring,
                )}
              >
                <Icon
                  size={compact ? 18 : 20}
                  color={tone.icon}
                  variant={step.done || step.current ? "Bold" : "Linear"}
                />
              </span>
              <span
                className={cn(
                  "mt-2 max-w-[5.2rem] text-center text-[11px] font-medium leading-tight sm:max-w-none sm:text-[12px]",
                  tone.label,
                )}
              >
                {step.label}
              </span>
              {dateLabel ? (
                <span
                  className={cn(
                    "mt-0.5 max-w-[5.5rem] text-center text-[10px] leading-tight tabular-nums sm:max-w-none sm:text-[11px]",
                    step.done ? "text-teal-700/80" : "text-slate-400",
                  )}
                >
                  {dateLabel}
                </span>
              ) : (
                <span className="mt-0.5 h-[14px]" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
