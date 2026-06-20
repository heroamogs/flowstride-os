import { Copy } from "lucide-react";

export const TestDataPanel = () => {
  return (
    <div style={{ padding: "16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            color: "var(--fs-text-dim)",
            fontWeight: "bold",
          }}
        >
          VARIABLE SET: <span style={{ color: "white" }}>STAGING_USERS</span>
        </span>
        <Copy size={14} color="#444" />
      </div>

      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}
      >
        <thead>
          <tr
            style={{
              textAlign: "left",
              borderBottom: "1px solid var(--fs-border)",
              color: "var(--fs-text-dim)",
            }}
          >
            <th style={{ padding: "8px" }}>Key</th>
            <th style={{ padding: "8px" }}>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: "1px solid #161b22" }}>
            <td style={{ padding: "8px", color: "var(--fs-accent-purple)" }}>
              admin_email
            </td>
            <td style={{ padding: "8px" }}>admin@flowstride.io</td>
          </tr>
          <tr style={{ borderBottom: "1px solid #161b22" }}>
            <td style={{ padding: "8px", color: "var(--fs-accent-purple)" }}>
              test_password
            </td>
            <td style={{ padding: "8px" }}>••••••••••••</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};
