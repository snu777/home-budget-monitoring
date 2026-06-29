import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

// Canonical public URL of the deployed app. The email confirmation link is
// pinned to this so it always lands on the homebudget site rather than the
// request origin (localhost during local dev). This value must also be present
// in the Supabase project's Redirect URLs allow-list, or Supabase silently
// falls back to its Site URL when building the link.
const SITE_URL = "https://home-budget-monitoring.kontostim1998.workers.dev";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: new URL("/auth/signin", SITE_URL).toString() },
  });

  if (error) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/auth/confirm-email");
};
