"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createScript,
  uploadScriptPDF,
  pollJob,
  listScenes,
  createScenesBatch,
  Scene,
} from "@/lib/api";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  ChevronRight,
  Plus,
  Trash2,
  Check,
  Edit3,
  ShieldCheck,
  Eye,
  AlertTriangle,
  User,
  MapPin,
  Flame,
  Film,
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import Link from "next/link";
import { cn } from "@/lib/utils";

import { useProject } from "@/components/ProjectContext";

export default function IntakePage() {
  const qc = useQueryClient();
  const { activeProjectId: productionId, activeProject } = useProject();

  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [draftScenes, setDraftScenes] = useState<any[]>([]);
  const [editingIndices, setEditingIndices] = useState<Record<number, boolean>>({});
  const [isIngested, setIsIngested] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: jobStatus } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => pollJob(jobId!),
    enabled: !!jobId,
    refetchInterval: 2_000,
  });

  const { data: scenes = [] } = useQuery({
    queryKey: ["scenes", productionId],
    queryFn: () => listScenes({ production_id: productionId }),
    enabled: !!productionId,
  });

  // When job completes, populate draft scenes for user review
  useEffect(() => {
    if (jobStatus?.status === "complete" && !isIngested) {
      const extracted = (jobStatus.result as any)?.scenes || [];
      if (extracted.length > 0 && draftScenes.length === 0) {
        setDraftScenes(extracted);
      }
    }
  }, [jobStatus, isIngested, draftScenes.length]);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file || !productionId) throw new Error("No file or production selected.");
      setDraftScenes([]);
      setIsIngested(false);
      setBatchError(null);
      const script = await createScript(productionId);
      setScriptId(script.id);
      const result = await uploadScriptPDF(script.id, productionId, file);
      setJobId(result.job_id);
    },
    onError: (err: any) => {
      setBatchError(err.message || "Failed to upload script");
    },
  });

  const confirmBatch = useMutation({
    mutationFn: async () => {
      setBatchError(null);
      if (!productionId) throw new Error("No active film project selected.");
      if (draftScenes.length === 0) throw new Error("No extracted stunt scenes to confirm.");

      const result = await createScenesBatch({
        production_id: productionId,
        script_id: scriptId || undefined,
        scenes: draftScenes,
      });
      return result;
    },
    onSuccess: () => {
      setIsIngested(true);
      qc.invalidateQueries({ queryKey: ["scenes"] });
      qc.invalidateQueries({ queryKey: ["scenes-all"] });
    },
    onError: (err: any) => {
      setBatchError(err.message || "Failed to confirm and ingest scenes");
    },
  });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f?.type === "application/pdf") setFile(f);
  };

  const updateDraftScene = (index: number, field: string, value: any) => {
    setDraftScenes((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const toggleEditMode = (index: number) => {
    setEditingIndices((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const removeDraftScene = (index: number) => {
    setDraftScenes((prev) => prev.filter((_, i) => i !== index));
  };

  const addDraftScene = () => {
    const newIdx = draftScenes.length;
    setDraftScenes((prev) => [
      ...prev,
      {
        scene_number: `SC-${String(prev.length + 1).padStart(3, "0")}`,
        header: "EXT. CITY PLAZA - DAY (ROOFTOP HIGH FALL)",
        description: "High fall from skyscraper roof onto safety air bag with wire deceleration system",
        stunt_type: "High Fall & Wirework",
        location: "City Center Plaza",
        stunt_coordinator_assigned: true,
        medic_onset: true,
      },
    ]);
    setEditingIndices((prev) => ({ ...prev, [newIdx]: true }));
  };

  return (
    <div className="p-6 space-y-6 fade-in max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold text-[#f4f4f8]">
          Script Intake & Stunt Finalization
        </h1>
        <p className="text-sm text-[#9898a8] mt-0.5">
          Upload a screenplay PDF. Review the full extracted stunt text, customize parameters, and confirm ingestion into project{" "}
          <span className="text-violet-400 font-medium">({activeProject?.name || "Selected"})</span>.
        </p>
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all",
          drag
            ? "border-violet-500/60 bg-violet-500/5"
            : "border-[#27272f] hover:border-[#3a3a4a] bg-[#111118]",
          file ? "border-violet-500/40" : ""
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <FileText className="w-8 h-8 text-violet-400" />
            <div className="text-left">
              <p className="text-sm font-medium text-[#f4f4f8]">{file.name}</p>
              <p className="text-xs text-[#9898a8]">
                {(file.size / 1024).toFixed(1)} KB · Click to change
              </p>
            </div>
          </div>
        ) : (
          <>
            <Upload className="w-10 h-10 text-[#3a3a4a] mx-auto mb-3" />
            <p className="text-sm font-medium text-[#9898a8]">
              Drop a PDF script here, or click to browse
            </p>
            <p className="text-xs text-[#5a5a6e] mt-1">Screenplay or call sheet · PDF format</p>
          </>
        )}
      </div>

      <button
        onClick={() => upload.mutate()}
        disabled={!file || !productionId || upload.isPending || !!jobId}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-medium text-sm disabled:opacity-50 transition-colors shadow-lg shadow-violet-600/20"
      >
        {upload.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Upload className="w-4 h-4" />
        )}
        {upload.isPending ? "Uploading Script..." : "Extract Stunts with Gemini"}
      </button>

      {/* Parsing Status */}
      {jobId && (
        <div
          className={cn(
            "rounded-xl border p-4 space-y-2",
            jobStatus?.status === "complete"
              ? "border-emerald-500/30 bg-emerald-500/5"
              : jobStatus?.status === "failed"
              ? "border-red-500/30 bg-red-500/5"
              : "border-violet-500/30 bg-violet-500/5"
          )}
        >
          <div className="flex items-center gap-2">
            {jobStatus?.status === "complete" ? (
              <CheckCircle className="w-5 h-5 text-emerald-400" />
            ) : jobStatus?.status === "failed" ? (
              <XCircle className="w-5 h-5 text-red-400" />
            ) : (
              <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
            )}
            <span className="text-sm font-medium text-[#f4f4f8]">
              {jobStatus?.status === "complete"
                ? `✓ Script Analysis Complete: ${draftScenes.length} stunts extracted for review`
                : jobStatus?.status === "failed"
                ? `Parsing failed: ${jobStatus.error}`
                : "ScriptIntakeAgent analyzing screenplay with Gemini..."}
            </span>
          </div>
        </div>
      )}

      {/* Error Alert Banner */}
      {batchError && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{batchError}</span>
        </div>
      )}

      {/* Draft Stunt Review & Finalization Panel */}
      {jobStatus?.status === "complete" && draftScenes.length > 0 && !isIngested && (
        <div className="rounded-2xl border border-violet-500/30 bg-[#111118] overflow-hidden shadow-2xl space-y-4 p-6 fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#27272f] pb-4 gap-3">
            <div>
              <h2 className="text-base font-bold text-[#f4f4f8] flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-violet-400" />
                Review & Edit Extracted Stunts ({draftScenes.length})
              </h2>
              <p className="text-xs text-[#a1a1aa] mt-0.5">
                Read full Gemini stunt outputs below. Click <strong>Edit Stunt</strong> to modify description text, stunt type, or parameters before ingesting.
              </p>
            </div>
            <button
              onClick={addDraftScene}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1c1c28] hover:bg-[#252535] text-violet-300 text-xs font-semibold border border-violet-500/30 transition-all shrink-0"
            >
              <Plus className="w-4 h-4" /> Add Custom Stunt
            </button>
          </div>

          {/* Stunt Cards Container */}
          <div className="space-y-4 max-h-[580px] overflow-y-auto pr-1">
            {draftScenes.map((sc, idx) => {
              const isEditing = editingIndices[idx];
              const autoSceneNum = sc.scene_number || `SC-${String(idx + 1).padStart(3, '0')}`;
              const sceneHeader = sc.header || sc.location || `SCENE ${autoSceneNum}`;

              return (
                <div
                  key={idx}
                  className={cn(
                    "rounded-xl border p-4 transition-all space-y-3.5",
                    isEditing
                      ? "border-violet-500/50 bg-[#171724]"
                      : "border-[#27272f] bg-[#14141e] hover:border-[#38384a]"
                  )}
                >
                  {/* Card Header Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#242432] pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Auto Assigned Scene ID */}
                      <span className="font-mono text-xs font-bold text-violet-400 bg-violet-500/10 px-2.5 py-1 rounded border border-violet-500/20">
                        {autoSceneNum}
                      </span>
                      {/* Dynamic Stunt Category */}
                      <span className="text-xs font-mono px-2.5 py-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-semibold">
                        {sc.stunt_type || "practical_effect"}
                      </span>
                      {sc.location && (
                        <span className="text-xs text-[#a1a1aa] flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-[#71717a]" /> {sc.location}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleEditMode(idx)}
                        className={cn(
                          "px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border",
                          isEditing
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                            : "bg-[#1f1f2c] text-[#f4f4f8] border-[#27272f] hover:bg-[#282838]"
                        )}
                      >
                        {isEditing ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" /> Done Editing
                          </>
                        ) : (
                          <>
                            <Edit3 className="w-3.5 h-3.5 text-violet-400" /> Edit Stunt
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => removeDraftScene(idx)}
                        className="p-1.5 hover:bg-red-500/10 text-red-400 rounded-lg transition-colors"
                        title="Remove Stunt"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Read Mode (Separated Header and Full Action Description) */}
                  {!isEditing ? (
                    <div className="space-y-2.5 text-xs">
                      {/* Scene Header (What is inside the stunt) */}
                      <div>
                        <span className="text-[10px] uppercase font-mono text-[#71717a] block mb-0.5">
                          Scene Header / Title (Location & Stunt Summary)
                        </span>
                        <div className="text-sm font-bold text-violet-200 tracking-wide bg-[#09090e] px-3 py-2 rounded-lg border border-[#1e1e2d] flex items-center gap-2">
                          <Film className="w-4 h-4 text-violet-400 shrink-0" />
                          <span>{sceneHeader}</span>
                        </div>
                      </div>

                      {/* Stunt Action Description */}
                      <div>
                        <span className="text-[10px] uppercase font-mono text-[#71717a] block mb-0.5">
                          Stunt Action Description (Full Un-truncated Gemini Output)
                        </span>
                        <p className="text-[#f4f4f8] leading-relaxed whitespace-pre-wrap bg-[#0d0d14] p-3 rounded-lg border border-[#20202c]">
                          {sc.description || "No stunt description extracted."}
                        </p>
                      </div>

                      {(sc.stunt_flags?.length > 0 || sc.characters?.length > 0) && (
                        <div className="flex flex-wrap gap-3 pt-1 text-[11px]">
                          {sc.characters?.length > 0 && (
                            <div className="flex items-center gap-1.5 text-[#a1a1aa]">
                              <User className="w-3 h-3 text-violet-400" />
                              <span>Characters: {sc.characters.join(", ")}</span>
                            </div>
                          )}
                          {sc.stunt_flags?.length > 0 && (
                            <div className="flex items-center gap-1.5 text-amber-400 font-medium">
                              <Flame className="w-3 h-3 text-amber-400" />
                              <span>Safety Flags: {sc.stunt_flags.join(", ")}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Edit Mode Controls */
                    <div className="space-y-3.5 text-xs fade-in">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[10px] text-[#a1a1aa] uppercase font-mono mb-1">
                            Auto Scene ID
                          </label>
                          <input
                            type="text"
                            value={sc.scene_number || autoSceneNum}
                            onChange={(e) => updateDraftScene(idx, "scene_number", e.target.value)}
                            className="w-full bg-[#0d0d14] border border-[#27272f] rounded-lg px-2.5 py-1.5 text-xs text-violet-300 font-mono focus:border-violet-500"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-[10px] text-[#a1a1aa] uppercase font-mono mb-1">
                            Scene Header (tells what is inside stunt)
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. EXT. JAIPUR HIGHWAY - NIGHT (MOTORCYCLE PURSUIT)"
                            value={sc.header || sceneHeader}
                            onChange={(e) => updateDraftScene(idx, "header", e.target.value)}
                            className="w-full bg-[#0d0d14] border border-[#27272f] rounded-lg px-2.5 py-1.5 text-xs text-[#f4f4f8] focus:border-violet-500 font-medium"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] text-[#a1a1aa] uppercase font-mono mb-1">
                            Stunt Category (Dynamic LLM / Custom)
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. High-Speed Vehicle Chase, Pyrotechnic Explosion"
                            value={sc.stunt_type || ""}
                            onChange={(e) => updateDraftScene(idx, "stunt_type", e.target.value)}
                            className="w-full bg-[#0d0d14] border border-[#27272f] rounded-lg px-2.5 py-1.5 text-xs text-amber-300 focus:border-violet-500 font-mono"
                          />
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {["Vehicle Chase", "High Fall", "Pyrotechnic Explosion", "Underwater Rescue", "Martial Arts Wirework", "Building Jump"].map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => updateDraftScene(idx, "stunt_type", preset)}
                                className="text-[10px] px-2 py-0.5 rounded bg-[#1c1c28] hover:bg-[#28283a] text-amber-400 border border-amber-500/20"
                              >
                                + {preset}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] text-[#a1a1aa] uppercase font-mono mb-1">
                            Location
                          </label>
                          <input
                            type="text"
                            value={sc.location || ""}
                            onChange={(e) => updateDraftScene(idx, "location", e.target.value)}
                            className="w-full bg-[#0d0d14] border border-[#27272f] rounded-lg px-2.5 py-1.5 text-xs text-[#f4f4f8] focus:border-violet-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] text-[#a1a1aa] uppercase font-mono mb-1">
                          Full Action & Stunt Description
                        </label>
                        <textarea
                          rows={4}
                          value={sc.description || ""}
                          onChange={(e) => updateDraftScene(idx, "description", e.target.value)}
                          className="w-full bg-[#0d0d14] border border-[#27272f] rounded-lg px-3 py-2 text-xs text-[#f4f4f8] leading-relaxed focus:border-violet-500 font-sans"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Confirm & Ingest Action Button */}
          <div className="pt-4 border-t border-[#27272f] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs text-[#71717a] font-mono">
              Ready to commit {draftScenes.length} confirmed stunt records to Project ({activeProject?.name})
            </span>
            <button
              onClick={() => confirmBatch.mutate()}
              disabled={confirmBatch.isPending || draftScenes.length === 0}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50"
            >
              {confirmBatch.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              Confirm & Ingest Stunts into Project ({activeProject?.name})
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Success & Project Ingested Scenes */}
      {isIngested && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-3 fade-in">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
            <CheckCircle className="w-5 h-5" />
            ✓ Stunts Successfully Confirmed & Ingested into Project "{activeProject?.name}"
          </div>
          <p className="text-xs text-[#a1a1aa]">
            All {draftScenes.length} stunt scenes have been assigned unique Stunt IDs in MCP. The Director Chatbot, Live Compliance Monitor, and Rehearsal Room can now recognize and check these scenes.
          </p>
        </div>
      )}

      {/* Registered Project Scenes */}
      {scenes.length > 0 && (
        <div className="rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden shadow-xl">
          <div className="px-4 py-3 border-b border-[#27272f] text-sm font-medium text-[#f4f4f8] flex items-center justify-between">
            <span>Project Scenes & Stunts ({scenes.length})</span>
            <span className="text-xs text-violet-400 font-mono font-medium">{activeProject?.name}</span>
          </div>
          <div className="divide-y divide-[#1d1d24]">
            {scenes.slice(0, 15).map((scene) => (
              <Link
                key={scene.id}
                href={`/scenes/${scene.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[#18181f] transition-colors group"
              >
                <span className="font-mono text-xs text-violet-300 font-bold w-36 truncate shrink-0">
                  {scene.scene_number}
                </span>
                <span className="text-sm text-[#f4f4f8] flex-1 truncate">
                  {scene.description}
                </span>
                <span className="font-mono text-xs text-amber-400 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                  {scene.stunt_type}
                </span>
                <StatusBadge status={scene.latest_compliance_status} size="sm" />
                <ChevronRight className="w-3.5 h-3.5 text-[#5a5a6e] opacity-0 group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
