import { describe, expect, it } from "vitest";
import { aggregate, computeMarker, resolveMarkers, sumByCategory } from "@/lib/expenses-summary";
import type { Expense, ExpenseCategory } from "@/types";

// Risk #6 rule-based suite. Assertions are derived from the PRD rules
// (strict >20% threshold, zero-base skip, first-month hide, aggregation
// totals) — NOT from the functions' current output (the oracle problem).

function expense(category: ExpenseCategory, amount: number): Expense {
  return {
    id: "id",
    budget_id: "budget",
    created_by: "user",
    category,
    amount,
    expense_date: "2026-06-01",
    created_at: "2026-06-01T00:00:00Z",
  };
}

describe("aggregation totals", () => {
  it("sums amounts per category", () => {
    const sums = sumByCategory([expense("Jedzenie", 10), expense("Jedzenie", 5), expense("Transport", 20)]);
    expect(sums.get("Jedzenie")).toBe(15);
    expect(sums.get("Transport")).toBe(20);
  });

  it("orders rows by total descending", () => {
    const { rows } = aggregate([expense("Jedzenie", 10), expense("Transport", 30), expense("Zdrowie", 20)]);
    expect(rows.map((r) => r.category)).toEqual(["Transport", "Zdrowie", "Jedzenie"]);
  });

  it("drops categories whose net total is not greater than zero", () => {
    const { rows } = aggregate([expense("Jedzenie", 10), expense("Transport", 5), expense("Transport", -5)]);
    expect(rows.map((r) => r.category)).toEqual(["Jedzenie"]);
  });

  it("grand total is the sum of the surviving rows", () => {
    const { rows, total } = aggregate([expense("Jedzenie", 10), expense("Transport", 30)]);
    expect(total).toBe(40);
    expect(total).toBe(rows.reduce((acc, r) => acc + r.total, 0));
  });

  it("returns an empty result for no expenses", () => {
    expect(aggregate([])).toEqual({ rows: [], total: 0 });
  });
});

describe("MoM marker boundaries (strict >20%)", () => {
  it("does not flag an exact +20% change", () => {
    expect(computeMarker(120, 100)).toBeNull();
  });

  it("does not flag an exact -20% change", () => {
    expect(computeMarker(80, 100)).toBeNull();
  });

  it("flags an increase strictly greater than 20%", () => {
    expect(computeMarker(120.01, 100)).toEqual({ direction: "up", percent: 20 });
  });

  it("flags a decrease strictly greater than 20%", () => {
    expect(computeMarker(79.99, 100)).toEqual({ direction: "down", percent: 20 });
  });

  it("reports the rounded magnitude for a large increase", () => {
    expect(computeMarker(150, 100)).toEqual({ direction: "up", percent: 50 });
  });

  it("reports the rounded magnitude for a large decrease", () => {
    expect(computeMarker(40, 100)).toEqual({ direction: "down", percent: 60 });
  });

  it("skips the zero-base case (previous total 0) instead of dividing by zero", () => {
    expect(computeMarker(100, 0)).toBeNull();
  });
});

describe("first-month rule", () => {
  it("hides every marker when there is no previous-month data", () => {
    const rows = resolveMarkers([expense("Jedzenie", 200), expense("Transport", 50)], []).rows;
    expect(rows.every((r) => r.marker === null)).toBe(true);
  });

  it("applies per-category zero-base + threshold when previous data exists", () => {
    const current = [
      expense("Jedzenie", 150), // 100 -> 150 = +50% => up
      expense("Transport", 110), // 100 -> 110 = +10% => no marker
      expense("Zdrowie", 30), // new category, previous 0 => no marker (zero-base)
    ];
    const prev = [expense("Jedzenie", 100), expense("Transport", 100)];
    const byCategory = new Map(resolveMarkers(current, prev).rows.map((r) => [r.category, r.marker]));
    expect(byCategory.get("Jedzenie")).toEqual({ direction: "up", percent: 50 });
    expect(byCategory.get("Transport")).toBeNull();
    expect(byCategory.get("Zdrowie")).toBeNull();
  });
});
