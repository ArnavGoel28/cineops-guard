// API client — thin wrapper over fetch, handles base URL and errors.
// All components call these functions; nothing uses fetch() directly.

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `API error ${res.status}`);
  }
  return res.json();
}

// ─── Productions ─────────────────────────────────────────────────────
export const listProductions = () => apiFetch<Production[]>("/productions");
export const createProduction = (name: string) =>
  apiFetch<Production>("/productions", { method: "POST", body: JSON.stringify({ name }) });

// ─── Scenes ──────────────────────────────────────────────────────────
export const listScenes = (params?: Record<string, string | number>) => {
  const qs = params ? "?" + new URLSearchParams(params as Record<string, string>).toString() : "";
  return apiFetch<Scene[]>(`/scenes${qs}`);
};
export const getScene = (id: string) => apiFetch<Scene>(`/scenes/${id}`);

// ─── Compliance ───────────────────────────────────────────────────────
export const checkScene = (sceneId: string) =>
  apiFetch<ComplianceResult>(`/check/${sceneId}`, { method: "POST" });

export const getComplianceHistory = (params?: { scene_id?: string; stunt_type?: string }) => {
  const qs = params ? "?" + new URLSearchParams(params as Record<string, string>).toString() : "";
  return apiFetch<ComplianceCheck[]>(`/compliance-history${qs}`);
};

export const overrideCompliance = (checkId: string, reason: string, userId = "demo-user-id") =>
  apiFetch<ComplianceCheck>(`/compliance-checks/${checkId}/override`, {
    method: "POST",
    body: JSON.stringify({ check_id: checkId, reason, user_id: userId }),
  });

export const runAllChecks = (productionId: string) =>
  apiFetch<{ results: ComplianceResult[] }>(`/run-all-checks?production_id=${productionId}`, {
    method: "POST",
  });

// ─── Scripts ─────────────────────────────────────────────────────────
export const createScript = (productionId: string) =>
  apiFetch<Script>(`/scripts?production_id=${productionId}`, { method: "POST" });

export const uploadScriptPDF = async (scriptId: string, productionId: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(
    `${API_URL}/scripts/${scriptId}/upload?production_id=${productionId}`,
    { method: "POST", body: form }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const getScript = (id: string) => apiFetch<Script>(`/scripts/${id}`);

// ─── Generation ───────────────────────────────────────────────────────
export const generateStoryboard = (body: {
  scene_id: string;
  description: string;
  n_panels?: number;
  style_notes?: string;
}) => apiFetch<{ job_id: string; status: string }>("/generate/storyboard", {
  method: "POST",
  body: JSON.stringify(body),
});

export const generateMusic = (body: {
  scene_id: string;
  description: string;
  genre?: string;
  intensity?: string;
  duration_seconds?: number;
}) => apiFetch<{ job_id: string; status: string }>("/generate/music", {
  method: "POST",
  body: JSON.stringify(body),
});

export const generateDialogueRead = (body: {
  scene_id: string;
  script_id: string;
  dialogue_lines: { character: string; line: string }[];
}) => apiFetch<{ asset_id: string }>("/generate/dialogue-read", {
  method: "POST",
  body: JSON.stringify(body),
});

export const pollJob = (jobId: string) => apiFetch<Job>(`/jobs/${jobId}`);

// ─── Media Assets ─────────────────────────────────────────────────────
export const listMediaAssets = (params?: { scene_id?: string; type?: string }) => {
  const qs = params ? "?" + new URLSearchParams(params as Record<string, string>).toString() : "";
  return apiFetch<MediaAsset[]>(`/media-assets${qs}`);
};

export const approveMediaAsset = (assetId: string) =>
  apiFetch<MediaAsset>(`/media-assets/${assetId}/approve`, {
    method: "POST",
    body: JSON.stringify({ user_id: "demo-user-id" }),
  });

// ─── Rehearsal ────────────────────────────────────────────────────────
export const listRehearsalSessions = (params?: { actor_id?: string; scene_id?: string }) => {
  const qs = params ? "?" + new URLSearchParams(params as Record<string, string>).toString() : "";
  return apiFetch<RehearsalSession[]>(`/rehearsal-sessions${qs}`);
};

export const startRehearsalSession = (sceneId: string) =>
  apiFetch<RehearsalSession>("/rehearsal-sessions", {
    method: "POST",
    body: JSON.stringify({ scene_id: sceneId, actor_id: "demo-user-id" }),
  });

// ─── Dailies ──────────────────────────────────────────────────────────
export const listDailies = (sceneId?: string) => {
  const qs = sceneId ? `?scene_id=${sceneId}` : "";
  return apiFetch<Dailies[]>(`/dailies${qs}`);
};

export const uploadDailies = async (sceneId: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/dailies/upload?scene_id=${sceneId}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

// ─── Safety Rules ─────────────────────────────────────────────────────
export const listSafetyRules = () => apiFetch<SafetyRule[]>("/safety-rules");
export const createSafetyRule = (rule: Partial<SafetyRule>) =>
  apiFetch<SafetyRule>("/safety-rules", { method: "POST", body: JSON.stringify(rule) });
export const updateSafetyRule = (stuntType: string, rule: Partial<SafetyRule>) =>
  apiFetch<SafetyRule>(`/safety-rules/${stuntType}`, {
    method: "PUT",
    body: JSON.stringify(rule),
  });
export const deleteSafetyRule = (stuntType: string) =>
  apiFetch<{ status: string; stunt_type: string }>(`/safety-rules/${stuntType}`, { method: "DELETE" });

// ─── Production & Scene Management ────────────────────────────────────
export const updateProduction = (id: string, body: Partial<Production>) =>
  apiFetch<Production>(`/productions/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteProduction = (id: string) =>
  apiFetch<{ status: string; id: string }>(`/productions/${id}`, { method: "DELETE" });

export const createScene = (body: Partial<Scene>) =>
  apiFetch<Scene>("/scenes", { method: "POST", body: JSON.stringify(body) });
export const updateScene = (sceneId: string, body: Partial<Scene>) =>
  apiFetch<Scene>(`/scenes/${sceneId}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteScene = (sceneId: string) =>
  apiFetch<{ status: string; id: string }>(`/scenes/${sceneId}`, { method: "DELETE" });

// ─── Users ─────────────────────────────────────────────────────────────
export const listUsers = () => apiFetch<User[]>("/users");
export const createUser = (user: { email: string; display_name: string; role: string }) =>
  apiFetch<User>("/users", { method: "POST", body: JSON.stringify(user) });
export const updateUser = (userId: string, body: Partial<User>) =>
  apiFetch<User>(`/users/${userId}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteUser = (userId: string) =>
  apiFetch<{ status: string; id: string }>(`/users/${userId}`, { method: "DELETE" });

// ─── Agent chat ───────────────────────────────────────────────────────
export const askAgent = (message: string, sessionId?: string) =>
  apiFetch<{ session_id: string; response: string }>("/ask", {
    method: "POST",
    body: JSON.stringify({ message, session_id: sessionId }),
  });

// ─── Types ─────────────────────────────────────────────────────────────
export type Production = { id: string; name: string; owner_id: string; created_at: string };
export type Scene = {
  id: string;
  production_id: string;
  scene_number: string;
  header?: string;
  description: string;
  stunt_type: string;
  location: string;
  shoot_date: string;
  forecast_wind_kmh: number;
  stunt_coordinator_assigned: boolean;
  medic_onset: boolean;
  crew_signoffs: number;
  equipment_confirmed: string[];
  characters?: string[];
  dialogue_script?: { id?: string; speaker: string; text: string; pause_hint?: string; gender?: "male" | "female" | "neutral" }[];
  created_at: string;
  latest_compliance_status?: "approved" | "blocked" | null;
};
export type ActorProfile = {
  id: string;
  production_id: string;
  character_name: string;
  actor_name: string;
  bio_notes?: string;
  assigned_scene_ids: string[];
  dialogues_by_scene: Record<string, { id?: string; speaker: string; text: string; pause_hint?: string }[]>;
  rehearsal_stats?: Record<string, any>;
  created_at: string;
};
export type ComplianceResult = {
  status: "approved" | "blocked";
  scene_id: string;
  stunt_type: string;
  violations: string[];
  grafana: object;
};
export type ComplianceCheck = {
  id: string;
  scene_id: string;
  status: "approved" | "blocked";
  violations: string[];
  checked_by_agent: string;
  grafana_pushed: boolean;
  overridden_by_user_id?: string;
  override_reason?: string;
  created_at: string;
};
export type Script = {
  id: string;
  production_id: string;
  source_pdf_uri?: string;
  parsed_at?: string;
  status: "uploaded" | "parsing" | "parsed" | "failed";
  created_at: string;
};
export type MediaAsset = {
  id: string;
  scene_id: string;
  type: "storyboard_panel" | "mood_music" | "dialogue_read";
  storage_uri: string;
  generated_by_agent: string;
  prompt_used?: string;
  approved: boolean;
  approved_by_user_id?: string;
  created_at: string;
};
export type Job = {
  id: string;
  type: string;
  status: "pending" | "running" | "complete" | "failed";
  result?: object;
  error?: string;
  created_at: string;
  completed_at?: string;
};
export type RehearsalSession = {
  id: string;
  scene_id: string;
  actor_id: string;
  transcript_uri?: string;
  summary?: string;
  started_at: string;
  ended_at?: string;
};
export type Dailies = {
  id: string;
  scene_id: string;
  video_uri: string;
  transcript?: { timestamp: string; speaker: string; text: string }[];
  captions_uri?: string;
  sentiment_flags?: { timestamp: string; script_tone: string; delivered_tone: string; severity: string }[];
  caption_metadata?: {
    summary: string;
    camera_techniques: string[];
    lighting: string;
    tags: string[];
    director_take_score: number;
  };
  safety_hazard_flags?: {
    timestamp: string;
    hazard: string;
    severity: "low" | "medium" | "high";
    recommended_action: string;
  }[];
  vfx_concept_uris?: string[];
  score_audio_uri?: string;
  created_at: string;
};
export type SafetyRule = {
  stunt_type: string;
  requires_stunt_coordinator: boolean;
  requires_medic_onset: boolean;
  max_wind_speed_kmh: number;
  min_crew_signoffs: number;
  required_equipment: string[];
};
export type User = { id: string; email: string; display_name: string; role: string; created_at: string };

export type BoxOfficePredictionInput = {
  budget: number;
  release_month: number;
  genres: string[];
  runtime: number;
  is_franchise: boolean;
  has_homepage: boolean;
  stunt_count: number;
  has_high_impact_stunt: boolean;
  director_tier: "top_tier" | "mid_tier" | "indie" | "debut";
  lead_cast_tier: "superstar" | "established" | "rising" | "unknown";
  production_company_tier: "major_studio" | "mid_major" | "indie";
  script_overview?: string;
};

export type BoxOfficePredictionResult = {
  budget_usd: number;
  predicted_revenue_usd: number;
  predicted_roi_multiple: number;
  roi_category: "Flop" | "Break-even" | "Hit" | "Blockbuster";
  financial_risk_score: number;
  confidence_score: number;
  revenue_range_min: number;
  revenue_range_max: number;
  feature_drivers: {
    feature: string;
    impact_usd: number;
    impact_formatted: string;
    direction: "positive" | "negative";
  }[];
  explanation: string;
};

export const predictBoxOfficeROI = (payload: BoxOfficePredictionInput) =>
  apiFetch<BoxOfficePredictionResult>("/analytics/predict-roi", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const createScenesBatch = (payload: { production_id: string; script_id?: string; scenes: any[] }) =>
  apiFetch<{ total_created: number; scenes: Scene[] }>("/scenes/batch", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const listActorProfiles = (productionId?: string) => {
  const qs = productionId ? `?production_id=${encodeURIComponent(productionId)}` : "";
  return apiFetch<ActorProfile[]>(`/actor-profiles${qs}`);
};

export const generateDailiesVFX = (dailiesId: string, prompt: string, sceneId?: string) =>
  apiFetch<{ dailies_id: string; vfx_concept_uri: string; all_vfx_uris: string[] }>(
    `/dailies/${dailiesId}/generate-vfx`,
    {
      method: "POST",
      body: JSON.stringify({ prompt, scene_id: sceneId }),
    }
  );

export const generateDailiesScore = (dailiesId: string, genre: string) =>
  apiFetch<{ dailies_id: string; score_audio_uri: string; genre: string }>(
    `/dailies/${dailiesId}/generate-score`,
    {
      method: "POST",
      body: JSON.stringify({ genre }),
    }
  );

