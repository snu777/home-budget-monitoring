# Usuwanie własnego wydatku (S-02) — Krótki plan

> Pełny plan: `context/changes/expense-delete/plan.md`

## Co i dlaczego

Użytkownik może usunąć własny wydatek po dialogu potwierdzenia. Wpisy dodane przez partnera są widoczne, ale nie do usunięcia. Realizacja FR-007 z PRD — uzupełnia CRUD wydatków o operację delete.

## Punkt wyjścia

S-01 (shared-expense-flow) jest zaimplementowane: lista wydatków z pollingiem, formularz dodawania z optimistic update, atrybucja "Ty"/"Partner". RLS DELETE policy `expenses_delete_own` z `USING (created_by = auth.uid())` już istnieje w migracji F-01 — baza danych jest gotowa na usuwanie.

## Pożądany stan końcowy

Przy każdym własnym wydatku na liście widnieje ikona kosza. Kliknięcie otwiera dialog potwierdzenia z kwotą i kategorią. Po potwierdzeniu wydatek znika natychmiast (optimistic delete). Wydatki partnera nie mają opcji usunięcia. W oknie partnera usunięty wydatek znika w < 5s dzięki pollingowi.

## Kluczowe podjęte decyzje

| Decyzja                    | Wybór                           | Dlaczego (1 zdanie)                                                    |
| -------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| Dialog potwierdzenia       | shadcn AlertDialog              | Dostępny (focus trap, ESC), spójny z ekosystemem shadcn/ui w projekcie |
| Strategia usuwania         | Optimistic delete               | Spójne z istniejącym optimistic add; szybki UX                         |
| Widoczność przycisku       | Ikona kosza zawsze widoczna     | Odkrywalność — użytkownik od razu widzi opcję usunięcia                |
| Komunikat błędu            | Inline error w wierszu          | Bez nowych komponentów; spójne z inline addError w formularzu          |

## Zakres

**W zakresie:**
- Handler DELETE w `src/pages/api/expenses.ts`
- Instalacja shadcn AlertDialog
- Ikona kosza (Lucide Trash2) w wierszu własnego wydatku
- Dialog potwierdzenia z kwotą i kategorią
- Optimistic delete z rollback przy błędzie API

**Poza zakresem:**
- Usuwanie wydatków partnera
- Edycja wydatku
- Batch delete
- Soft delete / undo
- Toast notifications

## Architektura / Podejście

Minimalny zakres zmian: 1 nowy handler DELETE w istniejącym pliku API + rozszerzenie istniejącego komponentu `ExpenseDashboard.tsx` o przycisk kosza z AlertDialog. Reużycie istniejącego `handleRemove(id)` do optimistic delete. RLS gwarantuje bezpieczeństwo — nawet bezpośrednie zapytanie API nie pozwoli usunąć cudzego wydatku.

## Fazy w skrócie

| Faza                                         | Co dostarcza                        | Kluczowe ryzyko                       |
| -------------------------------------------- | ----------------------------------- | ------------------------------------- |
| 1. API DELETE + shadcn AlertDialog            | Endpoint + komponent UI             | Brak — RLS gotowe, prosta instalacja  |
| 2. UI: przycisk, dialog, optimistic delete    | Pełna funkcjonalność usuwania       | Rollback ordering po failed delete    |

**Wymagania wstępne:** S-01 zaimplementowane (done), F-01 z RLS DELETE policy (done)
**Szacowany nakład pracy:** ~1 sesja w 2 fazach

## Otwarte ryzyka i założenia

- Założenie: `handleRemove` reużyte do optimistic delete poprawnie współgra z pollingiem (poll zastąpi cały stan, więc rollback jest potrzebny tylko do momentu następnego poll)
- Niskie ryzyko: kolejność elementów po rollback — wydatek wraca na koniec listy, ale następny poll przywróci poprawną kolejność

## Kryteria sukcesu (podsumowanie)

- Użytkownik widzi ikonę kosza tylko przy swoich wydatkach i może usunąć po potwierdzeniu w dialogu
- Usunięty wydatek nie wraca po odświeżeniu strony
- Partner widzi zniknięcie wydatku w < 5s bez ręcznego odświeżenia
