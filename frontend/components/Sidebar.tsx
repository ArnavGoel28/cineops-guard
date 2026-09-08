"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Film, Shield, FileText, Mic, Video, Users,
  Settings, ChevronRight, Clapperboard, Plus, ChevronDown, Check, X, Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useProject } from "./ProjectContext";

const nav = [
  { href: "/",             icon: LayoutDashboard, label: "Dashboard" },
  { href: "/schedule",     icon: Film,             label: "Schedule" },
  { href: "/intake",       icon: FileText,         label: "Script Intake" },
  { href: "/rehearsal",    icon: Mic,              label: "Rehearsal Room" },
  { href: "/actors",       icon: Users,            label: "Actor Directory" },
  { href: "/dailies",      icon: Video,            label: "Dailies" },
  { href: "/admin",        icon: Settings,         label: "Admin" },
];

export function Sidebar() {
  const path = usePathname();
  const {
    productions,
    activeProjectId,
    activeProject,
    setActiveProjectId,
    createProjectModalOpen,
    setCreateProjectModalOpen,
    createProject,
    isCreating
  } = useProject();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    await createProject(newProjectName.trim());
    setNewProjectName("");
  };

  return (
    <>
      <aside className="w-60 shrink-0 flex flex-col border-r border-[#27272f] bg-[#111118] h-screen select-none">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[#27272f]">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-blue-500 flex items-center justify-center shadow-md shadow-violet-600/30">
            <Clapperboard className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-[#f4f4f8] leading-tight">CineOps Guard</p>
            <p className="text-[10px] text-[#9898a8] leading-tight font-mono uppercase tracking-wider">v2.0 • Safety System</p>
          </div>
        </div>

        {/* Project Switcher Dropdown */}
        <div className="p-3 border-b border-[#27272f] relative">
          <label className="block text-[10px] font-mono uppercase text-[#71717a] font-semibold mb-1 px-1">
            ACTIVE FILM PROJECT
          </label>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#181820] hover:bg-[#20202a] border border-[#27272f] text-xs font-semibold text-[#f4f4f8] transition-all"
          >
            <div className="flex items-center gap-2 truncate">
              <Film className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span className="truncate">{activeProject?.name || "Select Project..."}</span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-[#71717a] shrink-0" />
          </button>

          {/* Dropdown Menu */}
          {dropdownOpen && (
            <div className="absolute left-3 right-3 top-[68px] z-50 rounded-xl bg-[#16161f] border border-[#27272f] shadow-2xl p-1.5 space-y-1 fade-in">
              <div className="max-h-48 overflow-y-auto space-y-0.5 custom-scrollbar">
                {productions.map((p) => {
                  const isSelected = p.id === activeProjectId;
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        setActiveProjectId(p.id);
                        setDropdownOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-all text-left",
                        isSelected
                          ? "bg-violet-600/15 text-violet-300 font-semibold"
                          : "text-[#a1a1aa] hover:bg-[#20202c] hover:text-[#f4f4f8]"
                      )}
                    >
                      <span className="truncate">{p.name}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-violet-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <div className="border-t border-[#27272f] pt-1">
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    setCreateProjectModalOpen(true);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-semibold text-violet-400 hover:bg-violet-500/10 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Film Project</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {nav.map(({ href, icon: Icon, label }) => {
            const active = path === href || (href !== "/" && path.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 group",
                  active
                    ? "bg-[#1f1f28] text-[#f4f4f8] border border-violet-500/20"
                    : "text-[#9898a8] hover:bg-[#18181f] hover:text-[#f4f4f8]"
                )}
              >
                <Icon className={cn("w-4 h-4 shrink-0", active ? "text-violet-400" : "text-[#5a5a6e] group-hover:text-[#9898a8]")} />
                <span className="flex-1">{label}</span>
                {active && <ChevronRight className="w-3 h-3 text-violet-400" />}
              </Link>
            );
          })}
        </nav>

        {/* Footer Status */}
        <div className="px-5 py-4 border-t border-[#27272f] bg-[#0d0d12]">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
            <span className="text-xs font-medium text-[#71717a]">Safety Gate: Active</span>
          </div>
        </div>
      </aside>

      {/* New Project Modal */}
      {createProjectModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreate} className="bg-[#111118] border border-[#27272f] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl fade-in">
            <div className="flex items-center justify-between border-b border-[#27272f] pb-3">
              <h2 className="text-lg font-bold text-[#f4f4f8] flex items-center gap-2">
                <Film className="w-5 h-5 text-violet-400" />
                Create New Film Project
              </h2>
              <button
                type="button"
                onClick={() => setCreateProjectModalOpen(false)}
                className="text-[#71717a] hover:text-[#f4f4f8]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#a1a1aa] mb-1.5">
                Film / Production Title
              </label>
              <input
                type="text"
                placeholder="e.g. Project Aegis, Apex Pursuit..."
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                autoFocus
                className="w-full bg-[#181820] border border-[#27272f] rounded-lg px-3.5 py-2.5 text-sm text-[#f4f4f8] placeholder-[#52525b] focus:outline-none focus:border-violet-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#27272f]">
              <button
                type="button"
                onClick={() => setCreateProjectModalOpen(false)}
                className="px-4 py-2 text-xs text-[#71717a] hover:text-[#f4f4f8]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newProjectName.trim() || isCreating}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-violet-600/20 disabled:opacity-50"
              >
                {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Create Project"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
