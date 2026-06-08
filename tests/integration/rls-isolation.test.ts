import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  createAuthedUser,
  createBudget,
  deleteUser,
  seedExpense,
  type AuthedUser,
} from "./helpers/supabase";

// Risk #1: prove the RLS read boundary. Two separate couples (A, B), each with
// their own budget + one expense. User B must never read any of A's rows; A
// must still read its own (positive control). The boundary lives entirely in
// `expenses_select_budget_members` / `budgets_select_members` — there is no
// app-layer budget_id filter — so this runs against real Postgres.
interface Couple {
  user: AuthedUser;
  budgetId: string;
  expenseId: string;
}

async function setupCouple(suffix: string): Promise<Couple> {
  const user = await createAuthedUser(suffix);
  const budgetId = await createBudget(user.client, `budget-${suffix}-${Date.now()}`);
  const expenseId = await seedExpense(user.client, { budgetId, createdBy: user.userId });
  return { user, budgetId, expenseId };
}

describe("Risk #1: cross-couple read isolation", () => {
  let coupleA: Couple | undefined;
  let coupleB: Couple | undefined;

  function getA(): Couple {
    if (!coupleA) throw new Error("coupleA was not initialized in beforeAll");
    return coupleA;
  }
  function getB(): Couple {
    if (!coupleB) throw new Error("coupleB was not initialized in beforeAll");
    return coupleB;
  }

  beforeAll(async () => {
    coupleA = await setupCouple("a");
    coupleB = await setupCouple("b");
  });

  afterAll(async () => {
    // Best-effort, idempotent teardown: clean up each user independently so a
    // single failed delete never blocks the other (cascades to budgets/expenses).
    const admin = adminClient();
    const userIds = [coupleA, coupleB].filter((c): c is Couple => c !== undefined).map((c) => c.user.userId);
    await Promise.allSettled(userIds.map((id) => deleteUser(admin, id)));
  });

  it("user B receives none of user A's expenses", async () => {
    const a = getA();
    const { data, error } = await getB().user.client.from("expenses").select("*");
    expect(error).toBeNull();
    const rows = data ?? [];
    expect(rows.some((row) => row.id === a.expenseId)).toBe(false);
    expect(rows.some((row) => row.budget_id === a.budgetId)).toBe(false);
  });

  it("user A still reads its own expense (positive control)", async () => {
    const a = getA();
    const { data, error } = await a.user.client.from("expenses").select("*");
    expect(error).toBeNull();
    expect((data ?? []).some((row) => row.id === a.expenseId)).toBe(true);
  });

  it("user B cannot read user A's budget row", async () => {
    const a = getA();
    const { data, error } = await getB().user.client.from("budgets").select("*").eq("id", a.budgetId);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("user A reads its own budget (positive control)", async () => {
    const a = getA();
    const { data, error } = await a.user.client.from("budgets").select("*").eq("id", a.budgetId);
    expect(error).toBeNull();
    expect((data ?? []).map((row) => row.id)).toContain(a.budgetId);
  });
});
