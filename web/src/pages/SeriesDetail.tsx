import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { StatusBadge } from "../components/StatusBadge.tsx";

export function SeriesDetail({ seriesId }: { seriesId: string }) {
  const series = useQuery(api.series.get, { id: seriesId as Id<"series"> });
  const issues = useQuery(api.issues.listRecent);

  if (series === undefined) {
    return <p style={{ color: "#888" }}>Loading...</p>;
  }

  if (series === null) {
    return <p>Series not found.</p>;
  }

  const seriesIssues = issues?.filter((i) => i.seriesName === series.name) ?? [];
  const siteUrl = import.meta.env.CONVEX_SITE_URL as string;

  return (
    <div>
      <a href="#series" style={{ fontSize: "0.85rem", color: "#888" }}>&larr; All Series</a>

      <div
        style={{
          marginTop: "1rem",
          padding: "1.25rem",
          background: "#fff",
          border: "1px solid #eee",
          borderRadius: "8px",
          borderTop: `4px solid ${series.colorPrimary || "#2c3e50"}`,
        }}
      >
        <h2 style={{ margin: "0 0 0.25rem" }}>{series.name}</h2>
        <div style={{ fontSize: "0.85rem", color: "#888" }}>
          {series.senderName && `${series.senderName} · `}{series.senderEmail}
        </div>

        <div style={{ marginTop: "1rem", display: "flex", gap: "2rem", flexWrap: "wrap" }}>
          <InfoItem label="Issues" value={String(series.issueCount)} />
          <InfoItem label="Slug" value={series.slug} />
          {series.fontMood && <InfoItem label="Font Mood" value={series.fontMood} />}
        </div>

        {series.designAnalyzed && (
          <div style={{ marginTop: "1rem" }}>
            <div style={{ fontSize: "0.8rem", color: "#888", marginBottom: "0.5rem" }}>Design Echo</div>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              {series.colorPrimary && <ColorSwatch color={series.colorPrimary} label="Primary" />}
              {series.colorSecondary && <ColorSwatch color={series.colorSecondary} label="Secondary" />}
              {series.colorAccent && <ColorSwatch color={series.colorAccent} label="Accent" />}
            </div>
          </div>
        )}
      </div>

      <h3 style={{ marginTop: "1.5rem" }}>Issues</h3>
      {seriesIssues.length === 0 ? (
        <p style={{ color: "#888" }}>No issues found.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Title</th>
              <th>Received</th>
              <th>Size</th>
              <th>Download</th>
            </tr>
          </thead>
          <tbody>
            {seriesIssues.map((issue) => (
              <tr key={issue._id}>
                <td><StatusBadge status={issue.status} /></td>
                <td>{issue.title}</td>
                <td style={{ fontSize: "0.85rem", color: "#666" }}>
                  {new Date(issue.receivedAt).toLocaleString()}
                </td>
                <td style={{ fontSize: "0.85rem", color: "#666" }}>
                  {issue.epubSizeBytes ? `${(issue.epubSizeBytes / 1024).toFixed(0)} KB` : "-"}
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
                  ) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function ColorSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          width: "32px",
          height: "32px",
          borderRadius: "6px",
          backgroundColor: color,
          border: "1px solid #ddd",
        }}
      />
      <div style={{ fontSize: "0.7rem", color: "#888", marginTop: "2px" }}>{label}</div>
      <div style={{ fontSize: "0.65rem", color: "#aaa" }}>{color}</div>
    </div>
  );
}
