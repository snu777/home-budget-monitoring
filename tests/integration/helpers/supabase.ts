import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";

export type TestClient = SupabaseClient<Database>;

type ExpenseCategory = Database["public"]["Enums"]["expense_category"];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required test env var: ${name}. Run \`npx supabase start\` and copy SUPABASE_URL, ` +
        `the anon key (SUPABASE_KEY), and the service_role key (SUPABASE_SERVICE_ROLE_KEY) into .env.test.`,
    );
  }
  return value;
}

export const SUPABASE_URL = requireEnv("SUPABASE_URL");
export const SUPABASE_ANON_KEY = requireEnv("SUPABASE_KEY");
export const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

export interface AuthedUser {
  client: TestClient;
  userId: string;
  email: string;
}

export interface SeedExpenseInput {
  budgetId: string;
  createdBy: string;
  amount?: number;
  category?: ExpenseCategory;
  expenseDate?: string;
}

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

/** A per-user anon-key client. Subject to RLS — this is the assertion client. */
export function anonClient(): TestClient {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, clientOptions);
}

/** A service-role client that BYPASSES RLS. Teardown / privileged setup only. */
export function adminClient(): TestClient {
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOptions);
}

/**
 * Sign up a uniquely-suffixed user and return an authenticated anon client.
 * Email confirmations are disabled locally, so signUp yields a session; we fall
 * back to an explicit sign-in defensively.
 */
export async function createAuthedUser(suffix: string): Promise<AuthedUser> {
  const email = `rls-test-${Date.now()}-${suffix}@example.com`;
  const password = "test-password-123";
  const client = anonClient();

  const { data: signUpData, error: signUpError } = await client.auth.signUp({ email, password });
  if (signUpError) {
    throw new Error(`signUp failed for ${email}: ${signUpError.message}`);
  }

  let userId = signUpData.user?.id;
  if (!signUpData.session) {
    const { data: signInData, error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) {
      throw new Error(`signIn failed for ${email}: ${signInError.message}`);
    }
    userId = signInData.user.id;
  }
  if (!userId) {
    throw new Error(`Could not resolve user id for ${email}`);
  }

  return { client, userId, email };
}

/** Create a budget via the SECURITY DEFINER RPC; returns the new budget id. */
export async function createBudget(client: TestClient, name: string): Promise<string> {
  const { data, error } = await client.rpc("create_budget", { p_name: name });
  if (error) {
    throw new Error(`create_budget failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("create_budget returned no budget id");
  }
  return data;
}

/** Seed one expense as the given user (RLS requires created_by = auth.uid()). */
export async function seedExpense(client: TestClient, input: SeedExpenseInput): Promise<string> {
  const { data, error } = await client
    .from("expenses")
    .insert({
      budget_id: input.budgetId,
      created_by: input.createdBy,
      amount: input.amount ?? 42.5,
      category: input.category ?? "Jedzenie",
      expense_date: input.expenseDate ?? "2026-06-01",
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(`seedExpense failed: ${error.message}`);
  }
  return data.id;
}

/** Delete a user via the admin API; cascades to their budgets/members/expenses. */
export async function deleteUser(admin: TestClient, userId: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`deleteUser failed for ${userId}: ${error.message}`);
  }
}
