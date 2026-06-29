import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  // Anchor the confirmation link to the origin the user actually signed up from
  // (prod URL in prod, localhost in dev) instead of Supabase's single Site URL
  // default. The target must also be present in the project's Redirect URLs
  // allow-list, otherwise Supabase silently falls back to the Site URL.
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: new URL("/auth/signin", context.url.origin).toString() },
  });

  if (error) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/auth/confirm-email");
};
