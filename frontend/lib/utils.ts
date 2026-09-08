// Status color system — one palette, used everywhere.
// Matches UI/UX Brief: green=approved, red=blocked, amber=pending, gray=unchecked.

export type ComplianceStatus = "approved" | "blocked" | "pending" | null | undefined;

export function statusColor(status: ComplianceStatus): string {
  switch (status) {
    case "approved": return "text-emerald-400";
    case "blocked":  return "text-red-400";
    case "pending":  return "text-amber-400";
    default:         return "text-zinc-500";
  }
}

export function statusBg(status: ComplianceStatus): string {
  switch (status) {
    case "approved": return "bg-emerald-500/10 border-emerald-500/30";
    case "blocked":  return "bg-red-500/10 border-red-500/30";
    case "pending":  return "bg-amber-500/10 border-amber-500/30";
    default:         return "bg-zinc-800 border-zinc-700";
  }
}

export function statusDot(status: ComplianceStatus): string {
  switch (status) {
    case "approved": return "bg-emerald-400";
    case "blocked":  return "bg-red-400";
    case "pending":  return "bg-amber-400 animate-pulse";
    default:         return "bg-zinc-600";
  }
}

export function statusLabel(status: ComplianceStatus): string {
  switch (status) {
    case "approved": return "APPROVED";
    case "blocked":  return "BLOCKED";
    case "pending":  return "PENDING";
    default:         return "NOT CHECKED";
  }
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric"
  });
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

export function stuntTypeLabel(type: string): string {
  const map: Record<string, string> = {
    high_fall: "High Fall",
    vehicle_chase: "Vehicle Chase",
    fire_gag: "Fire Gag",
    underwater: "Underwater",
    practical_effect: "Practical Effect",
    none: "No Stunt",
  };
  return map[type] || type;
}

export function stuntTypeBadge(type: string): string {
  const map: Record<string, string> = {
    high_fall: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    vehicle_chase: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    fire_gag: "bg-red-500/20 text-red-300 border-red-500/30",
    underwater: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    practical_effect: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    none: "bg-zinc-700 text-zinc-400 border-zinc-600",
  };
  return map[type] || "bg-zinc-700 text-zinc-400 border-zinc-600";
}

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
