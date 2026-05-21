---
project: home-budget-monitoring
researched_at: 2026-05-20
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 SSR
  runtime: Cloudflare Workers (workerd)
  database: Supabase (external)
  adapter: "@astrojs/cloudflare v13+"
---

## Rekomendacja

**Wdróż na Cloudflare Workers.**

Projekt jest już skonfigurowany pod Workers runtime (`wrangler.jsonc`, adapter `@astrojs/cloudflare` v13+) — żadna zmiana adaptera ani konfiguracji nie jest wymagana przed pierwszym deployem. Cloudflare uzyskało najwyższy wynik (10/10) w matrycy: `wrangler` CLI obsługuje deploy/rollback/logi bez GUI, 100K żądań dziennie mieści się w free tierze, dokumentacja jest dostępna jako `llms.txt` (GA) i agentowi-czytelne markdown, a serwer MCP (GA od kwietnia 2026) umożliwia operacje na platformie bezpośrednio z Claude Code. Deweloper nie posiada silnej znajomości żadnej z platform na liście (podana AWS nie była kandydatem), więc premia za znajomość nie zmienia rankingu — wynik jest zdominowany przez zerowy koszt migracji adaptera.

## Porównanie platform

### Matryca punktacji

| Platforma | CLI-first | Managed / Serverless | Docs dla agenta | Stabilne API deploy | MCP / Integracja | Adapter | Łącznie |
|---|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | Zero change | **10/10** |
| Vercel | Pass | Pass | Pass | Pass | Partial | Swap | **9/10** |
| Netlify | Pass | Pass | Pass | Partial | Pass | Swap | **8/10** |
| Railway | Pass | Partial | Pass | Partial | Partial | Swap + host fix | **6/10** |
| Render | Pass | Partial | Pass | Partial | Pass | Swap + HOST env | **6/10** |
| Fly.io | Partial | Partial | Fail | Partial | Partial | Swap + Dockerfile | **4/10** |

**Twarde filtry zastosowane przed punktacją:**
- Brak wymagania trwałych połączeń → żadna platforma nie odpada na tym kryterium
- `@astrojs/cloudflare` adapter + `wrangler.jsonc` już w projekcie → Fly.io / Railway / Render wymagają zamiany adaptera na `@astrojs/node` plus konfigurację hosta lub Dockerfile; koszty migracji wliczone w ocenę

**Wagi z wywiadu:**
- Pytanie 1 (brak persistent connections): neutral — żadna platforma nie odpada
- Pytanie 2 (cost vs DX: równo): bez kary za umiarkowany koszt
- Pytanie 3 (AWS znajomość): remisy rozstrzyga platforma bez zmiany adaptera
- Pytanie 4 (jeden region): przewaga edge-native Cloudflare zmniejszona, ale zero-adapter-change pozostaje kluczowe
- Pytanie 5 (co-location: nie wiem): Supabase już zewnętrzne, neutral

### Platformy na krótkiej liście

#### 1. Cloudflare Workers (Zalecana)

Natywny runtime projektu — `wrangler.jsonc` i `@astrojs/cloudflare` v13+ są już skonfigurowane. `wrangler deploy` / `wrangler rollback` / `wrangler tail` pokrywają pełny cykl operacyjny bez GUI. Free tier: 100K żądań/dzień (ok. 3M/miesiąc) — w zakresie MVP dla 2 użytkowników to nigdy nie zostanie przekroczone. Cloudflare publikuje `llms.txt` (GA) i serwer MCP (GA, kwiecień 2026) dla Claude Code. `@astrojs/cloudflare` v13 porzucił Pages na rzecz Workers — `wrangler.jsonc` w projekcie potwierdza poprawną ścieżkę.

#### 2. Vercel

Doskonały DX, Astro 6 SSR GA przez `@astrojs/vercel` (v10.0.7), `llms.txt` + `.md` docs dostępne. MCP server istnieje, ale jest na razie read-only (brak operacji zapisu, status: initial GA release, 2026-05-20). Aktywny bug esbuild #16258 w Astro 6 preview builds (workaround dostępny, bug otwarty w maju 2026). Wymaga zamiany adaptera. Wchodzi w grę, gdyby Cloudflare okazał się zbyt ograniczający dla przyszłych funkcji.

#### 3. Netlify

Astro 6 GA przez `@astrojs/netlify` v7 (od 2026-03-10), MCP server (GA), `llms.txt` (GA). Słabość: rollback jest wyłącznie przez UI (brak CLI), a nowy model rozliczenia na kredyty (po 2025-09-04) jest mało przejrzysty — 300 kredytów/miesiąc na free tierze dzieli się między requesty, deploje i compute. Netlify DB (Postgres oparty na Neon) dostępna, ale model rozliczeniowy w przejściu (billing storage od 2026-07-01). Wymaga zamiany adaptera.

## Weryfikacja krzyżowa anty-uprzedzeniowa: Cloudflare Workers

### Adwokat diabła — Słabe strony

1. **Sprzeczność Pages vs Workers w projekcie**: `tech-stack.md` zawiera `deployment_target: cloudflare-pages`, ale `@astrojs/cloudflare` v13 porzucił Pages — projekt wymaga aktualizacji tej dokumentacji i zrozumienia różnicy przed skonfigurowaniem CI
2. **CPU limit 10ms na free tier**: middleware Supabase parsujące JWT na każdym żądaniu może zbliżać się do limitu CPU *time* (nie wall-clock); sporadyczne przekroczenia nie dają jasnego komunikatu — objawiają się jako 500 bez stack trace w `wrangler tail`
3. **KV eventual consistency (do 60s)**: jeśli w przyszłości KV będzie użyte do cache'owania, zapisy nie są natychmiast widoczne globalnie — pułapka zaznaczona w dokumentacji, ale łatwa do przeoczenia przy projektowaniu
4. **CommonJS dependencies w workerd**: biblioteki używające `require()` / `module.exports` wymagają `vite.ssr.optimizeDeps.include` — brak konfiguracji manifestuje się jako kryptyczny błąd Vite, nie jako jasny komunikat o niezgodności runtime
5. **`wrangler rollback` nie cofa migracji bazy**: rollback Workers przywraca kod, ale migracje Supabase SQL są nieodwracalne przez `wrangler` — przy złej migracji potrzebny ręczny SQL; brak wbudowanego runbooka "rollback = kod + baza"

### Pre-mortem — Jak to mogło się nie udać

Pierwsze dwa tygodnie po deployu na Cloudflare Workers przebiegają sprawnie — dwa konta testowe, niski ruch. Problemy zaczynają się przy dodaniu Supabase middleware na każdym chronionym żądaniu: JWT parsing + `getSession()` regularnie przekracza 10ms CPU time na free tierze. Logi `wrangler tail` pokazują 500 bez stack trace — debugowanie trwa dwa dni, zanim CPU limit zostaje zidentyfikowany jako przyczyna. Przeniesienie na plan płatny ($5/miesiąc) rozwiązuje problem, ale pojawia się nowy: CI pipeline skonfigurowany przez "wklejenie przykładu z dokumentacji" używał starych komend Cloudflare Pages, podczas gdy `wrangler.jsonc` celuje w Workers — przez tydzień istnieją dwa równoległe wdrożenia do różnych produktów. Następnie instalacja biblioteki do formatowania dat, która wewnętrznie używa `require()`, powoduje nieprzejrzysty błąd Vite; debugowanie zajmuje trzy godziny (fix: `vite.ssr.optimizeDeps.include`). Kulminacja: zła migracja SQL wysłana do Supabase, `wrangler rollback` przywraca Worker, ale schemat bazy pozostaje zmigrowany — przez godzinę nowy Worker pracuje ze starym kodem oczekując starego schematu. Incydent ujawnia brak runbooka łączącego rollback kodu z rollback bazy.

### Nieznane niewiadome

1. **`wrangler.jsonc` vs `wrangler.toml`**: większość przykładów w dokumentacji i tutorialach używa formatu `.toml` — kopiowanie snippet'ów wymaga konwersji składni; parser `.jsonc` nie daje błędu przy literówce w komentarzu JSON
2. **Flaga kompatybilności `nodejs_compat` dla Supabase**: klient `@supabase/supabase-js` używa Node.js API (np. `crypto`, `TextEncoder`) — bez `compatibility_flags = ["nodejs_compat"]` w `wrangler.jsonc` autoryzacja może zawieść z mylącym błędem runtime
3. **`astro:env/server` + Cloudflare bindings — podwójna deklaracja**: zmienne muszą być zadeklarowane JEDNOCZEŚNIE w sekcji `vars` / `secrets` `wrangler.jsonc` ORAZ w schemacie `astro:env` w `astro.config.mjs` — pominięcie jednej strony daje komunikat "zmienna niezdefiniowana", nie "zła konfiguracja"
4. **Cron Triggers jako jedyna droga do background jobs**: gdy PRD v2 wprowadzi miesięczne raporty, Workers nie ma modelu persistent process — jedyną opcją są Cloudflare Cron Triggers (inne API, osobna konfiguracja w `wrangler.jsonc`)
5. **Breaking changes w `@astrojs/cloudflare`**: v13 złamał Pages support bez automatycznej ścieżki migracji; projekt jest silnie powiązany z jednym adapterem — przyszłe major wersje mogą wymagać podobnych przeglądów konfiguracji

## Historia operacyjna

- **Wdrożenia podglądowe**: `wrangler versions upload` tworzy nową wersję Workera bez wdrożenia na ruch produkcyjny; URL podglądu nie jest automatyczny jak w Vercel — weryfikacja przed pushem do produkcji wymaga `wrangler versions deploy` z gradualnym procentem lub ręcznego testu. Zalecane: Cloudflare Access na środowisku staging, jeśli dane są wrażliwe.
- **Sekrety**: `wrangler secret put SUPABASE_URL` / `wrangler secret put SUPABASE_KEY` przechowuje sekrety w Workers Secrets (zaszyfrowane, niewidoczne nawet przez CLI po zapisaniu). W CI: zmienne ustawiane jako GitHub Secrets i przekazywane przez `wrangler deploy --var NAME:$VALUE` lub przez Cloudflare dashboard → Settings → Variables. Rotacja: `wrangler secret put` nadpisuje istniejący secret.
- **Wycofywanie**: `wrangler rollback` (bez argumentu) przywraca poprzednią wersję; `wrangler rollback <deployment-id>` — konkretną. Czas przywrócenia: sekundy (bez rebuildu). **Uwaga krytyczna**: rollback Workers nie cofa migracji SQL w Supabase — przy złej migracji wymagany ręczny SQL `ALTER TABLE` lub `DROP` przed lub po rollback Workers.
- **Zatwierdzanie**: `wrangler deploy` do produkcji może wykonać agent bez nadzoru (jest deterministyczny). Operacje wymagające człowieka: pierwsze ustawienie sekretu (`wrangler secret put`), zmiana planu rozliczeniowego, usunięcie Workera. Gradualny rollout (`wrangler versions deploy`) — agent może wykonać, ale rekomendowane zatwierdzenie przez człowieka przy pierwszym użyciu.
- **Logi**: `wrangler tail` streamuje logi na żywo; `wrangler tail --status error` filtruje błędy; `wrangler tail --search "supabase"` szuka po treści. Retencja logów na free tierze: brak trwałego przechowywania — logi dostępne tylko podczas aktywnej sesji `wrangler tail`. Trwałe logi: Workers Logpush (GA, wymaga planu płatnego).

## Rejestr ryzyka

| Ryzyko | Źródło | Prawdopodobieństwo | Wpływ | Łagodzenie |
|---|---|---|---|---|
| CPU limit 10ms przekroczony przez Supabase middleware | Adwokat diabła | Średnie | Wysoki | Zmierz CPU time w dev via `wrangler tail`; upgrade do $5/mo planu jeśli potrzeba 30s CPU |
| `wrangler rollback` bez cofnięcia migracji SQL | Adwokat diabła | Niskie | Wysoki | Napisz runbook: deploy = `wrangler deploy` + Supabase migration; rollback = `wrangler rollback` + ręczny SQL revert |
| CommonJS dependency w workerd (brak `require()`) | Nieznane niewiadome | Średnie | Średni | Dodaj `vite.ssr.optimizeDeps.include` dla znanych problematycznych pakietów; weryfikuj każdą nową zależność |
| `nodejs_compat` flag brakuje → Supabase auth fail | Nieznane niewiadome | Wysokie | Wysoki | Dodaj `compatibility_flags = ["nodejs_compat"]` do `wrangler.jsonc` przed pierwszym deployem |
| CI skonfigurowane na Pages zamiast Workers | Pre-mortem | Niskie | Średni | Zaktualizuj `tech-stack.md` `deployment_target` na `cloudflare-workers`; CI używa `wrangler deploy`, nie Pages CI |
| `astro:env/server` + brakujące bindings w `wrangler.jsonc` | Nieznane niewiadome | Średnie | Średni | Przy każdej nowej zmiennej: dodaj do `wrangler.jsonc` vars ORAZ do schematu `astro:env` jednocześnie |
| Breaking changes w `@astrojs/cloudflare` v14+ | Wynik badań | Niskie | Średni | Pin adapter version w `package.json`; przejrzyj CHANGELOG przed każdym major update |
| KV eventual consistency (60s lag) dla przyszłych features | Adwokat diabła | Niskie (MVP) | Niski | Nie używaj KV do session state; Supabase obsługuje sesje auth; KV tylko do cache read-heavy |

## Rozpoczęcie pracy

1. **Zweryfikuj konfigurację `wrangler.jsonc`** — sprawdź, czy `compatibility_flags` zawiera `"nodejs_compat"` (wymagane przez Supabase JS client); jeśli nie, dodaj przed deployem
2. **Ustaw sekrety**: `npx wrangler secret put SUPABASE_URL` → `npx wrangler secret put SUPABASE_KEY` (lub przez Cloudflare dashboard → Workers → Settings → Variables)
3. **Pierwszy deploy**: `npm run build && npx wrangler deploy` — weryfikuj przez `wrangler tail` w osobnym terminalu
4. **Ustaw CI**: w GitHub Actions dodaj `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` jako repository secrets; workflow: `npm run lint && npm run build && wrangler deploy`
5. **Zaktualizuj `tech-stack.md`**: zmień `deployment_target: cloudflare-pages` → `cloudflare-workers` (Pages support usunięty z adaptera v13)

## Poza zakresem

W niniejszych badaniach nie oceniano następujących kwestii:
- Konfiguracja obrazu Docker
- Konfiguracja potoku CI/CD (GitHub Actions workflow jest krokiem w deploymencie, nie tematem tych badań)
- Architektura na skalę produkcyjną (wiele regionów, HA, DR)
