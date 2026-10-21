import { describe, expect, it } from "vitest";
import { parse } from "postcss";
import {
  appearances,
  brands,
  componentColorLiterals,
  composite,
  contrast,
  contrastPairs,
  globalStyles,
  measureTheme,
  rgba,
  resolveColorValue,
  rootTokens,
  statusNames,
} from "./theme-contrast.mjs";

describe("contrast measurement is conservative and alpha-aware", () => {
  it("matches reference black/white and identical-color ratios without rounding a failing ratio to a pass", () => {
    expect(contrast(rgba("#000"), rgba("#fff"))).toBe(21);
    expect(contrast(rgba("#fff"), rgba("#000"))).toBe(21);
    expect(contrast(rgba("#abcdef"), rgba("#abcdef"))).toBe(1);
    expect(contrast(rgba("#777"), rgba("#fff"))).toBeLessThan(4.5);
    expect(contrast(rgba("#767676"), rgba("#fff"))).toBeGreaterThan(4.5);
  });
  it("composites translucent foregrounds and does not treat translucent backgrounds as opaque", () => {
    expect(composite(rgba("#0008"), rgba("#fff"))[0]).toBeCloseTo(7 / 15);
    expect(contrast(rgba("rgba(0,0,0,.5)"), rgba("#fff"))).toBeCloseTo(
      contrast(rgba("#808080"), rgba("#fff")),
      1,
    );
    expect(() => contrast(rgba("#000"), rgba("rgba(255,255,255,.5)"))).toThrow(
      "opaque",
    );
  });
  it("fails closed for missing/circular tokens and unsupported colors instead of returning a false green", () => {
    expect(() => resolveColorValue("var(--missing)", {})).toThrow(
      "Missing CSS token",
    );
    expect(() =>
      resolveColorValue("var(--one)", {
        "--one": "var(--two)",
        "--two": "var(--one)",
      }),
    ).toThrow("Circular");
    expect(() => rgba("not-a-color")).toThrow("Unsupported CSS color");
  });
  it("applies real selector specificity before source order and does not import dark values over the light root", () => {
    const styles = [
      {
        file: "synthetic.css",
        ast: parse(
          ':root[data-appearance="light"]{--text:#222}:root{--text:#eee}:root[data-appearance="light"][data-brand="teal"]{--text:#030}:root[data-appearance="light"]{--text:#333}',
        ),
      },
    ];
    expect(rootTokens("light", "blue", styles)["--text"]).toBe("#333");
    expect(rootTokens("light", "teal", styles)["--text"]).toBe("#030");
    expect(rootTokens("dark", "blue", styles)["--text"]).toBe("#eee");
  });
});

describe("light theme repair and dark theme semantic color regressions", () => {
  const styles = globalStyles();
  it("reads the application CSS imports in their actual order, including the final shell theme overrides", () => {
    expect(styles.map((style) => style.file)).toEqual([
      "src/style.css",
      "src/completion.css",
      "src/controls.css",
      "src/shell.css",
    ]);
  });
  for (const appearance of appearances)
    for (const brand of brands) {
      it.each(contrastPairs())(
        `${appearance} ${brand}: $foreground / $background meets $minimum:1 for $purpose`,
        (pair) => {
          const measured = measureTheme(appearance, brand, styles).find(
            (result) =>
              result.foreground === pair.foreground &&
              result.background === pair.background,
          )!;
          expect(
            measured.ratio,
            `${appearance} ${brand} ${pair.foreground}=${measured.foreground_value} on ${pair.background}=${measured.background_value}`,
          ).toBeGreaterThanOrEqual(pair.minimum);
        },
      );
      it(`${appearance} ${brand}: status fills are opaque and every appearance owns explicit semantic action/status tokens`, () => {
        const light = rootTokens("light", brand, styles),
          dark = rootTokens("dark", brand, styles);
        for (const status of statusNames) {
          expect(
            rgba(
              resolveColorValue(
                `var(--status-${status}-bg)`,
                appearance === "light" ? light : dark,
              ),
            )[3],
          ).toBe(1);
          for (const suffix of ["", "-bg", "-border"]) {
            expect(light[`--status-${status}${suffix}`]).toBeTruthy();
            expect(dark[`--status-${status}${suffix}`]).toBeTruthy();
          }
        }
        for (const token of [
          "--action-primary-bg",
          "--action-primary-hover",
          "--action-primary-text",
          "--action-admin-bg",
          "--action-admin-hover",
          "--action-admin-text",
          "--bg-table-header",
          "--bg-subtle",
          "--input-placeholder",
          "--border-control",
          "--shadow-popover",
        ]) {
          expect(light[token], `light ${token}`).toBeTruthy();
          expect(dark[token], `dark ${token}`).toBeTruthy();
        }
      });
    }
  it("keeps status, error, warning and filled-action text mapped to semantic roles rather than dark-only literals in components", () => {
    expect(componentColorLiterals()).toEqual([]);
  });
});
