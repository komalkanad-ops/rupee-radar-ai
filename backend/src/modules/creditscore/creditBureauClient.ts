// Deliberately minimal — no credit-bureau vendor has been chosen yet. The roadmap originally
// assumed Setu would broker bureau pulls the same way it brokers Account Aggregator data; that
// turned out to be wrong (Setu's public product catalog has no credit-bureau product — confirmed
// by checking their docs directly). A credible alternative exists (Surepass: CIBIL/Experian/CRIF/
// Equifax connectors, free self-serve sandbox), but its exact request/response schema is gated
// behind signup, unlike Setu's fully public AA docs — so unlike setuClient.ts, this file does NOT
// guess at a real vendor's field names. Once you've picked a vendor and have sandbox credentials,
// replace getCreditBureauClient()'s throw with a real implementation of this interface.
export interface CreditBureauFetchInput {
  pan: string;
  fullName: string;
  dateOfBirth: string; // ISO date
  mobile: string;
}

export interface CreditBureauFetchResult {
  bureau: string;
  score: number;
  scoreBand: string;
  factors: string[];
}

export interface CreditBureauClient {
  fetchScore(input: CreditBureauFetchInput): Promise<CreditBureauFetchResult>;
}

export function getCreditBureauClient(): CreditBureauClient {
  throw new Error(
    "No credit bureau vendor configured yet — pick one (e.g. Surepass) and implement " +
      "creditBureauClient.ts's CreditBureauClient interface against their real, verified API " +
      "before this feature can fetch a real score.",
  );
}
