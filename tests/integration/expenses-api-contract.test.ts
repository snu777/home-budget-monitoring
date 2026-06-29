import type { APIRoute } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeContext, makeFakeSupabase, type FakeClient, type SupabaseScript } from "./helpers/api-context";

// Risk #4 — untrusted input + error disclosure at the API boundary.
//
// ORACLE DISCIPLINE: every expectation below is derived from the product rule,
// never from the handler's own implementation. Amount bounds come from PRD
// §Business Logic / FR-005; the category set is the PRD's predefined list
// (asserted with literal good/bad values — this file never imports
// EXPENSE_CATEGORIES or the handler's regex). The 500-body expectation is the
// security contract ("no schema / internal text"), not the current string.
//
// MECHANISM: mock only the external edge (`@/lib/supabase`). The factory returns
// a scriptable fake client and never imports the real module, so the route's
// `astro:env/server` dependency is never evaluated in the Node runner.

const mockState = vi.hoisted(() => ({ client: null as FakeClient | null }));

vi.mock("@/lib/supabase", () => ({
  createClient: () => mockState.client,
}));

// vi.mock is hoisted above this import, so the handler binds to the mocked factory.
import { DELETE, GET, POST, PUT } from "@/pages/api/expenses";

interface ParsedBody {
  error?: string;
  expense?: unknown;
  expenses?: unknown;
  success?: boolean;
}

/** Point the mocked `createClient` at a fresh fake client for this test. */
function useSupabase(script: SupabaseScript = {}) {
  const fake = makeFakeSupabase(script);
  mockState.client = fake.client;
  return fake;
}

async function call(
  handler: APIRoute,
  ctx: ReturnType<typeof makeContext>,
): Promise<{ status: number; body: ParsedBody }> {
  const res = await handler(ctx);
  const body = (await res.json()) as ParsedBody;
  return { status: res.status, body };
}

/** A valid POST body — individual tests override one field to make it invalid. */
function validExpense(overrides: Record<string, unknown> = {}) {
  return { amount: 42.5, category: "Jedzenie", expense_date: "2026-06-15", ...overrides };
}

beforeEach(() => {
  mockState.client = null;
});

describe("POST /api/expenses — input validation (server-side, regardless of client)", () => {
  it("rejects a non-number amount with 400", async () => {
    useSupabase();
    const { status, body } = await call(POST, makeContext({ method: "POST", body: validExpense({ amount: "50" }) }));
    expect(status).toBe(400);
    expect(body.error).toBe("Invalid amount");
  });

  it("rejects amount <= 0 with 400", async () => {
    useSupabase();
    for (const amount of [0, -5]) {
      const { status, body } = await call(POST, makeContext({ method: "POST", body: validExpense({ amount }) }));
      expect(status).toBe(400);
      expect(body.error).toBe("Invalid amount");
    }
  });

  it("rejects amount over the 1,000,000 ceiling with 400", async () => {
    useSupabase();
    const { status, body } = await call(
      POST,
      makeContext({ method: "POST", body: validExpense({ amount: 1_000_001 }) }),
    );
    expect(status).toBe(400);
    expect(body.error).toBe("Amount too large");
  });

  it("accepts a sub-cent amount and rounds it to two decimal places before insert", async () => {
    const fake = useSupabase();
    // Rule: amounts are stored at cent precision. 7.128 → 7.13 (nearest cent).
    const { status } = await call(POST, makeContext({ method: "POST", body: validExpense({ amount: 7.128 }) }));
    expect(status).toBe(201);
    expect(fake.captured.insertedExpense?.amount).toBe(7.13);
  });

  it("rejects a category outside the predefined list with 400", async () => {
    useSupabase();
    const { status, body } = await call(
      POST,
      makeContext({ method: "POST", body: validExpense({ category: "NotACategory" }) }),
    );
    expect(status).toBe(400);
    expect(body.error).toBe("Invalid category");
  });

  it("rejects malformed or impossible dates with 400", async () => {
    useSupabase();
    for (const expense_date of ["2026-13-40", "not-a-date", "06/15/2026"]) {
      const { status, body } = await call(POST, makeContext({ method: "POST", body: validExpense({ expense_date }) }));
      expect(status).toBe(400);
      expect(body.error).toBe("Invalid date");
    }
  });

  it("rejects a missing date with 400", async () => {
    useSupabase();
    const { status, body } = await call(
      POST,
      makeContext({ method: "POST", body: { amount: 10, category: "Jedzenie" } }),
    );
    expect(status).toBe(400);
    expect(body.error).toBe("Invalid date");
  });

  it("rejects a non-JSON body with 400", async () => {
    useSupabase();
    const { status, body } = await call(POST, makeContext({ method: "POST", rawBody: "{not valid json" }));
    expect(status).toBe(400);
    expect(body.error).toBe("Invalid JSON");
  });

  it("accepts a fully valid expense with 201", async () => {
    useSupabase();
    const { status, body } = await call(POST, makeContext({ method: "POST", body: validExpense() }));
    expect(status).toBe(201);
    expect(body.expense).toBeDefined();
  });
});

describe("auth / authorization gates", () => {
  it("returns 401 when the client cannot be constructed (no env / no session)", async () => {
    mockState.client = null;
    const { status } = await call(GET, makeContext());
    expect(status).toBe(401);
  });

  it("returns 401 when there is no authenticated user", async () => {
    useSupabase({ user: null });
    const { status } = await call(POST, makeContext({ method: "POST", body: validExpense() }));
    expect(status).toBe(401);
  });

  it("returns 403 on POST when the user belongs to no budget", async () => {
    useSupabase({ membership: null });
    const { status, body } = await call(POST, makeContext({ method: "POST", body: validExpense() }));
    expect(status).toBe(403);
    expect(body.error).toBe("No budget");
  });

  it("returns an empty list on GET when the user belongs to no budget", async () => {
    useSupabase({ membership: null });
    const { status, body } = await call(GET, makeContext());
    expect(status).toBe(200);
    expect(body.expenses).toEqual([]);
  });
});

describe("error disclosure — 5xx bodies carry no schema / internal text", () => {
  // A realistic raw PostgREST message: it embeds the constraint and column name.
  const leakyError = {
    message: 'duplicate key value violates unique constraint "expenses_pkey"',
  };

  function assertNoLeak(body: ParsedBody) {
    expect(body.error).toBe("Internal server error");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("constraint");
    expect(serialized).not.toContain("violates");
    expect(serialized).not.toContain("expenses_pkey");
  }

  it("GET masks a DB error behind a generic 500", async () => {
    useSupabase({ expensesSelect: { data: null, error: leakyError } });
    const { status, body } = await call(GET, makeContext());
    expect(status).toBe(500);
    assertNoLeak(body);
  });

  it("POST masks a DB error behind a generic 500", async () => {
    useSupabase({ expensesInsert: { data: null, error: leakyError } });
    const { status, body } = await call(POST, makeContext({ method: "POST", body: validExpense() }));
    expect(status).toBe(500);
    assertNoLeak(body);
  });

  it("DELETE masks a DB error behind a generic 500", async () => {
    useSupabase({ expensesDelete: { count: null, error: leakyError } });
    const { status, body } = await call(
      DELETE,
      makeContext({ method: "DELETE", searchParams: { id: "garbage-not-a-uuid" } }),
    );
    expect(status).toBe(500);
    assertNoLeak(body);
  });
});

describe("DELETE /api/expenses — untrusted id input", () => {
  it("returns 400 when the id query param is missing", async () => {
    useSupabase();
    const { status, body } = await call(DELETE, makeContext({ method: "DELETE" }));
    expect(status).toBe(400);
    expect(body.error).toBe("Missing expense id");
  });

  it("returns 404 (clean body) when no row is deleted (not found or RLS-forbidden)", async () => {
    useSupabase({ expensesDelete: { count: 0, error: null } });
    const { status, body } = await call(
      DELETE,
      makeContext({ method: "DELETE", searchParams: { id: "00000000-0000-0000-0000-000000000000" } }),
    );
    expect(status).toBe(404);
    expect(body.error).toBe("Expense not found");
  });

  it("returns success when a row is deleted", async () => {
    useSupabase({ expensesDelete: { count: 1, error: null } });
    const { status, body } = await call(
      DELETE,
      makeContext({ method: "DELETE", searchParams: { id: "11111111-1111-1111-1111-111111111111" } }),
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

describe("PUT /api/expenses — edit own expense (CRUD Update)", () => {
  const ID = "11111111-1111-1111-1111-111111111111";

  it("returns 400 when the id query param is missing", async () => {
    useSupabase();
    const { status, body } = await call(PUT, makeContext({ method: "PUT", body: validExpense() }));
    expect(status).toBe(400);
    expect(body.error).toBe("Missing expense id");
  });

  it("enforces the same input contract as POST (regardless of client)", async () => {
    useSupabase();
    const cases: [Record<string, unknown>, string][] = [
      [{ amount: "50" }, "Invalid amount"],
      [{ amount: 0 }, "Invalid amount"],
      [{ amount: 1_000_001 }, "Amount too large"],
      [{ category: "NotACategory" }, "Invalid category"],
      [{ expense_date: "2026-13-40" }, "Invalid date"],
    ];
    for (const [override, expected] of cases) {
      const { status, body } = await call(
        PUT,
        makeContext({ method: "PUT", searchParams: { id: ID }, body: validExpense(override) }),
      );
      expect(status).toBe(400);
      expect(body.error).toBe(expected);
    }
  });

  // Risk #3 (IDOR), Update variant: RLS scopes the UPDATE to the caller's own
  // rows, so editing another user's / another budget's expense matches no rows.
  // A clean 404 — not a 200 — must come back, and nothing is disclosed.
  it("returns 404 when the update matches no row (not owned / not found)", async () => {
    useSupabase({ expensesUpdate: { data: [], error: null } });
    const { status, body } = await call(
      PUT,
      makeContext({ method: "PUT", searchParams: { id: ID }, body: validExpense() }),
    );
    expect(status).toBe(404);
    expect(body.error).toBe("Expense not found");
  });

  it("updates an owned row and rounds the amount to cents before write", async () => {
    const fake = useSupabase({ expensesUpdate: { data: [{ id: ID }], error: null } });
    const { status, body } = await call(
      PUT,
      makeContext({ method: "PUT", searchParams: { id: ID }, body: validExpense({ amount: 7.128 }) }),
    );
    expect(status).toBe(200);
    expect(body.expense).toBeDefined();
    expect(fake.captured.updatedExpense?.amount).toBe(7.13);
  });

  it("masks a DB error behind a generic 500", async () => {
    useSupabase({ expensesUpdate: { data: null, error: { message: 'violates constraint "expenses_pkey"' } } });
    const { status, body } = await call(
      PUT,
      makeContext({ method: "PUT", searchParams: { id: ID }, body: validExpense() }),
    );
    expect(status).toBe(500);
    expect(body.error).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("constraint");
  });
});
