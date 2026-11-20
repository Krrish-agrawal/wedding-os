/** Indian-format money helpers for the pricing scene. */

export interface EmiInput {
  price: number;
  downPaymentPct: number;
  ratePct: number;
  tenureYears: number;
}

/** Standard reducing-balance EMI, in rupees per month. */
export function monthlyEmi({ price, downPaymentPct, ratePct, tenureYears }: EmiInput): number {
  const principal = price * (1 - downPaymentPct / 100);
  const r = ratePct / 12 / 100;
  const n = tenureYears * 12;
  if (r === 0) return principal / n;
  const growth = (1 + r) ** n;
  return (principal * r * growth) / (growth - 1);
}

const LAKH = 1e5;
const CRORE = 1e7;

/** ₹2.99 L, or ₹5.61 Cr above a crore. */
export function inr(amount: number): string {
  if (amount >= CRORE) return `₹${(amount / CRORE).toFixed(2)} Cr`;
  if (amount >= LAKH) return `₹${(amount / LAKH).toFixed(2)} L`;
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}
