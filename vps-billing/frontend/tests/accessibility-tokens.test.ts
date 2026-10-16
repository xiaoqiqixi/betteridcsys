import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Audit actual authored opaque colors; this cannot measure rendered compositing.
const planComponent = readFileSync(
  new URL("../src/components/PlansPage.vue", import.meta.url),
  "utf8",
);
const css =
  readFileSync(new URL("../src/style.css", import.meta.url), "utf8") +
  "\n" +
  planComponent.match(/<style scoped>([\s\S]*?)<\/style>/)![1];
const rules = [
  ...css.replace(/^@import[^;]+;/gm, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map((match) => ({
  selectors: match[1]!
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .split(/\s*,\s*/),
  declarations: Object.fromEntries(
    [...match[2]!.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((entry) => [
      entry[1]!,
      entry[2]!.trim(),
    ]),
  ),
}));

function properties(selector: string) {
  return Object.assign(
    {},
    ...rules
      .filter((rule) => rule.selectors.includes(selector))
      .map((rule) => rule.declarations),
  ) as Record<string, string>;
}

function themeTokens(theme: string) {
  const root = properties(":root");
  // Inherited custom properties have already resolved at the parent's boundary.
  // Re-resolving inherited aliases after child overrides hides theme regressions.
  const tokens = Object.fromEntries(
    Object.entries(root)
      .filter(([name]) => name.startsWith("--"))
      .map(([name, value]) => [name, resolve(value, root)]),
  );
  for (const rule of rules) {
    if (
      rule.selectors.some(
        (selector) =>
          selector === `[data-theme="${theme}"]` || selector === "[data-theme]",
      )
    ) {
      Object.assign(tokens, rule.declarations);
    }
  }
  return tokens;
}

function resolve(
  value: string,
  tokens: Record<string, string>,
  depth = 0,
): string {
  if (depth > 8 || !value) throw new Error("Missing or cyclic CSS color");
  const variable = /^var\((--[\w-]+)(?:,\s*([^()]+))?\)$/.exec(value);
  return variable
    ? resolve(tokens[variable[1]!] ?? variable[2]!, tokens, depth + 1)
    : value;
}

function luminance(value: string) {
  const hex = value.replace(/^#/, "");
  if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex))
    throw new Error(`Not an opaque sRGB color: ${value}`);
  const full =
    hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
    const component =
      Number.parseInt(full.slice(index * 2, index * 2 + 2), 16) / 255;
    return (
      sum +
      weight *
        (component <= 0.04045
          ? component / 12.92
          : ((component + 0.055) / 1.055) ** 2.4)
    );
  }, 0);
}

function contrast(a: string, b: string) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe.each(["blue", "teal", "violet"])(
  "%s authored accessibility colors",
  (theme) => {
    const tokens = themeTokens(theme);
    const color = (name: string) => resolve(tokens[name]!, tokens);

    it("keeps normal body and secondary text readable on supported surfaces", () => {
      for (const foreground of ["--text-primary", "--text-secondary"]) {
        for (const background of [
          "--surface",
          "--surface-subtle",
          "--page-background",
        ]) {
          expect(
            contrast(color(foreground), color(background)),
            `${foreground} on ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      const heading = properties("th");
      expect(
        contrast(
          resolve(heading.color!, tokens),
          resolve(heading.background!, tokens),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it("keeps brand labels readable in primary and selected controls", () => {
      expect(color("--brand-ink")).toBe(color("--theme-hover"));
      expect(color("--focus-ring")).toBe(color("--theme-focus"));
      for (const background of ["--blue", "--theme-hover"]) {
        expect(contrast("#ffffff", color(background))).toBeGreaterThanOrEqual(
          4.5,
        );
      }
      expect(
        contrast(color("--brand-ink"), color("--theme-soft")),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it("keeps focus and control boundaries distinct from adjacent surfaces", () => {
      for (const foreground of ["--focus-ring", "--control-border"]) {
        for (const background of [
          "--surface",
          "--surface-subtle",
          "--page-background",
        ]) {
          expect(
            contrast(color(foreground), color(background)),
            `${foreground} on ${background}`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
      expect(
        contrast(color("--focus-ring"), color("--theme-soft")),
      ).toBeGreaterThanOrEqual(3);
    });

    it("keeps actual selected navigation, settings and plan labels readable", () => {
      for (const selector of [
        "[data-theme] .sidebar nav a.active",
        ".settings-choice:has(input:checked)",
        '.region-options button[aria-pressed="true"]',
        '.plan-select[aria-pressed="true"]',
      ]) {
        const selected = properties(selector);
        expect(
          contrast(
            resolve(selected.color!, tokens),
            resolve(selected.background!, tokens),
          ),
          selector,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("keeps every status badge readable against its actual authored background", () => {
      for (const status of ["green", "amber", "red", "gray"]) {
        const badge = properties(`.badge.${status}`);
        expect(
          contrast(
            resolve(badge.color!, tokens),
            resolve(badge.background!, tokens),
          ),
          status,
        ).toBeGreaterThanOrEqual(4.5);
      }
      for (const status of ["error", "success", "info"]) {
        const alert = properties(`.alert.${status}`);
        expect(
          contrast(
            resolve(alert.color!, tokens),
            resolve(alert.background!, tokens),
          ),
          `alert ${status}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  },
);
