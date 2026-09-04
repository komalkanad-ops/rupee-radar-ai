import { apiPost } from "./api";

// Reports real, uncaught website errors to the backend's /logs endpoint so they show up in the
// admin console's Logs page — this site had zero error visibility before this (no Sentry DSN is
// configured for the web app), same standing gap noted for the backend/Android sides. Fire-and-
// forget: a logging failure must never surface to the user.
export function installErrorLogging() {
  window.addEventListener("error", (event) => {
    apiPost("/logs", {
      source: "WEB",
      level: "ERROR",
      feature: "website",
      message: `${event.message} (${event.filename}:${event.lineno}:${event.colno})`,
    }).catch(() => {});
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
    apiPost("/logs", { source: "WEB", level: "ERROR", feature: "website", message: `Unhandled rejection: ${reason}` }).catch(() => {});
  });
}
