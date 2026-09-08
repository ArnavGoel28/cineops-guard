"use client";
import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { listDailies, uploadDailies, pollJob, listScenes, listProductions } from "@/lib/api";
import { Video, Upload, Loader2, Flag, CheckCircle } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";

import { useProject } from "@/components/ProjectContext";

export default function DailiesPage() {
  const { activeProjectId: productionId } = useProject();

  const { data: scenes = [] } = useQuery({
    queryKey: ["scenes", productionId],
    queryFn: () => listScenes({ production_id: productionId }),
    enabled: !!productionId,
  });

  const { data: dailies = [], refetch } = useQuery({
    queryKey: ["dailies"],
    queryFn: () => listDailies(),
    refetchInterval: 10_000,
  });

  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [selectedDailies, setSelectedDailies] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: jobStatus } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => pollJob(jobId!),
    enabled: !!jobId,
    refetchInterval: 2_000,
  });

  const handleUpload = async () => {
    if (!file || !selectedSceneId) return;
    setUploading(true);
    try {
      const result = await uploadDailies(selectedSceneId, file);
      setJobId(result.job_id);
      setFile(null);
      refetch();
    } catch (e) { alert("Upload failed") }
    finally { setUploading(false); }
  };

  const activeDailies = dailies.find(d => d.id === selectedDailies);
  const flags = activeDailies?.sentiment_flags || [];

  return (
    <div className="p-6 space-y-5 fade-in">
      <div>
        <h1 className="text-xl font-semibold text-[#f4f4f8]">Dailies Review</h1>
        <p className="text-sm text-[#9898a8] mt-0.5">Upload video clips for automatic transcription and tone analysis.</p>
      </div>

      <div className="grid grid-cols-5 gap-5">
        {/* Upload + list */}
        <div className="col-span-2 space-y-4">
          {/* Upload panel */}
          <div className="rounded-xl border border-[#27272f] bg-[#111118] p-4 space-y-3">
            <p className="text-sm font-medium text-[#f4f4f8]">Upload Footage</p>
            <select
              value={selectedSceneId}
              onChange={e => setSelectedSceneId(e.target.value)}
              className="w-full bg-[#18181f] border border-[#27272f] rounded-lg px-3 py-2 text-sm text-[#f4f4f8] focus:outline-none focus:border-violet-500/50"
            >
              <option value="">Tag to scene...</option>
              {scenes.map(s => <option key={s.id} value={s.id}>{s.scene_number} — {s.description.slice(0, 40)}</option>)}
            </select>
            <div
              onClick={() => inputRef.current?.click()}
              className="border border-dashed border-[#27272f] rounded-lg p-4 text-center cursor-pointer hover:border-[#3a3a4a] transition-colors"
            >
              <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
              {file ? (
                <p className="text-sm text-violet-300">{file.name}</p>
              ) : (
                <>
                  <Video className="w-6 h-6 text-[#3a3a4a] mx-auto mb-1" />
                  <p className="text-xs text-[#5a5a6e]">Drop video or click</p>
                </>
              )}
            </div>
            <button
              onClick={handleUpload}
              disabled={!file || !selectedSceneId || uploading || !!jobId}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {(uploading || jobId) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {jobId ? (jobStatus?.status === "complete" ? "Done" : "Processing...") : "Upload"}
            </button>
            {jobStatus && jobStatus.status !== "complete" && (
              <p className="text-xs text-violet-400 text-center">
                {jobStatus.status === "running" ? "Transcribing and analyzing tone..." : "Queued for processing"}
              </p>
            )}
          </div>

          {/* Dailies list */}
          <div className="rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#27272f] text-xs text-[#5a5a6e] font-medium">{dailies.length} CLIPS</div>
            {dailies.length === 0 ? (
              <div className="p-6 text-center text-[#5a5a6e] text-sm">No clips uploaded yet</div>
            ) : (
              <div className="divide-y divide-[#1d1d24]">
                {dailies.map(d => {
                  const flagCount = d.sentiment_flags?.length || 0;
                  return (
                    <button
                      key={d.id}
                      onClick={() => setSelectedDailies(d.id)}
                      className={cn("w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[#18181f] transition-colors", selectedDailies === d.id ? "bg-[#18181f]" : "")}
                    >
                      <Video className="w-4 h-4 text-[#5a5a6e] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#f4f4f8] truncate">{d.video_uri.split("/").pop()}</p>
                        <p className="text-xs text-[#5a5a6e] font-mono">{formatDateTime(d.created_at)}</p>
                      </div>
                      {flagCount > 0 ? (
                        <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                          <Flag className="w-3 h-3" />
                          {flagCount}
                        </span>
                      ) : d.transcript ? (
                        <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Review panel */}
        <div className="col-span-3 rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden flex flex-col">
          {!activeDailies ? (
            <div className="flex-1 flex items-center justify-center text-[#5a5a6e] text-sm">Select a clip to review</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-[#27272f] flex items-center gap-2">
                <Video className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-medium text-[#f4f4f8] truncate">{activeDailies.video_uri.split("/").pop()}</span>
              </div>

              {/* Transcript with sentiment flags */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {!activeDailies.transcript ? (
                  <div className="text-center text-[#5a5a6e] text-sm mt-8">Processing transcript...</div>
                ) : (
                  (activeDailies.transcript as any[]).map((seg: any, i: number) => {
                    const flag = flags.find(f => f.timestamp === seg.timestamp);
                    return (
                      <div key={i} className={cn("flex gap-3 p-2 rounded-lg", flag ? "bg-amber-500/5 border border-amber-500/20" : "")}>
                        <span className="font-mono text-xs text-[#5a5a6e] shrink-0 w-10">{seg.timestamp}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-violet-400 font-medium mr-2">{seg.speaker}</span>
                          <span className="text-sm text-[#f4f4f8]">{seg.text}</span>
                          {flag && (
                            <div className="mt-1.5 flex items-start gap-1.5 text-xs">
                              <Flag className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                              <span className="text-amber-300">
                                Script: <strong>{flag.script_tone}</strong> · Delivered: <strong>{flag.delivered_tone}</strong>
                                {flag.severity === "high" && <span className="ml-1 text-red-400">(significant)</span>}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Sentiment summary */}
              {flags.length > 0 && (
                <div className="border-t border-[#27272f] px-4 py-3 bg-amber-500/5">
                  <p className="text-xs font-medium text-amber-400 flex items-center gap-1.5">
                    <Flag className="w-3.5 h-3.5" />
                    {flags.length} tone mismatch{flags.length > 1 ? "es" : ""} detected
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
