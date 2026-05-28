import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

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
  const name = (form.get("name") as string | null)?.trim() ?? null;

  const { error } = await supabase.rpc("create_budget", { p_name: name ?? undefined });

  if (error) {
    return context.redirect(`/dashboard?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/dashboard");
};
