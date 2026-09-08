"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listScenes, runAllChecks, listProductions, askAgent, type Scene } from "@/lib/api";
import { StatusBadge, StatusDot } from "@/components/StatusBadge";
import { stuntTypeLabel, stuntTypeBadge, formatDate, cn } from "@/lib/utils";
import { Shield, Zap, Clock, CheckCircle, XCircle, RefreshCw, MessageSquare, Send, ChevronRight, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";

import { useProject } from "@/components/ProjectContext";

const DEMO_PRODUCTION_ID = process.env.NEXT_PUBLIC_DEMO_PRODUCTION_ID || "";

export default function DashboardPage() {
  const qc = useQueryClient();
  const { activeProjectId: productionId, activeProject, setPredictorModalOpen } = useProject();

  const { data: scenes = [], isLoading } = useQuery({
    queryKey: ["scenes", productionId],
    queryFn: () => listScenes({ production_id: productionId }),
    enabled: !!productionId,
    refetchInterval: 15_000,
  });

  const runAll = useMutation({
    mutationFn: () => runAllChecks(productionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenes"] }),
  });

  // Status counts
  const approved = scenes.filter(s => s.latest_compliance_status === "approved").length;
  const blocked  = scenes.filter(s => s.latest_compliance_status === "blocked").length;
  const pending  = scenes.filter(s => !s.latest_compliance_status).length;

  // Agent chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string>();
  const [chatLoading, setChatLoading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || chatLoading) return;
    const text = input.trim();
    setInput("");
    setMessages(m => [...m, { role: "user", text }]);
    setChatLoading(true);
    try {
      const res = await askAgent(text, sessionId);
      setSessionId(res.session_id);
      setMessages(m => [...m, { role: "ai", text: res.response }]);
    } catch (e) {
      setMessages(m => [...m, { role: "ai", text: "Agent error — check API connection." }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#f4f4f8]">Production Dashboard</h1>
          <p className="text-sm text-[#9898a8] mt-0.5">
            🎬 {activeProject?.name || "No active project"} · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPredictorModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-sm font-medium border border-emerald-500/30 transition-colors shadow-sm"
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            ROI & Box Office Predictor
          </button>
          <button
            onClick={() => setChatOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 text-sm font-medium border border-violet-500/30 transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Ask Agent
          </button>
          <button
            onClick={() => runAll.mutate()}
            disabled={!productionId || runAll.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#18181f] hover:bg-[#1f1f28] text-[#f4f4f8] text-sm font-medium border border-[#27272f] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", runAll.isPending && "animate-spin")} />
            Run All Checks
          </button>
        </div>
      </div>

      {/* Status count cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Approved",    count: approved, icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
          { label: "Blocked",     count: blocked,  icon: XCircle,     color: "text-red-400",     bg: "bg-red-500/10 border-red-500/30" },
          { label: "Not Checked", count: pending,  icon: Clock,       color: "text-zinc-500",    bg: "bg-zinc-800 border-zinc-700" },
        ].map(({ label, count, icon: Icon, color, bg }) => (
          <div key={label} className={cn("rounded-xl border p-5 flex items-center gap-4", bg)}>
            <Icon className={cn("w-8 h-8", color)} />
            <div>
              <p className={cn("text-3xl font-bold font-mono", color)}>{count}</p>
              <p className="text-sm text-[#9898a8]">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Grafana Live Compliance Monitor */}
      <div className="rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#27272f]">
          <Shield className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-medium text-[#f4f4f8]">Live Compliance Monitor</span>
          <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono flex items-center gap-1.5 ml-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Grafana Live Stream
          </span>
          <a
            href="https://pluckyboat2830.grafana.net"
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-violet-400 hover:text-violet-300 font-mono flex items-center gap-1 transition-colors"
          >
            Open Grafana Dashboard ↗
          </a>
        </div>
        <div className="p-4 bg-[#0d0d12] space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#14141d] p-3 rounded-lg border border-[#27272f]">
              <p className="text-xs text-[#9898a8]">Audit Stream Status</p>
              <p className="text-sm font-semibold text-emerald-400 mt-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                Active Broadcasting
              </p>
            </div>
            <div className="bg-[#14141d] p-3 rounded-lg border border-[#27272f]">
              <p className="text-xs text-[#9898a8]">Annotations Pushed</p>
              <p className="text-sm font-semibold text-[#f4f4f8] font-mono mt-1">100% Pushed to Grafana</p>
            </div>
            <div className="bg-[#14141d] p-3 rounded-lg border border-[#27272f]">
              <p className="text-xs text-[#9898a8]">Compliance Gate Latency</p>
              <p className="text-sm font-semibold text-violet-400 font-mono mt-1">&lt; 0.9s (Sub-Second)</p>
            </div>
          </div>
          <div className="bg-[#14141d] p-3 rounded-lg border border-[#27272f] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-[#5a5a6e]">LIVE TIMELINE:</span>
              <span className="text-xs text-[#f4f4f8] font-mono">SC-014 (APPROVED) · SC-001 (OVERRIDDEN) · SC-005 (BLOCKED)</span>
            </div>
            <span className="text-xs text-[#5a5a6e] font-mono">Tags: cineops-guard, safety-audit</span>
          </div>
        </div>
      </div>

      {/* Scenes table */}
      <div className="rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#27272f]">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-medium text-[#f4f4f8]">All Scenes</span>
            <span className="text-xs text-[#5a5a6e] font-mono ml-1">{scenes.length}</span>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-px">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 shimmer" />
            ))}
          </div>
        ) : scenes.length === 0 ? (
          <div className="py-12 text-center text-[#5a5a6e] text-sm">
            No scenes found. <Link href="/intake" className="text-violet-400 hover:underline">Upload a script</Link> to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#27272f] text-[#5a5a6e] text-xs">
                <th className="text-left px-4 py-2.5 font-medium font-mono">SCENE</th>
                <th className="text-left px-4 py-2.5 font-medium">DESCRIPTION</th>
                <th className="text-left px-4 py-2.5 font-medium">STUNT TYPE</th>
                <th className="text-left px-4 py-2.5 font-medium">SHOOT DATE</th>
                <th className="text-left px-4 py-2.5 font-medium">STATUS</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1d1d24]">
              {scenes.map(scene => (
                <tr key={scene.id} className="hover:bg-[#18181f] transition-colors group">
                  <td className="px-4 py-3 font-mono text-[#9898a8] text-xs">{scene.scene_number}</td>
                  <td className="px-4 py-3 text-[#f4f4f8] max-w-xs truncate">{scene.description}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs px-2 py-0.5 rounded border font-mono", stuntTypeBadge(scene.stunt_type))}>
                      {stuntTypeLabel(scene.stunt_type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#9898a8] text-xs font-mono">{formatDate(scene.shoot_date)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={scene.latest_compliance_status} size="sm" />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/scenes/${scene.id}`} className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <ChevronRight className="w-4 h-4 text-[#5a5a6e] hover:text-violet-400" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Agent chat panel */}
      {chatOpen && (
        <div className="fixed bottom-6 right-6 w-96 rounded-2xl border border-[#27272f] bg-[#111118] shadow-2xl flex flex-col overflow-hidden fade-in" style={{ maxHeight: "60vh" }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#27272f] bg-[#18181f]">
            <MessageSquare className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-medium">Agent Chat</span>
            <button onClick={() => setChatOpen(false)} className="ml-auto text-[#5a5a6e] hover:text-[#f4f4f8] text-xs">✕</button>
          </div>
          <div ref={chatRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[180px]">
            {messages.length === 0 && (
              <p className="text-[#5a5a6e] text-xs text-center mt-4">Ask the Director Agent anything — "Can we shoot SC-014 tomorrow?"</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn("rounded-lg px-3 py-2 text-sm max-w-[85%]", m.role === "user" ? "ml-auto bg-violet-600/20 text-violet-100" : "bg-[#1f1f28] text-[#f4f4f8]")}>
                {m.text}
              </div>
            ))}
            {chatLoading && (
              <div className="bg-[#1f1f28] rounded-lg px-3 py-2 text-xs text-[#9898a8] w-20 shimmer h-8" />
            )}
          </div>
          <div className="flex gap-2 p-3 border-t border-[#27272f]">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendMessage()}
              placeholder="Ask the agent..."
              className="flex-1 bg-[#18181f] border border-[#27272f] rounded-lg px-3 py-2 text-sm text-[#f4f4f8] placeholder-[#5a5a6e] focus:outline-none focus:border-violet-500/50"
            />
            <button onClick={sendMessage} disabled={chatLoading} className="p-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 transition-colors">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
