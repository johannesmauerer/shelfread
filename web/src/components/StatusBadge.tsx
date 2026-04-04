type Status = "pending" | "extracting" | "generating" | "ready" | "failed";

const STATUS_STYLES: Record<Status, { bg: string; color: string }> = {
  pending: { bg: "#e0e0e0", color: "#555" },
  extracting: { bg: "#bbdefb", color: "#1565c0" },
  generating: { bg: "#fff9c4", color: "#f57f17" },
  ready: { bg: "#c8e6c9", color: "#2e7d32" },
  failed: { bg: "#ffcdd2", color: "#c62828" },
};

export function StatusBadge({ status }: { status: Status }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.pending;

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "12px",
        fontSize: "0.75rem",
        fontWeight: 600,
        backgroundColor: style.bg,
        color: style.color,
      }}
    >
      {status}
    </span>
  );
}
