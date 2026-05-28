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
  id           UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id    UUID                    NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  created_by   UUID                    NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  amount       NUMERIC(10,2)           NOT NULL CHECK (amount > 0),
  category     public.expense_category NOT NULL,
  expense_date DATE                    NOT NULL DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ             NOT NULL DEFAULT NOW()
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
