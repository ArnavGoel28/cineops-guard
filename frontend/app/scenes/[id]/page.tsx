"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getScene, getComplianceHistory, checkScene, overrideCompliance, listMediaAssets, generateStoryboard, generateMusic, approveMediaAsset, pollJob } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { stuntTypeLabel, stuntTypeBadge, formatDateTime, cn } from "@/lib/utils";
import { Shield, ImageIcon, Music, FileText, RefreshCw, CheckCircle, AlertTriangle, Loader2, ThumbsUp } from "lucide-react";
import { use, useState, useEffect } from "react";

type Params = Promise<{ id: string }>;

const TABS = ["Compliance", "Storyboard", "Audio", "Script"] as const;
type Tab = typeof TABS[number];

export default function SceneDetailPage({ params }: { params: Params }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("Compliance");
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [storyboardPrompt, setStoryboardPrompt] = useState("");
  const [storyboardStyleNotes, setStoryboardStyleNotes] = useState("");
  const [musicDesc, setMusicDesc] = useState("");
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);

  const { data: scene, isLoading: sceneLoading } = useQuery({
    queryKey: ["scene", id],
    queryFn: () => getScene(id),
  });

  const { data: checks = [] } = useQuery({
    queryKey: ["compliance-history", id],
    queryFn: () => getComplianceHistory({ scene_id: id }),
    refetchInterval: 10_000,
  });

  const { data: assets = [] } = useQuery({
    queryKey: ["media-assets", id],
    queryFn: () => listMediaAssets({ scene_id: id }),
    refetchInterval: pollingJobId ? 3_000 : false,
  });

  // Poll for job completion
  const { data: jobStatus } = useQuery({
    queryKey: ["job", pollingJobId],
    queryFn: () => pollJob(pollingJobId!),
    enabled: !!pollingJobId,
    refetchInterval: 2_000,
  });

  useEffect(() => {
    if (jobStatus?.status === "complete" || jobStatus?.status === "failed") {
      setPollingJobId(null);
      qc.invalidateQueries({ queryKey: ["media-assets", id] });
    }
  }, [jobStatus]);

  const runCheck = useMutation({
    mutationFn: () => checkScene(scene!.scene_number),
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["scene"] }); 
      qc.invalidateQueries({ queryKey: ["scenes"] }); 
      qc.invalidateQueries({ queryKey: ["compliance-history"] }); 
    },
  });

  const doOverride = useMutation({
    mutationFn: () => overrideCompliance(checks[0]?.id, overrideReason),
    onSuccess: () => { 
      setOverrideMode(false); 
      setOverrideReason(""); 
      qc.invalidateQueries({ queryKey: ["scene"] }); 
      qc.invalidateQueries({ queryKey: ["scenes"] }); 
      qc.invalidateQueries({ queryKey: ["compliance-history"] }); 
    },
  });

  const genStoryboard = useMutation({
    mutationFn: () => generateStoryboard({ scene_id: id, description: storyboardPrompt, style_notes: storyboardStyleNotes || undefined }),
    onSuccess: (data) => { setPollingJobId(data.job_id); setStoryboardPrompt(""); },
  });

  const genMusic = useMutation({
    mutationFn: () => generateMusic({ scene_id: id, description: musicDesc }),
    onSuccess: (data) => { setPollingJobId(data.job_id); setMusicDesc(""); },
  });

  const approveAsset = useMutation({
    mutationFn: (assetId: string) => approveMediaAsset(assetId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["media-assets", id] }),
  });

  const latestCheck = checks[0];
  const storyboards = assets.filter(a => a.type === "storyboard_panel");
  const music = assets.filter(a => a.type === "mood_music");
  const dialogueReads = assets.filter(a => a.type === "dialogue_read");

  if (sceneLoading) return <div className="p-6 fade-in"><div className="h-32 shimmer rounded-xl" /></div>;
  if (!scene) return <div className="p-6 text-[#9898a8]">Scene not found</div>;

  return (
    <div className="p-6 space-y-5 fade-in">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[#9898a8] text-sm">{scene.scene_number}</span>
            <span className={cn("text-xs px-1.5 py-0.5 rounded border font-mono", stuntTypeBadge(scene.stunt_type))}>
              {stuntTypeLabel(scene.stunt_type)}
            </span>
          </div>
          <h1 className="text-xl font-semibold text-[#f4f4f8]">{scene.description}</h1>
          <p className="text-sm text-[#9898a8] mt-0.5">{scene.location} · {scene.shoot_date || "Date TBD"}</p>
        </div>
        <StatusBadge status={scene.latest_compliance_status} size="lg" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#27272f]">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t ? "border-violet-500 text-[#f4f4f8]" : "border-transparent text-[#9898a8] hover:text-[#f4f4f8]"
            )}
          >
            {t === "Compliance" && <Shield className="w-3.5 h-3.5" />}
            {t === "Storyboard" && <ImageIcon className="w-3.5 h-3.5" />}
            {t === "Audio" && <Music className="w-3.5 h-3.5" />}
            {t === "Script" && <FileText className="w-3.5 h-3.5" />}
            {t}
          </button>
        ))}
      </div>

      {/* ── COMPLIANCE TAB ── */}
      {tab === "Compliance" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              onClick={() => runCheck.mutate()}
              disabled={runCheck.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#18181f] hover:bg-[#1f1f28] text-[#f4f4f8] text-sm font-medium border border-[#27272f] transition-colors disabled:opacity-50"
            >
              {runCheck.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
              Run Compliance Check
            </button>
            {latestCheck?.status === "blocked" && !overrideMode && (
              <button
                onClick={() => setOverrideMode(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-sm font-medium border border-amber-500/30 transition-colors"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Override Block
              </button>
            )}
          </div>

          {/* Override form */}
          {overrideMode && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <p className="text-sm font-medium text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Safety Override — Human Approval Required
              </p>
              <p className="text-xs text-[#9898a8]">
                This action inserts a new approved check with your name and reason. The original block is preserved in the audit log.
              </p>
              <textarea
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                placeholder="Reason for override (required — must be specific about what was resolved)..."
                rows={3}
                className="w-full bg-[#18181f] border border-[#27272f] rounded-lg px-3 py-2 text-sm text-[#f4f4f8] placeholder-[#5a5a6e] focus:outline-none focus:border-amber-500/50 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => doOverride.mutate()}
                  disabled={!overrideReason.trim() || doOverride.isPending}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {doOverride.isPending ? "Submitting..." : "Submit Override"}
                </button>
                <button onClick={() => { setOverrideMode(false); setOverrideReason(""); }} className="px-3 py-1.5 text-[#9898a8] text-sm hover:text-[#f4f4f8]">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Latest check result */}
          {latestCheck && (
            <div className={cn("rounded-xl border p-4 space-y-3", latestCheck.status === "approved" ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5")}>
              <div className="flex items-center justify-between">
                <StatusBadge status={latestCheck.status} size="lg" />
                <span className="text-xs text-[#5a5a6e] font-mono">{formatDateTime(latestCheck.created_at)}</span>
              </div>
              {latestCheck.violations.length > 0 && (
                <ul className="space-y-1.5">
                  {latestCheck.violations.map((v, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-red-300">
                      <span className="text-red-500 mt-0.5 shrink-0">✗</span>
                      {v}
                    </li>
                  ))}
                </ul>
              )}
              {latestCheck.overridden_by_user_id && (
                <div className="text-xs text-amber-400 border-t border-amber-500/20 pt-2">
                  ⚠ Human override — {latestCheck.override_reason}
                </div>
              )}
              <div className="text-xs text-[#5a5a6e] font-mono">Agent: {latestCheck.checked_by_agent} · Grafana: {latestCheck.grafana_pushed ? "✓ pushed" : "not pushed"}</div>
            </div>
          )}

          {/* Full history */}
          {checks.length > 1 && (
            <div className="rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#27272f] text-xs text-[#5a5a6e] font-medium">FULL AUDIT TRAIL</div>
              <div className="divide-y divide-[#1d1d24]">
                {checks.map(c => (
                  <div key={c.id} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                    <StatusBadge status={c.status} size="sm" />
                    <span className="text-[#9898a8] font-mono">{formatDateTime(c.created_at)}</span>
                    <span className="text-[#5a5a6e]">{c.checked_by_agent}</span>
                    {c.violations.length > 0 && <span className="text-red-400 truncate max-w-xs">{c.violations.join("; ")}</span>}
                    {c.overridden_by_user_id && <span className="text-amber-400">human override</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── STORYBOARD TAB ── */}
      {tab === "Storyboard" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#27272f] bg-[#18181f] p-4 space-y-3">
            <p className="text-sm font-medium text-[#f4f4f8]">Generate Storyboard Panels</p>
            <textarea
              value={storyboardPrompt}
              onChange={e => setStoryboardPrompt(e.target.value)}
              placeholder="Describe the scene visually — action, camera angle, lighting..."
              rows={2}
              className="w-full bg-[#111118] border border-[#27272f] rounded-lg px-3 py-2 text-sm text-[#f4f4f8] placeholder-[#5a5a6e] focus:outline-none focus:border-violet-500/50 resize-none"
            />
            <input
              value={storyboardStyleNotes}
              onChange={e => setStoryboardStyleNotes(e.target.value)}
              placeholder="Style notes (optional) — e.g. day-for-night, high contrast, Dutch angle..."
              className="w-full bg-[#111118] border border-[#27272f] rounded-lg px-3 py-2 text-sm text-[#f4f4f8] placeholder-[#5a5a6e] focus:outline-none focus:border-violet-500/50"
            />
            <button
              onClick={() => genStoryboard.mutate()}
              disabled={!storyboardPrompt.trim() || genStoryboard.isPending || !!pollingJobId}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {(genStoryboard.isPending || pollingJobId) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
              {pollingJobId ? "Generating panels..." : "Generate Panels"}
            </button>
          </div>

          {pollingJobId && (
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
              <div>
                <p className="text-sm text-violet-300 font-medium">Imagen 3 is generating your panels...</p>
                <p className="text-xs text-[#9898a8] mt-0.5">This usually takes 15–30 seconds</p>
              </div>
            </div>
          )}

          {storyboards.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              {storyboards.map(asset => (
                <div key={asset.id} className={cn("rounded-xl border overflow-hidden bg-[#18181f]", asset.approved ? "border-emerald-500/40" : "border-[#27272f]")}>
                  <div className="aspect-video bg-[#0d0d12] relative overflow-hidden group">
                    <img 
                      src={asset.storage_uri} 
                      alt={asset.prompt_used || "Storyboard Panel"} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    {asset.approved && (
                      <span className="absolute top-2 right-2 bg-emerald-500/90 text-white text-xs px-2 py-0.5 rounded font-mono shadow-md font-semibold">LOCKED IN</span>
                    )}
                  </div>
                  <div className="px-3 py-2.5 flex items-center justify-between bg-[#18181f]">
                    <span className="text-xs text-[#5a5a6e] font-mono">{formatDateTime(asset.created_at)}</span>
                    {!asset.approved && (
                      <button
                        onClick={() => approveAsset.mutate(asset.id)}
                        className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 font-medium px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/30"
                      >
                        <ThumbsUp className="w-3 h-3" />
                        Approve Panel
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── AUDIO TAB ── */}
      {tab === "Audio" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#27272f] bg-[#18181f] p-4 space-y-3">
            <p className="text-sm font-medium text-[#f4f4f8]">Generate Mood Music</p>
            <input
              value={musicDesc}
              onChange={e => setMusicDesc(e.target.value)}
              placeholder="Describe the emotional tone and action — e.g. 'tense chase, urban thriller, high energy'"
              className="w-full bg-[#111118] border border-[#27272f] rounded-lg px-3 py-2 text-sm text-[#f4f4f8] placeholder-[#5a5a6e] focus:outline-none focus:border-violet-500/50"
            />
            <button
              onClick={() => genMusic.mutate()}
              disabled={!musicDesc.trim() || genMusic.isPending || !!pollingJobId}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {(genMusic.isPending || pollingJobId) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Music className="w-3.5 h-3.5" />}
              {pollingJobId ? "Generating music..." : "Generate Music"}
            </button>
          </div>

          {[...music, ...dialogueReads].length > 0 && (
            <div className="space-y-3">
              {[...music, ...dialogueReads].map(asset => (
                <div key={asset.id} className={cn("rounded-xl border p-4 space-y-3", asset.approved ? "border-emerald-500/40 bg-emerald-500/5" : "border-[#27272f] bg-[#18181f]")}>
                  <div className="flex items-center gap-3">
                    <Music className="w-5 h-5 text-violet-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-[#f4f4f8] font-medium">{asset.type === "mood_music" ? "Mood Music Track" : "Dialogue Read"}</p>
                        <span className="text-xs text-[#5a5a6e] font-mono">{formatDateTime(asset.created_at)}</span>
                      </div>
                      {asset.prompt_used && <p className="text-xs text-[#9898a8] mt-0.5 truncate">{asset.prompt_used}</p>}
                    </div>
                    {!asset.approved && (
                      <button onClick={() => approveAsset.mutate(asset.id)} className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 font-medium px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/30">
                        <ThumbsUp className="w-3 h-3" />
                        Approve Track
                      </button>
                    )}
                    {asset.approved && <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />}
                  </div>
                  <audio controls src={asset.storage_uri} className="w-full h-9 rounded-lg focus:outline-none" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SCRIPT TAB ── */}
      {tab === "Script" && (
        <div className="rounded-xl border border-[#27272f] bg-[#111118] p-5 space-y-3">
          <p className="text-xs text-[#5a5a6e] font-mono uppercase tracking-wider">Scene Excerpt — {scene.scene_number}</p>
          <div className="space-y-2">
            <div><span className="text-xs text-[#5a5a6e]">Location:</span> <span className="text-sm text-[#f4f4f8]">{scene.location || "—"}</span></div>
            <div><span className="text-xs text-[#5a5a6e]">Stunt type:</span> <span className="text-sm text-[#f4f4f8]">{stuntTypeLabel(scene.stunt_type)}</span></div>
            <div><span className="text-xs text-[#5a5a6e]">Wind forecast:</span> <span className="text-sm text-[#f4f4f8] font-mono">{scene.forecast_wind_kmh != null ? `${scene.forecast_wind_kmh} km/h` : "—"}</span></div>
            <div><span className="text-xs text-[#5a5a6e]">Crew signoffs:</span> <span className="text-sm text-[#f4f4f8] font-mono">{scene.crew_signoffs}</span></div>
            <div><span className="text-xs text-[#5a5a6e]">Equipment confirmed:</span> <span className="text-sm text-[#f4f4f8] font-mono">{scene.equipment_confirmed?.join(", ") || "none"}</span></div>
          </div>
          <div className="border-t border-[#27272f] pt-3">
            <p className="text-sm text-[#f4f4f8] leading-relaxed">{scene.description}</p>
          </div>
        </div>
      )}
    </div>
  );
}
