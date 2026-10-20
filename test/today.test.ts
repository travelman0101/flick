import { describe, expect, it } from "vitest";
import { logicalDay, previousDay } from "../src/day";
import { call, login, task } from "./helpers";

const put = (id: string, body: unknown, cookie: string) =>
  call(`/api/tasks/${id}`, { method: "PUT", cookie, body: JSON.stringify(body) });

describe("logical day", () => {
  it("rolls over at 04:00, not midnight", () => {
    expect(logicalDay(new Date(2026, 9, 21, 3, 59))).toBe("2026-10-20");
    expect(logicalDay(new Date(2026, 9, 21, 4, 0))).toBe("2026-10-21");
    expect(logicalDay(new Date(2026, 9, 21, 23, 30))).toBe("2026-10-21");
  });

  it("finds the previous day across month ends", () => {
    expect(previousDay("2026-11-01")).toBe("2026-10-31");
    expect(previousDay("2027-01-01")).toBe("2026-12-31");
  });
});

describe("today flag", () => {
  it("stores the picked day and defaults to null", async () => {
    const cookie = await login("d1");
    await put("p1", task(), cookie);
    let list = ((await (await call("/api/tasks", { cookie })).json()) as any).tasks;
    expect(list[0].today).toBeNull();
    await put("p1", task({ today: "2026-10-20", updatedAt: Date.now() + 1 }), cookie);
    list = ((await (await call("/api/tasks", { cookie })).json()) as any).tasks;
    expect(list[0].today).toBe("2026-10-20");
  });

  it("rejects a malformed day", async () => {
    const cookie = await login("d2");
    expect((await put("p2", task({ today: "today" }), cookie)).status).toBe(400);
  });
});
