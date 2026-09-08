import { cn, statusDot, statusLabel, statusColor, statusBg, type ComplianceStatus } from "@/lib/utils";

interface StatusBadgeProps {
  status: ComplianceStatus;
  size?: "sm" | "md" | "lg";
}

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const sizeClasses = {
    sm: "text-[10px] px-1.5 py-0.5",
    md: "text-xs px-2 py-1",
    lg: "text-sm px-3 py-1.5 font-semibold",
  };

  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-md border font-mono font-medium",
      statusBg(status), statusColor(status), sizeClasses[size]
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusDot(status))} />
      {statusLabel(status)}
    </span>
  );
}

// Standalone colored dot
export function StatusDot({ status }: { status: ComplianceStatus }) {
  return (
    <span className={cn("inline-block w-2 h-2 rounded-full", statusDot(status))} />
  );
}
