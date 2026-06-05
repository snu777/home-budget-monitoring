# Expense Data Schema — Krótki plan

> Pełny plan: `context/changes/expense-data-schema/plan.md`
> Roadmapa: `context/foundation/roadmap.md` (F-01)

## Co i dlaczego

Tworzymy pełny schemat bazy danych dla wspólnego śledzenia budżetu: typ ENUM dla kategorii, trzy tabele (`budgets`, `budget_members`, `expenses`) z relacjami FK, RLS na każdej tabeli z politykami per-operacja, oraz funkcję PostgreSQL do dołączania przez kod zaproszenia. To jest fundament F-01 — bez niego żaden fragment widoczny dla użytkownika (S-01..S-04) nie może istnieć.

## Punkt wyjścia

`supabase/config.toml` istnieje i lokalny stack jest gotowy (`npx supabase start`). Brak katalogu `supabase/migrations/` i żadnych tabel w schemacie `public`. Klient Supabase (`src/lib/supabase.ts`) działa, ale nie ma generycznych typów — te zostaną dodane jako ostatni krok tej zmiany.

## Pożądany stan końcowy

Po zakończeniu: jeden plik SQL aplikuje się bez błędów przez `npx supabase db reset`, trzy tabele z włączonym RLS są widoczne w Supabase Studio, funkcja `join_budget_by_invite_code` jest dostępna dla roli `authenticated`, a `src/database.types.ts` zawiera wygenerowane typy TypeScript gotowe do użycia przez S-01.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---------|-------|---------------------|--------|
| Lista kategorii | 9 wartości: Jedzenie, Transport, Mieszkanie, Rozrywka, Zdrowie, Ubrania, Restauracje, Elektronika, Inne | Granularna, ale nie przytłaczająca lista pokrywająca typowe wydatki pary | Plan |
| Typ kategorii | PostgreSQL ENUM | Baza waliduje wartości natywnie; TypeScript-friendly przez generowane typy | Plan |
| Lokalizacja invite_code | Kolumna w `budgets` | Prościej: kod jest właściwością budżetu, nie konkretnego członka | Plan |
| Typ kwoty | NUMERIC(10,2) | Intuicyjne złote i grosze bez konwersji po stronie aplikacji | Plan |
| Typ daty wydatku | DATE | Aplikacja operuje na dniach kalendarza, nie godzinach | Plan |
| Budget name | Opcjonalne (nullable TEXT) | Nie wymagane w MVP, ale nie kosztuje nic dodać | Plan |
| RLS budget_members SELECT | `user_id = auth.uid()` (tylko własny wiersz) | Unika nieskończonej rekurencji przy self-referential policy | Plan |
| Przepływ zaproszenia | SECURITY DEFINER function | Użytkownik bez członkostwa nie przejdzie SELECT na budgets; funkcja bypasuje RLS z własną walidacją | Plan |

## Zakres

**W zakresie:**
- ENUM `expense_category` (9 wartości)
- Tabele `budgets`, `budget_members`, `expenses` z FK i constraints
- RLS na wszystkich tabelach + polityki SELECT/INSERT/DELETE (i UPDATE dla budgets)
- Funkcja `join_budget_by_invite_code(TEXT)` z walidacją biznesową
- Generowanie `src/database.types.ts`

**Poza zakresem:**
- UI, formularze, trasy API (S-01)
- Tabela `profiles` / wyświetlane nazwy (S-01 — MVP używa "Ty" vs "Partner")
- Polityka UPDATE/DELETE na `expenses` i `budget_members` (odpowiednio: poza MVP i S-02)
- Seeding danych testowych

## Architektura / Podejście

Jeden plik SQL w `supabase/migrations/` z sekcjami w kolejności wymaganej przez FK: ENUM → tabele → `ALTER TABLE ENABLE ROW LEVEL SECURITY` → polityki → funkcja → granty. Bez triggerów; `invite_code` generowany jako kolumna DEFAULT (`upper(substring(gen_random_uuid()::text, 1, 8))` — 8-znakowy kod z UUID). Funkcja `join_budget_by_invite_code` jest jedynym miejscem obsługującym przepływ zaproszenia: sprawdza kod, wykrywa zduplikowane członkostwo i egzekwuje limit 2 osób.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|------|-------------|-----------------|
| 1. Migracja | Plik SQL z pełnym DDL, RLS i funkcją; `db reset` przechodzi | RLS self-reference na `budget_members` (rozwiązane: polityka bez podzapytania do tej samej tabeli) |
| 2. Typy + weryfikacja | `src/database.types.ts` z typami; spot-check RLS przez SQL Editor | Lokalne supabase musi być aktywne; `npm run build` musi przejść z nowym plikiem |

**Wymagania wstępne:** Lokalny stack Supabase aktywny (`npx supabase start`) lub dostęp do cloud projektu.
**Szacowany nakład pracy:** ~1 sesja, 2 fazy. Faza 1 to główna praca; Faza 2 to komendy + weryfikacja.

## Otwarte ryzyka i założenia

- Invite code collision: 8-znakowy prefiks UUID daje ~4 mld kombinacji; przy MVP kolizja praktycznie niemożliwa. Jeśli UNIQUE constraint zawiedzie przy INSERT, S-01 powinno obsłużyć retry
- Supabase cloud: plan zakłada lokalny dev; przy push do cloud zamień `db reset` na `db push`
- Typ `expense_category` jest niezmienialny bez migracji ALTER TYPE; dodanie kategorii w przyszłości wymaga nowej migracji (akceptowalne dla MVP)

## Kryteria sukcesu (podsumowanie)

- `npx supabase db reset` kończy się kodem 0 i trzy tabele z RLS pojawiają się w Studio
- Funkcja `join_budget_by_invite_code('INVALID')` rzuca wyjątek `invalid_invite_code`
- `npm run build` przechodzi z wygenerowanym `src/database.types.ts`
