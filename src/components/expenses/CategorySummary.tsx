import { Pie, PieChart, ResponsiveContainer } from "recharts";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { Expense, ExpenseCategory } from "@/types";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  expenses: Expense[];
  // Previous-month expenses for MoM comparison markers (wired up in Phase 2).
  // Optional so the component keeps working with current-month-only data.
  prevExpenses?: Expense[];
}

// 9 distinct colors: the 5 chart CSS tokens cycled, plus 4 complementary hues
// for the remaining categories (there are 9 expense categories).
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

interface CategoryTotal {
  category: ExpenseCategory;
  total: number;
  // `fill` is read per-entry by Recharts <Pie> to color each sector
  // (Recharts 3 replaced the deprecated <Cell> with per-datum fill).
  fill: string;
}

// MoM comparison threshold: a category must move by strictly more than 20%
// versus the previous month to earn a marker.
const MOM_THRESHOLD = 0.2;

interface Marker {
  direction: "up" | "down";
  percent: number;
}

function sumByCategory(expenses: Expense[]): Map<ExpenseCategory, number> {
  const sums = new Map<ExpenseCategory, number>();
  for (const e of expenses) {
    sums.set(e.category, (sums.get(e.category) ?? 0) + e.amount);
  }
  return sums;
}

// Decide the marker for one category from its current vs previous totals.
// Returns null when there is no comparison base (previous total is 0) or the
// change stays within ±20%.
function computeMarker(current: number, previous: number): Marker | null {
  if (previous === 0) return null;
  const delta = (current - previous) / previous;
  if (delta > MOM_THRESHOLD) return { direction: "up", percent: Math.round(delta * 100) };
  if (delta < -MOM_THRESHOLD) return { direction: "down", percent: Math.round(Math.abs(delta) * 100) };
  return null;
}

function aggregate(expenses: Expense[]): { rows: CategoryTotal[]; total: number } {
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

export default function CategorySummary({ expenses, prevExpenses = [] }: Props) {
  const now = new Date();
  const monthLabel = now.toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
  const { rows, total } = aggregate(expenses);

  // First month of use: previous month has no expenses at all → no markers
  // anywhere. Otherwise compare each category against its previous-month total.
  const hasPrevMonth = prevExpenses.length > 0;
  const prevSums = sumByCategory(prevExpenses);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
      <h3 className="mb-4 font-semibold">
        Podsumowanie — <span className="font-normal text-blue-100/60 capitalize">{monthLabel}</span>
      </h3>

      {rows.length === 0 ? (
        <p className="text-sm text-blue-100/40">Brak danych do podsumowania.</p>
      ) : (
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="relative h-48 w-full sm:w-48 sm:shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="total"
                  nameKey="category"
                  innerRadius="60%"
                  outerRadius="100%"
                  stroke="none"
                  isAnimationActive={false}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xs text-blue-100/50">Razem</span>
              <span className="font-mono text-lg font-semibold">{formatAmount(total)}</span>
            </div>
          </div>

          <ul className="flex-1 space-y-2">
            {rows.map((row) => {
              const percent = total > 0 ? Math.round((row.total / total) * 100) : 0;
              const marker = hasPrevMonth ? computeMarker(row.total, prevSums.get(row.category) ?? 0) : null;
              return (
                <li key={row.category} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="inline-block size-3 shrink-0 rounded-full" style={{ backgroundColor: row.fill }} />
                    <span className="truncate">{row.category}</span>
                    {marker && (
                      <span
                        className={cn(
                          "flex shrink-0 items-center gap-0.5 text-xs font-medium",
                          marker.direction === "up" ? "text-red-400" : "text-green-400",
                        )}
                      >
                        {marker.direction === "up" ? (
                          <TrendingUp className="size-3.5" />
                        ) : (
                          <TrendingDown className="size-3.5" />
                        )}
                        {marker.direction === "up" ? `↑+${marker.percent}%` : `↓−${marker.percent}%`}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-mono font-semibold">{formatAmount(row.total)}</span>
                    <span className="w-10 text-right text-blue-100/40">{percent}%</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
