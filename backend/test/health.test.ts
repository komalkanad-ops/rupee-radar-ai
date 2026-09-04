import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

describe("Health checks", () => {
  it("GET /health is a static liveness check (no DB)", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("GET /health/sentry reports monitoring status as booleans, never the DSN", async () => {
    const res = await request(app).get("/health/sentry");
    expect(res.status).toBe(200);
    expect(typeof res.body.dsnConfigured).toBe("boolean");
    expect(typeof res.body.initialized).toBe("boolean");
    expect(JSON.stringify(res.body)).not.toContain("sentry.io");
  });

  it("GET /health/db reports DB reachability", async () => {
    const res = await request(app).get("/health/db");
    // In CI/local with a working test DB this is 200; if the DB is unreachable it must be a
    // clean 503, never a 500 — that distinction is the whole point of the endpoint.
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.ok).toBe(true);
      expect(res.body.db).toBe("up");
      // R7: a timed connect probe — connectMs is the wedged-pool early-warning signal.
      expect(typeof res.body.connectMs).toBe("number");
    } else {
      expect(res.body.ok).toBe(false);
      expect(res.body.db).toBe("down");
    }
  });
});
