/**
 * Client helpers for the FastAPI ML/AI service (via Next `/api/ml` proxy).
 */

export type MlTrialAnalysis = {
  verdict: string;
  confidence: number;
  signals: string[];
  recommended_actions: string[];
  product: string;
};

export type MlRoastPrediction = {
  predicted_roast_loss_percent: number;
  predicted_output_kg: number;
  expected_range_percent: [number, number];
  guidance: string[];
  model: string;
};

export type MlNextTest = {
  product: string;
  priority: string;
  recommended_tests: string[];
  suggested_experiment_title: string;
  save_as_entity: string;
};

export type MlQcRisk = {
  risk_score: number;
  disposition: string;
  reasons: string[];
  recommended_actions: string[];
};

export type MlCostOutlook = {
  total_cost: number;
  unit_cost: number;
  margin_percent: number | null;
  margin_healthy: boolean | null;
  guidance: string[];
};

export type MlQaAnswer = {
  answer: string;
  confidence: number;
  matched_topic: string | null;
};

export type MlSimulationGate = {
  stage: string;
  status: string;
  pass: boolean;
  detail: string;
};

export type MlProductDevSimulation = {
  product: string;
  overall: string;
  overall_detail: string;
  gates_passed: number;
  gates_total: number;
  gates: MlSimulationGate[];
  trial: MlTrialAnalysis;
  roast: MlRoastPrediction;
  qc: MlQcRisk;
  cost: MlCostOutlook;
  next_test: MlNextTest;
  save_as_entity: string;
};

export type MlUserPatternInsight = {
  schema?: string;
  model?: string;
  windowHours?: number;
  summary: {
    usersStudied: number;
    personaCounts: Record<string, number>;
    anomalyCount: number;
    orgAvgSession: string;
    orgPageViews: number;
    orgMutations: number;
  };
  clusters: Array<{ id: string; label: string; size: number; users: string[] }>;
  anomalies: Array<{
    userId?: string;
    name: string;
    type: string;
    detail: string;
    severity: string;
  }>;
  topUsers: Array<{
    userId?: string;
    name: string;
    persona: string;
    engagementScore: number;
    avgSession: string;
    sessions: number;
    pageViews: number;
    mutations: number;
    accessDenied: number;
    peakHourUtc?: number | null;
    topModule?: string | null;
    topPath?: string | null;
  }>;
  notes: string[];
  recommendations: string[];
  trainingHint?: {
    featureSchema: string;
    labels: string[];
    suggestedTargets: string[];
  };
};

export type UserPatternsExport = {
  ok?: boolean;
  windowHours: number;
  from?: string;
  to?: string;
  userCount?: number;
  users: unknown[];
  org?: Record<string, unknown>;
  schema?: string;
};

async function mlFetch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/ml/${path.replace(/^\//, "")}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || data.detail || `ML request failed (${res.status})`);
  }
  return data;
}

export function analyzeTrial(input: {
  product: string;
  hypothesis: string;
  variable: string;
  control_score?: number;
  trial_score?: number;
  yield_percent?: number;
  unit_cost?: number;
  target_cost?: number;
  defects?: string;
  observations?: string;
}) {
  return mlFetch<MlTrialAnalysis>("v1/analyze/trial", input);
}

export function predictRoastLoss(input: {
  input_weight_kg: number;
  charge_temperature_c: number;
  end_temperature_c: number;
  roast_time_min: number;
  moisture_percent?: number;
  process?: string;
}) {
  return mlFetch<MlRoastPrediction>("v1/predict/roast-loss", input);
}

export function recommendNextTest(input: {
  product: string;
  last_result?: string;
  last_variable?: string;
  cupping_score?: number;
  roast_loss_percent?: number;
  unit_cost?: number;
  target_margin_percent?: number;
  notes?: string;
}) {
  return mlFetch<MlNextTest>("v1/recommend/next-test", input);
}

export function scoreQcRisk(input: {
  cupping_score?: number;
  moisture_percent?: number;
  roast_loss_percent?: number;
  defects?: string;
  min_cupping?: number;
  moisture_max?: number;
  roast_loss_max?: number;
}) {
  return mlFetch<MlQcRisk>("v1/score/qc-risk", input);
}

export function costOutlook(input: {
  material_cost: number;
  labour_cost?: number;
  energy_cost?: number;
  packaging_cost?: number;
  waste_percent?: number;
  target_price?: number;
  planned_units?: number;
}) {
  return mlFetch<MlCostOutlook>("v1/cost/outlook", input);
}

export function askRdQuestion(question: string) {
  return mlFetch<MlQaAnswer>("v1/qa/ask", { question });
}

export function simulateProductDevelopment(input: {
  product: string;
  hypothesis: string;
  variable: string;
  control_score?: number;
  trial_score?: number;
  yield_percent?: number;
  unit_cost?: number;
  target_cost?: number;
  defects?: string;
  observations?: string;
  input_weight_kg?: number;
  charge_temperature_c?: number;
  end_temperature_c?: number;
  roast_time_min?: number;
  moisture_percent?: number;
  process?: string;
  material_cost?: number;
  labour_cost?: number;
  energy_cost?: number;
  packaging_cost?: number;
  waste_percent?: number;
  target_price?: number;
  planned_units?: number;
  min_cupping?: number;
  moisture_max?: number;
  roast_loss_max?: number;
  target_margin_percent?: number;
}) {
  return mlFetch<MlProductDevSimulation>("v1/simulate/product-development", input);
}

/** Study login duration + activity feature rows exported by the Go API. */
export function analyzeUserPatterns(features: UserPatternsExport | Record<string, unknown>) {
  return mlFetch<MlUserPatternInsight>("v1/analyze/user-patterns", features);
}

export function mlHealth() {
  return mlFetch<{ ok: boolean; service: string; version: string }>("health");
}

export function mlModels() {
  return mlFetch<{ models: Array<{ id: string; task: string }> }>("v1/models");
}
