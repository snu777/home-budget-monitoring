# Real-time Expense List Sync — Krótki plan

> Pełny plan: `context/changes/realtime-sync/plan.md`

## Co i dlaczego

Zmniejszamy interwał pollingu listy wydatków z 5s do 2.5s, aby spełnić wymaganie PRD NFR: "an expense added by one partner appears for the other in < 3 seconds, without manual refresh." S-01 wdrożyło polling jako uproszczenie; S-03 dostosowuje go do docelowego progu.

## Punkt wyjścia

`ExpenseDashboard.tsx` ma działający polling co 5s (z `setInterval`) — infrastruktura z S-01. Interwał 5000ms jest zahardkodowany inline. Błędy sieci są cicho ignorowane, co jest celowe dla MVP.

## Pożądany stan końcowy

Wydatek dodany lub usunięty przez partnera pojawia się/znika na liście drugiego użytkownika w < 3 sekundy bez ręcznego odświeżania. Interwał pollingu jest wyodrębniony jako nazwana stała `POLL_INTERVAL_MS`.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) |
|---------|-------|---------------------|
| Mechanizm sync | Szybszy polling (2.5s) | Supabase Realtime to overkill dla 2 użytkowników; polling już istnieje z S-01 |
| Wskaźnik sync w UI | Brak | PRD mówi "instant sync" — powinno być niewidoczne |
| Obsługa błędów pollingu | Cicha (bez zmian) | Następny udany poll self-healuje; MVP nie potrzebuje bannera |
| Styl kodu | Nazwana stała POLL_INTERVAL_MS | Self-documenting, łatwe do znalezienia i dostrojenia |

## Zakres

**W zakresie:** Zmiana interwału pollingu z 5s na 2.5s, ekstrakcja stałej

**Poza zakresem:** Supabase Realtime, wskaźnik sync, Page Visibility API, banner błędu, zmiany API/bazy

## Architektura / Podejście

Jedna zmiana w jednym pliku: wyodrębnij `POLL_INTERVAL_MS = 2500` jako stałą modułową w `ExpenseDashboard.tsx` i użyj w istniejącym `setInterval`. Brak nowych zależności, komponentów ani endpointów.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|------|-------------|-----------------|
| 1. Szybszy polling | Sync < 3s via 2.5s polling interval | Brak istotnego ryzyka — zmiana jednej wartości |

**Wymagania wstępne:** S-01 (shared-expense-flow) zaimplementowane — polling działa
**Szacowany nakład pracy:** ~1 sesja, 1 faza

## Otwarte ryzyka i założenia

- Przy przyszłym wzroście użytkowników (>10) polling 2.5s może generować istotne obciążenie — wtedy warto rozważyć Supabase Realtime (ale to poza MVP)

## Kryteria sukcesu (podsumowanie)

- Wydatek dodany przez partnera widoczny w < 3s bez odświeżenia
- Wydatek usunięty przez partnera znika w < 3s bez odświeżenia
- Brak regresji w istniejącej funkcjonalności (optimistic update, delete)
