# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## SECURITY DEFINER functions must guard against NULL auth.uid()

**Context**: supabase/migrations/ — any Postgres SECURITY DEFINER function that calls auth.uid() to perform DML

**Problem**: Functions GRANTed only to `authenticated` role seem safe from NULL auth.uid(), but direct psql calls, superuser execution, or accidental grant widening bypass the role check. auth.uid() returns NULL, and a subsequent INSERT/UPDATE hits a NOT NULL violation with an unhelpful internal Postgres error rather than a clean 'unauthenticated' exception.

**Rule**: Every SECURITY DEFINER function that calls auth.uid() must start with:
`IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;`
— even when only GRANTed to authenticated.

**Applies to**: Supabase PostgreSQL SECURITY DEFINER functions; any plpgsql function that uses auth.uid() for DML.
