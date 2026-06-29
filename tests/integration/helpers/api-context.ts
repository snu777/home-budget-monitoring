import type { APIContext } from "astro";

// Test scaffolding for Risk #4 contract tests on the JSON API route handlers.
//
// Unlike the RLS suite, these tests do NOT touch local Supabase. They drive the
// route handlers (`src/pages/api/expenses.ts`) directly with a hand-built
// context and a scriptable fake Supabase client, mocking ONLY the external edge
// (`@/lib/supabase`). Mocking that module also sidesteps the `astro:env/server`
// import that makes the real factory unusable in the Node test runner. This file
// intentionally does not import `./supabase` (whose top-level `requireEnv` would
// demand a running local Supabase).

/** A terminal query result, shaped like a PostgREST builder resolution. */
export interface QueryResult {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}

/** Per-test script controlling what the fake client returns at each call. */
export interface SupabaseScript {
  /** `auth.getUser()` user. `undefined` → a default authed user; `null` → unauthenticated. */
  user?: { id: string } | null;
  /** `budget_members` lookup. `undefined` → a default membership; `null` → no budget. */
  membership?: { budget_id: string } | null;
  /** GET `expenses` list resolution. */
  expensesSelect?: QueryResult;
  /** POST `expenses` insert resolution (`.single()`). */
  expensesInsert?: QueryResult;
  /** PUT `expenses` update resolution (`.select()` → `data` array). */
  expensesUpdate?: QueryResult;
  /** DELETE `expenses` resolution (with `count`). */
  expensesDelete?: QueryResult;
}

interface FakeBuilder {
  select: () => FakeBuilder;
  eq: () => FakeBuilder;
  gte: () => FakeBuilder;
  lte: () => FakeBuilder;
  order: () => FakeBuilder;
  insert: (payload: Record<string, unknown>) => FakeBuilder;
  update: (payload: Record<string, unknown>) => FakeBuilder;
  delete: () => FakeBuilder;
  single: () => Promise<QueryResult>;
  maybeSingle: () => Promise<QueryResult>;
  then: (onfulfilled: (value: QueryResult) => unknown) => Promise<unknown>;
}

export interface FakeClient {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: null }> };
  from: (table: string) => FakeBuilder;
}

export interface FakeSupabase {
  /** Pass as the value the mocked `createClient` returns (or set to `null` for the 401 path). */
  client: FakeClient;
  /** Captures payloads handed to `expenses.insert(...)` / `.update(...)` so tests can assert rounding etc. */
  captured: { insertedExpense?: Record<string, unknown>; updatedExpense?: Record<string, unknown> };
}

/**
 * Build a scriptable fake Supabase client matching the narrow surface the
 * expenses handlers use: `auth.getUser`, and a chainable thenable query builder
 * for `budget_members` and `expenses`.
 */
export function makeFakeSupabase(script: SupabaseScript = {}): FakeSupabase {
  const captured: { insertedExpense?: Record<string, unknown>; updatedExpense?: Record<string, unknown> } = {};
  const user = script.user === undefined ? { id: "user-1" } : script.user;
  const membership = script.membership === undefined ? { budget_id: "budget-1" } : script.membership;

  const client: FakeClient = {
    auth: {
      getUser: () => Promise.resolve({ data: { user }, error: null }),
    },
    from(table: string): FakeBuilder {
      let op: "select" | "insert" | "update" | "delete" = "select";

      const result = (): QueryResult => {
        if (table === "budget_members") return { data: membership, error: null };
        if (op === "insert") return script.expensesInsert ?? { data: { id: "exp-1" }, error: null };
        if (op === "update") return script.expensesUpdate ?? { data: [{ id: "exp-1" }], error: null };
        if (op === "delete") return script.expensesDelete ?? { count: 1, error: null };
        return script.expensesSelect ?? { data: [], error: null };
      };

      const builder: FakeBuilder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        lte: () => builder,
        order: () => builder,
        insert: (payload: Record<string, unknown>) => {
          op = "insert";
          if (table === "expenses") captured.insertedExpense = payload;
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          op = "update";
          if (table === "expenses") captured.updatedExpense = payload;
          return builder;
        },
        delete: () => {
          op = "delete";
          return builder;
        },
        single: () => Promise.resolve(result()),
        maybeSingle: () => Promise.resolve(result()),
        then: (onfulfilled) => Promise.resolve(result()).then(onfulfilled),
      };
      return builder;
    },
  };

  return { client, captured };
}

export interface MakeContextOptions {
  method?: string;
  /** JSON-serializable POST body. Mutually exclusive with `rawBody`. */
  body?: unknown;
  /** Raw request body string (e.g. malformed JSON). Mutually exclusive with `body`. */
  rawBody?: string;
  /** Query-string params, e.g. `{ id: "..." }` for DELETE or `{ month: "previous" }` for GET. */
  searchParams?: Record<string, string>;
}

/**
 * Build a minimal `APIContext` for invoking a route handler. The handler only
 * reads `request` (for `.json()`), `cookies` (handed to the mocked client, so
 * unused), and `url.searchParams`. Everything else is a typed stub.
 */
export function makeContext(opts: MakeContextOptions = {}): APIContext {
  const { method = "GET", body, rawBody, searchParams } = opts;

  const url = new URL("http://localhost/api/expenses");
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const init: RequestInit = { method };
  if (rawBody !== undefined) {
    init.body = rawBody;
    init.headers = { "Content-Type": "application/json" };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }

  const request = new Request(url, init);
  const cookies = {
    get: () => undefined,
    has: () => false,
    set: () => undefined,
    delete: () => undefined,
    merge: () => undefined,
    headers: () => [],
  };

  return { request, cookies, url } as unknown as APIContext;
}
