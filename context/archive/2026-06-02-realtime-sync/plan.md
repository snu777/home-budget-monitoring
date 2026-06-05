# Real-time Expense List Sync — Plan implementacji

## Przegląd

Zmniejszenie interwału pollingu listy wydatków z 5s do 2.5s, aby spełnić wymaganie NFR z PRD: "an expense added by one partner appears for the other in < 3 seconds, without manual refresh." Infrastruktura pollingu istnieje od S-01 — zmiana ogranicza się do jednego pliku.

## Analiza stanu obecnego

- `ExpenseDashboard.tsx:202-209` — `setInterval(fetchExpenses, 5000)` z cleanup w `useEffect`
- Polling działa poprawnie (potwierdzone w S-01 faza 3, krok 3.5)
- Błędy sieci są cicho ignorowane (`catch(() => {})` w `fetchExpenses`) — celowe dla MVP
- `GET /api/expenses` wykonuje 2 zapytania do Supabase (membership + expenses) — szybkie przy obecnej skali
- `tech-stack.md: has_realtime: false` — Supabase Realtime de-scoped; polling jest zalecaną ścieżką

### Kluczowe odkrycia:

- Interwał 5000ms jest zahardkodowany inline w `setInterval` call (`ExpenseDashboard.tsx:204`)
- Przy 2.5s interwale: ~1440 req/h per user (vs 720 przy 5s) — pomijalne dla 2 użytkowników na Cloudflare Workers
- Brak potrzeby zmian w API, schemacie bazy, ani innych komponentach

## Pożądany stan końcowy

Po zakończeniu planu: wydatek dodany/usunięty przez partnera pojawia się na liście drugiego użytkownika w < 3 sekundy bez ręcznego odświeżania. Interwał pollingu jest wyodrębniony jako nazwana stała `POLL_INTERVAL_MS` dla czytelności.

## Czego NIE robimy

- Brak Supabase Realtime (WebSocket) — polling wystarczy przy skali 2 użytkowników
- Brak wskaźnika "last synced" w UI — sync ma być niewidoczny
- Brak bannera błędu przy awarii pollingu — cicha obsługa jak w S-01
- Brak Page Visibility API (pause gdy tab ukryty) — uproszczenie dla MVP
- Brak zmian w API endpoint ani w schemacie bazy danych

## Podejście do implementacji

Jedna faza: wyodrębnij interwał pollingu jako nazwaną stałą, zmień wartość z 5000 na 2500ms. Zweryfikuj automatycznie (lint + build) i ręcznie (dwa okna przeglądarki, pomiar czasu sync).

## Faza 1: Szybszy polling

### Przegląd

Wyodrębnij `POLL_INTERVAL_MS = 2500` jako nazwaną stałą na górze `ExpenseDashboard.tsx` i użyj jej w `setInterval`. To jedyna zmiana w kodzie.

### Wymagane zmiany:

#### 1. Stała interwału pollingu i użycie w setInterval

**Plik**: `src/components/expenses/ExpenseDashboard.tsx`

**Cel**: Wyodrębnić magic number 5000 jako nazwaną stałą `POLL_INTERVAL_MS = 2500` i użyć jej w `setInterval` call, aby spełnić NFR <3s sync.

**Kontrakt**: Dodaj `const POLL_INTERVAL_MS = 2500;` na poziomie modułu (po importach, przed interfejsami). Zmień `setInterval(fetchExpenses, 5000)` na `setInterval(fetchExpenses, POLL_INTERVAL_MS)`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint` przechodzi bez błędów
- `npm run build` przechodzi (brak błędów TypeScript)

#### Weryfikacja ręczna:

- Otwórz dwie sesje przeglądarki (dwóch użytkowników w tym samym budżecie); dodaj wydatek w jednej — pojawia się w drugiej w < 3 sekundy bez ręcznego odświeżenia
- Otwórz dwie sesje; usuń wydatek w jednej — znika z drugiej w < 3 sekundy
- Brak regresji: optimistic update nadal działa (dodanie wydatku pojawia się natychmiast lokalnie)
- Brak regresji: usuwanie wydatku z AlertDialog nadal działa

**Uwaga implementacyjna**: Po zakończeniu tej fazy i pomyślnym przejściu wszystkich automatycznych weryfikacji, zatrzymaj się na ręczne potwierdzenie od człowieka, że testy ręczne zakończyły się sukcesem, zanim przejdziesz do commitu.

---

## Strategia testowania

### Testy automatyczne:

- `npm run lint` — weryfikacja zgodności kodu
- `npm run build` — weryfikacja TypeScript i poprawności buildu

### Kroki testowania ręcznego:

1. Zaloguj się jako użytkownik A (ma budżet) → dashboard z listą wydatków
2. Otwórz incognito/inny browser jako użytkownik B (partner w tym samym budżecie)
3. W oknie A: dodaj wydatek "Jedzenie 15.00" → pojawia się natychmiast (optimistic)
4. W oknie B: zmierz czas — wydatek powinien pojawić się w < 3s bez odświeżenia
5. W oknie B: usuń jeden ze swoich wydatków → w oknie A znika w < 3s
6. Sprawdź DevTools → Network tab: requesty GET /api/expenses co ~2.5s

## Uwagi dotyczące wydajności

Polling co 2.5s generuje ~1440 req/h per użytkownika (vs ~720 przy 5s). Przy 2 użytkownikach i Cloudflare Workers to pomijalne obciążenie. Każdy request to 2 zapytania do Supabase (membership lookup + expenses select) z istniejącymi indeksami.

## Referencje

- Roadmapa: `context/foundation/roadmap.md` (S-03)
- PRD NFR: `context/foundation/prd.md` — "Sync: < 3 seconds"
- S-01 plan: `context/changes/shared-expense-flow/plan.md` — polling infrastructure
- Komponent: `src/components/expenses/ExpenseDashboard.tsx:202-209`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dodaj ` — <commit sha>`, gdy krok zostanie zrealizowany. Nie zmieniaj nazw tytułów kroków.

### Faza 1: Szybszy polling

#### Automatyczne

- [x] 1.1 `npm run lint` przechodzi bez błędów — 22d9153
- [x] 1.2 `npm run build` przechodzi (brak błędów TypeScript) — 22d9153

#### Ręczne

- [x] 1.3 Wydatek dodany przez partnera pojawia się w < 3s bez odświeżenia — 22d9153
- [x] 1.4 Wydatek usunięty przez partnera znika w < 3s bez odświeżenia — 22d9153
- [x] 1.5 Brak regresji: optimistic update i usuwanie nadal działają — 22d9153
