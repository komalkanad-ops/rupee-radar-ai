import request from "supertest";
import { app } from "../src/app.js";

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
