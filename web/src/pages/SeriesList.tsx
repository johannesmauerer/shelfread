import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export function SeriesList() {
  const seriesList = useQuery(api.series.list);

  if (seriesList === undefined) {
    return <p style={{ color: "#888" }}>Loading...</p>;
  }

  if (seriesList.length === 0) {
    return (
      <p style={{ color: "#888", textAlign: "center", padding: "2rem" }}>
        No series yet. Ingest your first newsletter to get started.
      </p>
    );
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Series</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
        {seriesList.map((series) => (
          <a
            key={series._id}
            href={`#series/${series._id}`}
            style={{
              display: "block",
              padding: "1rem",
              background: "#fff",
              border: "1px solid #eee",
              borderRadius: "8px",
              textDecoration: "none",
              color: "inherit",
              borderTop: `4px solid ${series.colorPrimary || "#2c3e50"}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>{series.name}</div>
                <div style={{ fontSize: "0.8rem", color: "#888", marginTop: "2px" }}>
                  {series.senderEmail}
                </div>
              </div>
              {series.colorPrimary && (
                <div style={{ display: "flex", gap: "4px" }}>
                  <ColorDot color={series.colorPrimary} />
                  {series.colorSecondary && <ColorDot color={series.colorSecondary} />}
                  {series.colorAccent && <ColorDot color={series.colorAccent} />}
                </div>
              )}
            </div>
            <div style={{ marginTop: "0.75rem", display: "flex", justifyContent: "space-between", fontSize: "0.85rem", color: "#666" }}>
              <span>{series.issueCount} issues</span>
              {series.lastIssueDate && (
                <span>Last: {new Date(series.lastIssueDate).toLocaleDateString()}</span>
              )}
            </div>
            {series.fontMood && (
              <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#aaa" }}>
                {series.designAnalyzed ? `Design: ${series.fontMood}` : "Design not analyzed"}
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

function ColorDot({ color }: { color: string }) {
  return (
    <div
      style={{
        width: "14px",
        height: "14px",
        borderRadius: "50%",
        backgroundColor: color,
        border: "1px solid #ddd",
      }}
    />
  );
}
