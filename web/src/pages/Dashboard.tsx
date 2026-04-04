import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { StatusBadge } from "../components/StatusBadge.tsx";

export function Dashboard() {
  const issues = useQuery(api.issues.listRecent);
  const stats = useQuery(api.issues.stats);

  return (
    <div>
      <Stats stats={stats} />
      <IngestForm />
      <IssueTable issues={issues} />
    </div>
  );
}

function Stats({
  stats,
}: {
  stats:
    | {
        total: number;
        pending: number;
        extracting: number;
        generating: number;
        ready: number;
        failed: number;
      }
    | undefined;
}) {
  if (!stats) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: "1.5rem",
        marginBottom: "1.5rem",
        flexWrap: "wrap",
      }}
    >
      <StatCard label="Total" value={stats.total} />
      <StatCard label="Ready" value={stats.ready} color="#2e7d32" />
      <StatCard label="Processing" value={stats.extracting + stats.generating} color="#f57f17" />
      <StatCard label="Pending" value={stats.pending} color="#555" />
      <StatCard label="Failed" value={stats.failed} color="#c62828" />
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div
      style={{
        padding: "0.75rem 1rem",
        background: "#fff",
        border: "1px solid #eee",
        borderRadius: "8px",
        minWidth: "80px",
      }}
    >
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: color ?? "#1a1a1a" }}>
        {value}
      </div>
      <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>
        {label}
      </div>
    </div>
  );
}

function IngestForm() {
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!from || !subject || !htmlBody) return;

    setSubmitting(true);
    setMessage("");

    try {
      // POST to the Convex HTTP action endpoint
      const siteUrl = import.meta.env.CONVEX_SITE_URL as string;

      const res = await fetch(`${siteUrl}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, subject, htmlBody }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage(`Ingested! Issue ID: ${data.issueId}`);
        setFrom("");
        setSubject("");
        setHtmlBody("");
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <details style={{ marginBottom: "1.5rem" }}>
      <summary
        style={{
          cursor: "pointer",
          fontWeight: 600,
          marginBottom: "0.75rem",
          color: "#2c3e50",
        }}
      >
        Manual Ingest
      </summary>
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          padding: "1rem",
          background: "#fff",
          border: "1px solid #eee",
          borderRadius: "8px",
        }}
      >
        <input
          type="text"
          placeholder="From (e.g., ben@stratechery.com)"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          style={inputStyle}
        />
        <textarea
          placeholder="Paste newsletter HTML here..."
          value={htmlBody}
          onChange={(e) => setHtmlBody(e.target.value)}
          rows={6}
          style={{ ...inputStyle, resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <button
            type="submit"
            disabled={submitting || !from || !subject || !htmlBody}
            style={{
              padding: "0.5rem 1rem",
              background: "#2c3e50",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "Ingesting..." : "Ingest"}
          </button>
          {message && (
            <span style={{ fontSize: "0.85rem", color: message.startsWith("Error") ? "#c62828" : "#2e7d32" }}>
              {message}
            </span>
          )}
        </div>
      </form>
    </details>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.5rem",
  border: "1px solid #ddd",
  borderRadius: "4px",
  fontSize: "0.9rem",
  fontFamily: "inherit",
};

function IssueTable({
  issues,
}: {
  issues:
    | Array<{
        _id: string;
        title: string;
        seriesName: string;
        status: "pending" | "extracting" | "generating" | "ready" | "failed";
        receivedAt: number;
        epubFileId?: string;
        epubSizeBytes?: number;
        error?: string;
      }>
    | undefined;
}) {
  if (issues === undefined) {
    return <p style={{ color: "#888" }}>Loading...</p>;
  }

  if (issues.length === 0) {
    return (
      <p style={{ color: "#888", textAlign: "center", padding: "2rem" }}>
        No issues yet. Use the Manual Ingest form above to add your first newsletter.
      </p>
    );
  }

  const siteUrl = import.meta.env.CONVEX_SITE_URL as string;

  return (
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Title</th>
          <th>Series</th>
          <th>Received</th>
          <th>Size</th>
          <th>Download</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue) => (
          <tr key={issue._id}>
            <td>
              <StatusBadge status={issue.status} />
            </td>
            <td>
              {issue.title}
              {issue.error && (
                <div style={{ fontSize: "0.75rem", color: "#c62828", marginTop: "2px" }}>
                  {issue.error}
                </div>
              )}
            </td>
            <td>{issue.seriesName}</td>
            <td style={{ fontSize: "0.85rem", color: "#666" }}>
              {new Date(issue.receivedAt).toLocaleString()}
            </td>
            <td style={{ fontSize: "0.85rem", color: "#666" }}>
              {issue.epubSizeBytes
                ? `${(issue.epubSizeBytes / 1024).toFixed(0)} KB`
                : "-"}
            </td>
            <td>
              {issue.status === "ready" && issue.epubFileId ? (
                <a
                  href={`${siteUrl}/download?id=${issue._id}`}
                  style={{
                    padding: "3px 10px",
                    background: "#2c3e50",
                    color: "#fff",
                    borderRadius: "4px",
                    textDecoration: "none",
                    fontSize: "0.8rem",
                  }}
                >
                  EPUB
                </a>
              ) : (
                "-"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
