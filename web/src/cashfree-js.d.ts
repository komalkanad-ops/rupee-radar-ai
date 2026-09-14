// @cashfreepayments/cashfree-js ships no type declarations — a minimal ambient module covering
// only what Pricing.tsx actually calls (load + checkout), per Cashfree's public JS SDK docs.
declare module "@cashfreepayments/cashfree-js" {
  interface CashfreeCheckoutOptions {
    paymentSessionId: string;
    redirectTarget?: "_self" | "_blank" | "_top" | HTMLElement;
  }
  interface CashfreeInstance {
    checkout(options: CashfreeCheckoutOptions): Promise<unknown>;
  }
  export function load(options: { mode: "sandbox" | "production" }): Promise<CashfreeInstance>;
}
