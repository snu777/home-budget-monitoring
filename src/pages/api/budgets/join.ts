import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

const ERROR_MESSAGES: Record<string, string> = {
  invalid_invite_code: "Nieprawidłowy kod zaproszenia",
  already_member: "Jesteś już członkiem tego budżetu",
  budget_full: "Budżet ma już dwóch członków",
};

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/dashboard?error=${encodeURIComponent("Nie jesteś zalogowany")}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return context.redirect(`/dashboard?error=${encodeURIComponent("Nie jesteś zalogowany")}`);
  }

  const form = await context.request.formData();
  const invite_code = (form.get("invite_code") as string | null)?.trim();

  if (!invite_code) {
    return context.redirect(`/dashboard?error=${encodeURIComponent("Wpisz kod zaproszenia")}`);
  }

  const { error } = await supabase.rpc("join_budget_by_invite_code", {
    p_invite_code: invite_code,
  });

  if (error) {
    const message = ERROR_MESSAGES[error.message] ?? "Nie udało się dołączyć do budżetu";
    return context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);
  }

  return context.redirect("/dashboard");
};
