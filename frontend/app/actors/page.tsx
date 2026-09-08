"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listActorProfiles, listScenes, ActorProfile } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";
import { Users, User, Film, BookOpen, Mic, Sparkles, CheckCircle2, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function ActorDirectoryPage() {
  const { activeProjectId: productionId, activeProject } = useProject();

  const { data: actorProfiles = [], isLoading } = useQuery({
    queryKey: ["actor-profiles", productionId],
    queryFn: () => listActorProfiles(productionId),
    enabled: !!productionId,
  });

  const { data: scenes = [] } = useQuery({
    queryKey: ["scenes", productionId],
    queryFn: () => listScenes({ production_id: productionId }),
    enabled: !!productionId,
  });

  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);

  // Default to first profile if none selected
  const activeProfile = actorProfiles.find(p => p.character_name === selectedCharacter) || actorProfiles[0];

  return (
    <div className="p-6 space-y-6 fade-in max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold text-[#f4f4f8] flex items-center gap-2">
          <Users className="w-5 h-5 text-violet-400" />
          Actor & Character Profiles Directory
        </h1>
        <p className="text-sm text-[#9898a8] mt-0.5">
          Pre-parsed character side scripts, scene assignments, and dialogue line counts extracted during script intake.
        </p>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-xs font-mono text-[#9898a8]">Loading character profiles...</div>
      ) : actorProfiles.length === 0 ? (
        <div className="rounded-2xl border border-[#27272f] bg-[#111118] p-8 text-center space-y-3">
          <BookOpen className="w-8 h-8 text-violet-400 mx-auto" />
          <h3 className="text-sm font-semibold text-[#f4f4f8]">No Actor Profiles Found Yet</h3>
          <p className="text-xs text-[#9898a8] max-w-md mx-auto">
            Upload a screenplay PDF in <Link href="/intake" className="text-violet-400 underline">Script Intake</Link> to automatically extract speaking characters and construct persistent actor profiles.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Character List (1 Col) */}
          <div className="space-y-3">
            <h2 className="text-xs uppercase font-mono font-bold text-[#71717a] tracking-wider px-1">
              Extracted Characters ({actorProfiles.length})
            </h2>
            <div className="space-y-2">
              {actorProfiles.map((profile) => {
                const isSelected = activeProfile?.id === profile.id;
                const totalLines = Object.values(profile.dialogues_by_scene || {}).reduce((acc, lines) => acc + lines.length, 0);

                return (
                  <button
                    key={profile.id}
                    onClick={() => setSelectedCharacter(profile.character_name)}
                    className={cn(
                      "w-full text-left p-4 rounded-xl border transition-all flex items-center justify-between",
                      isSelected
                        ? "border-violet-500/50 bg-[#161622] shadow-lg shadow-violet-500/10"
                        : "border-[#27272f] bg-[#111118] hover:bg-[#16161f] text-[#9898a8]"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-mono font-bold text-sm", isSelected ? "bg-violet-600 text-white" : "bg-[#1f1f2a] text-violet-300")}>
                        {profile.character_name.slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-[#f4f4f8]">{profile.character_name}</p>
                        <p className="text-xs text-[#71717a]">{profile.actor_name || "Unassigned"}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                        {totalLines} lines
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Character Profile & Pre-Parsed Side Script (2 Cols) */}
          {activeProfile && (
            <div className="lg:col-span-2 space-y-5">
              {/* Character Card Header */}
              <div className="rounded-2xl border border-[#27272f] bg-[#111118] p-5 space-y-4 shadow-xl">
                <div className="flex items-center justify-between border-b border-[#242432] pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center font-mono font-bold text-lg text-white shadow-lg shadow-violet-600/30">
                      {activeProfile.character_name.slice(0, 2)}
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-[#f4f4f8]">{activeProfile.character_name}</h2>
                      <p className="text-xs text-[#9898a8]">Assigned Actor: <span className="text-violet-300 font-semibold">{activeProfile.actor_name}</span></p>
                    </div>
                  </div>
                  <Link
                    href={`/rehearsal`}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-md shadow-violet-600/20 transition-all"
                  >
                    <Mic className="w-3.5 h-3.5" />
                    <span>Rehearse Role</span>
                  </Link>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="bg-[#181820] border border-[#27272f] p-3 rounded-xl">
                    <span className="text-[10px] uppercase font-mono text-[#71717a] block">Assigned Scenes</span>
                    <span className="text-sm font-mono font-bold text-[#f4f4f8]">{activeProfile.assigned_scene_ids?.length || 0} Scenes</span>
                  </div>
                  <div className="bg-[#181820] border border-[#27272f] p-3 rounded-xl">
                    <span className="text-[10px] uppercase font-mono text-[#71717a] block">Total Spoken Lines</span>
                    <span className="text-sm font-mono font-bold text-violet-400">
                      {Object.values(activeProfile.dialogues_by_scene || {}).reduce((acc, l) => acc + l.length, 0)} Lines
                    </span>
                  </div>
                  <div className="bg-[#181820] border border-[#27272f] p-3 rounded-xl col-span-2 md:col-span-1">
                    <span className="text-[10px] uppercase font-mono text-[#71717a] block">Rehearsal Status</span>
                    <span className="text-sm font-mono font-bold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Pre-Cached
                    </span>
                  </div>
                </div>
              </div>

              {/* Pre-Parsed Dialogue Side Script Breakdown */}
              <div className="rounded-2xl border border-[#27272f] bg-[#111118] p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-[#242432] pb-3">
                  <h3 className="text-xs uppercase font-mono font-bold text-violet-300 tracking-wider flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-violet-400" />
                    Extracted Side Script for {activeProfile.character_name}
                  </h3>
                  <span className="text-xs font-mono text-[#71717a]">Zero LLM latency cache</span>
                </div>

                {Object.keys(activeProfile.dialogues_by_scene || {}).length === 0 ? (
                  <p className="text-xs text-[#71717a] font-mono text-center py-6">No scene dialogue assigned yet.</p>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(activeProfile.dialogues_by_scene || {}).map(([sceneId, lines]) => (
                      <div key={sceneId} className="bg-[#09090e] border border-[#20202e] rounded-xl p-4 space-y-2.5">
                        <div className="flex items-center justify-between border-b border-[#1d1d2b] pb-2">
                          <span className="text-xs font-mono font-bold text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                            Scene {sceneId}
                          </span>
                          <span className="text-[11px] font-mono text-[#71717a]">{lines.length} lines</span>
                        </div>
                        <div className="space-y-2 font-mono text-xs">
                          {lines.map((line, idx) => (
                            <div key={idx} className="p-2.5 rounded-lg bg-[#12121c] border border-[#222232] space-y-1">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="font-bold text-violet-300">{line.speaker}</span>
                                {line.pause_hint && (
                                  <span className="text-[10px] text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                    {line.pause_hint}
                                  </span>
                                )}
                              </div>
                              <p className="text-[#f4f4f8] leading-relaxed">{line.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
