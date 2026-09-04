// Entry-point shim for hosts with a fixed, non-configurable entry file expectation (e.g.
// Hostinger's Node.js App "Entry File" for the Express preset, which always looks for
// server.js at the app root and can't be pointed at dist/server.js). The actual compiled
// app lives in dist/ (see tsconfig.json + package.json's "build" script) — this just boots
// it. dist/server.js is regenerated on every deploy via the "postinstall" script, so it's
// always present here before this file ever runs.
import "./dist/server.js";
