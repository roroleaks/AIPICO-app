import { PHI_NOTICE_TEXT } from "@/lib/phi-notice";

export function PhiNotice() {
  return (
    <aside
      aria-label="Patient Privacy Notice"
      role="note"
      style={{
        marginTop: 14,
        marginBottom: 14,
        padding: "10px 14px",
        background: "#f8fafc",
        border: "1px solid #cbd5e1",
        borderRadius: 8,
        color: "#0f172a",
        fontSize: "0.82rem",
        lineHeight: 1.45,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span aria-hidden="true" style={{ fontSize: "1rem", lineHeight: 1 }}>🔒</span>
        <div>
          <strong style={{ display: "block", color: "#0f172a", marginBottom: 2 }}>
            Patient Privacy Notice:
          </strong>
          <span>{PHI_NOTICE_TEXT}</span>
        </div>
      </div>
    </aside>
  );
}
