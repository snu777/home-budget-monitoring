# Shared Expense Flow (S-01) — Krótki plan

> Pełny plan: `context/changes/shared-expense-flow/plan.md`
> Roadmapa: `context/foundation/roadmap.md` (S-01)

## Co i dlaczego

Budujemy pełny przepływ S-01 — "gwiazdę przewodnią" produktu: para może rejestrować wspólny budżet kodem zaproszenia, dodawać wydatki i śledzić listę bieżącego miesiąca, która odświeża się automatycznie. Bez S-01 hipoteza rdzenia produktu nie jest udowodniona.

## Punkt wyjścia

Auth działa (signin/signup/middleware). Dashboard.astro to placeholder. Baza danych ma schemat (tabele budgets/budget_members/expenses) i dwie funkcje RPC: `create_budget()` i `join_budget_by_invite_code()`. `src/database.types.ts` wygenerowane. Brak tras API i komponentów UI dla budżetów/wydatków.

## Pożądany stan końcowy

Zalogowany użytkownik widzi dashboard z formularzami tworzenia/dołączania budżetu. Po stworzeniu — kod zaproszenia + lista wydatków z formularzem. Wydatek dodany przez partnera pojawia się automatycznie w < 5s. Lista grupuje wpisy separatorami dni z atrybucją "Ty"/"Partner".

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) |
|---------|-------|---------------------|
| Struktura stron | Jedna strona dashboard z warunkami | Prostsza nawigacja — jeden protected URL, bez dodatkowych tras |
| Lista wydatków | Flat chronological z separatorem daty | Lepsze skanowanie przy 30–50 wpisach niż prosta lista bez podziału |
| Formularz wydatku | React island z natychmiastowym feedbackiem | Optimistic update wymaga zarządzania stanem; pasuje do wzorca SignInForm.tsx |
| Atrybucja | "Ty" vs "Partner" | Zero extra DB queries; created_by === currentUserId |
| Sync po add | Optimistic update + polling co 5s | User jawnie wybrał; spełnia PRD NFR < 3s bez S-03 scope |
| Tworzenie budżetu | Pole nazwy z prefillem "Nasz budżet" | Minimalne tarcie przy personalizacji |
| Kwota | input type=number step=0.01 | Natywna walidacja + klawiatura numeryczna na mobile |
| Błędy form | Redirect z ?error= w URL | Spójność z wzorcem signin.ts |
| Dashboard state machine | 2 stany: brak budżetu / ma budżet | budget_members SELECT zwraca tylko własny wiersz → maybeSingle() wystarczy |

## Zakres

**W zakresie:**
- API routes: GET+POST /api/expenses, POST /api/budgets, POST /api/budgets/join
- Przepisanie dashboard.astro (state machine A/B)
- `src/types.ts` — typy i EXPENSE_CATEGORIES
- `ExpenseDashboard.tsx` — polling, lista z grupowaniem, optimistic update
- `AddExpenseForm.tsx` — formularz z 3 polami

**Poza zakresem:**
- Usuwanie wydatku (S-02)
- Supabase Realtime — tylko polling (S-03)
- Podsumowanie per-kategoria (S-04)
- Edycja wydatku (PRD Non-Goal)
- Wyświetlanie emaila/nazwy partnera

## Architektura / Podejście

`dashboard.astro` (SSR) określa stan server-side: query `budget_members` → `budgets`. Przekazuje `budgetId`, `currentUserId` jako props do `ExpenseDashboard` (React island, `client:load`). Wyspa zarządza listą przez `fetch('/api/expenses')` + `setInterval(5000)`. Formularze budżetu to plain HTML forms POST do API routes z redirect pattern. Formularz wydatku to React z fetch() i optimistic state.

```
dashboard.astro (SSR)
  ├── Stan A: <form action="/api/budgets"> + <form action="/api/budgets/join">
  └── Stan B: invite_code display + <ExpenseDashboard client:load />
                                          ├── fetch GET /api/expenses (mount + poll 5s)
                                          ├── <AddExpenseForm onAdd={optimistic} />
                                          └── Lista grouped by date
```

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|------|-------------|-----------------|
| 1. Typy + API routes | 4 pliki API gotowe; src/types.ts z EXPENSE_CATEGORIES | budget_members maybeSingle() może zwrócić null gdy RLS blokuje — obsłużyć gracefully |
| 2. Dashboard state machine | dashboard.astro z logiką A/B; formularze tworzenia i dołączania działają | Error query param musi być zdekodowany przed wyświetleniem |
| 3. React island | ExpenseDashboard z polling + optimistic update; pełny e2e flow | Cleanup setInterval w useEffect; tymczasowe ID optimistic vs poll |

**Wymagania wstępne:** F-01 zaimplementowane (done ✓); użytkownik zalogowany przez Supabase Auth; DB functions `create_budget()` i `join_budget_by_invite_code()` w cloud Supabase.
**Szacowany nakład pracy:** ~2-3 sesje, 3 fazy.

## Otwarte ryzyka i założenia

- Polling co 5s: zakładamy Cloudflare Workers persists między requestami (per-worker mode w wrangler.jsonc)
- `budget_members` maybeSingle(): zakładamy że użytkownik może być w max 1 budżecie (per MVP model); jeśli ktoś dołączył do 2 — maybeSingle() zwróci błąd (PostgreSQL "multiple rows") → plan musi to obsłużyć gracefully zwracając pierwszy wiersz
- Supabase anon key: GET /api/expenses musi być dostępne z przeglądarki przez fetch() — cookies przesyłane automatycznie (same-site)

## Kryteria sukcesu (podsumowanie)

- Para może zarejestrować się, połączyć przez kod zaproszenia, dodać wydatek i zobaczyć wspólną listę — spełniony §Primary Success Criteria PRD
- Wydatek partnera pojawia się automatycznie w < 5s bez ręcznego odświeżenia
- `npm run build` przechodzi po każdej fazie
