import type { Database } from "@/database.types";

export type Expense = Database["public"]["Tables"]["expenses"]["Row"];
export type Budget = Database["public"]["Tables"]["budgets"]["Row"];
export type ExpenseCategory = Database["public"]["Enums"]["expense_category"];

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "Jedzenie",
  "Transport",
  "Mieszkanie",
  "Rozrywka",
  "Zdrowie",
  "Ubrania",
  "Restauracje",
  "Elektronika",
  "Inne",
];
