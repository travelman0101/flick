import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

/** Each test gets its own fresh user via the local-only dev login. */
export const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    // dev-login keeps 40 chars: stay well under so every run gets a brand-new user
    const name = `e2e-${randomUUID().slice(0, 8)}-${Date.now().toString(36)}`;
    await page.goto(`/api/auth/dev-login?name=${name}`);
    // first load of a fresh user on the local runtime can be slow while browsers run in parallel
    await expect(page.getByTestId("tab-todo")).toBeVisible({ timeout: 20_000 });
    await use(page);
  },
});
export { expect };

export const memo = (page: Page) => page.locator("#memo");
// only the list on screen: a list animating out after a tab switch is inert
export const cards = (page: Page) => page.locator('[data-testid^="list-"]:not([data-exiting]) [data-testid="task"]');
export const card = (page: Page, title: string) => cards(page).filter({ hasText: title });

export async function addMemo(page: Page, text: string) {
  await memo(page).fill(text);
  await memo(page).press("Enter");
  await expect(card(page, text)).toBeVisible();
}

/** Drag a card horizontally like a finger flick. */
export async function flick(page: Page, target: Locator, dx: number) {
  // like a finger, wait until the card is back on screen (it re-enters after an in-place flick)
  // measure the moving card itself, not its static shell
  // and until it has stopped moving (cards slide and fade into place after undo or reorder)
  const handle = target.locator(".card");
  const width = page.viewportSize()!.width;
  const seen: string[] = [];
  await expect
    .poll(
      async () => {
        const b = await handle.boundingBox();
        const opaque = await target.evaluate((el) => getComputedStyle(el.closest("li") ?? el).opacity === "1");
        seen.push(b && opaque && b.x >= 0 && b.x + b.width <= width + 1 ? `${Math.round(b.x)},${Math.round(b.y)}` : "");
        // the same on-screen position three times in a row, fully visible
        const [a, c, d] = seen.slice(-3);
        return seen.length >= 3 && a !== "" && a === c && c === d;
      },
      { intervals: [100] },
    )
    .toBe(true);
  const box = (await handle.boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + i * 0.5);
  await page.mouse.up();
}

/** Click once the element has stopped moving (sheets and folds open with springs; a loaded CI box can lag). */
export async function clickSettled(target: Locator) {
  const seen: string[] = [];
  await expect
    .poll(
      async () => {
        const b = await target.boundingBox();
        seen.push(b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.height)}` : "");
        const [a, c, d] = seen.slice(-3);
        return seen.length >= 3 && a !== "" && a === c && c === d;
      },
      { intervals: [100] },
    )
    .toBe(true);
  await target.click();
}
