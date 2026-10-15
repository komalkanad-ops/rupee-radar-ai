import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";
import { normalizeName, normalizeSubcategory, reservedReason } from "../src/modules/customLists/customListRules.js";

describe("customListRules (KEEP IN SYNC with CustomListsTest.kt)", () => {
  it("normalizeName trims, collapses spaces and drops invisible characters", () => {
    expect(normalizeName("  Pet   care ")).toBe("Pet care");
    expect(normalizeName("Pet​care")).toBe("Petcare");
    expect(normalizeName("")).toBeNull();
    expect(normalizeName("   ")).toBeNull();
    expect(normalizeName("---")).toBeNull();
    expect(normalizeName("x".repeat(41))).toBeNull();
    expect(normalizeName("x".repeat(40))).toBe("x".repeat(40));
    expect(normalizeName(42)).toBeNull();
  });

  it("reservedReason blocks built-in categories and payment methods, case-insensitively", () => {
    expect(reservedReason("EXPENSE_CATEGORY", "Income")).not.toBeNull();
    expect(reservedReason("EXPENSE_CATEGORY", "transfer")).not.toBeNull();
    expect(reservedReason("INCOME_CATEGORY", "Savings")).not.toBeNull();
    expect(reservedReason("EXPENSE_CATEGORY", "Groceries")).not.toBeNull();
    expect(reservedReason("EXPENSE_CATEGORY", "Pet care")).toBeNull();
    expect(reservedReason("PAYMENT_METHOD", "UPI")).not.toBeNull();
    expect(reservedReason("PAYMENT_METHOD", "Bank transfer")).not.toBeNull();
    expect(reservedReason("PAYMENT_METHOD", "HDFC credit card")).toBeNull();
    // Payees can be called anything, even a category name.
    expect(reservedReason("PAYEE", "Groceries")).toBeNull();
  });

  it("normalizeSubcategory: undefined leaves alone, null/empty clears, junk is ignored", () => {
    expect(normalizeSubcategory(undefined)).toBeUndefined();
    expect(normalizeSubcategory(null)).toBeNull();
    expect(normalizeSubcategory("")).toBeNull();
    expect(normalizeSubcategory(" Freelance ")).toBe("Freelance");
    expect(normalizeSubcategory(12)).toBeUndefined();
    expect(normalizeSubcategory("y".repeat(41))).toBeUndefined();
  });
});

describe("Custom lists (/custom-lists)", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.customListItem.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  async function newUser() {
    const u = await createAnonymousUser();
    userIds.push(u.userId);
    return u;
  }
  const put = (token: string, id: string, body: unknown) =>
    request(app).put(`/custom-lists/${id}`).set("Authorization", `Bearer ${token}`).send(body as object);
  const list = (token: string) => request(app).get("/custom-lists").set("Authorization", `Bearer ${token}`);

  it("every route requires a token", async () => {
    expect((await request(app).get("/custom-lists")).status).toBe(401);
    expect((await request(app).put("/custom-lists/a1").send({ kind: "PAYEE", name: "x" })).status).toBe(401);
    expect((await request(app).delete("/custom-lists/a1")).status).toBe(401);
  });

  it("creates, renames and deletes by the app's own id", async () => {
    const u = await newUser();
    const created = await put(u.token, "cat-1", { kind: "EXPENSE_CATEGORY", name: "  Pet   care ", userId: "someone-else" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: "cat-1", kind: "EXPENSE_CATEGORY", name: "Pet care", defaultCategory: null });

    const renamed = await put(u.token, "cat-1", { kind: "EXPENSE_CATEGORY", name: "Pets" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Pets");

    const payee = await put(u.token, "payee-1", { kind: "PAYEE", name: "Corner Store", defaultCategory: "Groceries" });
    expect(payee.status).toBe(201);
    expect(payee.body.defaultCategory).toBe("groceries");

    const all = await list(u.token);
    expect(all.status).toBe(200);
    expect(all.body.map((i: any) => i.id).sort()).toEqual(["cat-1", "payee-1"]);
    const row = await prisma.customListItem.findFirst({ where: { clientId: "cat-1", userId: u.userId } });
    expect(row?.userId).toBe(u.userId);

    expect((await request(app).delete("/custom-lists/cat-1").set("Authorization", `Bearer ${u.token}`)).status).toBe(204);
    // Deleting again is fine — it's already gone.
    expect((await request(app).delete("/custom-lists/cat-1").set("Authorization", `Bearer ${u.token}`)).status).toBe(204);
    expect((await list(u.token)).body.map((i: any) => i.id)).toEqual(["payee-1"]);
  });

  it("rejects bad input", async () => {
    const u = await newUser();
    expect((await put(u.token, "a1", { kind: "NOPE", name: "x" })).status).toBe(400);
    expect((await put(u.token, "a1", { kind: "PAYEE", name: "" })).status).toBe(400);
    expect((await put(u.token, "a1", { kind: "PAYEE", name: "z".repeat(41) })).status).toBe(400);
    expect((await put(u.token, "a1", { kind: "EXPENSE_CATEGORY", name: "Income" })).status).toBe(400);
    expect((await put(u.token, "a1", { kind: "PAYMENT_METHOD", name: "upi" })).status).toBe(400);
    expect((await put(u.token, "a1", { kind: "EXPENSE_CATEGORY", name: "Pets", defaultCategory: "dining" })).status).toBe(400);
    expect((await put(u.token, "bad id!", { kind: "PAYEE", name: "x" })).status).toBe(400);
    expect((await put(u.token, "k1", { kind: "PAYEE", name: "Shop" })).status).toBe(201);
    expect((await put(u.token, "k1", { kind: "PAYER", name: "Shop" })).status).toBe(409);
    // Same name in the same list, any case → 409; same name in another list is fine.
    expect((await put(u.token, "k2", { kind: "PAYEE", name: "SHOP" })).status).toBe(409);
    expect((await put(u.token, "k3", { kind: "PAYMENT_METHOD", name: "Shop" })).status).toBe(201);
    // Renaming an item to its own name in a different case is not a clash.
    expect((await put(u.token, "k1", { kind: "PAYEE", name: "shop" })).status).toBe(200);
  });

  it("one user can't see, change or delete another user's items, even with the same id", async () => {
    const owner = await newUser();
    const other = await newUser();
    expect((await put(owner.token, "shared-id", { kind: "PAYEE", name: "Owner's" })).status).toBe(201);

    expect((await list(other.token)).body).toEqual([]);
    // The same id under another user is a separate item, not the owner's.
    expect((await put(other.token, "shared-id", { kind: "PAYEE", name: "Other's" })).status).toBe(201);
    expect((await request(app).delete("/custom-lists/shared-id").set("Authorization", `Bearer ${other.token}`)).status).toBe(204);

    const ownerItems = (await list(owner.token)).body;
    expect(ownerItems).toHaveLength(1);
    expect(ownerItems[0].name).toBe("Owner's");
  });

  it("stores an income sub-category on a transaction, and an older upload without it leaves it alone", async () => {
    const u = await newUser();
    const send = (t: Record<string, unknown>) =>
      request(app).post("/sms/transactions").set("Authorization", `Bearer ${u.token}`).send({ transactions: [t] });
    const base = { rawSmsHash: "sub-1", amount: 5000, merchant: "Client", category: "income", txnType: "credit", parsedVia: "manual", txnDate: "2026-10-01T10:00:00.000Z" };

    expect((await send({ ...base, subcategory: "Freelance" })).status).toBe(201);
    const read = async () => (await prisma.smsTransaction.findFirst({ where: { userId: u.userId, rawSmsHash: "sub-1" } }))?.subcategory;
    expect(await read()).toBe("Freelance");

    expect((await send(base)).status).toBe(201);
    expect(await read()).toBe("Freelance");

    expect((await send({ ...base, subcategory: null })).status).toBe(201);
    expect(await read()).toBeNull();

    // A row moved away from income loses its income label even if the client omits the field.
    expect((await send({ ...base, subcategory: "Freelance" })).status).toBe(201);
    expect((await send({ ...base, category: "transfer" })).status).toBe(201);
    expect(await read()).toBeNull();
  });
});
