import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

// Real bug found live: a person who already has an account via one sign-in method (e.g. a
// phone_custom login with an email set via the profile-completion form) got a dead-end 409 when
// later signing in with Google using that same email, instead of the two being recognized as the
// same person. Mocks verifyFirebaseIdToken since a real Firebase ID token can't be produced in a
// test — this endpoint's own job (merge-vs-create logic) is what's under test, not Firebase's
// token verification itself.
const mockDecoded: { current: any } = { current: null };
vi.mock("../src/modules/push/firebaseAdmin.js", () => ({
  verifyFirebaseIdToken: vi.fn(async () => mockDecoded.current),
}));

const { app } = await import("../src/app.js");
const { prisma } = await import("../src/lib/prisma.js");

describe("POST /auth/session (firebase) — email/phone collision merges into the existing account", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("merges a Google sign-in into an existing account that already has that email, instead of 409ing", async () => {
    const deviceId = `merge-test-${Date.now()}`;
    const sharedEmail = `merge-${deviceId}@example.com`;

    // Existing account: an anonymous session that later set its email via PATCH /auth/me (the
    // same real-world path the phone-login profile-completion form uses).
    const anon = await request(app).post("/auth/session").send({ provider: "anonymous", deviceId });
    createdUserIds.push(deviceId);
    await request(app)
      .patch("/auth/me")
      .set("Authorization", `Bearer ${anon.body.token}`)
      .send({ name: "Existing Person", email: sharedEmail });

    // A brand-new Firebase (Google) identity presenting the same email.
    mockDecoded.current = {
      uid: `firebase-uid-${deviceId}`,
      email: sharedEmail,
      name: "Existing Person",
      picture: null,
      firebase: { sign_in_provider: "google.com" },
    };

    const res = await request(app).post("/auth/session").send({ provider: "firebase", idToken: "fake-token" });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(deviceId); // merged into the SAME existing row, not a new one

    const merged = await prisma.user.findUnique({ where: { id: deviceId } });
    expect(merged?.firebaseUid).toBe(`firebase-uid-${deviceId}`);
    expect(merged?.authProvider).toBe("google");
    expect(merged?.email).toBe(sharedEmail);

    const count = await prisma.user.count({ where: { email: sharedEmail } });
    expect(count).toBe(1); // no duplicate row was created
  });

  it("still creates a brand-new account for a genuinely new email with no existing owner", async () => {
    const uid = `firebase-uid-fresh-${Date.now()}`;
    const email = `${uid}@example.com`;
    mockDecoded.current = {
      uid,
      email,
      name: "Fresh Person",
      picture: null,
      firebase: { sign_in_provider: "google.com" },
    };

    const res = await request(app).post("/auth/session").send({ provider: "firebase", idToken: "fake-token" });
    expect(res.status).toBe(200);
    createdUserIds.push(res.body.userId);

    const user = await prisma.user.findUnique({ where: { id: res.body.userId } });
    expect(user?.email).toBe(email);
    expect(user?.firebaseUid).toBe(uid);
  });
});
