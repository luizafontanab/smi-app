import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * A17/A19/A20 — the console member editor and inline contact editing.
 * Writes to the dev database, so every fixture is timestamped like join.spec.ts.
 *
 * Every step starts from a query-free URL: each save redirects back with
 * ?saved=1, and waitForURL(/saved=1/) would resolve against the *previous*
 * save's URL, letting the next assertion run against a form that is about to be
 * replaced mid-edit.
 */
const PASSWORD = "local-dev-password";

async function loginAsJas(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', "jas@smi.local");
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(/\/console/, { timeout: 20_000 });
}

/** Creates a member through the console and returns its query-free editor URL. */
async function createMember(page: Page, company: string, email: string) {
  await page.goto("/console/members/new");
  await page.fill('input[name="company"]', company);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Create member')");
  await page.waitForURL(/\/console\/members\/[0-9a-f-]{36}\?created=1/, { timeout: 20_000 });
  return page.url().split("?")[0];
}

const save = async (page: Page, expected: RegExp) => {
  await page.click("button:has-text('Save changes')");
  await page.waitForURL(expected, { timeout: 20_000 });
};

test.describe("console member editor", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsJas(page);
  });

  test("member name opens the editor and edits persist", async ({ page }) => {
    const ts = Date.now();
    const company = `E2E Editor Ltd ${ts}`;
    await createMember(page, company, `e2e-editor-${ts}@test.local`);

    // reachable from the list, not just the URL we were redirected to — via
    // the list's server-side search, since the list is paginated
    await page.goto(`/console/members?q=${encodeURIComponent(company)}`);
    await page.locator("tr", { hasText: company }).getByRole("link", { name: company }).click();
    await page.waitForURL(/\/console\/members\/[0-9a-f-]{36}/);

    await page.fill('input[name="phone"]', "0161 555 0100");
    await page.fill('input[name="address"]', "Unit 4, Trafford Park, Manchester");
    await page.fill('input[name="website"]', "https://example.com");
    await save(page, /\?saved=1/);
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.reload();
    await expect(page.locator('input[name="phone"]')).toHaveValue("0161 555 0100");
    await expect(page.locator('input[name="address"]')).toHaveValue("Unit 4, Trafford Park, Manchester");
    await expect(page.locator('input[name="website"]')).toHaveValue("https://example.com");
  });

  test("the A17 gate refuses to activate a draft with nothing paid", async ({ page }) => {
    const ts = Date.now();
    const company = `E2E Gate Editor Ltd ${ts}`;
    const editor = await createMember(page, company, `e2e-gate-editor-${ts}@test.local`);

    await page.goto(editor);
    await page.selectOption('select[name="status"]', "active");
    await save(page, /\?error=/);
    await expect(page.getByText(/needs a payment or comp on record/)).toBeVisible();

    // the refusal is real, not just a banner — reload from the record
    await page.goto(editor);
    await expect(page.locator('select[name="status"]')).toHaveValue("draft");
  });

  test("recording a payment raises an invoice and clears the gate", async ({ page }) => {
    const ts = Date.now();
    const company = `E2E Paid Ltd ${ts}`;
    const editor = await createMember(page, company, `e2e-paid-${ts}@test.local`);

    await page.goto(editor);
    await page.click("button:has-text('Record £40 payment')");
    await page.waitForURL(/\?saved=1/, { timeout: 20_000 });

    await page.goto(editor);
    await expect(page.locator('input[name="paid_at"]')).not.toHaveValue("");
    await expect(page.getByText(/Invoice SMI-JOIN-/)).toBeVisible(); // activity timeline

    await page.selectOption('select[name="status"]', "active");
    await save(page, /\?saved=1/);
    await page.goto(editor);
    await expect(page.locator('select[name="status"]')).toHaveValue("active");
  });

  test("a duplicate email is refused without creating a second member", async ({ page }) => {
    const ts = Date.now();
    const company = `E2E Dupe Ltd ${ts}`;
    const email = `e2e-dupe-${ts}@test.local`;
    await createMember(page, company, email);

    await page.goto("/console/members/new");
    await page.fill('input[name="company"]', `${company} Again`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click("button:has-text('Create member')");
    await page.waitForURL(/\/console\/members\/new\?error=/, { timeout: 20_000 });
    await expect(page.getByText(/already exists/)).toBeVisible();

    // "<company> Again" contains "<company>", so a second row would show up here
    await page.goto(`/console/members?q=${encodeURIComponent(company)}`);
    await expect(page.locator("tr", { hasText: company })).toHaveCount(1);
  });

  test("renaming a live member 301s the old public URL", async ({ page }) => {
    const ts = Date.now();
    const company = `E2E Slug Ltd ${ts}`;
    const editor = await createMember(page, company, `e2e-slug-${ts}@test.local`);

    // get it live: payment, then activate
    await page.goto(editor);
    await page.click("button:has-text('Record £40 payment')");
    await page.waitForURL(/\?saved=1/, { timeout: 20_000 });
    await page.goto(editor);
    await page.selectOption('select[name="status"]', "active");
    await save(page, /\?saved=1/);

    await page.goto(editor);
    const oldSlug = await page.locator('input[name="slug"]').inputValue();
    const newSlug = `${oldSlug}-renamed`;

    // without the confirmation the change is refused
    await page.fill('input[name="slug"]', newSlug);
    await save(page, /\?error=/);
    await expect(page.getByText(/breaks existing links/)).toBeVisible();
    await page.goto(editor);
    await expect(page.locator('input[name="slug"]')).toHaveValue(oldSlug);

    await page.fill('input[name="slug"]', newSlug);
    await page.check('input[name="confirm_slug"]');
    await save(page, /\?saved=1/);

    await page.goto(`/member/${oldSlug}`);
    await expect(page).toHaveURL(new RegExp(`/member/${newSlug}$`));
  });
});

test.describe("console contact editing", () => {
  // Contacts live on /console/crm — this block predated that page and still
  // pointed at a contacts card /console/members no longer renders.
  async function addContact(page: Page, email: string, name?: string) {
    await page.goto("/console/crm");
    await page.getByLabel("Email", { exact: true }).fill(email);
    if (name) await page.getByLabel("Name", { exact: true }).fill(name);
    await page.click("button:has-text('Add (writes through to Bigin)')");
    await expect(page.locator("tr", { hasText: email })).toBeVisible();
  }

  /** Opens the contact editor from a clean URL and returns the editor form. */
  async function openEditor(page: Page, email: string): Promise<Locator> {
    await page.goto(`/console/crm?q=${encodeURIComponent(email)}`);
    await page.locator("tr", { hasText: email }).getByRole("link", { name: "Edit" }).click();
    // the Edit link keeps the search and page (?q=…&page=…&contact=…)
    await page.waitForURL(/[?&]contact=/, { timeout: 20_000 });
    const editor = page.locator("form", { hasText: `Editing ${email}` });
    await expect(editor).toBeVisible();
    return editor;
  }

  const saveContact = async (page: Page, editor: Locator) => {
    await editor.locator("button:has-text('Save contact')").click();
    await page.waitForURL(/saved=1/, { timeout: 20_000 });
  };

  test.beforeEach(async ({ page }) => {
    await loginAsJas(page);
  });

  test("a contact's details can be edited in place", async ({ page }) => {
    const ts = Date.now();
    const email = `e2e-contact-${ts}@test.local`;
    await addContact(page, email, `E2E Contact ${ts}`);

    const editor = await openEditor(page, email);
    await editor.locator('input[name="company"]').fill("Renamed Co");
    await editor.locator('select[name="newsletter"]').selectOption("not_subscribed");
    await saveContact(page, editor);

    const updated = page.locator("tr", { hasText: email });
    await expect(updated).toContainText("Renamed Co");
    await expect(updated.getByText("no", { exact: true })).toBeVisible();
  });

  test("an unsubscribed contact stays unsubscribed without an explicit re-opt-in", async ({ page }) => {
    const ts = Date.now();
    const email = `e2e-unsub-${ts}@test.local`;
    await addContact(page, email);

    let editor = await openEditor(page, email);
    await editor.locator('select[name="newsletter"]').selectOption("unsubscribed");
    await saveContact(page, editor);
    await expect(page.locator("tr", { hasText: email })).toContainText("(permanent)");

    // the select alone must not undo it
    editor = await openEditor(page, email);
    await editor.locator('select[name="newsletter"]').selectOption("subscribed");
    await saveContact(page, editor);
    await expect(page.locator("tr", { hasText: email })).toContainText("(permanent)");

    // ticking the consent box is the one way back
    editor = await openEditor(page, email);
    await editor.locator('select[name="newsletter"]').selectOption("subscribed");
    await editor.locator('input[name="re_opt_in"]').check();
    await saveContact(page, editor);
    await expect(page.locator("tr", { hasText: email }).getByText("subscribed", { exact: true })).toBeVisible();
  });
});
