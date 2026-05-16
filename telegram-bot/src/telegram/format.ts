const FORMATTER = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function formatINR(amount: number): string {
  const rounded = Math.round(amount);
  if (rounded < 0) return `-₹${FORMATTER.format(Math.abs(rounded))}`;
  return `₹${FORMATTER.format(rounded)}`;
}
