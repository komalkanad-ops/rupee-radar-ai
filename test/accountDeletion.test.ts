import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createAnonymousUser } from "./helpers.js";

describe("DELETE /auth/me", () => {
  it("requires a token", async () => {
    const res = await request(app).delete("/auth/me");
    expect(res.status).toBe(401);
  });

  it("deletes the user and every owned row, disowning Feedback/BugReport instead of deleting them", async () => {
    const { userId, token } = await createAnonymousUser();

    await prisma.smsTransaction.create({
      data: {
        userId,
        rawSmsHash: `hash-${userId}`,
        amount: 500,
        merchant: "Test Merchant",
        category: "groceries",
        txnDate: new Date(),
      },
    });
    await prisma.todoItem.create({ data: { userId, title: "Test todo" } });
    const bugReport = await prisma.bugReport.create({
      data: { userId, type: "BUG", message: "test bug", screenRoute: "dashboard" },
    });

    const res = await request(app).delete("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user).toBeNull();

    const remainingTxns = await prisma.smsTransaction.findMany({ where: { userId } });
    expect(remainingTxns).toHaveLength(0);

    const remainingTodos = await prisma.todoItem.findMany({ where: { userId } });
    expect(remainingTodos).toHaveLength(0);

    // BugReport is disowned (userId set to null), not deleted — the row itself should still exist.
    const survivingBugReport = await prisma.bugReport.findUnique({ where: { id: bugReport.id } });
    expect(survivingBugReport).not.toBeNull();
    expect(survivingBugReport?.userId).toBeNull();

    // Clean up the disowned row so this test doesn't leave permanent debris in the dev DB.
    await prisma.bugReport.delete({ where: { id: bugReport.id } });
  });

  it("using a deleted user's token afterward still fails auth cleanly (no 500)", async () => {
    const { userId, token } = await createAnonymousUser();
    await request(app).delete("/auth/me").set("Authorization", `Bearer ${token}`);

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    // The JWT itself is still structurally valid (it's just a signed claim, not a DB lookup), so
    // requireUser lets it through — the 404 comes from GET /auth/me's own "user not found" check.
    expect(res.status).toBe(404);
    void userId;
  });
});
