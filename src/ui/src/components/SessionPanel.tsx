export const SessionPanel = () => {
  const sessionData = [
    { key: "auth_token", value: "eyJhbGciOiJIUzI1...", type: "Cookie" },
    { key: "user_id", value: "user_992834", type: "LocalStorage" },
    { key: "theme", value: "dark", type: "LocalStorage" },
    { key: "is_pro", value: "true", type: "Cookie" },
  ];

  return (
    <div style={{ padding: "16px", color: "var(--fs-text-main)" }}>
      <div style={{ display: "flex", gap: "15px", marginBottom: "15px" }}>
        <div
          style={{
            fontSize: "10px",
            color: "var(--fs-accent-purple)",
            fontWeight: "bold",
            borderBottom: "1px solid var(--fs-accent-purple)",
            paddingBottom: "4px",
          }}
        >
          STORAGE
        </div>
        <div
          style={{
            fontSize: "10px",
            color: "var(--fs-text-dim)",
            fontWeight: "bold",
          }}
        >
          COOKIES
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1px",
          backgroundColor: "var(--fs-border)",
          border: "1px solid var(--fs-border)",
          borderRadius: "6px",
          overflow: "hidden",
        }}
      >
        {sessionData.map((item) => (
          <div
            key={item.key}
            style={{
              display: "flex",
              backgroundColor: "#0d1117",
              padding: "8px 12px",
              fontSize: "12px",
              gap: "10px",
            }}
          >
            <span
              style={{
                color: "var(--fs-text-dim)",
                width: "100px",
                fontWeight: "500",
              }}
            >
              {item.key}
            </span>
            <span
              style={{
                color: "var(--fs-success)",
                flex: 1,
                fontFamily: "monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.value}
            </span>
            <span style={{ fontSize: "10px", color: "#444" }}>{item.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
