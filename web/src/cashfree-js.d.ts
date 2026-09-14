// @cashfreepayments/cashfree-js ships no type declarations — a minimal ambient module covering
// only what Pricing.tsx actually calls (load + checkout), per Cashfree's public JS SDK docs.
declare module "@cashfreepayments/cashfree-js" {
  interface CashfreeCheckoutOptions {
    paymentSessionId: string;
    returnUrl?: string;
    redirectTarget?: "_self" | "_blank" | "_top" | HTMLElement;
  }
  interface CashfreeCheckoutResult {
    error?: { message?: string };
    redirect?: boolean;
  }
  interface CashfreeInstance {
    checkout(options: CashfreeCheckoutOptions): Promise<CashfreeCheckoutResult>;
  }
  export function load(options: { mode: "sandbox" | "production" }): Promise<CashfreeInstance>;
}
