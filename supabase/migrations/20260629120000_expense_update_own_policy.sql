-- ============================================================
-- Wydatki: edycja własnych wpisów (FR-007 rozszerzone o Update / domknięcie CRUD)
-- ============================================================
-- Użytkownik może zaktualizować tylko własny wydatek. WITH CHECK powtarza
-- warunek właściciela, aby uniemożliwić przepisanie `created_by` na inny uid
-- w ramach UPDATE (egzekwowane w bazie, nie tylko w logice aplikacji).

CREATE POLICY "expenses_update_own"
  ON public.expenses FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());
