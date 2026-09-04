import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("Merchant offers (/offers/active)", () => {
  const createdOfferIds: string[] = [];
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await prisma.merchantOffer.deleteMany({ where: { id: { in: createdOfferIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  async function makeOffer(pattern: string, opts: Partial<{ from: Date; until: Date }> = {}) {
    const offer = await prisma.merchantOffer.create({
      data: {
        merchantNamePattern: pattern,
        bankName: "HDFC Bank",
        title: `${pattern} deal`,
        discountPct: 10,
        validFrom: opts.from ?? new Date(Date.now() - 86400_000),
        validUntil: opts.until ?? new Date(Date.now() + 7 * 86400_000),
      },
    });
    createdOfferIds.push(offer.id);
    return offer;
  }

  it("requires a token", async () => {
    const res = await request(app).get("/offers/active").query({ merchants: "Zara" });
    expect(res.status).toBe(401);
  });

  it("is reachable without PRO and returns only matching, currently-valid offers", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);

    await makeOffer("Croma");
    await makeOffer("Shoppers Stop");
    await makeOffer("Westside", { until: new Date(Date.now() - 3600_000) }); // expired

    const res = await request(app)
      .get("/offers/active")
      .query({ merchants: "Croma,Westside,Zara" })
      .set("Authorization", `Bearer ${user.token}`);

    expect(res.status).toBe(200);
    const patterns = res.body.map((o: any) => o.merchantNamePattern);
    expect(patterns).toContain("Croma");
    expect(patterns).not.toContain("Westside"); // expired
    expect(patterns).not.toContain("Shoppers Stop"); // not requested
    expect(res.body[0]).toHaveProperty("discountPct", 10);
    expect(res.body[0]).not.toHaveProperty("validFrom"); // trimmed shape
  });

  it("returns [] for an empty merchants list", async () => {
    const user = await createAnonymousUser();
    createdUserIds.push(user.userId);
    const res = await request(app).get("/offers/active").set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
