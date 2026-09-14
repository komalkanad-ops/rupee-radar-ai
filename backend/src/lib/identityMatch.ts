// Shared normalization so a voucher buyer's email/phone (typed once at checkout) still matches
// what they type again at redemption, even with cosmetic differences (+91 country code, spaces,
// case). Used by proPurchaseRouter.ts on both the write (order creation) and read (redemption
// match) sides.

export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

// Keeps only digits, then the last 10 — absorbs a leading "+91"/"91"/"0" country/trunk prefix the
// same way regardless of how it was typed. Returns null for anything that doesn't reduce to at
// least 10 digits (not a real Indian mobile number).
export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (digits.length < 10) return null;
  return digits.slice(-10);
}
