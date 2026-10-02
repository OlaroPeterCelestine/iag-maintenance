/**
 * In-app release notes. Keep newest first.
 */

export type ReleaseNote = {
  version: string;
  date: string;
  title: string;
  summary: string;
  highlights: string[];
  githubUrl?: string;
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "v1.0.0",
    date: "2026-10-02",
    title: "Machinery maintenance",
    summary:
      "A workshop desk for plant and machinery, on the same screens as the other IAG apps.",
    highlights: [
      "Machine register",
      "Work orders",
      "Preventive schedules",
      "Spare parts",
      "Downtime and job cards",
    ],
  },
];
