interface Props {
  budgetId: string;
  currentUserId: string;
}

// Placeholder — full implementation in Phase 3
export default function ExpenseDashboard(_props: Props) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl">
      <p className="text-sm text-blue-100/50">Ładowanie wydatków…</p>
    </div>
  );
}
