import { CheckCircle2 } from "lucide-react";

export const AssertionsPanel = () => (
  <div style={{ padding: "15px" }}>
    <h4
      style={{
        fontSize: "11px",
        color: "var(--fs-text-dim)",
        textTransform: "uppercase",
        marginBottom: "15px",
      }}
    >
      Assertions
    </h4>
    {[
      "URL contains /dashboard",
      "Dashboard title visible",
      "Response status is 200",
    ].map((a) => (
      <div
        key={a}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          color: "var(--fs-success)",
          fontSize: "13px",
          marginBottom: "10px",
        }}
      >
        <CheckCircle2 size={14} /> {a}
      </div>
    ))}
  </div>
);
