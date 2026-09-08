"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listScenes, listProductions, checkScene } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { stuntTypeLabel, stuntTypeBadge, formatDate, cn } from "@/lib/utils";
import { Search, Filter, ChevronRight, Shield } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useProject } from "@/components/ProjectContext";

export default function SchedulePage() {
  const { activeProjectId: productionId, activeProject } = useProject();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [stuntFilter, setStuntFilter] = useState<string>("all");

  const { data: scenes = [], isLoading } = useQuery({
    queryKey: ["scenes", productionId],
    queryFn: () => listScenes({ production_id: productionId, limit: 200 }),
    enabled: !!productionId,
  });

  const runCheck = useMutation({
    mutationFn: (sceneNum: string) => checkScene(sceneNum),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenes"] }),
  });

  const filtered = scenes.filter(s => {
    const matchSearch = !search || s.scene_number.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || s.latest_compliance_status === statusFilter || (statusFilter === "none" && !s.latest_compliance_status);
    const matchStunt = stuntFilter === "all" || s.stunt_type === stuntFilter;
    return matchSearch && matchStatus && matchStunt;
  });

  const stuntTypes = ["all", ...Array.from(new Set(scenes.map(s => s.stunt_type)))];

  return (
    <div className="p-6 space-y-5 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#f4f4f8]">Production Schedule</h1>
          <p className="text-sm text-[#9898a8] mt-0.5">{scenes.length} scenes · 🎬 {activeProject?.name || "No active project"}</p>
        </div>
        <Link href="/intake" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 text-sm font-medium border border-violet-500/30 transition-colors">
          + Upload Script
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5a5a6e]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search scenes..."
            className="w-full bg-[#18181f] border border-[#27272f] rounded-lg pl-8 pr-3 py-2 text-sm text-[#f4f4f8] placeholder-[#5a5a6e] focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-[#18181f] border border-[#27272f] rounded-lg px-3 py-2 text-sm text-[#9898a8] focus:outline-none focus:border-violet-500/50"
        >
          <option value="all">All Status</option>
          <option value="approved">Approved</option>
          <option value="blocked">Blocked</option>
          <option value="none">Not Checked</option>
        </select>
        <select
          value={stuntFilter}
          onChange={e => setStuntFilter(e.target.value)}
          className="bg-[#18181f] border border-[#27272f] rounded-lg px-3 py-2 text-sm text-[#9898a8] focus:outline-none focus:border-violet-500/50"
        >
          {stuntTypes.map(t => <option key={t} value={t}>{t === "all" ? "All Stunt Types" : stuntTypeLabel(t)}</option>)}
        </select>
        <span className="text-xs text-[#5a5a6e] ml-auto font-mono">{filtered.length} results</span>
      </div>

      {/* Dense table */}
      <div className="rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#27272f] text-[#5a5a6e] text-xs">
              <th className="text-left px-4 py-2.5 font-medium font-mono w-24">SCENE</th>
              <th className="text-left px-4 py-2.5 font-medium">DESCRIPTION</th>
              <th className="text-left px-4 py-2.5 font-medium w-36">STUNT TYPE</th>
              <th className="text-left px-4 py-2.5 font-medium w-28">SHOOT DATE</th>
              <th className="text-left px-4 py-2.5 font-medium w-32">STATUS</th>
              <th className="text-left px-4 py-2.5 font-medium w-16">WIND</th>
              <th className="px-4 py-2.5 w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1d1d24]">
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i}><td colSpan={7}><div className="h-11 shimmer" /></td></tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="py-12 text-center text-[#5a5a6e] text-sm">No scenes match filters</td></tr>
            ) : (
              filtered.map(scene => (
                <tr key={scene.id} className="hover:bg-[#18181f] transition-colors group">
                  <td className="px-4 py-2.5 font-mono text-[#9898a8] text-xs">{scene.scene_number}</td>
                  <td className="px-4 py-2.5 text-[#f4f4f8] max-w-xs truncate">{scene.description}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn("text-xs px-1.5 py-0.5 rounded border font-mono", stuntTypeBadge(scene.stunt_type))}>
                      {stuntTypeLabel(scene.stunt_type)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[#9898a8] text-xs font-mono">{formatDate(scene.shoot_date)}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={scene.latest_compliance_status} size="sm" />
                  </td>
                  <td className="px-4 py-2.5 text-[#9898a8] text-xs font-mono">
                    {scene.forecast_wind_kmh != null ? `${scene.forecast_wind_kmh}km/h` : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => runCheck.mutate(scene.scene_number)}
                        title="Run compliance check"
                        className="p-1 rounded hover:bg-[#27272f] text-[#5a5a6e] hover:text-violet-400"
                      >
                        <Shield className="w-3.5 h-3.5" />
                      </button>
                      <Link href={`/scenes/${scene.id}`} className="p-1 rounded hover:bg-[#27272f]">
                        <ChevronRight className="w-3.5 h-3.5 text-[#5a5a6e] hover:text-violet-400" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
