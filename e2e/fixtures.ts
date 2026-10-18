import { expect, test as base, type Locator, type Page } from "@playwright/test";

/** Each test gets its own fresh user via the local-only dev login. */
export const test = base.extend<{ app: Page }>({
  app: async ({ page }, use, info) => {
    const name = `e2e-${info.testId}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "");
    await page.goto(`/api/auth/dev-login?name=${name}`);
    await expect(page.getByTestId("tab-todo")).toBeVisible();
    await use(page);
  },
});
export { expect };

export const memo = (page: Page) => page.locator("#memo");
export const cards = (page: Page) => page.getByTestId("task");
export const card = (page: Page, title: string) => cards(page).filter({ hasText: title });

export async function addMemo(page: Page, text: string) {
  await memo(page).fill(text);
  await memo(page).press("Enter");
  await expect(card(page, text)).toBeVisible();
}

/** Drag a card horizontally like a finger flick. */
export async function flick(page: Page, target: Locator, dx: number) {
  const box = (await target.boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + i * 0.5);
  await page.mouse.up();
}
