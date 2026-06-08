import { describe, expect, it } from "vitest";
import { aggregate, sumByCategory } from "@/lib/expenses-summary";
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory } from "@/types";

// CHARACTERIZATION TESTS — these assert the CURRENT behavior of accepted MVP
// numeric quirks, NOT a specification. Unlike the rule-based suite, they are
// expected to change when the numeric model is intentionally changed; they
// exist to catch *accidental* drift, not to enforce a contract.

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

describe("characterization: float/cents accumulation", () => {
  it("sums amounts with naive floating-point addition (no per-row rounding)", () => {
    // 0.1 + 0.2 is not exactly 0.3 in IEEE-754; aggregation does not round.
    const sum = sumByCategory([expense("Jedzenie", 0.1), expense("Jedzenie", 0.2)]).get("Jedzenie");
    expect(sum).toBe(0.30000000000000004);
  });
});

describe("characterization: percentage rounding", () => {
  it("sum of rounded per-category percentages can differ from 100", () => {
    // Percentages are computed in the component (CategorySummary.tsx) as
    // Math.round((row.total / total) * 100). Three equal thirds each round to
    // 33, so the displayed shares sum to 99, not 100.
    const { rows, total } = aggregate([expense("Jedzenie", 100), expense("Transport", 100), expense("Zdrowie", 100)]);
    const percents = rows.map((r) => Math.round((r.total / total) * 100));
    expect(percents).toEqual([33, 33, 33]);
    expect(percents.reduce((a, b) => a + b, 0)).toBe(99);
  });
});

describe("characterization: no 'Inne'/Other overflow bucket", () => {
  it("every category is its own slice — no top-N truncation or synthetic Other rollup", () => {
    const { rows } = aggregate(EXPENSE_CATEGORIES.map((c, i) => expense(c, i + 1)));
    expect(rows).toHaveLength(EXPENSE_CATEGORIES.length);
    // "Inne" is a first-class category, not a remainder bucket.
    expect(rows.some((r) => r.category === "Inne")).toBe(true);
  });
});
