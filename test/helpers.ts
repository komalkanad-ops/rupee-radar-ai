import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

let counter = 0;

/** Creates a real anonymous session the same way the Android app does (POST /auth/session with
 * provider: "anonymous") rather than hand-crafting a JWT, so tests exercise the actual issuance
 * path instead of assuming it. Each call gets a unique device id. */
export async function createAnonymousUser(): Promise<{ userId: string; token: string }> {
  counter += 1;
  const deviceId = `test-device-${Date.now()}-${counter}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app).post("/auth/session").send({ provider: "anonymous", deviceId });
  if (res.status !== 200) {
    throw new Error(`Failed to create test user: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { userId: res.body.userId, token: res.body.token };
}

/** Creates a session then patches it in the DB to look like a real, non-anonymous signup (a unique
 * email + authProvider "google") — there's no test-only OTP/Google flow to drive end-to-end, and
 * routes that gate on "not anonymous" (e.g. POST /referrals/redeem) only ever look at those two
 * columns, so patching them directly exercises the real gate without faking a whole auth provider. */
export async function createRealUser(): Promise<{ userId: string; token: string }> {
  const anon = await createAnonymousUser();
  await prisma.user.update({
    where: { id: anon.userId },
    data: { authProvider: "google", email: `test-${anon.userId}@example.com` },
  });
  return anon;
}
