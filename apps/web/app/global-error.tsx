"use client";

/**
 * The root layout's own failure. `app/error.tsx` renders *inside* that layout,
 * so it cannot catch an error thrown by it — this replaces the whole document.
 *
 * Nothing from the app is available here: not `globals.css`, which the root
 * layout imports, and not the inline script that sets `.dark` before first
 * paint (§7.4). So the two tokens this page needs are declared inline and the
 * theme follows `prefers-color-scheme` directly. Deliberately the only place
 * in the app with hard-coded colour values.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "0 1.5rem",
          background: "#fff",
          color: "#0a0a0a",
          colorScheme: "light dark",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <style>{`@media (prefers-color-scheme: dark){body{background:#000!important;color:#fff!important}}`}</style>
        <div style={{ width: "100%", maxWidth: "24rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 400 }}>
            TasksHQ did not start
          </h1>
          <p style={{ marginTop: "0.5rem", opacity: 0.7, lineHeight: 1.6 }}>
            The app failed before any page could render. Trying again often
            clears it. If it does not, the error is in the server log for
            whoever runs this app.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "2rem",
              padding: "0.5rem 1rem",
              borderRadius: "9999px",
              border: 0,
              font: "inherit",
              fontSize: "0.875rem",
              cursor: "pointer",
              background: "#0063e1",
              color: "#fff",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
