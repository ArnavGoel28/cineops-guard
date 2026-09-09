"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  listDailies,
  uploadDailies,
  pollJob,
  listScenes,
  Dailies,
} from "@/lib/api";
import {
  Video,
  Upload,
  Loader2,
  Flag,
  ShieldAlert,
  Sparkles,
  Tag,
  Film,
  Award,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { useProject } from "@/components/ProjectContext";

export default function DailiesPage() {
  const { activeProjectId: productionId } = useProject();

  const { data: scenes = [] } = useQuery({
    queryKey: ["scenes", productionId],
    queryFn: async () => {
      const res = await listScenes(productionId ? { production_id: productionId } : {});
      if (res.length === 0 && productionId) {
        return listScenes({});
      }
      return res;
    },
    enabled: true,
  });

  const { data: dailies = [], refetch } = useQuery({
    queryKey: ["dailies"],
    queryFn: () => listDailies(),
    refetchInterval: 5_000,
  });

  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [selectedDailiesId, setSelectedDailiesId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"grounding" | "transcription" | "captioning">("grounding");

  const inputRef = useRef<HTMLInputElement>(null);

  const { data: jobStatus } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => pollJob(jobId!),
    enabled: !!jobId,
    refetchInterval: 1_000,
  });

  useEffect(() => {
    if (jobStatus?.status === "complete" || jobStatus?.status === "failed") {
      setJobId(null);
      refetch();
    }
  }, [jobStatus, refetch]);

  const selectedScene = scenes.find((s) => s.id === selectedSceneId);

  // Active Dailies record from database matching current selected scene or selected Dailies item
  const activeDailies: Dailies | null =
    dailies.find((d) => d.scene_id === selectedSceneId) ||
    dailies.find((d) => d.id === selectedDailiesId) ||
    null;

  const handleUpload = async () => {
    if (!file || !selectedSceneId) return;
    setUploading(true);
    try {
      const result = await uploadDailies(selectedSceneId, file);
      setJobId(result.job_id);
      if (result.dailies_id) {
        setSelectedDailiesId(result.dailies_id);
      }
      setFile(null);
      refetch();
    } catch (e) {
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 fade-in">
      {/* Header & Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#f4f4f8] flex items-center gap-2">
            <Video className="w-6 h-6 text-violet-400" />
            Director's AI Dailies Suite
            <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20">
              Multimodal Video & VFX Studio
            </span>
          </h1>
          <p className="text-xs text-[#9898a8] mt-0.5">
            Gemini Multimodal Safety Audits, Video Asset Captioning, and Imagen 3 / Lyria AI Pre-Vis Generation
          </p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left Column: Scene Selection, Script Grounding, & Ingest */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          {/* Upload & Scene Selection Panel */}
          <div className="rounded-xl border border-[#27272f] bg-[#111118] p-4 space-y-3 shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#a1a1aa] flex items-center gap-1.5 font-mono">
              <Upload className="w-3.5 h-3.5 text-violet-400" />
              Ingest Raw Footage Clip
            </p>
            <select
              value={selectedSceneId}
              onChange={(e) => setSelectedSceneId(e.target.value)}
              className="w-full bg-[#181820] border border-[#27272f] rounded-lg px-3 py-2 text-xs text-[#f4f4f8] focus:outline-none focus:border-violet-500"
            >
              <option value="">Select scene for script grounding...</option>
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.scene_number} — {s.description.slice(0, 35)}...
                </option>
              ))}
            </select>

            <div
              onClick={() => inputRef.current?.click()}
              className="border border-dashed border-[#27272f] hover:border-violet-500/50 rounded-xl p-4 text-center cursor-pointer bg-[#14141d] hover:bg-[#181824] transition-all"
            >
              <input
                ref={inputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              {file ? (
                <p className="text-xs font-semibold text-violet-300 truncate">{file.name}</p>
              ) : (
                <>
                  <Video className="w-6 h-6 text-violet-400/60 mx-auto mb-1" />
                  <p className="text-xs text-[#a1a1aa] font-medium">Click or drag raw footage clip</p>
                  <p className="text-[10px] text-[#71717a] mt-0.5">Supports MP4, MOV, WebM</p>
                </>
              )}
            </div>

            <button
              onClick={handleUpload}
              disabled={!file || !selectedSceneId || uploading || !!jobId}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-violet-600/20 disabled:opacity-50 transition-all"
            >
              {uploading || jobId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {jobId ? (jobStatus?.status === "complete" ? "Analysis Complete" : "Running Multimodal Processing...") : "Upload & Analyze Footage"}
            </button>
          </div>

          {/* Scene Script Grounding & Dialogues Display */}
          {selectedScene ? (
            <div className="rounded-xl border border-violet-500/30 bg-[#161622] p-4 space-y-3 shadow-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-violet-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                  <Film className="w-4 h-4 text-violet-400" />
                  Target Scene Script Grounding
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 font-bold border border-violet-500/30">
                  {selectedScene.scene_number}
                </span>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#f4f4f8]">{selectedScene.header || selectedScene.location}</p>
                <p className="text-xs text-[#a1a1aa] mt-0.5 leading-relaxed">{selectedScene.description}</p>
              </div>

              {selectedScene.dialogue_script && selectedScene.dialogue_script.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-[#27272f]">
                  <p className="text-[11px] font-mono uppercase font-semibold text-violet-400 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-violet-300" />
                    Scene Dialogues ({selectedScene.dialogue_script.length})
                  </p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {selectedScene.dialogue_script.map((line, idx) => (
                      <div key={idx} className="bg-[#111118] p-2.5 rounded-lg border border-[#27272f] text-xs space-y-0.5">
                        <span className="font-bold text-violet-300">{line.speaker}: </span>
                        <span className="text-[#f4f4f8]">{line.text}</span>
                        {line.pause_hint && (
                          <p className="text-[10px] text-amber-400 font-mono mt-0.5">[{line.pause_hint}]</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#27272f] bg-[#111118]/50 p-4 text-center text-xs text-[#71717a]">
              Select a scene from the dropdown to load its script dialogues & intent grounding.
            </div>
          )}

          {/* Dailies Clips Library */}
          <div className="rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden shadow-lg">
            <div className="px-4 py-2.5 border-b border-[#27272f] text-xs font-mono uppercase tracking-wider text-[#a1a1aa] flex justify-between items-center bg-[#161622]">
              <span>Ingested Dailies Clips ({dailies.length})</span>
              <Film className="w-3.5 h-3.5 text-violet-400" />
            </div>
            {dailies.length === 0 ? (
              <div className="p-5 text-center text-xs text-[#71717a]">
                No footage clips ingested yet. Select a scene above and upload a raw video clip to analyze.
              </div>
            ) : (
              <div className="divide-y divide-[#1d1d24] max-h-[300px] overflow-y-auto">
                {dailies.map((d) => {
                  const isSelected = activeDailies?.id === d.id;
                  const hazardCount = d.safety_hazard_flags?.length || 0;
                  const score = d.caption_metadata?.director_take_score;
                  return (
                    <button
                      key={d.id}
                      onClick={() => setSelectedDailiesId(d.id)}
                      className={cn(
                        "w-full text-left px-4 py-3 flex items-center gap-3 transition-colors",
                        isSelected ? "bg-violet-600/10 border-l-2 border-violet-500" : "hover:bg-[#161622]"
                      )}
                    >
                      <div className="w-8 h-8 rounded-lg bg-[#181824] border border-[#27272f] flex items-center justify-center shrink-0">
                        <Video className="w-4 h-4 text-violet-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#f4f4f8] truncate">
                          {d.video_uri.split("/").pop()}
                        </p>
                        <p className="text-[10px] text-[#71717a] font-mono mt-0.5">
                          {formatDateTime(d.created_at)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {score && (
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {score} pts
                          </span>
                        )}
                        {hazardCount > 0 && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30 flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3" />
                            {hazardCount}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: 3 Horizontal Parallel Tabs (Grounding, Transcription, Asset Captioning) */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          {/* Horizontal Parallel Tabs Header */}
          <div className="flex items-center gap-2 p-1.5 rounded-xl border border-[#27272f] bg-[#111118] shadow-lg">
            <button
              onClick={() => setActiveTab("grounding")}
              className={cn(
                "flex-1 py-2.5 px-3 rounded-lg text-xs font-bold font-mono transition-all flex items-center justify-center gap-2 border",
                activeTab === "grounding"
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/30 shadow-md"
                  : "bg-transparent text-[#a1a1aa] border-transparent hover:bg-[#1a1a24] hover:text-[#f4f4f8]"
              )}
            >
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              1. Multimodal Grounding
            </button>

            <button
              onClick={() => setActiveTab("transcription")}
              className={cn(
                "flex-1 py-2.5 px-3 rounded-lg text-xs font-bold font-mono transition-all flex items-center justify-center gap-2 border",
                activeTab === "transcription"
                  ? "bg-sky-500/15 text-sky-300 border-sky-500/30 shadow-md"
                  : "bg-transparent text-[#a1a1aa] border-transparent hover:bg-[#1a1a24] hover:text-[#f4f4f8]"
              )}
            >
              <Clock className="w-4 h-4 text-sky-400" />
              2. Transcription & Diarization
            </button>

            <button
              onClick={() => setActiveTab("captioning")}
              className={cn(
                "flex-1 py-2.5 px-3 rounded-lg text-xs font-bold font-mono transition-all flex items-center justify-center gap-2 border",
                activeTab === "captioning"
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 shadow-md"
                  : "bg-transparent text-[#a1a1aa] border-transparent hover:bg-[#1a1a24] hover:text-[#f4f4f8]"
              )}
            >
              <Tag className="w-4 h-4 text-emerald-400" />
              3. Asset Captioning & Metadata
            </button>
          </div>

          <div className="space-y-6">
            {/* Video Player Display Card */}
            <div className="rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden shadow-2xl p-4 space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-mono font-bold text-[#f4f4f8] flex items-center gap-2">
                  <Video className="w-4 h-4 text-violet-400" />
                  Active Dailies Clip: {activeDailies ? activeDailies.video_uri.split("/").pop() : "No Video Uploaded"}
                </span>
                {activeDailies && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Processed &amp; Indexed
                  </span>
                )}
              </div>

              {activeDailies ? (
                <div className="rounded-xl overflow-hidden border border-[#27272f] bg-black aspect-video relative group">
                  <video src={activeDailies.video_uri} controls className="w-full h-full object-contain" />
                </div>
              ) : (
                <div className="aspect-video bg-[#181824] rounded-xl border border-dashed border-[#27272f] flex flex-col items-center justify-center p-6 text-center">
                  <Video className="w-10 h-10 text-[#71717a] mb-2" />
                  <p className="text-xs font-semibold text-[#f4f4f8]">No Dailies Footage Selected</p>
                  <p className="text-[11px] text-[#71717a] mt-1 max-w-xs">
                    Select a scene on the left panel or upload a raw video clip to analyze multimodal grounding, transcription &amp; metadata.
                  </p>
                </div>
              )}
            </div>

            {/* ─────────────────────────────────────────────────────────────
                  SECTION 1: Multimodal Grounding (Video + Script Text + Audio)
              ───────────────────────────────────────────────────────────── */}
            {activeTab === "grounding" && (
              <div className="rounded-xl border border-[#27272f] bg-[#111118] p-5 space-y-4 shadow-xl">
                <div className="flex items-center justify-between border-b border-[#27272f] pb-3">
                  <h3 className="text-sm font-bold text-[#f4f4f8] flex items-center gap-2 font-mono">
                    <ShieldAlert className="w-4.5 h-4.5 text-amber-400" />
                    SECTION 1: Grounding (Video + Script Text + Audio)
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                    Multimodal Safety &amp; Intent Audit
                  </span>
                </div>

                {!activeDailies ? (
                  <div className="p-8 bg-[#181824] border border-[#27272f] rounded-xl text-center space-y-2">
                    <ShieldAlert className="w-8 h-8 text-amber-400/50 mx-auto" />
                    <p className="text-xs font-semibold text-[#f4f4f8]">No Safety Grounding Audit Available</p>
                    <p className="text-xs font-mono text-[#71717a]">Upload a video clip for Scene {selectedScene?.scene_number || "this scene"} to execute multimodal grounding.</p>
                  </div>
                ) : (
                  <>
                    {/* Safety Hazard Alerts Banner */}
                    {activeDailies.safety_hazard_flags && activeDailies.safety_hazard_flags.length > 0 ? (
                      <div className="space-y-2 bg-red-500/10 border border-red-500/30 p-4 rounded-xl">
                        <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider font-mono flex items-center gap-1.5">
                          <ShieldAlert className="w-4 h-4 text-red-400" />
                          Multimodal Safety Hazards Detected ({activeDailies.safety_hazard_flags.length})
                        </h4>
                        <div className="space-y-2">
                          {activeDailies.safety_hazard_flags.map((h, idx) => (
                            <div key={idx} className="flex items-start gap-2 bg-[#111118]/90 p-3 rounded-lg border border-red-500/20 text-xs">
                              <span className="font-mono text-red-400 font-bold shrink-0 px-1.5 py-0.5 bg-red-500/10 rounded">{h.timestamp}</span>
                              <div className="flex-1">
                                <p className="text-[#f4f4f8] font-medium">{h.hazard}</p>
                                <p className="text-[11px] text-[#a1a1aa] mt-0.5">
                                  Recommended Action: <span className="text-emerald-400 font-semibold">{h.recommended_action}</span>
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex items-center gap-2 font-mono">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        No physical safety hazard violations detected during multimodal frame analysis.
                      </div>
                    )}

                    {/* Grounding Sentiment & Script Tone Matching */}
                    <div className="space-y-2 pt-2">
                      <h4 className="text-xs font-semibold text-[#a1a1aa] uppercase font-mono tracking-wider flex items-center gap-1.5">
                        <Flag className="w-3.5 h-3.5 text-amber-400" />
                        Script Grounding &amp; Tone Alignment Flags
                      </h4>
                      {!activeDailies.sentiment_flags || activeDailies.sentiment_flags.length === 0 ? (
                        <div className="p-3 bg-[#181824] rounded-xl border border-[#27272f] text-xs text-[#a1a1aa]">
                          No script tone mismatch flags detected. Delivered performance matches script intent.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {activeDailies.sentiment_flags.map((flag, idx) => (
                            <div key={idx} className="p-3 rounded-xl border bg-amber-500/5 border-amber-500/30 text-xs space-y-1">
                              <div className="flex items-center gap-2 font-mono text-amber-300">
                                <span className="font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">{flag.timestamp}</span>
                                <span>Script Tone: <strong>{flag.script_tone}</strong></span>
                                <span>vs</span>
                                <span>Delivered Tone: <strong>{flag.delivered_tone}</strong></span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                  SECTION 2: Video Transcription & Speaker Diarization
              ───────────────────────────────────────────────────────────── */}
            {activeTab === "transcription" && (
              <div className="rounded-xl border border-[#27272f] bg-[#111118] p-5 space-y-4 shadow-xl">
                <div className="flex items-center justify-between border-b border-[#27272f] pb-3">
                  <h3 className="text-sm font-bold text-[#f4f4f8] flex items-center gap-2 font-mono">
                    <Clock className="w-4.5 h-4.5 text-sky-400" />
                    SECTION 2: Video Transcription &amp; Speaker Diarization
                  </h3>
                  <div className="flex items-center gap-2">
                    {activeDailies?.captions_uri && (
                      <a
                        href={activeDailies.captions_uri}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-mono px-2.5 py-1 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 hover:bg-sky-500/20 transition-all flex items-center gap-1 font-semibold"
                      >
                        Download .SRT Subtitles
                      </a>
                    )}
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20">
                      Gemini 2.5 Audio Diarization
                    </span>
                  </div>
                </div>

                {!activeDailies || !activeDailies.transcript || activeDailies.transcript.length === 0 ? (
                  <div className="p-8 bg-[#181824] border border-[#27272f] rounded-xl text-center space-y-2">
                    <Clock className="w-8 h-8 text-sky-400/50 mx-auto" />
                    <p className="text-xs font-semibold text-[#f4f4f8]">No Audio Transcript Available</p>
                    <p className="text-xs font-mono text-[#71717a]">Upload a video clip to generate comprehensive speaker diarized transcription.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-[#a1a1aa] uppercase font-mono tracking-wider flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-sky-400" />
                      Speaker Diarized Dialogue Turns ({activeDailies.transcript.length})
                    </h4>
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {activeDailies.transcript.map((seg, idx) => (
                        <div key={idx} className="p-3.5 rounded-xl bg-[#181824] border border-[#27272f] text-xs space-y-1 shadow-sm">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded text-[11px]">{seg.timestamp}</span>
                              <span className="font-bold text-[#f4f4f8] font-mono">{seg.speaker}</span>
                            </div>
                          </div>
                          <p className="text-[#d4d4d8] pt-1 leading-relaxed">&quot;{seg.text}&quot;</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                  SECTION 3: Video Asset Captioning & Searchable Metadata
              ───────────────────────────────────────────────────────────── */}
            {activeTab === "captioning" && (
              <div className="rounded-xl border border-[#27272f] bg-[#111118] p-5 space-y-4 shadow-xl">
                <div className="flex items-center justify-between border-b border-[#27272f] pb-3">
                  <h3 className="text-sm font-bold text-[#f4f4f8] flex items-center gap-2 font-mono">
                    <Tag className="w-4.5 h-4.5 text-emerald-400" />
                    SECTION 3: Video Asset Captioning &amp; Searchable Metadata
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    Multimodal Indexing Engine
                  </span>
                </div>

                {!activeDailies || !activeDailies.caption_metadata ? (
                  <div className="p-8 bg-[#181824] border border-[#27272f] rounded-xl text-center space-y-2">
                    <Tag className="w-8 h-8 text-emerald-400/50 mx-auto" />
                    <p className="text-xs font-semibold text-[#f4f4f8]">No Video Captioning Metadata Available</p>
                    <p className="text-xs font-mono text-[#71717a]">Upload a video clip to generate camera techniques, lighting, and searchable tags.</p>
                  </div>
                ) : (
                  <div className="space-y-4 text-xs">
                    {/* Take Score & Executive Summary */}
                    <div className="bg-[#181824] p-4 rounded-xl border border-[#27272f] space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-mono text-[#a1a1aa] uppercase font-semibold">Gemini Executive Summary</p>
                        <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono font-bold text-xs">
                          <Award className="w-3.5 h-3.5 text-emerald-400" />
                          Director Take Score: 92 / 100
                        </div>
                      </div>
                      <p className="text-[#f4f4f8] leading-relaxed text-xs">{activeDailies.caption_metadata.summary}</p>
                    </div>

                    {/* Camera Techniques & Lighting */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-[#181824] p-3.5 rounded-xl border border-[#27272f]">
                        <p className="text-[11px] font-mono text-[#a1a1aa] uppercase font-semibold mb-2">Camera Movement &amp; Shot Type</p>
                        <div className="flex flex-wrap gap-1.5">
                          {activeDailies.caption_metadata.camera_techniques?.map((tech, i) => (
                            <span key={i} className="px-2.5 py-1 rounded-md bg-violet-500/10 text-violet-300 border border-violet-500/20 text-xs font-medium">
                              {tech}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="bg-[#181824] p-3.5 rounded-xl border border-[#27272f]">
                        <p className="text-[11px] font-mono text-[#a1a1aa] uppercase font-semibold mb-1.5">Lighting Setup</p>
                        <p className="text-[#f4f4f8] font-medium text-xs">{activeDailies.caption_metadata.lighting}</p>
                      </div>
                    </div>

                    {/* Searchable Tags */}
                    <div className="bg-[#181824] p-3.5 rounded-xl border border-[#27272f]">
                      <p className="text-[11px] font-mono text-[#a1a1aa] uppercase font-semibold mb-2">Searchable Scene Tags</p>
                      <div className="flex flex-wrap gap-1.5">
                        {activeDailies.caption_metadata.tags?.map((tag, i) => (
                          <span key={i} className="px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono text-xs">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
