import { describe, it, expect } from "vitest";
import { withConnectionTimeouts } from "../src/lib/prisma.js";

describe("withConnectionTimeouts", () => {
  it("appends timeout params to a URL with no existing query string", () => {
    const out = withConnectionTimeouts("mysql://user:pass@host:3306/db");
    expect(out).toBe("mysql://user:pass@host:3306/db?connect_timeout=10&pool_timeout=10&connection_limit=5");
  });

  it("appends timeout params to a URL that already has a query string", () => {
    const out = withConnectionTimeouts("mysql://user:pass@host:3306/db?sslaccept=strict");
    const [base, query] = out.split("?");
    const params = new URLSearchParams(query);
    expect(base).toBe("mysql://user:pass@host:3306/db");
    expect(params.get("sslaccept")).toBe("strict");
    expect(params.get("connect_timeout")).toBe("10");
    expect(params.get("pool_timeout")).toBe("10");
    expect(params.get("connection_limit")).toBe("5");
  });

  it("does not override a param the URL already sets explicitly", () => {
    const out = withConnectionTimeouts("mysql://user:pass@host:3306/db?connect_timeout=30&connection_limit=20");
    const params = new URLSearchParams(out.split("?")[1]);
    expect(params.get("connect_timeout")).toBe("30");
    expect(params.get("connection_limit")).toBe("20");
    expect(params.get("pool_timeout")).toBe("10");
  });
});
