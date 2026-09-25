import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("SMS transactions — tags", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.smsTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  const base = { bankSender: "AD-KOTAKB-S", amount: 450, merchant: "Cafe", category: "dining", parsedVia: "regex", txnDate: "2026-08-12T10:00:00.000Z" };

  async function newUser() {
    const u = await createAnonymousUser();
    createdUserIds.push(u.userId);
    return u;
  }
  const post = (token: string, transactions: any[]) =>
    request(app).post("/sms/transactions").set("Authorization", `Bearer ${token}`).send({ transactions });
  const list = async (token: string) => {
    const res = await request(app).get("/sms/transactions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    return Object.fromEntries(res.body.map((t: any) => [t.rawSmsHash, t]));
  };

  it("stores normalised tags and GET returns both the raw column and the parsed array", async () => {
    const u = await newUser();
    expect((await post(u.token, [{ ...base, rawSmsHash: "tag-1", tags: ["  Goa  Trip ", "goa trip", "food"] }])).status).toBe(201);

    const t = (await list(u.token))["tag-1"];
    expect(t.tags).toEqual(["Goa Trip", "food"]);
    expect(t.tagsJson).toBe(JSON.stringify(["Goa Trip", "food"]));
  });

  it("a row that was never tagged reads back as tags: [] with a null tagsJson", async () => {
    const u = await newUser();
    await post(u.token, [{ ...base, rawSmsHash: "untagged-1" }]);
    const t = (await list(u.token))["untagged-1"];
    expect(t.tags).toEqual([]);
    expect(t.tagsJson).toBeNull();
  });

  it("an older client re-uploading an edit WITHOUT tags leaves the stored tags intact", async () => {
    const u = await newUser();
    await post(u.token, [{ ...base, rawSmsHash: "keep-1", tags: ["trip"] }]);
    // Older app build: no `tags` field at all, but the category was edited.
    expect((await post(u.token, [{ ...base, rawSmsHash: "keep-1", category: "travel" }])).status).toBe(201);

    const t = (await list(u.token))["keep-1"];
    expect(t.category).toBe("travel");
    expect(t.tags).toEqual(["trip"]);
  });

  it("tags: [] explicitly clears stored tags", async () => {
    const u = await newUser();
    await post(u.token, [{ ...base, rawSmsHash: "clear-1", tags: ["trip", "food"] }]);
    await post(u.token, [{ ...base, rawSmsHash: "clear-1", tags: [] }]);

    const t = (await list(u.token))["clear-1"];
    expect(t.tags).toEqual([]);
    expect(t.tagsJson).toBe("[]");
  });

  it("sending a new tag set replaces the old one", async () => {
    const u = await newUser();
    await post(u.token, [{ ...base, rawSmsHash: "replace-1", tags: ["old"] }]);
    await post(u.token, [{ ...base, rawSmsHash: "replace-1", tags: ["new1", "new2"] }]);
    expect((await list(u.token))["replace-1"].tags).toEqual(["new1", "new2"]);
  });

  it("garbage tags on one row never fail the batch — the other rows still save", async () => {
    const u = await newUser();
    const res = await post(u.token, [
      { ...base, rawSmsHash: "batch-ok-1", tags: ["fine"] },
      { ...base, rawSmsHash: "batch-bad", tags: [1, null, {}, [], true, "​", "x".repeat(500)] },
      { ...base, rawSmsHash: "batch-bad-2", tags: "not-an-array" },
      { ...base, rawSmsHash: "batch-bad-3", tags: { a: 1 } },
      { ...base, rawSmsHash: "batch-ok-2", tags: ["also fine"] },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(5);

    const all = await list(u.token);
    expect(all["batch-ok-1"].tags).toEqual(["fine"]);
    expect(all["batch-ok-2"].tags).toEqual(["also fine"]);
    expect(all["batch-bad"].tags).toEqual(["x".repeat(24)]); // junk dropped, the long one truncated
    // Not an array => "no tags sent" => nothing stored, and nothing wiped.
    expect(all["batch-bad-2"].tagsJson).toBeNull();
    expect(all["batch-bad-3"].tagsJson).toBeNull();
  });

  it("caps at 5 tags per transaction", async () => {
    const u = await newUser();
    await post(u.token, [{ ...base, rawSmsHash: "cap-1", tags: ["1", "2", "3", "4", "5", "6", "7", "8"] }]);
    expect((await list(u.token))["cap-1"].tags).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("GET survives a malformed tagsJson on one row and still returns the others", async () => {
    const u = await newUser();
    await post(u.token, [
      { ...base, rawSmsHash: "malformed-1", tags: ["ok"] },
      { ...base, rawSmsHash: "malformed-2", tags: ["fine"] },
    ]);
    await prisma.smsTransaction.updateMany({ where: { userId: u.userId, rawSmsHash: "malformed-1" }, data: { tagsJson: "{broken" } });

    const res = await request(app).get("/sms/transactions").set("Authorization", `Bearer ${u.token}`);
    expect(res.status).toBe(200);
    const all = Object.fromEntries(res.body.map((t: any) => [t.rawSmsHash, t]));
    expect(all["malformed-1"].tags).toEqual([]);
    expect(all["malformed-1"].tagsJson).toBe("{broken"); // raw column returned as stored
    expect(all["malformed-2"].tags).toEqual(["fine"]);
  });

  it("a user cannot read another user's tags", async () => {
    const a = await newUser();
    const b = await newUser();
    await post(a.token, [{ ...base, rawSmsHash: "private-1", tags: ["secret-project"] }]);

    const bView = await list(b.token);
    expect(Object.keys(bView)).toHaveLength(0);
    expect(JSON.stringify(bView)).not.toContain("secret-project");
  });

  it("another user uploading the same rawSmsHash cannot touch the first user's tags", async () => {
    const a = await newUser();
    const b = await newUser();
    await post(a.token, [{ ...base, rawSmsHash: "shared-hash", tags: ["mine"] }]);
    await post(b.token, [{ ...base, rawSmsHash: "shared-hash", tags: ["theirs"] }]);

    expect((await list(a.token))["shared-hash"].tags).toEqual(["mine"]);
    expect((await list(b.token))["shared-hash"].tags).toEqual(["theirs"]);
  });
});
