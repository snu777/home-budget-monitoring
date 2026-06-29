import { Pie, PieChart, ResponsiveContainer } from "recharts";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { Expense } from "@/types";
import { resolveMarkers } from "@/lib/expenses-summary";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  expenses: Expense[];
  // Previous-month expenses for MoM comparison markers.
  // Optional so the component keeps working with current-month-only data.
  prevExpenses?: Expense[];
}

export default function CategorySummary({ expenses, prevExpenses = [] }: Props) {
  const now = new Date();
  const monthLabel = now.toLocaleDateString("pl-PL", { month: "long", year: "numeric" });

  // Aggregation + MoM markers (incl. the first-month gate) are computed by the
  // pure `resolveMarkers` helper so they can be unit-tested independently.
  const { rows, total } = resolveMarkers(expenses, prevExpenses);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-black/20">
      <h3 className="mb-4 font-semibold text-white">
        Podsumowanie <span className="font-normal text-slate-400 capitalize">· {monthLabel}</span>
      </h3>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Brak danych do podsumowania.</p>
      ) : (
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="relative h-44 w-full sm:w-44 sm:shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="total"
                  nameKey="category"
                  innerRadius="68%"
                  outerRadius="100%"
                  paddingAngle={2}
                  stroke="#0f172a"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xs tracking-wide text-slate-500 uppercase">Razem</span>
              <span className="text-lg font-semibold text-white tabular-nums">{formatAmount(total)}</span>
            </div>
          </div>

          <ul className="flex-1 space-y-3">
            {rows.map((row) => {
              const percent = total > 0 ? Math.round((row.total / total) * 100) : 0;
              const marker = row.marker;
              return (
                <li key={row.category} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="inline-block size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: row.fill }}
                      />
                      <span className="truncate text-slate-200">{row.category}</span>
                      {marker && (
                        <span
                          className={cn(
                            "flex shrink-0 items-center gap-0.5 text-xs font-medium",
                            marker.direction === "up" ? "text-rose-400" : "text-emerald-400",
                          )}
                        >
                          {marker.direction === "up" ? (
                            <TrendingUp className="size-3.5" />
                          ) : (
                            <TrendingDown className="size-3.5" />
                          )}
                          {marker.direction === "up" ? `+${marker.percent}%` : `−${marker.percent}%`}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-semibold text-white tabular-nums">{formatAmount(row.total)}</span>
                      <span className="w-9 text-right text-xs text-slate-500 tabular-nums">{percent}%</span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: row.fill }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
