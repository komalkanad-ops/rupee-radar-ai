// Standard reducing-balance EMI math — the same formula every Indian bank's own EMI calculator
// uses: EMI = P x r x (1+r)^n / ((1+r)^n - 1), where r is the *monthly* rate and n is the tenure
// in months. Faithfully ported from the Android app's domain/usecase/LoanCalculator.kt (the same
// engine that powers the app's Loan & EMI tracker) rather than reimplemented from scratch, so the
// website's numbers always agree with the app's.

export interface ScheduleEntry {
  monthIndex: number; // 1-based
  openingBalance: number;
  interestComponent: number;
  principalComponent: number;
  paymentAmount: number;
  closingBalance: number;
}

export interface PrepaymentPlan {
  monthsToClose: number;
  totalInterest: number;
  monthsSaved: number;
  interestSaved: number;
}

export function monthlyRate(annualRoiPct: number): number {
  return annualRoiPct / 12 / 100;
}

export function calculateEmi(principal: number, annualRoiPct: number, tenureMonths: number): number {
  if (principal <= 0 || tenureMonths <= 0) return 0;
  const r = monthlyRate(annualRoiPct);
  if (r === 0) return principal / tenureMonths;
  const factor = Math.pow(1 + r, tenureMonths);
  return (principal * r * factor) / (factor - 1);
}

// Given principal + ROI + EMI, computes the tenure in months (rounded up — the final installment
// is typically smaller than the rest, same as every real bank schedule). Returns null when the EMI
// doesn't even cover the first month's interest, since the loan would never amortize down.
export function calculateTenureMonths(principal: number, annualRoiPct: number, emi: number): number | null {
  if (principal <= 0 || emi <= 0) return null;
  const r = monthlyRate(annualRoiPct);
  if (r === 0) return Math.ceil(principal / emi);
  const monthlyInterest = principal * r;
  if (emi <= monthlyInterest) return null;
  const n = Math.log(emi / (emi - monthlyInterest)) / Math.log(1 + r);
  // Subtracts a tiny epsilon before ceiling — an EMI produced by calculateEmi() for an exact
  // integer tenure round-trips through log/pow with enough floating-point noise to land a hair
  // past the integer boundary, which Math.ceil() would otherwise bump up a full month.
  return Math.ceil(n - 1e-6);
}

// Simulates the loan month by month — the one place any interest/principal-paid figure is actually
// computed, not a closed-form "emi x months - principal" shortcut (which overstates interest
// whenever the final installment is smaller than a full EMI).
export function buildAmortizationSchedule(
  principal: number,
  annualRoiPct: number,
  tenureMonths: number,
  emiAmount: number,
): ScheduleEntry[] {
  const r = monthlyRate(annualRoiPct);
  let balance = principal;
  const entries: ScheduleEntry[] = [];
  for (let month = 1; month <= tenureMonths; month++) {
    if (balance <= 0) break;
    const interest = balance * r;
    let principalComponent = emiAmount - interest;
    let payment = emiAmount;
    if (principalComponent >= balance) {
      // Final installment: pay off exactly what's left, not a full (over-large) EMI.
      principalComponent = balance;
      payment = balance + interest;
    }
    const closing = Math.max(balance - principalComponent, 0);
    entries.push({ monthIndex: month, openingBalance: balance, interestComponent: interest, principalComponent, paymentAmount: payment, closingBalance: closing });
    balance = closing;
  }
  return entries;
}

export function fullTenureSummary(principal: number, annualRoiPct: number, tenureMonths: number, emiAmount: number) {
  const schedule = buildAmortizationSchedule(principal, annualRoiPct, tenureMonths, emiAmount);
  const principalPaid = schedule.reduce((sum, e) => sum + e.principalComponent, 0);
  const interestPaid = schedule.reduce((sum, e) => sum + e.interestComponent, 0);
  return { principalPaid, interestPaid, totalPaid: principalPaid + interestPaid };
}

// "Pay an extra Rs X every month" — a strictly higher constant EMI still amortizes via the same
// closed-form tenure formula, so this reads real simulated totals for both the baseline and
// boosted schedules rather than a naive multiply.
export function withExtraMonthlyPayment(
  principal: number,
  annualRoiPct: number,
  currentEmi: number,
  extraMonthly: number,
): PrepaymentPlan | null {
  if (extraMonthly <= 0) return null;
  const baselineMonths = calculateTenureMonths(principal, annualRoiPct, currentEmi);
  if (baselineMonths === null) return null;
  const baselineInterest = fullTenureSummary(principal, annualRoiPct, baselineMonths, currentEmi).interestPaid;

  const boostedEmi = currentEmi + extraMonthly;
  const newMonths = calculateTenureMonths(principal, annualRoiPct, boostedEmi);
  if (newMonths === null) return null;
  const newInterest = fullTenureSummary(principal, annualRoiPct, newMonths, boostedEmi).interestPaid;

  return {
    monthsToClose: newMonths,
    totalInterest: newInterest,
    monthsSaved: Math.max(baselineMonths - newMonths, 0),
    interestSaved: Math.max(baselineInterest - newInterest, 0),
  };
}
