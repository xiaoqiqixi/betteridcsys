// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { router } from "../src/router";

describe("route scroll policy after the actual browser regression", () => {
  const scroll = router.options.scrollBehavior!;

  it("starts different pages, record details and query scopes at the top", () => {
    expect(
      scroll(router.resolve("/home"), router.resolve("/orders"), null),
    ).toEqual({ left: 0, top: 0 });
    expect(
      scroll(
        router.resolve("/orders/new-id"),
        router.resolve("/orders/old-id"),
        null,
      ),
    ).toEqual({ left: 0, top: 0 });
    expect(
      scroll(
        router.resolve("/catalog?region=TYO"),
        router.resolve("/catalog?region=HKG"),
        null,
      ),
    ).toEqual({ left: 0, top: 0 });
  });

  it("restores the router-provided position on a cross-page browser return", () => {
    const saved = { left: 12, top: 640 };
    expect(
      scroll(router.resolve("/orders"), router.resolve("/home"), saved),
    ).toBe(saved);
  });

  it("leaves same-fullPath overlay history in place even when a saved position exists", () => {
    const page = router.resolve("/orders?filter=pending");
    expect(scroll(page, page, null)).toBe(false);
    expect(scroll(page, page, { left: 0, top: 0 })).toBe(false);
  });
});
