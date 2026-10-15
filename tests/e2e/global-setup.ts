import { assertLocalTarget } from "../smoke/global-setup";

/**
 * The e2e suite signs up, books, approves and pays through the dev server —
 * it writes on purpose, so it must only ever do it to the local stack. Same
 * guard as the smoke suite (one definition, so the two can't drift): the env
 * files must point at a local Supabase, and so must the server that is
 * actually answering on 3100, which `reuseExistingServer` would otherwise
 * accept unchecked.
 */
export default async function globalSetup(): Promise<void> {
  await assertLocalTarget("e2e");
}
