import { ADMIN_STATE, MEMBER_STATE, test as setup } from "./fixtures";

/**
 * Sign in once per role and save the session for the specs (storageState), so
 * a run costs two Supabase Auth sign-ins rather than one per test. The files
 * hold live refresh tokens — tests/smoke/.auth/ is gitignored.
 */
setup("sign in as admin", async ({ page, signIn }) => {
  await signIn("jas@smi.local");
  await page.context().storageState({ path: ADMIN_STATE });
});

setup("sign in as member", async ({ page, signIn }) => {
  await signIn("member1@smi.local");
  await page.context().storageState({ path: MEMBER_STATE });
});
