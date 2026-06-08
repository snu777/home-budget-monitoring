import type { Expense, ExpenseCategory } from "@/types";

// Pure, side-effect-free expense-summary computations, extracted from
// CategorySummary.tsx so they can be unit-tested without rendering the React
// island or touching the DB. Behavior is identical to the prior in-component
// versions — keep it that way (the tests pin the documented rules).

// 9 distinct colors: the 5 chart CSS tokens, plus 4 complementary hues for the
// remaining categories (there are 9 expense categories).
const CATEGORY_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#a78bfa",
  "#f472b6",
  "#34d399",
  "#fbbf24",
];

// MoM comparison threshold: a category must move by strictly more than 20%
// versus the previous month to earn a marker.
const MOM_THRESHOLD = 0.2;

export interface Marker {
  direction: "up" | "down";
  percent: number;
}

export interface CategoryTotal {
  category: ExpenseCategory;
  total: number;
  // `fill` is read per-entry by Recharts <Pie> to color each sector.
  fill: string;
}

export interface CategoryRow extends CategoryTotal {
  // The MoM marker for this category, or null when there is no comparison base
  // (first month / previous total 0 / within ±20%).
  marker: Marker | null;
}

export function sumByCategory(expenses: Expense[]): Map<ExpenseCategory, number> {
  const sums = new Map<ExpenseCategory, number>();
  for (const e of expenses) {
    sums.set(e.category, (sums.get(e.category) ?? 0) + e.amount);
  }
  return sums;
}

// Decide the marker for one category from its current vs previous totals.
// Returns null when there is no comparison base (previous total is 0) or the
// change stays within ±20%. Rounding is applied AFTER the threshold decision,
// so it can never flip inclusion across the 20% gate.
export function computeMarker(current: number, previous: number): Marker | null {
  if (previous === 0) return null;
  const delta = (current - previous) / previous;
  if (delta > MOM_THRESHOLD) return { direction: "up", percent: Math.round(delta * 100) };
  if (delta < -MOM_THRESHOLD) return { direction: "down", percent: Math.round(Math.abs(delta) * 100) };
  return null;
}

export function aggregate(expenses: Expense[]): { rows: CategoryTotal[]; total: number } {
  const sums = sumByCategory(expenses);

  const rows = [...sums.entries()]
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([category, total], i) => ({
      category,
      total,
      fill: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    }));

  const total = rows.reduce((acc, r) => acc + r.total, 0);
  return { rows, total };
}

// Aggregate the current month and attach each category's MoM marker. This is
// the composed decision the dashboard renders: the first-month gate
// (no previous-month expenses at all → every marker null) wraps the per-category
// zero-base + threshold logic.
export function resolveMarkers(
  currentExpenses: Expense[],
  prevExpenses: Expense[],
): { rows: CategoryRow[]; total: number } {
  const { rows, total } = aggregate(currentExpenses);
  const hasPrevMonth = prevExpenses.length > 0;
  const prevSums = sumByCategory(prevExpenses);

  const withMarkers: CategoryRow[] = rows.map((row) => ({
    ...row,
    marker: hasPrevMonth ? computeMarker(row.total, prevSums.get(row.category) ?? 0) : null,
  }));

  return { rows: withMarkers, total };
}
