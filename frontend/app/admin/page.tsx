"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listSafetyRules, createSafetyRule, updateSafetyRule, deleteSafetyRule,
  listUsers, createUser, updateUser, deleteUser,
  listScenes, createScene, updateScene, deleteScene,
  listProductions, createProduction, updateProduction, deleteProduction,
  getComplianceHistory,
  SafetyRule, User, Scene, Production
} from "@/lib/api";
import {
  Shield, Users, ScrollText, Film, Clapperboard, Plus, Trash2, Edit2,
  Save, X, Loader2, Check, AlertTriangle
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime, cn } from "@/lib/utils";

import { useProject } from "@/components/ProjectContext";

const TABS = ["Safety Rules", "Users", "Scenes & Stunts", "Productions", "Audit Log"] as const;
type Tab = typeof TABS[number];

export default function AdminPage() {
  const qc = useQueryClient();
  const { activeProjectId, activeProject } = useProject();
  const [tab, setTab] = useState<Tab>("Safety Rules");
  const [selectedProdFilter, setSelectedProdFilter] = useState<string>("active");

  // Queries
  const { data: rules = [], isLoading: loadingRules } = useQuery({ queryKey: ["safety-rules"], queryFn: listSafetyRules });
  const { data: users = [], isLoading: loadingUsers } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const { data: productions = [], isLoading: loadingProds } = useQuery({ queryKey: ["productions"], queryFn: listProductions });
  const { data: scenes = [], isLoading: loadingScenes } = useQuery({ queryKey: ["scenes-all"], queryFn: () => listScenes({ limit: 500 }) });
  const { data: auditLog = [] } = useQuery({ queryKey: ["compliance-history-all"], queryFn: () => getComplianceHistory({}) });

  const filteredScenes = scenes.filter((sc) => {
    if (selectedProdFilter === "all") return true;
    if (selectedProdFilter === "active" || !selectedProdFilter) return sc.production_id === activeProjectId;
    return sc.production_id === selectedProdFilter;
  });

  // Modal States
  const [showAddRule, setShowAddRule] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAddScene, setShowAddScene] = useState(false);
  const [showAddProd, setShowAddProd] = useState(false);

  // Edit States
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<Partial<SafetyRule>>({});

  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userForm, setUserForm] = useState<Partial<User>>({});

  const [editingScene, setEditingScene] = useState<string | null>(null);
  const [sceneForm, setSceneForm] = useState<Partial<Scene>>({});

  const [editingProd, setEditingProd] = useState<string | null>(null);
  const [prodForm, setProdForm] = useState<Partial<Production>>({});

  // Safety Rule Mutations
  const createRuleMut = useMutation({
    mutationFn: createSafetyRule,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["safety-rules"] }); setShowAddRule(false); setRuleForm({}); },
  });
  const updateRuleMut = useMutation({
    mutationFn: () => updateSafetyRule(editingRule!, ruleForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["safety-rules"] }); setEditingRule(null); setRuleForm({}); },
  });
  const deleteRuleMut = useMutation({
    mutationFn: deleteSafetyRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["safety-rules"] }),
  });

  // User Mutations
  const createUserMut = useMutation({
    mutationFn: (u: { email: string; display_name: string; role: string }) => createUser(u),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setShowAddUser(false); setUserForm({}); },
  });
  const updateUserMut = useMutation({
    mutationFn: () => updateUser(editingUser!, userForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setEditingUser(null); setUserForm({}); },
  });
  const deleteUserMut = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  // Scene Mutations
  const createSceneMut = useMutation({
    mutationFn: createScene,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["scenes-all"] }); setShowAddScene(false); setSceneForm({}); },
  });
  const updateSceneMut = useMutation({
    mutationFn: () => updateScene(editingScene!, sceneForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["scenes-all"] }); setEditingScene(null); setSceneForm({}); },
  });
  const deleteSceneMut = useMutation({
    mutationFn: deleteScene,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenes-all"] }),
  });

  // Production Mutations
  const createProdMut = useMutation({
    mutationFn: (name: string) => createProduction(name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["productions"] }); setShowAddProd(false); setProdForm({}); },
  });
  const updateProdMut = useMutation({
    mutationFn: () => updateProduction(editingProd!, prodForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["productions"] }); setEditingProd(null); setProdForm({}); },
  });
  const deleteProdMut = useMutation({
    mutationFn: deleteProduction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["productions"] });
      qc.invalidateQueries({ queryKey: ["scenes-all"] });
    },
  });

  return (
    <div className="p-6 space-y-6 fade-in max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#27272f] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#f4f4f8] flex items-center gap-2">
            <Shield className="w-6 h-6 text-violet-400" />
            Admin Dashboard & Operations
          </h1>
          <p className="text-sm text-[#9898a8] mt-1">
            Full CRUD control over Safety Rules, User Permissions, Scenes & Stunt Data, and Production Projects.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "Safety Rules" && (
            <button
              onClick={() => { setRuleForm({ stunt_type: "", requires_stunt_coordinator: true, requires_medic_onset: false, max_wind_speed_kmh: 30, min_crew_signoffs: 1 }); setShowAddRule(true); }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition-all"
            >
              <Plus className="w-4 h-4" /> Add Safety Rule
            </button>
          )}
          {tab === "Users" && (
            <button
              onClick={() => { setUserForm({ role: "ad" }); setShowAddUser(true); }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition-all"
            >
              <Plus className="w-4 h-4" /> Add User
            </button>
          )}
          {tab === "Scenes & Stunts" && (
            <button
              onClick={() => { setSceneForm({ production_id: activeProjectId, stunt_type: "none" }); setShowAddScene(true); }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition-all"
            >
              <Plus className="w-4 h-4" /> Add Scene
            </button>
          )}
          {tab === "Productions" && (
            <button
              onClick={() => { setProdForm({}); setShowAddProd(true); }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition-all"
            >
              <Plus className="w-4 h-4" /> Add Production
            </button>
          )}
        </div>
      </div>

      {/* Tabs Nav */}
      <div className="flex gap-1 border-b border-[#27272f]">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-all",
              tab === t
                ? "border-violet-500 text-[#f4f4f8] bg-violet-500/5 rounded-t-lg"
                : "border-transparent text-[#9898a8] hover:text-[#f4f4f8]"
            )}
          >
            {t === "Safety Rules" && <Shield className="w-4 h-4" />}
            {t === "Users" && <Users className="w-4 h-4" />}
            {t === "Scenes & Stunts" && <Clapperboard className="w-4 h-4" />}
            {t === "Productions" && <Film className="w-4 h-4" />}
            {t === "Audit Log" && <ScrollText className="w-4 h-4" />}
            {t}
          </button>
        ))}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          TAB 1: SAFETY RULES CRUD
      ───────────────────────────────────────────────────────────── */}
      {tab === "Safety Rules" && (
        <div className="rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden shadow-xl">
          <div className="px-4 py-3 border-b border-[#27272f] text-xs text-amber-400 bg-amber-500/10 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            Admin Control: Safety rule thresholds directly enforce scene approval/block status for future compliance checks.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-[#27272f] text-[#71717a] text-xs uppercase font-mono bg-[#16161f]">
                  <th className="px-4 py-3 font-semibold">STUNT TYPE</th>
                  <th className="px-4 py-3 font-semibold">COORD REQD</th>
                  <th className="px-4 py-3 font-semibold">MEDIC REQD</th>
                  <th className="px-4 py-3 font-semibold">MAX WIND</th>
                  <th className="px-4 py-3 font-semibold">MIN SIGNOFFS</th>
                  <th className="px-4 py-3 text-right font-semibold">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1d1d24]">
                {rules.map(rule => (
                  <tr key={rule.stunt_type} className={cn("hover:bg-[#18181f] transition-colors", editingRule === rule.stunt_type ? "bg-[#1d1d28]" : "")}>
                    <td className="px-4 py-3 font-mono text-xs text-violet-300 font-semibold">{rule.stunt_type}</td>

                    {editingRule === rule.stunt_type ? (
                      <>
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={ruleForm.requires_stunt_coordinator ?? rule.requires_stunt_coordinator} onChange={e => setRuleForm(v => ({ ...v, requires_stunt_coordinator: e.target.checked }))} className="rounded accent-violet-500" />
                        </td>
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={ruleForm.requires_medic_onset ?? rule.requires_medic_onset} onChange={e => setRuleForm(v => ({ ...v, requires_medic_onset: e.target.checked }))} className="rounded accent-violet-500" />
                        </td>
                        <td className="px-4 py-3">
                          <input type="number" defaultValue={rule.max_wind_speed_kmh} onChange={e => setRuleForm(v => ({ ...v, max_wind_speed_kmh: +e.target.value }))} className="w-20 bg-[#111118] border border-[#27272f] rounded px-2 py-1 text-xs text-[#f4f4f8]" />
                        </td>
                        <td className="px-4 py-3">
                          <input type="number" defaultValue={rule.min_crew_signoffs} onChange={e => setRuleForm(v => ({ ...v, min_crew_signoffs: +e.target.value }))} className="w-16 bg-[#111118] border border-[#27272f] rounded px-2 py-1 text-xs text-[#f4f4f8]" />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => updateRuleMut.mutate()} disabled={updateRuleMut.isPending} className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium bg-emerald-500/10 px-2 py-1 rounded">
                              {updateRuleMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                            </button>
                            <button onClick={() => { setEditingRule(null); setRuleForm({}); }} className="text-xs text-[#71717a] hover:text-[#9898a8] px-2 py-1">Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-[#f4f4f8]">{rule.requires_stunt_coordinator ? <Check className="w-4 h-4 text-emerald-400" /> : <span className="text-[#52525b]">—</span>}</td>
                        <td className="px-4 py-3 text-[#f4f4f8]">{rule.requires_medic_onset ? <Check className="w-4 h-4 text-emerald-400" /> : <span className="text-[#52525b]">—</span>}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#a1a1aa]">{rule.max_wind_speed_kmh} km/h</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#a1a1aa]">{rule.min_crew_signoffs}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => { setEditingRule(rule.stunt_type); setRuleForm(rule); }} className="p-1.5 hover:bg-violet-500/10 text-violet-400 rounded-md transition-colors" title="Edit Rule">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => deleteRuleMut.mutate(rule.stunt_type)} className="p-1.5 hover:bg-red-500/10 text-red-400 rounded-md transition-colors" title="Delete Rule">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 2: USERS CRUD
      ───────────────────────────────────────────────────────────── */}
      {tab === "Users" && (
        <div className="rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-[#27272f] text-[#71717a] text-xs uppercase font-mono bg-[#16161f]">
                  <th className="px-4 py-3 font-semibold">NAME</th>
                  <th className="px-4 py-3 font-semibold">EMAIL</th>
                  <th className="px-4 py-3 font-semibold">ROLE</th>
                  <th className="px-4 py-3 font-semibold">CREATED</th>
                  <th className="px-4 py-3 text-right font-semibold">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1d1d24]">
                {users.map(u => (
                  <tr key={u.id} className={cn("hover:bg-[#18181f] transition-colors", editingUser === u.id ? "bg-[#1d1d28]" : "")}>
                    {editingUser === u.id ? (
                      <>
                        <td className="px-4 py-3"><input type="text" defaultValue={u.display_name} onChange={e => setUserForm(v => ({ ...v, display_name: e.target.value }))} className="bg-[#111118] border border-[#27272f] rounded px-2 py-1 text-xs text-[#f4f4f8] w-full" /></td>
                        <td className="px-4 py-3"><input type="email" defaultValue={u.email} onChange={e => setUserForm(v => ({ ...v, email: e.target.value }))} className="bg-[#111118] border border-[#27272f] rounded px-2 py-1 text-xs text-[#f4f4f8] w-full" /></td>
                        <td className="px-4 py-3">
                          <select defaultValue={u.role} onChange={e => setUserForm(v => ({ ...v, role: e.target.value }))} className="bg-[#111118] border border-[#27272f] rounded px-2 py-1 text-xs text-[#f4f4f8]">
                            <option value="admin">Admin</option>
                            <option value="safety_lead">Safety Lead</option>
                            <option value="ad">First AD</option>
                            <option value="director">Director</option>
                            <option value="actor">Actor</option>
                            <option value="sound">Sound Engineer</option>
                          </select>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-[#71717a]">{formatDateTime(u.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => updateUserMut.mutate()} disabled={updateUserMut.isPending} className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium bg-emerald-500/10 px-2 py-1 rounded">
                              {updateUserMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                            </button>
                            <button onClick={() => { setEditingUser(null); setUserForm({}); }} className="text-xs text-[#71717a] hover:text-[#9898a8] px-2 py-1">Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 font-medium text-[#f4f4f8]">{u.display_name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#a1a1aa]">{u.email}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2.5 py-1 rounded-md bg-violet-500/10 text-violet-300 border border-violet-500/20 font-mono font-medium">
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-[#71717a]">{formatDateTime(u.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => { setEditingUser(u.id); setUserForm(u); }} className="p-1.5 hover:bg-violet-500/10 text-violet-400 rounded-md transition-colors" title="Edit User">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => deleteUserMut.mutate(u.id)} className="p-1.5 hover:bg-red-500/10 text-red-400 rounded-md transition-colors" title="Delete User">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 3: SCENES & STUNTS CRUD
      ───────────────────────────────────────────────────────────── */}
      {tab === "Scenes & Stunts" && (
        <div className="rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-[#16161f] border-b border-[#27272f] gap-3">
            <div className="flex items-center gap-2 text-xs text-[#a1a1aa]">
              <Film className="w-4 h-4 text-violet-400" />
              <span className="font-medium text-[#f4f4f8]">Filter Scenes by Film Project:</span>
              <select
                value={selectedProdFilter}
                onChange={(e) => setSelectedProdFilter(e.target.value)}
                className="bg-[#111118] border border-[#27272f] rounded-lg px-2.5 py-1.5 text-xs text-[#f4f4f8] focus:outline-none focus:border-violet-500 font-medium"
              >
                <option value="active">Active Project ({activeProject?.name || "Selected"})</option>
                <option value="all">All Film Projects ({scenes.length})</option>
                {productions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="text-xs text-[#71717a] font-mono">
              Showing {filteredScenes.length} {filteredScenes.length === 1 ? "scene" : "scenes"}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-[#27272f] text-[#71717a] text-xs uppercase font-mono bg-[#16161f]">
                  <th className="px-4 py-3 font-semibold">SCENE</th>
                  <th className="px-4 py-3 font-semibold">DESCRIPTION</th>
                  <th className="px-4 py-3 font-semibold">STUNT TYPE</th>
                  <th className="px-4 py-3 font-semibold">LOCATION</th>
                  <th className="px-4 py-3 font-semibold">SAFETY & CREW</th>
                  <th className="px-4 py-3 text-right font-semibold">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1d1d24]">
                {filteredScenes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-[#71717a]">
                      No scenes found for the selected film project filter.
                    </td>
                  </tr>
                ) : (
                  filteredScenes.map(sc => (
                  <tr key={sc.id} className={cn("hover:bg-[#18181f] transition-colors", editingScene === sc.id ? "bg-[#1d1d28]" : "")}>
                    {editingScene === sc.id ? (
                      <>
                        <td className="px-4 py-3 font-mono text-xs text-[#f4f4f8]">{sc.scene_number}</td>
                        <td className="px-4 py-3">
                          <input type="text" defaultValue={sc.description} onChange={e => setSceneForm(v => ({ ...v, description: e.target.value }))} className="bg-[#111118] border border-[#27272f] rounded px-2 py-1 text-xs text-[#f4f4f8] w-full" />
                        </td>
                        <td className="px-4 py-3">
                          <select defaultValue={sc.stunt_type} onChange={e => setSceneForm(v => ({ ...v, stunt_type: e.target.value }))} className="bg-[#111118] border border-[#27272f] rounded px-2 py-1 text-xs text-[#f4f4f8]">
                            <option value="none">none</option>
                            <option value="high_fall">high_fall</option>
                            <option value="vehicle_chase">vehicle_chase</option>
                            <option value="fire_gag">fire_gag</option>
                            <option value="underwater">underwater</option>
                            <option value="practical_effect">practical_effect</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <input type="text" defaultValue={sc.location} onChange={e => setSceneForm(v => ({ ...v, location: e.target.value }))} className="bg-[#111118] border border-[#27272f] rounded px-2 py-1 text-xs text-[#f4f4f8] w-full" />
                        </td>
                        <td className="px-4 py-3 text-xs space-y-1">
                          <label className="flex items-center gap-1.5"><input type="checkbox" defaultChecked={sc.stunt_coordinator_assigned} onChange={e => setSceneForm(v => ({ ...v, stunt_coordinator_assigned: e.target.checked }))} /> Coord</label>
                          <label className="flex items-center gap-1.5"><input type="checkbox" defaultChecked={sc.medic_onset} onChange={e => setSceneForm(v => ({ ...v, medic_onset: e.target.checked }))} /> Medic</label>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => updateSceneMut.mutate()} disabled={updateSceneMut.isPending} className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium bg-emerald-500/10 px-2 py-1 rounded">
                              {updateSceneMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                            </button>
                            <button onClick={() => { setEditingScene(null); setSceneForm({}); }} className="text-xs text-[#71717a] hover:text-[#9898a8] px-2 py-1">Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 font-mono font-bold text-xs text-violet-300">{sc.scene_number}</td>
                        <td className="px-4 py-3 text-[#f4f4f8] text-xs max-w-xs truncate">{sc.description}</td>
                        <td className="px-4 py-3 font-mono text-xs text-amber-400">{sc.stunt_type}</td>
                        <td className="px-4 py-3 text-xs text-[#a1a1aa]">{sc.location || "—"}</td>
                        <td className="px-4 py-3 text-xs space-y-0.5 text-[#a1a1aa]">
                          <div>Coord: {sc.stunt_coordinator_assigned ? "✓" : "—"} | Medic: {sc.medic_onset ? "✓" : "—"}</div>
                          <div>Wind: {sc.forecast_wind_kmh ?? 0}kmh | Signoffs: {sc.crew_signoffs}</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => { setEditingScene(sc.id); setSceneForm(sc); }} className="p-1.5 hover:bg-violet-500/10 text-violet-400 rounded-md transition-colors" title="Edit Scene">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => deleteSceneMut.mutate(sc.id)} className="p-1.5 hover:bg-red-500/10 text-red-400 rounded-md transition-colors" title="Delete Scene">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 4: PRODUCTIONS CRUD
      ───────────────────────────────────────────────────────────── */}
      {tab === "Productions" && (
        <div className="rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-[#27272f] text-[#71717a] text-xs uppercase font-mono bg-[#16161f]">
                  <th className="px-4 py-3 font-semibold">PRODUCTION TITLE</th>
                  <th className="px-4 py-3 font-semibold">ID</th>
                  <th className="px-4 py-3 font-semibold">CREATED</th>
                  <th className="px-4 py-3 text-right font-semibold">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1d1d24]">
                {productions.map(p => (
                  <tr key={p.id} className={cn("hover:bg-[#18181f] transition-colors", editingProd === p.id ? "bg-[#1d1d28]" : "")}>
                    {editingProd === p.id ? (
                      <>
                        <td className="px-4 py-3"><input type="text" defaultValue={p.name} onChange={e => setProdForm(v => ({ ...v, name: e.target.value }))} className="bg-[#111118] border border-[#27272f] rounded px-2 py-1 text-xs text-[#f4f4f8] w-full" /></td>
                        <td className="px-4 py-3 font-mono text-xs text-[#71717a]">{p.id}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#71717a]">{formatDateTime(p.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => updateProdMut.mutate()} disabled={updateProdMut.isPending} className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium bg-emerald-500/10 px-2 py-1 rounded">
                              {updateProdMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                            </button>
                            <button onClick={() => { setEditingProd(null); setProdForm({}); }} className="text-xs text-[#71717a] hover:text-[#9898a8] px-2 py-1">Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 font-semibold text-[#f4f4f8]">{p.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#a1a1aa]">{p.id}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#71717a]">{formatDateTime(p.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => { setEditingProd(p.id); setProdForm(p); }} className="p-1.5 hover:bg-violet-500/10 text-violet-400 rounded-md transition-colors" title="Edit Production">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => deleteProdMut.mutate(p.id)} className="p-1.5 hover:bg-red-500/10 text-red-400 rounded-md transition-colors" title="Delete Production">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 5: AUDIT LOG (READ ONLY)
      ───────────────────────────────────────────────────────────── */}
      {tab === "Audit Log" && (
        <div className="rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden shadow-xl">
          <div className="px-4 py-3 border-b border-[#27272f] text-xs text-[#71717a] font-mono uppercase">
            COMPLIANCE AUDIT TRAIL — IMMUTABLE APPEND-ONLY LOG
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-[#27272f] text-[#71717a] text-xs uppercase font-mono bg-[#16161f]">
                  <th className="px-4 py-2 font-semibold">TIME</th>
                  <th className="px-4 py-2 font-semibold">SCENE</th>
                  <th className="px-4 py-2 font-semibold">STATUS</th>
                  <th className="px-4 py-2 font-semibold">AGENT</th>
                  <th className="px-4 py-2 font-semibold">VIOLATIONS / OVERRIDE REASON</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1d1d24]">
                {auditLog.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-[#71717a] text-sm">No compliance checks logged yet</td></tr>
                ) : (
                  auditLog.map(c => (
                    <tr key={c.id} className="hover:bg-[#18181f] transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-[#71717a]">{formatDateTime(c.created_at)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[#a1a1aa]">{c.scene_id}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={c.status} size="sm" /></td>
                      <td className="px-4 py-2.5 text-xs text-[#a1a1aa]">{c.checked_by_agent}</td>
                      <td className="px-4 py-2.5 text-xs">
                        {c.overridden_by_user_id ? (
                          <span className="text-amber-400 font-medium">⚠ Override: {c.override_reason}</span>
                        ) : c.violations.length > 0 ? (
                          <span className="text-red-400 font-medium">{c.violations.join("; ")}</span>
                        ) : (
                          <span className="text-emerald-500 font-medium">All checks passed</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODALS FOR CREATING ENTITIES
      ───────────────────────────────────────────────────────────── */}
      {/* Add Safety Rule Modal */}
      {showAddRule && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111118] border border-[#27272f] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#27272f] pb-3">
              <h2 className="text-lg font-bold text-[#f4f4f8]">Add New Safety Rule</h2>
              <button onClick={() => setShowAddRule(false)} className="text-[#71717a] hover:text-[#f4f4f8]"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[#a1a1aa] font-medium mb-1">Stunt Type Identifier</label>
                <input type="text" placeholder="e.g. pyrotechnics" value={ruleForm.stunt_type || ""} onChange={e => setRuleForm(v => ({ ...v, stunt_type: e.target.value }))} className="w-full bg-[#181820] border border-[#27272f] rounded-lg px-3 py-2 text-[#f4f4f8]" />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer text-[#f4f4f8]">
                  <input type="checkbox" checked={ruleForm.requires_stunt_coordinator ?? true} onChange={e => setRuleForm(v => ({ ...v, requires_stunt_coordinator: e.target.checked }))} className="rounded accent-violet-500" />
                  Requires Stunt Coordinator
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-[#f4f4f8]">
                  <input type="checkbox" checked={ruleForm.requires_medic_onset ?? false} onChange={e => setRuleForm(v => ({ ...v, requires_medic_onset: e.target.checked }))} className="rounded accent-violet-500" />
                  Requires Medic On-set
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#a1a1aa] font-medium mb-1">Max Wind (km/h)</label>
                  <input type="number" value={ruleForm.max_wind_speed_kmh ?? 30} onChange={e => setRuleForm(v => ({ ...v, max_wind_speed_kmh: +e.target.value }))} className="w-full bg-[#181820] border border-[#27272f] rounded-lg px-3 py-2 text-[#f4f4f8]" />
                </div>
                <div>
                  <label className="block text-[#a1a1aa] font-medium mb-1">Min Signoffs</label>
                  <input type="number" value={ruleForm.min_crew_signoffs ?? 1} onChange={e => setRuleForm(v => ({ ...v, min_crew_signoffs: +e.target.value }))} className="w-full bg-[#181820] border border-[#27272f] rounded-lg px-3 py-2 text-[#f4f4f8]" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-[#27272f]">
              <button onClick={() => setShowAddRule(false)} className="px-4 py-2 text-xs text-[#71717a] hover:text-[#f4f4f8]">Cancel</button>
              <button onClick={() => createRuleMut.mutate(ruleForm)} disabled={!ruleForm.stunt_type || createRuleMut.isPending} className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold">
                {createRuleMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Create Safety Rule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showAddUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111118] border border-[#27272f] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#27272f] pb-3">
              <h2 className="text-lg font-bold text-[#f4f4f8]">Add New User</h2>
              <button onClick={() => setShowAddUser(false)} className="text-[#71717a] hover:text-[#f4f4f8]"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[#a1a1aa] font-medium mb-1">Full Name</label>
                <input type="text" placeholder="Jane Doe" value={userForm.display_name || ""} onChange={e => setUserForm(v => ({ ...v, display_name: e.target.value }))} className="w-full bg-[#181820] border border-[#27272f] rounded-lg px-3 py-2 text-[#f4f4f8]" />
              </div>
              <div>
                <label className="block text-[#a1a1aa] font-medium mb-1">Email Address</label>
                <input type="email" placeholder="jane@production.com" value={userForm.email || ""} onChange={e => setUserForm(v => ({ ...v, email: e.target.value }))} className="w-full bg-[#181820] border border-[#27272f] rounded-lg px-3 py-2 text-[#f4f4f8]" />
              </div>
              <div>
                <label className="block text-[#a1a1aa] font-medium mb-1">System Role</label>
                <select value={userForm.role || "ad"} onChange={e => setUserForm(v => ({ ...v, role: e.target.value }))} className="w-full bg-[#181820] border border-[#27272f] rounded-lg px-3 py-2 text-[#f4f4f8]">
                  <option value="admin">Admin</option>
                  <option value="safety_lead">Safety Lead</option>
                  <option value="ad">First AD</option>
                  <option value="director">Director</option>
                  <option value="actor">Actor</option>
                  <option value="sound">Sound Engineer</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-[#27272f]">
              <button onClick={() => setShowAddUser(false)} className="px-4 py-2 text-xs text-[#71717a] hover:text-[#f4f4f8]">Cancel</button>
              <button onClick={() => createUserMut.mutate({ email: userForm.email!, display_name: userForm.display_name!, role: userForm.role! })} disabled={!userForm.email || !userForm.display_name || createUserMut.isPending} className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold">
                {createUserMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Scene Modal */}
      {showAddScene && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111118] border border-[#27272f] rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#27272f] pb-3">
              <h2 className="text-lg font-bold text-[#f4f4f8]">Add New Scene</h2>
              <button onClick={() => setShowAddScene(false)} className="text-[#71717a] hover:text-[#f4f4f8]"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#a1a1aa] font-medium mb-1">Production Project</label>
                  <select value={sceneForm.production_id || ""} onChange={e => setSceneForm(v => ({ ...v, production_id: e.target.value }))} className="w-full bg-[#181820] border border-[#27272f] rounded-lg px-3 py-2 text-[#f4f4f8]">
                    {productions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[#a1a1aa] font-medium mb-1">Scene Number</label>
                  <input type="text" placeholder="SC-101" value={sceneForm.scene_number || ""} onChange={e => setSceneForm(v => ({ ...v, scene_number: e.target.value }))} className="w-full bg-[#181820] border border-[#27272f] rounded-lg px-3 py-2 text-[#f4f4f8]" />
                </div>
              </div>
              <div>
                <label className="block text-[#a1a1aa] font-medium mb-1">Description</label>
                <textarea rows={2} placeholder="Scene action summary..." value={sceneForm.description || ""} onChange={e => setSceneForm(v => ({ ...v, description: e.target.value }))} className="w-full bg-[#181820] border border-[#27272f] rounded-lg px-3 py-2 text-[#f4f4f8]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#a1a1aa] font-medium mb-1">Stunt Category</label>
                  <select value={sceneForm.stunt_type || "none"} onChange={e => setSceneForm(v => ({ ...v, stunt_type: e.target.value }))} className="w-full bg-[#181820] border border-[#27272f] rounded-lg px-3 py-2 text-[#f4f4f8]">
                    <option value="none">none</option>
                    <option value="high_fall">high_fall</option>
                    <option value="vehicle_chase">vehicle_chase</option>
                    <option value="fire_gag">fire_gag</option>
                    <option value="underwater">underwater</option>
                    <option value="practical_effect">practical_effect</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[#a1a1aa] font-medium mb-1">Location</label>
                  <input type="text" placeholder="Rooftop, Highway, etc." value={sceneForm.location || ""} onChange={e => setSceneForm(v => ({ ...v, location: e.target.value }))} className="w-full bg-[#181820] border border-[#27272f] rounded-lg px-3 py-2 text-[#f4f4f8]" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-[#27272f]">
              <button onClick={() => setShowAddScene(false)} className="px-4 py-2 text-xs text-[#71717a] hover:text-[#f4f4f8]">Cancel</button>
              <button onClick={() => createSceneMut.mutate(sceneForm)} disabled={!sceneForm.scene_number || createSceneMut.isPending} className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold">
                {createSceneMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Create Scene"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Production Modal */}
      {showAddProd && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111118] border border-[#27272f] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#27272f] pb-3">
              <h2 className="text-lg font-bold text-[#f4f4f8]">Add New Production Project</h2>
              <button onClick={() => setShowAddProd(false)} className="text-[#71717a] hover:text-[#f4f4f8]"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[#a1a1aa] font-medium mb-1">Production Project Title</label>
                <input type="text" placeholder="Project Aegis" value={prodForm.name || ""} onChange={e => setProdForm(v => ({ ...v, name: e.target.value }))} className="w-full bg-[#181820] border border-[#27272f] rounded-lg px-3 py-2 text-[#f4f4f8]" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-[#27272f]">
              <button onClick={() => setShowAddProd(false)} className="px-4 py-2 text-xs text-[#71717a] hover:text-[#f4f4f8]">Cancel</button>
              <button onClick={() => createProdMut.mutate(prodForm.name!)} disabled={!prodForm.name || createProdMut.isPending} className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold">
                {createProdMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Create Production"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
