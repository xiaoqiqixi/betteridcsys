import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { auditNames } from "../src/format";
const root = resolve(import.meta.dirname, "../src");
const css = readFileSync(resolve(root, "style.css"), "utf8");
function luminance(hex: string) {
  const c = hex
    .replace("#", "")
    .match(/../g)!
    .slice(0, 3)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function ratio(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const themes = [
  ...css.matchAll(/:root(?:\[data-theme=["']?dark["']?\])?\s*\{([^}]+)\}/g),
].map((m) =>
  Object.fromEntries(
    [...m[1]!.matchAll(/(--[\w-]+)\s*:\s*(#[a-f\d]{6})(?=;|\s|\})/gi)].map(
      (v) => [v[1]!, v[2]!],
    ),
  ),
);
describe("design contracts (static tokens, not browser computed)", () => {
  it("distinguishes staff audit requests from the controller dispatch commit", () => {
    expect(auditNames["operation.dispatch_requested"]).toEqual([
      "请求派发任务",
      "Task dispatch requested",
    ]);
    expect(auditNames["operation.reconcile_requested"]).toEqual([
      "请求核对任务",
      "Task reconciliation requested",
    ]);
    expect(auditNames["operation.dispatch_committed"]).toEqual([
      "任务派发已提交",
      "Task dispatch committed",
    ]);
  });
  for (const [index, theme] of themes.entries()) {
    for (const surface of [
      "--canvas",
      "--surface",
      "--surface-raised",
      "--subtle",
    ])
      for (const text of ["--text", "--secondary", "--muted"])
        it(`${index === 0 ? "light" : "dark"} ${text} on ${surface} is AA`, () =>
          expect(ratio(theme[text]!, theme[surface]!)).toBeGreaterThanOrEqual(
            4.5,
          ));
    for (const [text, bg] of [
      ["--accent-text", "--accent-bg"],
      ["--on-accent", "--accent"],
      ["--success", "--success-bg"],
      ["--danger", "--danger-bg"],
      ["--warning", "--warning-bg"],
      ["--sidebar-text", "--sidebar-bg"],
      ["--sidebar-secondary", "--sidebar-bg"],
    ])
      it(`${index} semantic ${text} on ${bg}`, () =>
        expect(ratio(theme[text!]!, theme[bg!]!)).toBeGreaterThanOrEqual(4.5));
  }
  it("has both complete palettes", () => expect(themes).toHaveLength(2));
  it("has no browser-native select, alert/confirm, mocked data imports or credential storage in production", () => {
    const walk = (p: string): string[] =>
      readdirSync(p, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(resolve(p, e.name))
          : /\.(?:vue|ts)$/.test(e.name)
            ? [resolve(p, e.name)]
            : [],
      );
    for (const f of walk(root)) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(
        /<select\b|\b(?:alert|confirm)\s*\(|from\s+['"][^'"]*(?:fixtures|demo|mock)/,
      );
      expect(text, f).not.toMatch(
        /(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:password|csrf_token)/,
      );
    }
  });
  it("honors reduced motion and safe areas", () => {
    expect(css).toContain("prefers-reduced-motion");
    expect(
      readFileSync(resolve(root, "components/ToastStack.vue"), "utf8"),
    ).toContain("env(safe-area-inset-bottom)");
  });
});
