-- Drop permissive direct-insert policy; all member inserts now routed
-- through SECURITY DEFINER functions that enforce business rules
DROP POLICY "budget_members_insert_own" ON public.budget_members;

-- Atomic budget creation: inserts budget + owner membership
CREATE OR REPLACE FUNCTION public.create_budget(p_name TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_budget_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  INSERT INTO public.budgets (name)
  VALUES (p_name)
  RETURNING id INTO v_budget_id;

  INSERT INTO public.budget_members (budget_id, user_id)
  VALUES (v_budget_id, auth.uid());

  RETURN v_budget_id;
END;
$$;

GRANT  EXECUTE ON FUNCTION public.create_budget(TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_budget(TEXT) FROM anon;

-- Harden existing join function: add auth.uid() NULL guard + auth in search_path
CREATE OR REPLACE FUNCTION public.join_budget_by_invite_code(p_invite_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_budget_id    UUID;
  v_member_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT id INTO v_budget_id
  FROM public.budgets
  WHERE invite_code = p_invite_code;

  IF v_budget_id IS NULL THEN
    RAISE EXCEPTION 'invalid_invite_code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.budget_members
    WHERE budget_id = v_budget_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'already_member';
  END IF;

  SELECT COUNT(*) INTO v_member_count
  FROM public.budget_members
  WHERE budget_id = v_budget_id;

  IF v_member_count >= 2 THEN
    RAISE EXCEPTION 'budget_full';
  END IF;

  INSERT INTO public.budget_members (budget_id, user_id)
  VALUES (v_budget_id, auth.uid());

  RETURN v_budget_id;
END;
$$;
