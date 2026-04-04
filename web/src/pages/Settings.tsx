import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

export function Settings() {
  const settings = useQuery(api.settings.list);
  const setSetting = useMutation(api.settings.set);

  const siteUrl = import.meta.env.CONVEX_SITE_URL as string;

  // Build current values from settings list
  const settingsMap = new Map<string, string>();
  settings?.forEach((s) => settingsMap.set(s.key, s.value));

  const allowedSenders = settingsMap.get("allowed_senders")
    ? JSON.parse(settingsMap.get("allowed_senders")!)
    : [];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Settings</h2>

      <Section title="OPDS Feed">
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={labelStyle}>Catalog URL</label>
          <CopyableUrl url={`${siteUrl}/opds/shelf/catalog.xml`} />
          <p style={helpStyle}>
            Add this URL to Readest, KOReader, or any OPDS-compatible reader app.
          </p>
        </div>
        <div>
          <label style={labelStyle}>Recent Issues (direct)</label>
          <CopyableUrl url={`${siteUrl}/opds/shelf/recent.xml`} />
          <p style={helpStyle}>
            Use this if your reader doesn't support navigation feeds.
          </p>
        </div>
      </Section>

      <Section title="Email Ingestion">
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={labelStyle}>Ingest Endpoint</label>
          <CopyableUrl url={`${siteUrl}/ingest`} />
          <p style={helpStyle}>
            Configure your email service (Mailgun, etc.) to POST to this URL.
          </p>
        </div>
      </Section>

      <Section title="Allowed Senders">
        <p style={helpStyle}>
          Only emails from these addresses will be processed. Leave empty to accept all senders.
        </p>
        <AllowedSendersList
          senders={allowedSenders}
          onUpdate={async (newList: string[]) => {
            await setSetting({ key: "allowed_senders", value: JSON.stringify(newList) });
          }}
        />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginBottom: "1.5rem",
        padding: "1.25rem",
        background: "#fff",
        border: "1px solid #eee",
        borderRadius: "8px",
      }}
    >
      <h3 style={{ margin: "0 0 1rem", fontSize: "1rem", color: "#2c3e50" }}>{title}</h3>
      {children}
    </div>
  );
}

function CopyableUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <code
        style={{
          flex: 1,
          padding: "0.4rem 0.6rem",
          background: "#f5f5f5",
          borderRadius: "4px",
          fontSize: "0.8rem",
          wordBreak: "break-all",
        }}
      >
        {url}
      </code>
      <button
        onClick={handleCopy}
        style={{
          padding: "0.4rem 0.75rem",
          background: copied ? "#2e7d32" : "#2c3e50",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          fontSize: "0.8rem",
          whiteSpace: "nowrap",
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function AllowedSendersList({
  senders,
  onUpdate,
}: {
  senders: string[];
  onUpdate: (newList: string[]) => Promise<void>;
}) {
  const [newSender, setNewSender] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    const email = newSender.trim().toLowerCase();
    if (!email || senders.includes(email)) return;
    setSaving(true);
    await onUpdate([...senders, email]);
    setNewSender("");
    setSaving(false);
  };

  const handleRemove = async (email: string) => {
    setSaving(true);
    await onUpdate(senders.filter((s) => s !== email));
    setSaving(false);
  };

  return (
    <div>
      {senders.length > 0 && (
        <div style={{ marginBottom: "0.75rem" }}>
          {senders.map((email) => (
            <div
              key={email}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.35rem 0.6rem",
                background: "#f5f5f5",
                borderRadius: "4px",
                marginBottom: "4px",
                fontSize: "0.85rem",
              }}
            >
              <span>{email}</span>
              <button
                onClick={() => handleRemove(email)}
                disabled={saving}
                style={{
                  background: "none",
                  border: "none",
                  color: "#c62828",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          type="email"
          value={newSender}
          onChange={(e) => setNewSender(e.target.value)}
          placeholder="sender@example.com"
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          style={{
            flex: 1,
            padding: "0.4rem 0.6rem",
            border: "1px solid #ddd",
            borderRadius: "4px",
            fontSize: "0.85rem",
            fontFamily: "inherit",
          }}
        />
        <button
          onClick={handleAdd}
          disabled={saving || !newSender.trim()}
          style={{
            padding: "0.4rem 0.75rem",
            background: "#2c3e50",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            fontSize: "0.85rem",
            opacity: saving ? 0.6 : 1,
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "#555",
  marginBottom: "0.35rem",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

const helpStyle: React.CSSProperties = {
  fontSize: "0.8rem",
  color: "#999",
  margin: "0.35rem 0 0",
};
