import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Expense, ExpenseCategory } from "@/types";
import { EXPENSE_CATEGORIES } from "@/types";
import { formatAmount } from "@/lib/format";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const POLL_INTERVAL_MS = 2500;

interface Props {
  budgetId: string;
  currentUserId: string;
}

interface AddExpenseFormProps {
  onAdd: (expense: Expense) => void;
  onRemove: (id: string) => void;
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
  });
}

function groupByDate(expenses: Expense[]): Map<string, Expense[]> {
  const map = new Map<string, Expense[]>();
  for (const e of expenses) {
    const group = map.get(e.expense_date) ?? [];
    group.push(e);
    map.set(e.expense_date, group);
  }
  return map;
}

function AddExpenseForm({ onAdd, onRemove }: AddExpenseFormProps) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>(EXPENSE_CATEGORIES[0]);
  const [date, setDate] = useState(today());
  const [addError, setAddError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setAddError("Kwota musi być większa od 0");
      return;
    }

    const optimisticId = crypto.randomUUID();
    const optimistic: Expense = {
      id: optimisticId,
      budget_id: "",
      created_by: "optimistic",
      amount: parsedAmount,
      category,
      expense_date: date,
      created_at: new Date().toISOString(),
    };

    onAdd(optimistic);
    setAmount("");
    setDate(today());
    setAddError(null);
    setSubmitting(true);

    fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: parsedAmount, category, expense_date: date }),
    })
      .then((res) => res.json())
      .then((data: { error?: string }) => {
        if (data.error) {
          onRemove(optimisticId);
          setAddError(data.error);
        }
      })
      .catch(() => {
        onRemove(optimisticId);
        setAddError("Błąd sieci — spróbuj ponownie");
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="exp-amount" className="mb-1 block text-xs text-blue-100/60">
            Kwota (zł)
          </label>
          <input
            id="exp-amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/30 focus:ring-1 focus:ring-white/30 focus:outline-none"
          />
        </div>
        <div className="col-span-2 sm:col-span-2">
          <label htmlFor="exp-category" className="mb-1 block text-xs text-blue-100/60">
            Kategoria
          </label>
          <select
            id="exp-category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as ExpenseCategory);
            }}
            className="w-full rounded-lg border border-white/20 bg-zinc-900 px-3 py-2 text-white focus:ring-1 focus:ring-white/30 focus:outline-none"
          >
            {EXPENSE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="exp-date" className="mb-1 block text-xs text-blue-100/60">
            Data
          </label>
          <input
            id="exp-date"
            type="date"
            required
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
            }}
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white focus:ring-1 focus:ring-white/30 focus:outline-none"
          />
        </div>
      </div>
      {addError && <p className="text-sm text-red-300">{addError}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold transition-colors hover:bg-purple-700 disabled:opacity-50"
      >
        {submitting ? "Dodawanie…" : "Dodaj wydatek"}
      </button>
    </form>
  );
}

export default function ExpenseDashboard({ currentUserId }: Props) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchExpenses = () => {
    fetch("/api/expenses")
      .then((res) => res.json())
      .then((data: { expenses?: Expense[] }) => {
        if (data.expenses) {
          setExpenses(data.expenses);
        }
      })
      .catch(() => {
        // network errors silently ignored during polling
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchExpenses();
    intervalRef.current = setInterval(fetchExpenses, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const handleAdd = (optimistic: Expense) => {
    setExpenses((prev) => [...prev, optimistic]);
  };

  const handleRemove = (id: string) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  };

  const handleDelete = (id: string) => {
    const saved = expenses.find((e) => e.id === id);
    if (!saved) return;

    setDeleteError(null);
    handleRemove(id);

    fetch(`/api/expenses?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      .then((res) => res.json())
      .then((data: { error?: string }) => {
        if (data.error) {
          setExpenses((prev) => [...prev, saved]);
          setDeleteError({ id, message: data.error });
        }
      })
      .catch(() => {
        setExpenses((prev) => [...prev, saved]);
        setDeleteError({ id, message: "Błąd sieci — spróbuj ponownie" });
      });
  };

  const now = new Date();
  const monthLabel = now.toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
  const grouped = groupByDate(expenses);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
        <h3 className="mb-4 font-semibold text-blue-100/80">Dodaj wydatek</h3>
        <AddExpenseForm onAdd={handleAdd} onRemove={handleRemove} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
        <h3 className="mb-4 font-semibold">
          Wydatki — <span className="font-normal text-blue-100/60 capitalize">{monthLabel}</span>
        </h3>

        {loading && expenses.length === 0 ? (
          <p className="text-sm text-blue-100/40">Ładowanie…</p>
        ) : expenses.length === 0 ? (
          <p className="text-sm text-blue-100/40">Brak wydatków w tym miesiącu.</p>
        ) : (
          <div className="space-y-4">
            {[...grouped.entries()].map(([dateStr, items]) => (
              <div key={dateStr}>
                <p className="mb-2 text-xs font-medium tracking-wide text-blue-100/40 uppercase">
                  {formatDate(dateStr)}
                </p>
                <div className="space-y-2">
                  {items.map((expense) => {
                    const isOptimistic = expense.created_by === "optimistic";
                    const isOwn = isOptimistic || expense.created_by === currentUserId;
                    const canDelete = isOwn && !isOptimistic;
                    return (
                      <div key={expense.id}>
                        <div
                          className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                            isOptimistic ? "bg-white/5 opacity-60" : "bg-white/5"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-blue-100/40">{isOwn ? "Ty" : "Partner"}</span>
                            <span className="text-sm">{expense.category}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold">{formatAmount(expense.amount)}</span>
                            {canDelete && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <button
                                    type="button"
                                    className="rounded p-1 text-blue-100/30 transition-colors hover:text-red-400"
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                </AlertDialogTrigger>
                                <AlertDialogContent size="sm">
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Usunąć wydatek?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      {expense.category} — {formatAmount(expense.amount)}
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Anuluj</AlertDialogCancel>
                                    <AlertDialogAction
                                      variant="destructive"
                                      onClick={() => {
                                        handleDelete(expense.id);
                                      }}
                                    >
                                      Usuń
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </div>
                        {deleteError?.id === expense.id && (
                          <p className="mt-1 px-3 text-xs text-red-300">{deleteError.message}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
