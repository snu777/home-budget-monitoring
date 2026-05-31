# Usuwanie własnego wydatku (S-02) — Plan implementacji

## Przegląd

Dodanie możliwości usuwania własnego wydatku z dialogiem potwierdzenia (shadcn AlertDialog). Użytkownik widzi ikonę kosza przy swoich wydatkach; kliknięcie otwiera modal z potwierdzeniem; po potwierdzeniu wydatek znika optimistycznie. Wydatki partnera są widoczne, ale bez opcji usunięcia.

## Analiza stanu obecnego

- RLS DELETE policy `expenses_delete_own` z `USING (created_by = auth.uid())` już istnieje w migracji F-01 (`supabase/migrations/20260528000000_expense_data_schema.sql:128-130`)
- API route `src/pages/api/expenses.ts` obsługuje GET i POST — brak handlera DELETE
- `ExpenseDashboard.tsx` ma `handleRemove(id)` (linia 203-205) — filtruje wydatek po ID ze stanu; używane do cofania optimistic add, ale nadaje się też do optimistic delete
- Atrybucja `isOwn` (linia 237) już rozróżnia własne vs partnera — reużycie do warunkowego renderowania przycisku
- shadcn AlertDialog nie jest zainstalowany — dostępne: `button.tsx`, `LibBadge.astro`
- Lucide React jest w zależnościach (używane w auth forms)

### Kluczowe odkrycia:

- `handleRemove` w `ExpenseDashboard` można reużyć do optimistic delete — ta sama operacja: usunięcie wpisu ze stanu po ID
- RLS gwarantuje bezpieczeństwo na poziomie bazy — nawet jeśli ktoś wyśle DELETE bezpośrednio przez API, polityka `expenses_delete_own` pozwoli usunąć tylko własne wpisy
- Brak potrzeby migracji — warstwa danych jest kompletna

## Pożądany stan końcowy

Po zakończeniu planu:
1. Przy każdym własnym wydatku na liście widoczna jest ikona kosza (Lucide `Trash2`)
2. Kliknięcie ikony otwiera shadcn AlertDialog z pytaniem "Czy na pewno chcesz usunąć ten wydatek?"
3. Po potwierdzeniu: wydatek znika natychmiast (optimistic); jeśli API zwróci błąd, wydatek wraca z inline komunikatem
4. Wydatki partnera: brak ikony kosza, brak możliwości usunięcia
5. Optimistic/w-trakcie wydatki: brak ikony kosza

## Czego NIE robimy

- Brak usuwania wydatków partnera (PRD FR-007: tylko własne)
- Brak edycji wydatku (PRD Non-Goal)
- Brak batch delete (zaznaczanie wielu)
- Brak soft delete — usunięcie jest trwałe
- Brak undo/cofnij po usunięciu (optimistic fallback wystarczy)
- Brak Toast/Sonner — inline error w wierszu

## Podejście do implementacji

Dwie fazy:
1. **Backend** — handler DELETE w istniejącym pliku `expenses.ts`
2. **Frontend** — instalacja AlertDialog, przycisk kosza w wierszu, dialog potwierdzenia, optimistic delete z error fallback

## Faza 1: API DELETE endpoint + shadcn AlertDialog

### Przegląd

Dodanie handlera DELETE do istniejącego pliku API i instalacja komponentu shadcn AlertDialog.

### Wymagane zmiany:

#### 1. Handler DELETE w API expenses

**Plik**: `src/pages/api/expenses.ts`

**Cel**: Dodać eksport `DELETE: APIRoute` — przyjmuje `id` wydatku w query string, waliduje ownership poprzez RLS, usuwa i zwraca sukces.

**Kontrakt**:

```
DELETE /api/expenses?id=<uuid>
  Auth: wymagane (supabase client z cookies)
  Query param: id (UUID wydatku)
  Response 200: { success: true }
  Response 400: { error: "Missing expense id" }
  Response 401: { error: "Unauthorized" }
  Response 404: { error: "Expense not found" } — gdy RLS blokuje (nie jest właścicielem) lub wydatek nie istnieje
```

Logika: auth check → walidacja `id` w query string → `supabase.from('expenses').delete().eq('id', id)` → sprawdzenie `count` w odpowiedzi (jeśli 0 → 404). RLS policy `expenses_delete_own` egzekwuje `created_by = auth.uid()` — jeśli użytkownik próbuje usunąć cudzy wydatek, DELETE zwraca 0 rows affected bez błędu Postgres.

---

#### 2. Instalacja shadcn AlertDialog

**Cel**: Dodać komponent `alert-dialog` z rejestru shadcn/ui.

**Kontrakt**: `npx shadcn@latest add alert-dialog` → tworzy `src/components/ui/alert-dialog.tsx`. Styl `new-york` (CLAUDE.md). CLI automatycznie instaluje wymaganą zależność `@base-ui/react`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint` przechodzi bez błędów
- `npm run build` przechodzi

#### Weryfikacja ręczna:

- `DELETE /api/expenses?id=<valid-own-expense>` zwraca `{ success: true }` i wydatek znika z bazy
- `DELETE /api/expenses?id=<partner-expense>` zwraca 404 (RLS blokuje)
- `DELETE /api/expenses?id=<nonexistent>` zwraca 404
- `DELETE /api/expenses` (brak id) zwraca 400
- Plik `src/components/ui/alert-dialog.tsx` istnieje

**Uwaga implementacyjna**: Po zakończeniu tej fazy i pomyślnym przejściu wszystkich automatycznych weryfikacji, zatrzymaj się tutaj na ręczne potwierdzenie od człowieka, że testy ręczne zakończyły się sukcesem, zanim przejdziesz do następnej fazy.

---

## Faza 2: UI — przycisk usuwania, dialog potwierdzenia, optimistic delete

### Przegląd

Dodanie ikony kosza do wiersza własnego wydatku, shadcn AlertDialog z potwierdzeniem, optimistic delete z inline error przy niepowodzeniu.

### Wymagane zmiany:

#### 1. Rozszerzenie ExpenseDashboard o logikę usuwania

**Plik**: `src/components/expenses/ExpenseDashboard.tsx`

**Cel**: Dodać stan `deleteError`, handler `handleDelete(id)` z optimistic delete (reużycie `handleRemove`) i rollback przy błędzie, oraz wyrenderować przycisk kosza z AlertDialog w wierszu wydatku.

**Kontrakt**:

Nowy stan: `deleteError: { id: string; message: string } | null`

Handler `handleDelete(id: string)`:
1. Zapisz kopię wydatku do rollbacku
2. Wywołaj `handleRemove(id)` — optimistic usunięcie z listy
3. `fetch(\`/api/expenses?id=${id}\`, { method: 'DELETE' })`
4. Jeśli odpowiedź nie-ok: przywróć wydatek do stanu (`setExpenses(prev => [...prev, saved].sort(...))`) i ustaw `deleteError`
5. Przy kolejnym poll (5s) stan i tak zsynchronizuje się z bazą

Wiersz wydatku (w `items.map()`):
- Warunek: `isOwn && !isOptimistic` → renderuj ikonę `Trash2` (Lucide) jako trigger AlertDialog
- AlertDialog: tytuł "Usunąć wydatek?", opis z kwotą i kategorią, przyciski "Anuluj" / "Usuń"
- Po kliknięciu "Usuń" → wywołaj `handleDelete(expense.id)`
- Jeśli `deleteError?.id === expense.id` → pod wierszem czerwony tekst z `deleteError.message`

Import: `Trash2` z `lucide-react`, komponenty AlertDialog z `@/components/ui/alert-dialog`

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint` przechodzi bez błędów
- `npm run build` przechodzi

#### Weryfikacja ręczna:

- Własny wydatek: widoczna ikona kosza po prawej stronie wiersza
- Wydatek partnera: brak ikony kosza
- Optimistic wydatek (w trakcie dodawania): brak ikony kosza
- Kliknięcie kosza: otwiera się AlertDialog z treścią "Usunąć wydatek?" i kwotą/kategorią
- Kliknięcie "Anuluj": dialog zamknięty, nic się nie dzieje
- Kliknięcie "Usuń": wydatek znika natychmiast z listy
- Odświeżenie strony po usunięciu: wydatek nie wraca (persisted)
- Test w dwóch oknach: po usunięciu przez użytkownika A, w oknie użytkownika B wydatek znika w < 5s (polling)

**Uwaga implementacyjna**: Po zakończeniu tej fazy i pomyślnym przejściu wszystkich automatycznych weryfikacji, zatrzymaj się tutaj na ręczne potwierdzenie od człowieka, że testy ręczne zakończyły się sukcesem.

---

## Strategia testowania

### Testy automatyczne:

- `npm run lint` po każdej fazie
- `npm run build` po każdej fazie

### Kroki testowania ręcznego (end-to-end):

1. Zaloguj się → dodaj 2-3 wydatki w różnych kategoriach
2. Przy każdym wydatku widoczna ikona kosza
3. Kliknij kosz przy jednym wydatku → dialog "Usunąć wydatek?" z poprawną kwotą i kategorią
4. Kliknij "Anuluj" → dialog zamknięty, wydatek nadal na liście
5. Kliknij kosz ponownie → "Usuń" → wydatek znika natychmiast
6. Odśwież stronę → wydatek nie wraca
7. Otwórz drugie okno (partner) → dodaj wydatek przez partnera → w pierwszym oknie: wydatek partnera widoczny BEZ ikony kosza
8. W drugim oknie: dodaj wydatek przez partnera → w pierwszym oknie po max 5s pojawia się bez kosza
9. Sprawdź: po usunięciu wydatku przez jednego użytkownika, w oknie drugiego wydatek znika w < 5s

## Referencje

- Roadmapa: `context/foundation/roadmap.md` (S-02, zależy od S-01)
- S-01 plan: `context/changes/shared-expense-flow/plan.md`
- F-01 RLS: `supabase/migrations/20260528000000_expense_data_schema.sql:128-130` (policy `expenses_delete_own`)
- API wzorzec: `src/pages/api/expenses.ts` (GET/POST handlers)
- React island: `src/components/expenses/ExpenseDashboard.tsx`
- shadcn style: `new-york` (CLAUDE.md)

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dodaj ` — <commit sha>`, gdy krok zostanie zrealizowany.

### Faza 1: API DELETE endpoint + shadcn AlertDialog

#### Automatyczne

- [x] 1.1 `npm run lint` przechodzi bez błędów — dc65f72
- [x] 1.2 `npm run build` przechodzi — dc65f72

#### Ręczne

- [x] 1.3 DELETE własnego wydatku → `{ success: true }`, wydatek usunięty z bazy — dc65f72
- [x] 1.4 DELETE wydatku partnera → 404 (RLS blokuje) — dc65f72
- [x] 1.5 DELETE bez id → 400 — dc65f72
- [x] 1.6 `src/components/ui/alert-dialog.tsx` istnieje — dc65f72

### Faza 2: UI — przycisk, dialog, optimistic delete

#### Automatyczne

- [x] 2.1 `npm run lint` przechodzi bez błędów
- [x] 2.2 `npm run build` przechodzi

#### Ręczne

- [x] 2.3 Własny wydatek: ikona kosza widoczna; partnera: brak
- [x] 2.4 Kliknięcie kosza → AlertDialog z kwotą i kategorią
- [x] 2.5 "Anuluj" → dialog zamknięty, wydatek nadal na liście
- [x] 2.6 "Usuń" → wydatek znika natychmiast (optimistic)
- [x] 2.7 Odświeżenie strony → wydatek nie wraca (persisted)
- [x] 2.8 Drugie okno: usunięty wydatek znika w < 5s (polling)
