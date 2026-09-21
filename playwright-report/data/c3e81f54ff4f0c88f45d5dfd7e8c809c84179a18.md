# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> dev-auth harness >> dev-login issues a session and reaches the Character Desk
- Location: tests\e2e\auth.spec.ts:13:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  1  | /**
  2  |  * Dev-auth harness spec — the entry gate for the whole runtime suite.
  3  |  *
  4  |  * Verifies the local dev-login path (never production credentials):
  5  |  *   - `?auth=1&dev-login=1` issues a session and strips the query params;
  6  |  *   - the authenticated boot reaches the Courier Desk flow;
  7  |  *   - a character is created/selected through the normal desk UI.
  8  |  */
  9  | import { test, expect } from "@playwright/test";
  10 | import { SEL, gotoDevLogin, screenshot } from "./support/harness";
  11 | 
  12 | test.describe("dev-auth harness", () => {
  13 |   test("dev-login issues a session and reaches the Character Desk", async ({ page }) => {
  14 |     await gotoDevLogin(page);
  15 | 
  16 |     // Authenticated chrome appears once the session is issued + reloaded.
  17 |     await expect(page.locator(SEL.topBar)).toBeVisible({ timeout: 30_000 });
  18 | 
  19 |     // The dev-login query must be stripped after the harness hand-off.
  20 |     await expect(page).toHaveURL((url) => {
  21 |       return !url.searchParams.has("dev-login");
  22 |     });
  23 | 
  24 |     // A fresh dev account shows the create desk (name field); an account
  25 |     // that already played shows the select desk or auto-plays. All three
  26 |     // are valid harness outcomes — assert the authenticated state only.
  27 |     const nameVisible = await page.locator(SEL.deskNameInput).isVisible().catch(() => false);
  28 |     const playVisible = await page.locator(SEL.charPlayButton).isVisible().catch(() => false);
  29 |     const autoPlayed = await page.locator(SEL.topBar).isVisible();
> 30 |     expect(nameVisible || playVisible || autoPlayed).toBe(true);
     |                                                      ^ Error: expect(received).toBe(expected) // Object.is equality
  31 | 
  32 |     await screenshot(page, "auth-desk.png");
  33 |   });
  34 | });
  35 | 
```