# Expense Data Schema — Plan implementacji

## Przegląd

Jeden plik migracji SQL ustanawiający pełny model danych dla śledzenia budżetu: typ `expense_category` (PostgreSQL ENUM), trzy tabele (`budgets`, `budget_members`, `expenses`), RLS włączone na każdej z osobnymi politykami per-operacja i per-rola, oraz funkcja `SECURITY DEFINER` umożliwiająca uwierzytelnionym użytkownikom dołączenie do budżetu przez kod zaproszenia. To jest fundament F-01 odblokowujący całą ścieżkę S-01 → S-02 → S-03 → S-04.

## Analiza stanu obecnego

- `supabase/config.toml` istnieje; katalog `supabase/migrations/` nie istnieje — trzeba go utworzyć
- Żaden schemat nie jest zdefiniowany; jedyna tabela to `auth.users` (wbudowana w Supabase Auth)
- `src/lib/supabase.ts` tworzy klienta bez generycznego `Database` — typy zostaną wygenerowane w Fazie 2 i podłączone w S-01
- Tech stack: PostgreSQL 17 (local), Supabase SSR client, Cloudflare Workers runtime

## Pożądany stan końcowy

Po zakończeniu planu:
- `supabase/migrations/20260528000000_expense_data_schema.sql` istnieje i aplikuje się bez błędów przez `npx supabase db reset`
- Trzy tabele widoczne w Supabase Studio w schemacie `public`, każda z włączonym RLS
- Funkcja `join_budget_by_invite_code(TEXT)` widoczna pod Database → Functions, wykonywalna przez rolę `authenticated`
- `src/database.types.ts` zawiera wygenerowane typy TypeScript dla wszystkich tabel i enuma

### Kluczowe odkrycia:

- `gen_random_uuid()` jest wbudowane od PostgreSQL 13 — nie wymaga rozszerzenia; bezpieczne jako DEFAULT dla `id` i `invite_code`
- Supabase w lokalnym dev ma pgcrypto domyślnie włączone, ale UUID-based invite code prefix unika zależności od `gen_random_bytes`
- Polityka SELECT na `budget_members` **nie może** referencować `budget_members` w podzapytaniu — tworzy nieskończoną rekurencję; rozwiązanie: `user_id = auth.uid()` (każdy widzi tylko swój wiersz)
- Polityki `budgets` referencują `budget_members` bez ryzyka rekurencji (cykl jednopoziomowy, nie głębszy)
- Przepływ zaproszenia wymaga `SECURITY DEFINER` function — użytkownik wpisujący kod NIE jest jeszcze w `budget_members`, więc polityka SELECT na `budgets` by go zablokowała

## Czego NIE robimy

- Brak UI, formularzy ani tras API (to jest S-01)
- Brak seedowania ani danych testowych
- Brak polityki UPDATE na `expenses` (PRD Non-Goal: brak edycji in-place)
- Brak polityki DELETE na `budget_members` (opuszczenie budżetu poza zakresem MVP)
- Brak polityki DELETE na `budgets`
- Brak tabeli `profiles` ani wyświetlanych nazw użytkowników (oznaczenie "Ty" vs "Partner" to logika S-01 bazująca na `created_by != auth.uid()`)
- Brak triggera dla `invite_code` — DEFAULT na kolumnie wystarczy

## Podejście do implementacji

Jeden plik migracji z sekcjami w kolejności zależności: ENUM → tabele → `ALTER TABLE ENABLE ROW LEVEL SECURITY` → polityki → funkcja → granty. Brak triggerów; kod zaproszenia generowany jako kolumna DEFAULT. Funkcja `join_budget_by_invite_code` enkapsuluje całą logikę dołączania (walidacja kodu, sprawdzenie czy już członek, ograniczenie 2 osób, INSERT).

## Krytyczne szczegóły implementacji

**Rekurencja RLS w `budget_members`**: Standardowy wzorzec "widz wszystkich członków swojego budżetu" (`budget_id IN (SELECT budget_id FROM budget_members WHERE user_id = auth.uid())`) powoduje błąd `infinite recursion detected in policy for relation "budget_members"`. Polityka SELECT musi być `user_id = auth.uid()` — brak podzapytania do tej samej tabeli. Skutek: użytkownik widzi tylko swój wiersz; partner nie jest widoczny przez `budget_members` SELECT. To jest celowe dla MVP — atrybucja wydatku ("Ty" vs "Partner") jest rozwiązywana po stronie aplikacji przez porównanie `created_by` z `auth.uid()`.

**Bypass RLS dla przepływu zaproszenia**: Funkcja musi mieć `SECURITY DEFINER` + `SET search_path = public`. Bez tego osoba wpisująca kod (niebędąca jeszcze członkiem) nie może SELECT z `budgets` przez restrykcyjną politykę. Funkcja uruchamia się z uprawnieniami właściciela (postgres), ale sama egzekwuje reguły biznesowe.

## Faza 1: Migracja — schemat, RLS, funkcja zaproszenia

### Przegląd

Stworzenie pliku migracji `supabase/migrations/20260528000000_expense_data_schema.sql` zawierającego pełny DDL: ENUM, trzy tabele, włączenie RLS, polityki per-operacja i funkcję `join_budget_by_invite_code`.

### Wymagane zmiany:

#### 1. Katalog migracji

**Plik**: `supabase/migrations/` (katalog do stworzenia)

**Cel**: Supabase CLI oczekuje migracji w `supabase/migrations/`; katalog nie istnieje.

**Kontrakt**: Pusty katalog; plik `.gitkeep` opcjonalny (CLI go nie wymaga).

---

#### 2. Plik migracji

**Plik**: `supabase/migrations/20260528000000_expense_data_schema.sql`

**Cel**: Ustanowić pełny schemat bazy danych dla F-01 w jednej transakcyjnej migracji.

**Kontrakt**: Plik zawiera poniższe sekcje w dokładnej kolejności (kolejność jest wymagana przez zależności FK):

```sql
-- ============================================================
-- 1. ENUM
-- ============================================================
CREATE TYPE public.expense_category AS ENUM (
  'Jedzenie',
  'Transport',
  'Mieszkanie',
  'Rozrywka',
  'Zdrowie',
  'Ubrania',
  'Restauracje',
  'Elektronika',
  'Inne'
);

-- ============================================================
-- 2. TABELE
-- ============================================================

-- Wspólny budżet domowy
CREATE TABLE public.budgets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT,
  invite_code TEXT        UNIQUE NOT NULL
                          DEFAULT upper(substring(gen_random_uuid()::text, 1, 8)),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Powiązanie użytkownik–budżet
CREATE TABLE public.budget_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id  UUID        NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (budget_id, user_id)
);

-- Wydatki
CREATE TABLE public.expenses (
  id           UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id    UUID               NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  created_by   UUID               NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  amount       NUMERIC(10,2)      NOT NULL CHECK (amount > 0),
  category     public.expense_category NOT NULL,
  expense_date DATE               NOT NULL DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. ROW LEVEL SECURITY — włączenie
-- ============================================================
ALTER TABLE public.budgets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses       ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. POLITYKI RLS — budgets
-- ============================================================

-- Członkowie budżetu mogą go zobaczyć
CREATE POLICY "budgets_select_members"
  ON public.budgets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.budget_members bm
      WHERE bm.budget_id = budgets.id
        AND bm.user_id   = auth.uid()
    )
  );

-- Uwierzytelniony użytkownik może utworzyć budżet
CREATE POLICY "budgets_insert_authenticated"
  ON public.budgets FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Członkowie budżetu mogą go aktualizować (np. regenerować invite_code)
CREATE POLICY "budgets_update_members"
  ON public.budgets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.budget_members bm
      WHERE bm.budget_id = budgets.id
        AND bm.user_id   = auth.uid()
    )
  );

-- ============================================================
-- 5. POLITYKI RLS — budget_members
-- ============================================================

-- Użytkownik widzi tylko swój własny wiersz członkostwa
-- (brak podzapytania do budget_members — unika nieskończonej rekurencji)
CREATE POLICY "budget_members_select_own"
  ON public.budget_members FOR SELECT
  USING (user_id = auth.uid());

-- Użytkownik może wstawić tylko swój własny user_id
CREATE POLICY "budget_members_insert_own"
  ON public.budget_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 6. POLITYKI RLS — expenses
-- ============================================================

-- Członkowie budżetu widzą wszystkie wydatki z ich budżetu
CREATE POLICY "expenses_select_budget_members"
  ON public.expenses FOR SELECT
  USING (
    budget_id IN (
      SELECT budget_id FROM public.budget_members
      WHERE user_id = auth.uid()
    )
  );

-- Członkowie mogą dodawać wydatki do swoich budżetów (created_by musi być swoim uid)
CREATE POLICY "expenses_insert_budget_members"
  ON public.expenses FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND budget_id IN (
      SELECT budget_id FROM public.budget_members
      WHERE user_id = auth.uid()
    )
  );

-- Użytkownik może usunąć tylko własne wydatki
CREATE POLICY "expenses_delete_own"
  ON public.expenses FOR DELETE
  USING (created_by = auth.uid());

-- ============================================================
-- 7. FUNKCJA: dołączenie do budżetu przez kod zaproszenia
-- ============================================================
CREATE OR REPLACE FUNCTION public.join_budget_by_invite_code(p_invite_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_budget_id    UUID;
  v_member_count INTEGER;
BEGIN
  -- Znajdź budżet po kodzie zaproszenia
  SELECT id INTO v_budget_id
  FROM public.budgets
  WHERE invite_code = p_invite_code;

  IF v_budget_id IS NULL THEN
    RAISE EXCEPTION 'invalid_invite_code';
  END IF;

  -- Sprawdź, czy użytkownik jest już członkiem
  IF EXISTS (
    SELECT 1 FROM public.budget_members
    WHERE budget_id = v_budget_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'already_member';
  END IF;

  -- Sprawdź limit członków (MVP: max 2 osoby)
  SELECT COUNT(*) INTO v_member_count
  FROM public.budget_members
  WHERE budget_id = v_budget_id;

  IF v_member_count >= 2 THEN
    RAISE EXCEPTION 'budget_full';
  END IF;

  -- Dodaj nowego członka
  INSERT INTO public.budget_members (budget_id, user_id)
  VALUES (v_budget_id, auth.uid());

  RETURN v_budget_id;
END;
$$;

-- ============================================================
-- 8. GRANTY dla funkcji
-- ============================================================
GRANT  EXECUTE ON FUNCTION public.join_budget_by_invite_code(TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.join_budget_by_invite_code(TEXT) FROM anon;
```

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- Migracja aplikuje się czysto: `npx supabase db reset` kończy się kodem 0
- Brak błędów w stdout/stderr poza standardowymi komunikatami CLI

#### Weryfikacja ręczna:

- Trzy tabele (`budgets`, `budget_members`, `expenses`) widoczne w Studio → Table Editor
- Każda tabela ma "Row Level Security" = enabled (ikona tarczy w Studio)
- Pod Database → Functions widoczna funkcja `join_budget_by_invite_code`
- W Studio SQL Editor: `SELECT * FROM public.budgets;` jako rola `anon` zwraca 0 wierszy (dostęp zablokowany przez brak polityki dla anon)

**Uwaga implementacyjna**: Po zakończeniu tej fazy i pomyślnym przejściu wszystkich automatycznych weryfikacji, zatrzymaj się tutaj na ręczne potwierdzenie od człowieka, że weryfikacja ręczna zakończyła się sukcesem, zanim przejdziesz do Fazy 2.

---

## Faza 2: Generowanie typów TypeScript + weryfikacja RLS

### Przegląd

Wygenerowanie typów TypeScript ze schematu bazy danych i spot-check polityk RLS przez bezpośrednie zapytania SQL w Studio.

### Wymagane zmiany:

#### 1. Wygenerowane typy bazy danych

**Plik**: `src/database.types.ts`

**Cel**: Zapewnić pełne typy TypeScript dla wszystkich tabel i enuma, aby S-01 mogło wdrożyć type-safe klienta Supabase od pierwszej linii kodu.

**Kontrakt**: Plik jest generowany poleceniem `npx supabase gen types typescript --local --schema public > src/database.types.ts`. Nie jest ręcznie edytowany. Zawiera eksport `Database` z kluczami `Tables<'budgets'>`, `Tables<'budget_members'>`, `Tables<'expenses'>` i `Enums<'expense_category'>`. Podłączenie `Database` do `createServerClient` w `src/lib/supabase.ts` jest zadaniem S-01, nie tej migracji.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `src/database.types.ts` istnieje i zawiera `expense_category` w sekcji Enums
- `npm run build` kończy się kodem 0 (nowy plik nie wprowadza błędów typów)

#### Weryfikacja ręczna:

- W Studio SQL Editor wykonaj poniższe zapytania i potwierdź wyniki:

```sql
-- Test 1: anon nie ma dostępu do żadnych tabel
SET ROLE anon;
SELECT * FROM public.budgets;        -- expected: ERROR lub 0 rows (brak polityki dla anon)
SELECT * FROM public.expenses;       -- expected: ERROR lub 0 rows
RESET ROLE;

-- Test 2: funkcja join_budget_by_invite_code odrzuca nieprawidłowy kod
SELECT public.join_budget_by_invite_code('INVALID99');
-- expected: ERROR z message 'invalid_invite_code'

-- Test 3: kolumna invite_code generuje unikalne wartości
INSERT INTO public.budgets DEFAULT VALUES;
INSERT INTO public.budgets DEFAULT VALUES;
SELECT invite_code FROM public.budgets;
-- expected: dwa różne 8-znakowe kody wielkich liter
```

---

## Strategia testowania

### Testy automatyczne:

- `npx supabase db reset` — jedyna automatyczna weryfikacja w tej fazie; sprawdza poprawność SQL i kompletność migracji

### Kroki testowania ręcznego:

1. Uruchom `npx supabase start` jeśli stack nie jest aktywny
2. Uruchom `npx supabase db reset` — potwierdź exit 0
3. Otwórz Studio pod `http://localhost:54323`
4. Table Editor → sprawdź `budgets`, `budget_members`, `expenses` z ikoną RLS
5. Database → Functions → potwierdź `join_budget_by_invite_code`
6. SQL Editor → wykonaj testy z sekcji Fazy 2
7. Uruchom `npx supabase gen types typescript --local --schema public > src/database.types.ts`
8. Uruchom `npm run build` — potwierdź exit 0

## Uwagi dotyczące migracji

- Plik migracji jest jedynym artefaktem produkcyjnym — `supabase db push` (dla cloud) lub `supabase db reset` (dla local) aplikują go automatycznie
- Kolejność sekcji w pliku SQL jest krytyczna: ENUM przed tabelami, tabele przed politykami, granty na końcu
- Dla cloud Supabase użyj `npx supabase db push` zamiast `db reset`
- Wersja PostgreSQL: lokalnie `major_version = 17` (z config.toml); `gen_random_uuid()` jest wbudowane, brak zależności od rozszerzeń

## Referencje

- Roadmapa: `context/foundation/roadmap.md` (F-01, odblokowuje S-01..S-04)
- PRD: `context/foundation/prd.md` (FR-003, FR-004, FR-005, FR-006, §Access Control)
- Supabase client: `src/lib/supabase.ts`
- Supabase config: `supabase/config.toml`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dodaj ` — <commit sha>`, gdy krok zostanie zrealizowany.

### Faza 1: Migracja — schemat, RLS, funkcja zaproszenia

#### Automatyczne

- [x] 1.1 `npx supabase db reset` kończy się kodem 0 bez błędów — 5a4115e

#### Ręczne

- [x] 1.2 Trzy tabele widoczne w Studio z włączonym RLS — 5a4115e
- [x] 1.3 Funkcja `join_budget_by_invite_code` widoczna w Database → Functions — 5a4115e
- [x] 1.4 `SELECT * FROM public.budgets` jako rola `anon` zwraca brak dostępu — 5a4115e

### Faza 2: Generowanie typów TypeScript + weryfikacja RLS

#### Automatyczne

- [x] 2.1 `src/database.types.ts` istnieje i zawiera `expense_category` w Enums
- [x] 2.2 `npm run build` kończy się kodem 0

#### Ręczne

- [x] 2.3 Test RLS: anon nie ma dostępu do tabel (SQL Editor w Studio)
- [x] 2.4 Test funkcji: `join_budget_by_invite_code('INVALID99')` rzuca `invalid_invite_code`
- [x] 2.5 Test invite_code: dwa INSERT do `budgets` generują dwa różne kody
