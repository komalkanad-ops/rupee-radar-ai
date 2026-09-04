// Wraps Setu's Account Aggregator (AA) sandbox API — mirrors llm/meshClient.ts's pattern (env
// vars read at module scope, throws if unset, raw fetch, no SDK). Credentials come from Setu's
// free self-serve "Bridge" developer console (aa-bridge.setu.co/signup); SETU_BASE_URL is issued
// per-org in that dashboard, not a fixed public hostname, so it has no default here.
//
// Header names and the exact webhook payload/signature scheme are documented from Setu's public
// docs as of this writing but NOT yet verified against a real sandbox response — confirm both
// once SETU_CLIENT_ID etc. are actually set, same "verify against reality once unblocked" caveat
// already attached to Play Billing in billingRouter.ts.
import "dotenv/config";

const CLIENT_ID = process.env.SETU_CLIENT_ID;
const CLIENT_SECRET = process.env.SETU_CLIENT_SECRET;
const PRODUCT_INSTANCE_ID = process.env.SETU_PRODUCT_INSTANCE_ID;
const BASE_URL = process.env.SETU_BASE_URL;

export function isSetuConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && PRODUCT_INSTANCE_ID && BASE_URL);
}

function requireConfig() {
  if (!isSetuConfigured()) {
    throw new Error(
      "Setu AA is not configured — set SETU_CLIENT_ID, SETU_CLIENT_SECRET, " +
        "SETU_PRODUCT_INSTANCE_ID, and SETU_BASE_URL (from your Setu Bridge dashboard) in backend/.env",
    );
  }
}

async function setuFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  requireConfig();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "x-client-id": CLIENT_ID!,
      "x-client-secret": CLIENT_SECRET!,
      "x-product-instance-id": PRODUCT_INSTANCE_ID!,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  let data: any;
  try {
    data = await res.json();
  } catch (err: any) {
    throw new Error(`Invalid JSON response from Setu: ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(data?.errorMsg || JSON.stringify(data));
  }
  return data as T;
}

export interface SetuConsentResponse {
  id: string;
  url: string;
  status: "PENDING" | "ACTIVE" | "REJECTED" | "REVOKED" | "EXPIRED";
  detail?: { fiTypes?: string[]; consentExpiry?: string };
}

export interface SetuDataSessionResponse {
  id: string;
  status: "PENDING" | "PARTIAL" | "COMPLETED" | "EXPIRED" | "FAILED";
}

export interface SetuTransaction {
  txnId: string;
  amount: string;
  type: "CREDIT" | "DEBIT";
  transactionTimestamp: string;
  narration?: string;
  mode?: string;
}

export interface SetuSessionDataResponse {
  id: string;
  status: SetuDataSessionResponse["status"];
  data?: Array<{ account?: { transactions?: { transaction?: SetuTransaction[] } } }>;
}

// fiTypes scoped to DEPOSIT (bank accounts) only for this phase — see roadmap plan for why.
// `vua` (the user's AA handle, e.g. "9999999999@setu") is optional — if the user hasn't already
// registered one, Setu's own hosted webview (the returned `url`) walks them through mobile-number
// verification/registration directly, per Setu's consent-flow docs.
export function createConsent(vua?: string): Promise<SetuConsentResponse> {
  return setuFetch<SetuConsentResponse>("/consents", {
    method: "POST",
    body: JSON.stringify({
      ...(vua ? { vua } : {}),
      consentDuration: { unit: "MONTH", value: "12" },
      dataRange: {
        from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
        to: new Date().toISOString(),
      },
      context: [{ key: "fiTypes", value: "DEPOSIT" }],
    }),
  });
}

export function getConsentStatus(consentId: string): Promise<SetuConsentResponse> {
  return setuFetch<SetuConsentResponse>(`/consents/${consentId}`);
}

export function createDataSession(consentId: string): Promise<SetuDataSessionResponse> {
  return setuFetch<SetuDataSessionResponse>("/sessions", {
    method: "POST",
    body: JSON.stringify({ consentId, format: "json" }),
  });
}

export function getSessionData(sessionId: string): Promise<SetuSessionDataResponse> {
  return setuFetch<SetuSessionDataResponse>(`/sessions/${sessionId}`);
}
