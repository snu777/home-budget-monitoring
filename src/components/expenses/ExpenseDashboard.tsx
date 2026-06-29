import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type { Expense, ExpenseCategory } from "@/types";
import { EXPENSE_CATEGORIES } from "@/types";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import CategorySummary from "@/components/expenses/CategorySummary";
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

const CARD = "rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-black/20";
const FIELD =
  "w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-slate-100 placeholder-slate-500 transition-colors focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 focus:outline-none";
const LABEL = "mb-1 block text-xs font-medium text-slate-400";

interface Props {
  currentUserId: string;
}

interface AddExpenseFormProps {
  onAdd: (expense: Expense) => void;
  onRemove: (id: string) => void;
  onConfirm: (id: string) => void;
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

function AddExpenseForm({ onAdd, onRemove, onConfirm }: AddExpenseFormProps) {
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
        } else {
          // POST persisted — stop preserving the optimistic entry so the next
          // poll can replace it with the server row.
          onConfirm(optimisticId);
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
          <label htmlFor="exp-amount" className={LABEL}>
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
            className={cn(FIELD, "tabular-nums")}
          />
        </div>
        <div className="col-span-2 sm:col-span-2">
          <label htmlFor="exp-category" className={LABEL}>
            Kategoria
          </label>
          <select
            id="exp-category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as ExpenseCategory);
            }}
            className={cn(FIELD, "bg-slate-900")}
          >
            {EXPENSE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="exp-date" className={LABEL}>
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
            className={FIELD}
          />
        </div>
      </div>
      {addError && <p className="text-sm text-rose-300">{addError}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="size-4" />
        {submitting ? "Dodawanie…" : "Dodaj wydatek"}
      </button>
    </form>
  );
}

interface EditExpenseFormProps {
  expense: Expense;
  onSave: (patch: { amount: number; category: ExpenseCategory; expense_date: string }) => void;
  onCancel: () => void;
  error?: string;
}

function EditExpenseForm({ expense, onSave, onCancel, error }: EditExpenseFormProps) {
  const [amount, setAmount] = useState(String(expense.amount));
  const [category, setCategory] = useState<ExpenseCategory>(expense.category);
  const [date, setDate] = useState(expense.expense_date);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setLocalError("Kwota musi być większa od 0");
      return;
    }
    setLocalError(null);
    onSave({ amount: parsedAmount, category, expense_date: date });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-emerald-500/30 bg-slate-800/60 p-3"
      aria-label="Edytuj wydatek"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor={`edit-amount-${expense.id}`} className={LABEL}>
            Kwota (zł)
          </label>
          <input
            id={`edit-amount-${expense.id}`}
            type="number"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
            className={cn(FIELD, "tabular-nums")}
          />
        </div>
        <div className="col-span-2 sm:col-span-2">
          <label htmlFor={`edit-category-${expense.id}`} className={LABEL}>
            Kategoria
          </label>
          <select
            id={`edit-category-${expense.id}`}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as ExpenseCategory);
            }}
            className={cn(FIELD, "bg-slate-900")}
          >
            {EXPENSE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor={`edit-date-${expense.id}`} className={LABEL}>
            Data
          </label>
          <input
            id={`edit-date-${expense.id}`}
            type="date"
            required
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
            }}
            className={FIELD}
          />
        </div>
      </div>
      {(localError ?? error) && <p className="text-sm text-rose-300">{localError ?? error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
        >
          Zapisz
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-700"
        >
          <X className="size-4" />
          Anuluj
        </button>
      </div>
    </form>
  );
}

export default function ExpenseDashboard({ currentUserId }: Props) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [prevExpenses, setPrevExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<{ id: string; message: string } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // IDs of optimistic entries whose POST is still in flight; a poll landing
  // mid-request must keep these so the new row doesn't flicker out.
  const optimisticIdsRef = useRef<Set<string>>(new Set());
  // Optimistically-edited rows whose PUT is still in flight, keyed by id; a poll
  // landing mid-request must keep the edited values instead of the stale server
  // row (mirrors the optimistic-add protection above).
  const optimisticEditsRef = useRef<Map<string, Expense>>(new Map());

  const fetchExpenses = () => {
    fetch("/api/expenses")
      .then((res) => {
        if (res.status === 401) {
          // session expired — stop polling and bounce to sign-in
          if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          window.location.href = "/auth/signin";
          return null;
        }
        return res.json() as Promise<{ expenses?: Expense[] }>;
      })
      .then((data) => {
        const fresh = data?.expenses;
        if (fresh) {
          setExpenses((prev) => {
            const inFlight = prev.filter((e) => optimisticIdsRef.current.has(e.id));
            // Keep optimistic edits on top of the freshly-fetched rows until
            // their PUT settles, so a mid-request poll doesn't revert them.
            const merged = fresh.map((e) => optimisticEditsRef.current.get(e.id) ?? e);
            return [...merged, ...inFlight];
          });
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
    // Previous month is immutable within a session — fetch once on mount and
    // keep it out of the poll loop (drives MoM markers in CategorySummary).
    fetch("/api/expenses?month=previous")
      .then((res) => res.json())
      .then((data: { expenses?: Expense[] }) => {
        if (data.expenses) {
          setPrevExpenses(data.expenses);
        }
      })
      .catch(() => {
        // network errors silently ignored; markers simply won't render
      });
    intervalRef.current = setInterval(fetchExpenses, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const handleAdd = (optimistic: Expense) => {
    optimisticIdsRef.current.add(optimistic.id);
    setExpenses((prev) => [...prev, optimistic]);
  };

  const handleRemove = (id: string) => {
    optimisticIdsRef.current.delete(id);
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  };

  const handleConfirm = (id: string) => {
    optimisticIdsRef.current.delete(id);
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

  const handleEdit = (id: string, patch: { amount: number; category: ExpenseCategory; expense_date: string }) => {
    const original = expenses.find((e) => e.id === id);
    if (!original) return;

    setEditError(null);
    setEditingId(null);

    const optimistic: Expense = { ...original, ...patch };
    optimisticEditsRef.current.set(id, optimistic);
    setExpenses((prev) => prev.map((e) => (e.id === id ? optimistic : e)));

    fetch(`/api/expenses?id=${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then((res) => res.json())
      .then((data: { error?: string; expense?: Expense }) => {
        if (data.error) {
          optimisticEditsRef.current.delete(id);
          setExpenses((prev) => prev.map((e) => (e.id === id ? original : e)));
          setEditError({ id, message: data.error });
        } else if (data.expense) {
          const saved = data.expense;
          optimisticEditsRef.current.delete(id);
          setExpenses((prev) => prev.map((e) => (e.id === id ? saved : e)));
        }
      })
      .catch(() => {
        optimisticEditsRef.current.delete(id);
        setExpenses((prev) => prev.map((e) => (e.id === id ? original : e)));
        setEditError({ id, message: "Błąd sieci — spróbuj ponownie" });
      });
  };

  const now = new Date();
  const monthLabel = now.toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
  const grouped = groupByDate(expenses);

  return (
    <div className="space-y-4">
      <div className={CARD}>
        <h3 className="mb-4 font-semibold text-white">Dodaj wydatek</h3>
        <AddExpenseForm onAdd={handleAdd} onRemove={handleRemove} onConfirm={handleConfirm} />
      </div>

      {!(loading && expenses.length === 0) && <CategorySummary expenses={expenses} prevExpenses={prevExpenses} />}

      <div className={CARD}>
        <h3 className="mb-4 font-semibold text-white">
          Wydatki <span className="font-normal text-slate-400 capitalize">· {monthLabel}</span>
        </h3>

        {loading && expenses.length === 0 ? (
          <p className="text-sm text-slate-500">Ładowanie…</p>
        ) : expenses.length === 0 ? (
          <p className="text-sm text-slate-500">Brak wydatków w tym miesiącu.</p>
        ) : (
          <div className="space-y-5">
            {[...grouped.entries()].map(([dateStr, items]) => (
              <div key={dateStr}>
                <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">{formatDate(dateStr)}</p>
                <div className="space-y-2">
                  {items.map((expense) => {
                    const isOptimistic = expense.created_by === "optimistic";
                    const isOwn = isOptimistic || expense.created_by === currentUserId;
                    const canDelete = isOwn && !isOptimistic;
                    return (
                      <div key={expense.id}>
                        {editingId === expense.id ? (
                          <EditExpenseForm
                            expense={expense}
                            error={editError?.id === expense.id ? editError.message : undefined}
                            onSave={(patch) => {
                              handleEdit(expense.id, patch);
                            }}
                            onCancel={() => {
                              setEditingId(null);
                            }}
                          />
                        ) : (
                          <>
                            <div
                              className={cn(
                                "flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2.5 transition-colors",
                                isOptimistic ? "opacity-60" : "hover:border-slate-700 hover:bg-slate-800/70",
                              )}
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <span
                                  className={cn(
                                    "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase",
                                    isOwn ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700/50 text-slate-300",
                                  )}
                                >
                                  {isOwn ? "Ty" : "Partner"}
                                </span>
                                <span className="truncate text-sm text-slate-200">{expense.category}</span>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <span className="text-sm font-semibold text-white tabular-nums">
                                  {formatAmount(expense.amount)}
                                </span>
                                {canDelete && (
                                  <button
                                    type="button"
                                    aria-label="Edytuj wydatek"
                                    onClick={() => {
                                      setEditError(null);
                                      setEditingId(expense.id);
                                    }}
                                    className="cursor-pointer rounded-md p-1.5 text-slate-500 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400"
                                  >
                                    <Pencil className="size-4" />
                                  </button>
                                )}
                                {canDelete && (
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <button
                                        type="button"
                                        aria-label="Usuń wydatek"
                                        className="cursor-pointer rounded-md p-1.5 text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
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
                              <p className="mt-1 px-3 text-xs text-rose-300">{deleteError.message}</p>
                            )}
                            {editError?.id === expense.id && (
                              <p className="mt-1 px-3 text-xs text-rose-300">{editError.message}</p>
                            )}
                          </>
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
