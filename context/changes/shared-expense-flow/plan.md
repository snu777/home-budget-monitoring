# Shared Expense Flow (S-01) — Plan implementacji

## Przegląd

Implementacja pełnego przepływu S-01 ("gwiazda przewodnia"): użytkownik rejestruje budżet lub dołącza do istniejącego kodem zaproszenia, dodaje wydatki i widzi wspólną listę bieżącego miesiąca. Lista odświeża się automatycznie co 5 sekund (polling), dzięki czemu wydatek dodany przez partnera pojawia się bez ręcznego odświeżania. Formularz dodawania wydatku działa z optymistycznym updatem — wpis jest widoczny natychmiast, zanim API potwierdzi zapis.

## Analiza stanu obecnego

- Auth kompletny: `signin.ts`, `signup.ts`, `signout.ts`, middleware chroni `/dashboard`
- `dashboard.astro` to placeholder: wyświetla email + przycisk sign-out — wymaga pełnego przepisania
- Brak tras API dla budżetów i wydatków
- Brak komponentów React dla funkcjonalności budżetowej
- `src/database.types.ts` gotowe; `createServerClient<Database>` podłączony
- RPC functions w DB: `create_budget()`, `join_budget_by_invite_code()` (z migracji F-01)
- `src/types.ts` nie istnieje — trzeba stworzyć
- Brak katalogu `src/components/expenses/`
- Shadcn `button.tsx` dostępny; Lucide React dostępny; brak Zod

## Pożądany stan końcowy

Po zakończeniu planu użytkownik może:
1. Po zalogowaniu: zobaczyć dashboard z formularzem tworzenia budżetu lub dołączenia przez kod
2. Po stworzeniu budżetu: zobaczyć swój kod zaproszenia i dodać pierwszy wydatek
3. Po dołączeniu partnera (innym urządzeniem/kontem): zobaczyć wydatki drugiej osoby w < 3s bez odświeżania
4. Lista wydatków: bieżący miesiąc, chronologicznie, pogrupowana separatorami dni, z atrybucją "Ty"/"Partner"

### Kluczowe odkrycia:

- `budget_members` SELECT RLS zwraca tylko własny wiersz — do server-side state machine: `.maybeSingle()` na `budget_members` daje `budget_id` użytkownika (jeśli jest członkiem) lub `null`
- React island (ExpenseDashboard) komunikuje się z API przez `fetch()` z cookies — serwer-side Supabase client w API routes waliduje JWT automatycznie; nie potrzeba browser-side Supabase client w wyspie
- Wzorzec błędów w formach HTML: `?error=` w URL (jak `signin.ts`); błędy w React island: inline w komponencie
- Wyspy React w Astro: `client:load`; props z Astro server-side przekazane jako atrybuty HTML

## Czego NIE robimy

- Brak edycji wydatku in-place (PRD Non-Goal)
- Brak usuwania wydatku (to jest S-02)
- Brak synchronizacji < 3s via Supabase Realtime (to jest S-03 — polling 5s jest uproszczeniem)
- Brak podsumowania per-kategoria (to jest S-04)
- Brak wyświetlania emaila partnera (tylko "Ty"/"Partner")
- Brak paginacji ani wyszukiwania
- Brak powiadomień push
- Brak walidacji przez Zod — używamy natywnej walidacji HTML5 i manualnych sprawdzeń

## Podejście do implementacji

Trzy fazy w kolejności zależności:
1. **Backend foundation** — typy, migracja, API routes (serwer gotowy przed UI)
2. **Dashboard state machine** — Astro page ze server-side logiką stanu
3. **React island** — `ExpenseDashboard.tsx` z listą, formą i pollingiem

Dashboard.astro rozstrzyga dwa stany server-side:
- **A** (brak budżetu): formularze tworzenia i dołączania
- **B** (ma budżet): kod zaproszenia + `<ExpenseDashboard client:load />`

## Krytyczne szczegóły implementacji

**Polling cleanup**: `useEffect` w `ExpenseDashboard` musi zwrócić `() => clearInterval(id)`. Bez tego przy unmount/HMR pojawia się memory leak i zdublowane pollingi — szczególnie dotkliwe w Cloudflare Workers gdzie Workers są długożyjące.

**Optimistic ID**: optimistyczny wpis dodany do lokalnego stanu PRZED potwierdzeniem API musi mieć tymczasowe ID (np. `crypto.randomUUID()` lub `Date.now().toString()`). Kolejny poll zastąpi cały array danymi z serwera, eliminując duplikaty. Nie próbuj matchować optimistic ID z serwerowym — poll jest źródłem prawdy.

**Kolejność ORDER BY**: API `/api/expenses` sortuje `expense_date ASC, created_at ASC` — najstarszy wpis na górze, najnowszy na dole. Optimistic update appenduje na dół listy (CURRENT_DATE i NOW() — zawsze na końcu chronologicznie).

**`export const prerender = false`**: WSZYSTKIE pliki pod `src/pages/api/` muszą mieć tę linię (CLAUDE.md hard rule). Bez niej Astro próbuje pre-renderować endpoint statycznie i build pada.

## Faza 1: Typy, API routes, migracja

### Przegląd

Stworzenie wspólnych typów, wszystkich tras API (5 handlerów w 4 plikach) i pushowanie migracji walidującej że nowe RPC nie jest potrzebne (potwierdzamy że `get_dashboard_state()` nie jest konieczna dzięki uproszczonej architekturze).

### Wymagane zmiany:

#### 1. Wspólne typy

**Plik**: `src/types.ts`

**Cel**: Eksportować przyjazne aliasy typów bazy danych i stałą EXPENSE_CATEGORIES (wymaganą przez formularz i API).

**Kontrakt**: Eksportuje:
- `type Expense = Database['public']['Tables']['expenses']['Row']`
- `type Budget = Database['public']['Tables']['budgets']['Row']`
- `type ExpenseCategory = Database['public']['Enums']['expense_category']`
- `const EXPENSE_CATEGORIES: ExpenseCategory[]` — tablica 9 wartości w kolejności z migracji (Jedzenie, Transport, Mieszkanie, Rozrywka, Zdrowie, Ubrania, Restauracje, Elektronika, Inne)

---

#### 2. API route: lista i dodawanie wydatków

**Plik**: `src/pages/api/expenses.ts`

**Cel**: GET zwraca listę wydatków bieżącego miesiąca dla budżetu użytkownika (używane przez polling); POST dodaje nowy wydatek i zwraca go.

**Kontrakt**:

```
export const prerender = false

GET /api/expenses
  Auth: wymagane (supabase client z cookies)
  Response 200: { expenses: Expense[] } — ASC order (expense_date, created_at)
  Response 200 z expenses: [] — gdy użytkownik nie ma budżetu
  Response 401: { error: "Unauthorized" } — gdy brak sesji

POST /api/expenses
  Auth: wymagane
  Body: JSON { amount: number, category: ExpenseCategory, expense_date: string }
  Validation: amount > 0, category in EXPENSE_CATEGORIES, expense_date poprawny format YYYY-MM-DD
  Response 201: { expense: Expense }
  Response 400: { error: "Invalid amount" | "Invalid category" | ... }
  Response 401: { error: "Unauthorized" }
  Response 403: { error: "No budget" } — gdy użytkownik nie ma budżetu
```

Logika GET: query `budget_members` (maybeSingle → budget_id), jeśli null → `{ expenses: [] }`. Jeśli jest → query `expenses` WHERE budget_id + expense_date w bieżącym miesiącu, ORDER BY expense_date ASC, created_at ASC.

Logika POST: analogicznie pobierz budget_id, waliduj pola, INSERT do `expenses` z `created_by = user.id`.

---

#### 3. API route: tworzenie budżetu

**Plik**: `src/pages/api/budgets.ts`

**Cel**: Obsłużyć POST z formularza tworzenia budżetu — wywołać RPC `create_budget()`, przekierować.

**Kontrakt**:

```
export const prerender = false

POST /api/budgets
  Auth: wymagane
  Body: form data { name: string }
  Success: redirect 303 → /dashboard
  Error: redirect 303 → /dashboard?error=<message>
```

Wywołuje `supabase.rpc('create_budget', { p_name: name || null })`. Mapuje wyjątek PostgreSQL na czytelny komunikat w `?error=`.

---

#### 4. API route: dołączanie do budżetu

**Plik**: `src/pages/api/budgets/join.ts`

**Cel**: Obsłużyć POST z formularza dołączania przez kod zaproszenia.

**Kontrakt**:

```
export const prerender = false

POST /api/budgets/join
  Auth: wymagane
  Body: form data { invite_code: string }
  Success: redirect 303 → /dashboard
  Error: redirect 303 → /dashboard?error=<message>
```

Wywołuje `supabase.rpc('join_budget_by_invite_code', { p_invite_code: invite_code })`. Mapuje wyjątki: `invalid_invite_code` → "Nieprawidłowy kod zaproszenia", `already_member` → "Jesteś już członkiem tego budżetu", `budget_full` → "Budżet ma już dwóch członków".

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint` przechodzi bez błędów
- `npm run build` przechodzi (brak błędów TypeScript)

#### Weryfikacja ręczna:

- `GET /api/expenses` jako zalogowany użytkownik bez budżetu zwraca `{expenses: []}`
- `POST /api/budgets` z `name=Nasz+budżet` tworzy budżet i przekierowuje na `/dashboard`
- `POST /api/budgets/join` z nieprawidłowym kodem przekierowuje na `/dashboard?error=Nieprawid%C5%82owy+kod...`
- `POST /api/expenses` z `{amount:12.50, category:"Jedzenie", expense_date:"2026-05-28"}` zwraca 201 z expense

**Uwaga implementacyjna**: Po zakończeniu tej fazy i pomyślnym przejściu wszystkich automatycznych weryfikacji, zatrzymaj się na ręczne potwierdzenie przed przejściem do Fazy 2.

---

## Faza 2: Dashboard — maszyna stanów

### Przegląd

Pełne przepisanie `dashboard.astro`: server-side query określa stan A (brak budżetu) lub B (ma budżet), renderuje odpowiedni UI.

### Wymagane zmiany:

#### 1. Dashboard page

**Plik**: `src/pages/dashboard.astro`

**Cel**: Zastąpić placeholder pełnym UI dashboardu z maszyną stanów. Server-side query do Supabase ustala stan; przekazuje dane do React island przez props.

**Kontrakt**: Plik wykonuje server-side:

```
1. const user = Astro.locals.user
2. const supabase = createClient(Astro.request.headers, Astro.cookies)
3. const { data: membership } = await supabase
     .from('budget_members').select('budget_id').maybeSingle()
4. Jeśli membership → const { data: budget } = await supabase
     .from('budgets').select('id, name, invite_code').eq('id', membership.budget_id).single()
5. const errorMessage = Astro.url.searchParams.get('error')
```

**Stan A** (membership === null): renderuje dwie sekcje side-by-side:
- "Utwórz nowy budżet": `<form method="POST" action="/api/budgets">` z `<input name="name" value="Nasz budżet">` i przyciskiem submit
- "Dołącz do budżetu": `<form method="POST" action="/api/budgets/join">` z `<input name="invite_code" placeholder="Wpisz kod zaproszenia">` i przyciskiem submit
- Jeśli errorMessage: wyświetl `<ServerError>` lub odpowiednik z treścią błędu

**Stan B** (membership !== null + budget): renderuje:
- Nagłówek z nazwą budżetu (`budget.name ?? 'Nasz budżet'`)
- Sekcja "Kod zaproszenia": `<code>{budget.invite_code}</code>` + przycisk copy (można jako Astro, bez React)
- `<ExpenseDashboard client:load budgetId={budget.id} currentUserId={user.id} />`

Stylowanie: zgodne z istniejącym glassmorphic design (backdrop-blur, gradient text, dark background) widocznym w `signin.astro` i `dashboard.astro`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint` przechodzi
- `npm run build` przechodzi

#### Weryfikacja ręczna:

- Nowy użytkownik po zalogowaniu widzi Stan A (formularze tworzenia i dołączania)
- Po stworzeniu budżetu: redirect na dashboard → widoczny Stan B z kodem zaproszenia
- Po wpisaniu złego kodu zaproszenia: widoczny komunikat błędu pod formularzem
- Brak regresji: sign-out nadal działa

**Uwaga implementacyjna**: Zatrzymaj się na ręczne potwierdzenie przed Fazą 3.

---

## Faza 3: React island ExpenseDashboard

### Przegląd

Stworzenie interaktywnej wyspy `ExpenseDashboard.tsx` z formularzem dodawania wydatków, listą bieżącego miesiąca pogrupowaną po dniach i pollingiem co 5 sekund.

### Wymagane zmiany:

#### 1. Główna wyspa wydatków

**Plik**: `src/components/expenses/ExpenseDashboard.tsx`

**Cel**: React island zarządzający całą funkcjonalnością wydatków: lista, formularz, polling, optimistic updates.

**Kontrakt**:

Props interface:
```typescript
interface Props {
  budgetId: string
  currentUserId: string
}
```

Stan wewnętrzny: `expenses: Expense[]`, `loading: boolean`, `addError: string | null`.

Lifecycle:
- `useEffect([], cleanup)` — fetch GET /api/expenses → set expenses; startuje `setInterval(fetchExpenses, 5000)`; cleanup: `clearInterval`
- Każde wywołanie `fetchExpenses`: `fetch('/api/expenses')` → `response.json()` → `setExpenses(data.expenses)`

Renderuje (od góry):
1. Sekcja nagłówkowa: "Wydatki – [miesiac rok]"
2. `<AddExpenseForm>` (sub-komponent lub inline) — po submicie: optimistic push do `expenses`, czyści pola, refetch po 1s (dla potwierdzenia)
3. Jeśli `loading && expenses.length === 0`: loading skeleton lub spinner
4. Lista wydatków pogrupowana po `expense_date`:
   - Separator dnia: formatted date string
   - Wiersze wydatków: kwota (np. "12,50 zł"), kategoria, atrybucja

Atrybucja: `expense.created_by === currentUserId ? 'Ty' : 'Partner'`

Formatowanie kwoty: `Number(expense.amount).toLocaleString('pl-PL', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' zł'`

Formatowanie daty separatora: `new Date(expense.expense_date + 'T00:00:00').toLocaleDateString('pl-PL', {day: 'numeric', month: 'long'})` — wynik: "28 maja"

Grupowanie: redukuj `expenses` do `Map<string, Expense[]>` kluczowanego przez `expense_date`. Iteruj Map w kolejności insertion (expenses są posortowane ASC z API, więc kolejność jest chronologiczna).

---

#### 2. Formularz dodawania wydatku

**Plik**: `src/components/expenses/AddExpenseForm.tsx` (lub inline w ExpenseDashboard)

**Cel**: Formularz z trzema polami; submit przez fetch(); optimistic update do rodzica; inline error.

**Kontrakt**:

Props interface (jeśli osobny plik):
```typescript
interface Props {
  onAdd: (expense: Expense) => void  // callback dla optimistic update
}
```

Pola:
- `amount`: `<input type="number" step="0.01" min="0.01" required placeholder="0.00">`
- `category`: `<select required>` z `<option>` dla każdej wartości z `EXPENSE_CATEGORIES`
- `expense_date`: `<input type="date" required defaultValue={today}>` gdzie `today = new Date().toISOString().split('T')[0]`

Submit handler:
1. Buduje optimistic `Expense` z tymczasowym `id = crypto.randomUUID()`
2. Wywołuje `onAdd(optimisticExpense)` (natychmiastowe pojawienie się na liście)
3. `fetch('/api/expenses', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({amount, category, expense_date})})` 
4. Jeśli error: wywołuje callback do usunięcia optimistic entry, `setAddError(message)`
5. Jeśli success: czyści pola formularza

`addError`: jeśli niepuste, renderuje tekst błędu nad przyciskiem submit.

---

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint` przechodzi
- `npm run build` przechodzi

#### Weryfikacja ręczna:

- Zaloguj się, stwórz budżet → formularz wydatku widoczny
- Dodaj wydatek: "Jedzenie, 25.00, dziś" → wpis pojawia się natychmiast (optimistic)
- Odśwież stronę → wpis nadal widoczny (persisted)
- Otwórz drugi browser/incognito jako partner (dołącz przez kod zaproszenia) → dodaj wydatek → w pierwszym oknie po max 5s pojawia się bez ręcznego odświeżenia
- Lista pokazuje separator daty (np. "28 maja") z wierszami poniżej
- Atrybucja: wydatki swoje oznaczone "Ty", partnera "Partner"
- Formularz: pole kwoty odrzuca wartości ≤ 0 (natywna walidacja HTML5)

---

## Strategia testowania

### Testy automatyczne:

- `npm run lint` po każdej fazie
- `npm run build` po każdej fazie

### Kroki testowania ręcznego (end-to-end):

1. Zaloguj się jako nowy użytkownik → widoczny Stan A (formularze)
2. Stwórz budżet "Testowy budżet" → redirect → Stan B z invite code
3. Skopiuj kod zaproszenia
4. Otwórz nową sesję (incognito lub inny browser) → zaloguj się jako drugi użytkownik
5. Na dashboardzie drugiego użytkownika: wpisz kod zaproszenia → redirect → Stan B
6. W oknie 1: dodaj wydatek "Jedzenie 50.00" → pojawia się natychmiast (optimistic)
7. W oknie 2: poczekaj max 5s → wydatek użytkownika 1 pojawia się automatycznie z atrybucją "Partner"
8. W oknie 2: dodaj wydatek "Transport 30.00" → w oknie 1 po max 5s pojawia się z "Partner"
9. Sprawdź separator dat: dwa wpisy z dziś powinny być pod jednym separatorem
10. Zły kod zaproszenia: wpisz "XXXXXXXX" → komunikat błędu na dashboardzie

## Uwagi dotyczące wydajności

Polling co 5s generuje ~720 requestów/godzina na użytkownika. Przy 2 użytkownikach i Cloudflare Workers skala jest pomijalnie mała. GET /api/expenses wykonuje 2 zapytania do Supabase (membership + expenses) — indeksy na `budget_members.user_id` i `expenses.budget_id` są standardowe i wystarczające dla MVP.

## Referencje

- Roadmapa: `context/foundation/roadmap.md` (S-01, odblokowane przez F-01)
- PRD: `context/foundation/prd.md` (US-01, FR-001–006)
- F-01 plan: `context/changes/expense-data-schema/plan.md`
- Auth API wzorzec: `src/pages/api/auth/signup.ts`
- React form wzorzec: `src/components/auth/SignInForm.tsx`
- Supabase client: `src/lib/supabase.ts`
- DB schema: `src/database.types.ts`
- Lesson: `context/foundation/lessons.md` (SECURITY DEFINER NULL guard — dotyczy create_budget i join)

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dodaj ` — <commit sha>`, gdy krok zostanie zrealizowany.

### Faza 1: Typy, API routes

#### Automatyczne

- [x] 1.1 `npm run lint` przechodzi bez błędów — e413b0e
- [x] 1.2 `npm run build` przechodzi (brak błędów TypeScript) — e413b0e

#### Ręczne

- [x] 1.3 GET /api/expenses jako zalogowany bez budżetu → `{expenses:[]}` — e413b0e
- [x] 1.4 POST /api/budgets tworzy budżet i przekierowuje na `/dashboard` — e413b0e
- [x] 1.5 POST /api/budgets/join z złym kodem → redirect z `?error=` — e413b0e
- [x] 1.6 POST /api/expenses z poprawnym payload → 201 z expense object — e413b0e

### Faza 2: Dashboard maszyna stanów

#### Automatyczne

- [x] 2.1 `npm run lint` przechodzi — bdb90f5
- [x] 2.2 `npm run build` przechodzi — bdb90f5

#### Ręczne

- [x] 2.3 Nowy użytkownik widzi Stan A (formularze tworzenia i dołączania) — bdb90f5
- [x] 2.4 Po stworzeniu budżetu: Stan B z kodem zaproszenia — bdb90f5
- [x] 2.5 Zły kod zaproszenia: komunikat błędu na dashboardzie — bdb90f5
- [x] 2.6 Sign-out nadal działa — bdb90f5

### Faza 3: React island ExpenseDashboard

#### Automatyczne

- [x] 3.1 `npm run lint` przechodzi
- [x] 3.2 `npm run build` przechodzi

#### Ręczne

- [x] 3.3 Dodaj wydatek → pojawia się natychmiast (optimistic)
- [x] 3.4 Odśwież stronę → wydatek persisted
- [x] 3.5 Polling: wydatek partnera pojawia się w < 5s bez ręcznego odświeżenia
- [x] 3.6 Separator dat widoczny; atrybucja "Ty"/"Partner" poprawna
- [x] 3.7 Formularz odrzuca kwotę ≤ 0 (natywna walidacja)
