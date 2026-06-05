import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { EXPENSE_CATEGORIES } from "@/types";
import type { ExpenseCategory } from "@/types";

export const prerender = false;

// Format a Date's *local* calendar Y-M-D as "YYYY-MM-DD". Avoids the UTC shift
// of toISOString(), which in positive-offset timezones rolls a local-midnight
// boundary back into the previous day (and previous month).
function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const GET: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("budget_members")
    .select("budget_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return Response.json({ expenses: [] });
  }

  const now = new Date();
  // Optional `month` selector: "previous" serves the prior calendar month
  // (for MoM comparison); anything else (incl. "current"/absent) keeps today's
  // default behavior. monthOffset shifts the base month; Date normalizes the
  // January → prior-year December rollover automatically.
  const monthOffset = context.url.searchParams.get("month") === "previous" ? -1 : 0;
  const startOfMonth = toLocalISODate(new Date(now.getFullYear(), now.getMonth() + monthOffset, 1));
  const endOfMonth = toLocalISODate(new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0));

  const { data: expenses, error } = await supabase
    .from("expenses")
    .select("*")
    .gte("expense_date", startOfMonth)
    .lte("expense_date", endOfMonth)
    .order("expense_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ expenses });
};

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("budget_members")
    .select("budget_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return Response.json({ error: "No budget" }, { status: 403 });
  }

  let body: { amount?: unknown; category?: unknown; expense_date?: unknown };
  try {
    body = (await context.request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { amount, category, expense_date } = body;

  if (typeof amount !== "number" || amount <= 0) {
    return Response.json({ error: "Invalid amount" }, { status: 400 });
  }

  if (typeof category !== "string" || !EXPENSE_CATEGORIES.includes(category as ExpenseCategory)) {
    return Response.json({ error: "Invalid category" }, { status: 400 });
  }

  if (typeof expense_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expense_date)) {
    return Response.json({ error: "Invalid date" }, { status: 400 });
  }
  if (isNaN(new Date(expense_date).getTime())) {
    return Response.json({ error: "Invalid date" }, { status: 400 });
  }

  const { data: expense, error } = await supabase
    .from("expenses")
    .insert({
      budget_id: membership.budget_id,
      created_by: user.id,
      amount,
      category: category as ExpenseCategory,
      expense_date,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ expense }, { status: 201 });
};

export const DELETE: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = context.url.searchParams.get("id");
  if (!id) {
    return Response.json({ error: "Missing expense id" }, { status: 400 });
  }

  const { count, error } = await supabase.from("expenses").delete({ count: "exact" }).eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (count === 0) {
    return Response.json({ error: "Expense not found" }, { status: 404 });
  }

  return Response.json({ success: true });
};
