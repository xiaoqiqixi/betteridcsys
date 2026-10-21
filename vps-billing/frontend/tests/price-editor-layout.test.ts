import { describe, expect, it } from "vitest";
import { declaredRole } from "./theme-contrast.mjs";

const component = "src/pages/AdminCatalogPage.vue";
const role = (selector: string, property: string) =>
  declaredRole(selector, property, component);

describe("price-editor layout preserves a full amount row without hiding content", () => {
  it("gives the currency header and amount control the complete drawer row at every existing breakpoint", () => {
    expect(role(".price-row", "grid-template-columns")).toBe(
      "minmax(0,1fr)auto",
    );
    expect(role(".price-currency", "grid-column")).toBe("1/-1");
    expect(role(".price-currency", "grid-row")).toBe("auto");
    expect(role(".price-amount", "grid-column")).toBe("1/-1");
  });
  it("puts the input on its own full-width grid line instead of squeezing it between affixes", () => {
    expect(role(".price-amount", "display")).toBe("grid");
    expect(role(".price-amount input", "grid-column")).toBe("1/-1");
    expect(role(".price-amount input", "width")).toBe("100%");
    expect(role(".price-amount input", "min-width")).toBe("0");
  });
  it("allows complete affixes to wrap without a fixed 55px ceiling, ellipsis or overflow masking", () => {
    expect(role(".price-affix", "max-width")).toBe("none");
    expect(role(".price-affix", "overflow-wrap")).toBe("anywhere");
    expect(role(".price-amount", "overflow")).toBeUndefined();
    expect(role(".price-affix", "text-overflow")).toBeUndefined();
  });
  it("retains the established amount and affix font sizes", () => {
    expect(role(".price-amount input", "font-size")).toBe("12px");
    expect(role(".price-affix", "font-size")).toBe("10px");
  });
});
