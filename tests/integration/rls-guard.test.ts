import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  createAuthedUser,
  deleteUser,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  type AuthedUser,
} from "./helpers/supabase";

// Guards the harness itself: if migrations weren't applied or the assertion
// client is accidentally privileged, the isolation suite would pass green
// while proving nothing (research Open Question #1). These tests turn that
// silent false-green into a loud, immediate failure.
describe("RLS harness guard", () => {
  let user: AuthedUser | undefined;

  function authedUser(): AuthedUser {
    if (!user) {
      throw new Error("guard user was not initialized in beforeAll");
    }
    return user;
  }

  beforeAll(async () => {
    user = await createAuthedUser("guard");
  });

  afterAll(async () => {
    // Best-effort teardown: a failed delete must not fail the suite (matches
    // rls-isolation.test.ts). Unique timestamped emails avoid rerun collisions.
    if (user) {
      await Promise.allSettled([deleteUser(adminClient(), user.userId)]);
    }
  });

  it("a freshly-created user with no budget sees zero expenses (RLS is enforced)", async () => {
    const { data, error } = await authedUser().client.from("expenses").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("the assertion (anon) key is not the service-role key", () => {
    expect(SUPABASE_ANON_KEY).not.toEqual(SUPABASE_SERVICE_ROLE_KEY);
  });

  it("the anon client cannot perform a service-role-only action", async () => {
    // Listing all auth users is an admin-only operation. If the anon client
    // could do it, it would be a service-role key in disguise and every
    // isolation assertion below would be meaningless.
    const { data, error } = await anonClient().auth.admin.listUsers();
    expect(error).not.toBeNull();
    expect(data.users).toEqual([]);
  });
});
