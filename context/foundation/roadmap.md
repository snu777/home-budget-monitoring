---
project: "Home Budget Monitoring"
version: 1
status: draft
created: 2026-05-27
updated: 2026-06-05
prd_version: 1
main_goal: speed
top_blocker: time
---

# Mapa drogowa: Home Budget Monitoring

> Pochodzi z `context/foundation/prd.md` (v1) + automatycznie zbadana baza kodu.
> Edytuj na miejscu; archiwizuj po zastąpieniu.
> Fragmenty poniżej są wymienione w kolejności zależności. Tabela „W skrócie" to indeks.

## Podsumowanie wizji

Para dociera do końca miesiąca, patrzy na saldo bankowe i nie potrafi wyjaśnić, gdzie poszły pieniądze. Oboje partnerzy wydają niezależnie — nie ma wspólnego widoku ani podziału na kategorie. Istniejące narzędzia wymagają zbyt dużo konfiguracji; gdy jedno z partnerów przestaje wpisywać dane, wspólny obraz się rozpada. Aplikacja rozwiązuje to minimum: para może wspólnie śledzić wydatki kategorii bez specjalnej konfiguracji.

## Gwiazda przewodnia

Gwiazda przewodnia — najmniejszy kompletny przepływ, którego pomyślne dostarczenie udowadnia, że produkt działa (tu: że para ma jeden wspólny widok wydatków) — to:

**S-01: Oboje partnerzy widzą wspólną listę wydatków** — kiedy S-01 jest gotowe, hipoteza rdzenia produktu jest udowodniona: para może rejestrować się, łączyć konta kodem zaproszenia, dodawać wydatki i przeglądać wspólną listę bieżącego miesiąca; PRD §Primary Success Criteria.

## W skrócie

| ID   | ID zmiany              | Wynik (użytkownik może …)                                                                           | Wymagania wstępne | Odniesienia do PRD                                    | Status   |
|------|------------------------|-----------------------------------------------------------------------------------------------------|-------------------|-------------------------------------------------------|----------|
| F-01 | expense-data-schema    | (fundament) schemat danych wdrożony: tabele `budgets`, `budget_members`, `expenses` + RLS           | —                 | FR-003, FR-004, FR-005, FR-006, §Access Control       | done     |
| S-01 | shared-expense-flow    | zarejestrować się, połączyć konta kodem zaproszenia, dodać wydatek i zobaczyć wspólną listę miesiąca | F-01             | US-01, FR-001, FR-002, FR-003, FR-004, FR-005, FR-006 | done     |
| S-02 | expense-delete         | usunąć własny wydatek po kroku potwierdzenia                                                        | S-01              | FR-007                                                | proposed |
| S-03 | realtime-sync          | zobaczyć wydatek dodany przez partnera w < 3s bez ręcznego odświeżania                              | S-01              | NFR: Sync < 3s, §Guardrails                           | done     |
| S-04 | category-summary       | zobaczyć podsumowanie wydatków bieżącego miesiąca per kategoria                                     | S-01              | FR-008                                                | done     |
| S-05 | monthly-comparison     | zobaczyć wizualne oznaczenie kategorii wzrastających > 20% vs. poprzedni miesiąc                    | S-04              | FR-008, §Business Logic                               | blocked  |

## Strumienie

Pomoc nawigacyjna — grupuje elementy, które dzielą łańcuch wymagań wstępnych. Kanoniczna kolejność nadal w tabeli „W skrócie" i blokach fragmentów; ta tabela to proponowana kolejność czytania równoległych ścieżek.

| Strumień | Temat                  | Łańcuch                                        | Uwaga                                                                          |
|----------|------------------------|------------------------------------------------|--------------------------------------------------------------------------------|
| A        | Rdzeń i synchronizacja | `F-01` → `S-01` → `S-02` / `S-03`             | Ścieżka must-have; gwiazda przewodnia w `S-01`; priorytet zgodny z celem `speed`. |
| B        | Analiza wydatków        | `S-04` → `S-05`                                | Rozgałęzia się od `S-01` (Stream A); nice-to-have; parkowane gdy czas zagrożony.  |

## Baza

Co już jest na miejscu w bazie kodu na dzień 2026-05-27 (automatycznie zbadane + potwierdzone). Fundamenty poniżej zakładają, że te elementy są obecne i NIE tworzą ich ponownie.

- **Frontend:** obecny — Astro 6.3 + React 19 + Tailwind 4 + shadcn/ui (`astro.config.mjs`, `src/components/`)
- **Backend / API:** obecny — trasy auth: `signin.ts`, `signup.ts`, `signout.ts` (`src/pages/api/auth/`)
- **Dane:** częściowy — klient Supabase skonfigurowany (`src/lib/supabase.ts`); brak plików migracji w `supabase/`
- **Autoryzacja:** obecny — Supabase Auth + middleware chroniący `/dashboard` (`src/middleware.ts`); FR-001 i FR-002 pokryte istniejącą implementacją
- **Wdrożenie / infra:** obecny — Cloudflare Workers + GitHub Actions CI/CD (`wrangler.jsonc`, `.github/workflows/ci.yml`)
- **Obserwowalność:** obecny (minimal) — flaga Wrangler observability; brak biblioteki logowania na poziomie aplikacji

## Fundamenty

### F-01: Schemat danych wydatków

- **Wynik:** (fundament) migracje Supabase wdrożone: tabela `budgets` (reprezentuje wspólny budżet domowy), `budget_members` (powiązanie użytkownik–budżet + kolumna kodu zaproszenia), `expenses` (kwota, kategoria, data, `created_by`, `budget_id`); RLS włączone na każdej tabeli z politykami per-operacja, per-rola — nigdy blanket `USING (true)`.
- **ID zmiany:** `expense-data-schema`
- **Odniesienia do PRD:** FR-003 (kod zaproszenia wymaga tabeli/kolumny), FR-004 (dołączenie wymaga relacji user–budget), FR-005 (wydatek musi wskazywać `budget_id`), FR-006 (lista filtrowana per budżet), §Access Control (flat permissions, RLS)
- **Odblokowuje:** S-01 (pełny przepływ wspólnej listy), S-02 (usuwanie wydatku), S-03 (real-time sync), S-04 (podsumowanie kategorii)
- **Wymagania wstępne:** —
- **Równolegle z:** —
- **Blokady:** —
- **Niewiadome:** —
- **Ryzyko:** Jedyny fundament; każde opóźnienie tu blokuje wszystkie fragmenty widoczne dla użytkownika. RLS musi być poprawna od początku — zmiana polityk po wdrożeniu danych jest podatna na pominięcia i trudna do zweryfikowania retrospektywnie.
- **Status:** done

## Fragmenty

### S-01: Wspólna lista wydatków

- **Wynik:** użytkownik może zarejestrować się, zalogować, wygenerować kod zaproszenia lub dołączyć do budżetu partnera przez kod; następnie dodać wydatek (kwota, kategoria z predefiniowanej listy, data domyślnie dzisiaj) i zobaczyć listę wydatków bieżącego miesiąca w kolejności chronologicznej z informacją kto dodał każdy wpis; aplikacja jest w pełni użyteczna solo przed dołączeniem partnera.
- **ID zmiany:** `shared-expense-flow`
- **Odniesienia do PRD:** US-01, FR-001, FR-002, FR-003, FR-004, FR-005, FR-006
- **Wymagania wstępne:** F-01
- **Równolegle z:** —
- **Blokady:** —
- **Niewiadome:**
  - Jakie kategorie znajdą się na predefiniowanej liście? (liczba i nazwy — np. Jedzenie, Transport, Mieszkanie…) — Właściciel: użytkownik. Blokada: tak (potrzebne przed implementacją formularza dodawania wydatku i zdefiniowaniem schematu enum/FK).
- **Ryzyko:** Największy fragment — obejmuje sharing, CRUD wydatków i widok listy. Przy celu `speed` to uzasadnione połączenie: mechanizm zaproszenia bez listy wydatków jest pusty, a lista wydatków bez sharingu nie dowodzi hipotezy rdzenia. Razem udowadniają §Primary Success Criteria.
- **Status:** done

### S-02: Usuwanie wydatku

- **Wynik:** użytkownik może usunąć własny wydatek po dialogu potwierdzenia; wpisy dodane przez partnera są widoczne, ale nie do usunięcia.
- **ID zmiany:** `expense-delete`
- **Odniesienia do PRD:** FR-007
- **Wymagania wstępne:** S-01
- **Równolegle z:** S-03, S-04
- **Blokady:** —
- **Niewiadome:** —
- **Ryzyko:** Prosta implementacja UI + endpoint DELETE; RLS z F-01 musi egzekwować `created_by = auth.uid()` na poziomie bazy — nie tylko w logice aplikacji. Brak tej polityki = możliwość usunięcia cudzego wydatku przez bezpośrednie zapytanie API.
- **Status:** proposed

### S-03: Synchronizacja w czasie rzeczywistym

- **Wynik:** wydatek dodany przez partnera pojawia się na liście użytkownika w < 3 sekundy bez ręcznego odświeżania strony.
- **ID zmiany:** `realtime-sync`
- **Odniesienia do PRD:** NFR: Sync < 3s, §Guardrails: Instant sync
- **Wymagania wstępne:** S-01
- **Równolegle z:** S-02, S-04
- **Blokady:** —
- **Niewiadome:**
  - Mechanizm synchronizacji: polling (`setInterval` co 2–3s, zgodny z `tech-stack.md: has_realtime: false`) czy Supabase Realtime (dostępne addytywnie, nie w tech-stack)? — Właściciel: developer. Blokada: nie (polling jest domyślną ścieżką pasującą do tech-stack i małej skali; decyzja przed implementacją, nie blokuje planowania S-03).
- **Ryzyko:** `tech-stack.md` deklaruje `has_realtime: false` — polling jest prostszą ścieżką zgodną z celem `speed`; Supabase Realtime można dodać addytywnie w v2 bez zamiany stosu.
- **Status:** done

### S-04: Podsumowanie per kategoria

- **Wynik:** użytkownik może zobaczyć ekran podsumowania z łączną kwotą wydatków per kategoria dla bieżącego miesiąca (np. Jedzenie: 400 zł, Transport: 120 zł).
- **ID zmiany:** `category-summary`
- **Odniesienia do PRD:** FR-008
- **Wymagania wstępne:** S-01
- **Równolegle z:** S-02, S-03
- **Blokady:** —
- **Niewiadome:** —
- **Ryzyko:** Nice-to-have; przy celu `speed` wdrażać dopiero po zamknięciu S-02 i S-03 (must-have). Proste grupowanie SQL `GROUP BY category` — niskie ryzyko techniczne.
- **Status:** done

### S-05: Porównanie miesiąc do miesiąca

- **Wynik:** użytkownik widzi wizualne oznaczenie (ikona + % delta) przy kategoriach, których suma wzrosła o > 20% w stosunku do poprzedniego miesiąca; w pierwszym miesiącu użytkowania — tylko wartości, bez oznaczeń.
- **ID zmiany:** `monthly-comparison`
- **Odniesienia do PRD:** FR-008, §Business Logic
- **Wymagania wstępne:** S-04
- **Równolegle z:** —
- **Blokady:** —
- **Niewiadome:**
  - Co oznacza wzrost, gdy dana kategoria nie miała wydatków w poprzednim miesiącu (suma = 0)? Flagować jako +∞% czy pominąć flagę? — Właściciel: użytkownik. Blokada: tak (logika obliczeń wymaga jednoznacznej definicji tego edge case'u).
- **Ryzyko:** Nice-to-have; PRD opisuje edge case „pierwszego miesiąca" (tylko wartości, bez flag) — implementacja musi rozróżnić „brak danych za poprzedni miesiąc w ogóle" od „suma = 0 w poprzednim miesiącu dla danej kategorii".
- **Status:** blocked

## Przekazanie do backlogu

| ID mapy drogowej | ID zmiany              | Sugerowany tytuł problemu                                              | Gotowe do `/10x-plan` | Uwagi                                                          |
|------------------|------------------------|------------------------------------------------------------------------|-----------------------|----------------------------------------------------------------|
| F-01             | expense-data-schema    | Utwórz migracje Supabase: budgets, budget_members, expenses + RLS      | yes                   | Uruchom `/10x-plan expense-data-schema`                       |
| S-01             | shared-expense-flow    | Wspólna lista wydatków: invite code + expense CRUD + lista miesięczna  | no                    | Blokada: zatwierdź listę kategorii (Otwarte pytanie #1)       |
| S-02             | expense-delete         | Usuwanie własnego wydatku z potwierdzeniem                             | no                    | Czeka na S-01                                                  |
| S-03             | realtime-sync          | Synchronizacja listy < 3s bez odświeżania                              | no                    | Czeka na S-01; zdecyduj polling vs Supabase Realtime          |
| S-04             | category-summary       | Podsumowanie wydatków per kategoria (bieżący miesiąc)                  | no                    | Nice-to-have; czeka na S-01                                    |
| S-05             | monthly-comparison     | Oznaczenia wzrostu kategorii > 20% MoM                                 | no                    | Nice-to-have; blokada: edge case zero-wydatki (Otwarte pytanie #3) |

## Otwarte pytania dotyczące mapy drogowej

1. **Jakie kategorie znajdą się na predefiniowanej liście?** (liczba i nazwy) — Właściciel: użytkownik. Blokada: S-01 (gwiazda przewodnia; formularz dodawania wydatku nie może być zaplanowany bez tej decyzji).
2. **Czytelność listy przy skali** — przy 30–50 wpisach miesięcznie lista chronologiczna bez filtrów może być trudna do skanowania; czy MVP grupuje wpisy według dnia czy stronicuje? — Właściciel: użytkownik. Blokada: nie blokuje v1 (z PRD §Open Questions #1).
3. **Edge case zerowych wydatków w poprzednim miesiącu** — reguła 20% jest nieokreślona gdy poprzedni miesiąc nie miał wydatków w danej kategorii; flagować +∞% czy pominąć flagę? — Właściciel: użytkownik. Blokada: S-05 (z PRD §Open Questions + §Business Logic constraint).

## Zaparkowane

- **Integracja bankowa** — Dlaczego zaparkowane: PRD §Non-Goals: wydatki są wprowadzane ręcznie; automatyczny import z kont bankowych lub aplikacji płatniczych poza zakresem MVP.
- **Planowanie budżetu** — Dlaczego zaparkowane: PRD §Non-Goals: aplikacja śledzi tylko rzeczywiste wydatki; limity miesięczne i porównanie plan-vs-rzeczywistość poza zakresem.
- **Edycja wydatku** — Dlaczego zaparkowane: PRD §Non-Goals: korekta = usuń i dodaj ponownie; formularz edycji in-place poza zakresem.
- **Historia dłuższa niż dwa miesiące** — Dlaczego zaparkowane: PRD §Non-Goals: reguła MoM wymaga tylko bieżącego i poprzedniego miesiąca; starsze dane nie są wyświetlane w MVP.

## Zrobione

- **S-01: Wspólna lista wydatków** — Zarchiwizowano 2026-06-05 → `context/archive/2026-05-28-shared-expense-flow/`. Lekcja: —.
- **S-03: Synchronizacja w czasie rzeczywistym** — Zarchiwizowano 2026-06-05 → `context/archive/2026-06-02-realtime-sync/`. Lekcja: —.
- **F-01: (fundament) Schemat danych wydatków** — Zarchiwizowano 2026-06-05 → `context/archive/2026-05-28-expense-data-schema/`. Lekcja: —.
- **S-04: Podsumowanie per kategoria** — Zarchiwizowano 2026-06-05 → `context/archive/2026-06-02-category-summary/`. Lekcja: —.
