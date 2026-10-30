import { describe, expect, it, vi } from "vitest";
import { cancelDailyItem, CancelDailyItemApiClientError } from "./cancel-daily-item";

const input = { date: "2026-09-21", itemId: "60000000-0000-4000-8000-000000000001" };
describe("Cancel Daily Item client", () => {
  it("sends one authenticated date + Item command with cancellation signal", async () => {
    const body = { data: {}, effects: ["daily_item_cancelled"] };
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json(body));
    const controller = new AbortController();
    expect(await cancelDailyItem({ apiBaseUrl: "http://localhost:3001", accessToken: "session", input, signal: controller.signal, fetchImplementation })).toEqual(body);
    const [url, options] = fetchImplementation.mock.calls[0];
    expect(String(url)).toBe("http://localhost:3001/api/commands/daily-item/cancel");
    expect(options).toMatchObject({ method: "POST", cache: "no-store", signal: controller.signal });
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer session");
    expect(JSON.parse(options!.body as string)).toEqual(input);
  });
  it.each([true, false])("preserves HTTP status and safe error codes (JSON=%s)", async (json) => {
    await expect(cancelDailyItem({ apiBaseUrl: "http://localhost:3001", accessToken: "session", input,
      fetchImplementation: async () => json ? Response.json({ error: "DAILY_ITEM_CANCEL_NOT_ALLOWED" }, { status: 409 }) : new Response("Unavailable", { status: 503 }),
    })).rejects.toEqual(new CancelDailyItemApiClientError(json ? 409 : 503, json ? "DAILY_ITEM_CANCEL_NOT_ALLOWED" : null));
  });
});
