/**
 * The failure-code catalog: problem / cause / remedy, after ISO 14224. Mirrors
 * iag-mes FailureCatalog (internal/store/maintenance_phase2.go), which refuses
 * anything else. Kept dependency-free so the browser's form definitions can
 * import it.
 */
export const FAILURE_PROBLEMS = [
  "Bearing failure", "Belt or chain failure", "Electrical fault", "Motor failure",
  "Overheating", "Abnormal vibration or noise", "Leak", "Blockage or jam",
  "Worn or broken part", "Misalignment", "Sensor or control fault", "Structural damage", "Other",
];
export const FAILURE_CAUSES = [
  "Normal wear", "Lack of lubrication", "Contamination or dust", "Overload",
  "Operating error", "Missed or late PM", "Poor installation or repair", "Power supply problem",
  "Foreign object in product", "Design or specification", "Unknown", "Other",
];
export const FAILURE_REMEDIES = [
  "Replaced part", "Repaired", "Adjusted or aligned", "Cleaned", "Lubricated",
  "Tightened", "Reset or restarted", "Modified", "Temporary fix — follow-up needed", "Other",
];
