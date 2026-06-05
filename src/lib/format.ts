export function formatAmount(amount: number): string {
  return (
    amount.toLocaleString("pl-PL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " zł"
  );
}
