/** Static, declared-color regression checks, not a substitute for rendered browser checks.
 * Uses CSS import order + root selector specificity; unsupported color syntax fails closed.
 * WCAG relative luminance / contrast: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postcss from "postcss";
import { parse as parseSfc } from "@vue/compiler-sfc";

export const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const appearances = ["light", "dark"];
export const brands = ["blue", "teal", "violet"];
export const surfaces = ["--bg-canvas", "--bg-surface", "--bg-elevated"];
export const textSurfaces = [...surfaces, "--bg-subtle", "--bg-table-header"];
export const statusNames = ["success", "warning", "danger", "info", "neutral"];

export function globalStyles(root = projectRoot) {
  const main = readFileSync(join(root, "src/main.ts"), "utf8");
  return [...main.matchAll(/import\s+['"](.+?\.css)['"]/g)].map(([, path]) => {
    const file = resolve(root, "src", path);
    return {
      file: relative(root, file),
      ast: postcss.parse(readFileSync(file, "utf8"), { from: file }),
    };
  });
}
function matchesRoot(selector, appearance, brand) {
  if (
    !selector.startsWith(":root") ||
    selector.replace(/\[[^\]]+\]/g, "") !== ":root"
  )
    return false;
  return [
    ...selector.matchAll(/\[([\w-]+)(?:\s*=\s*["']?([^\]"']+)["']?)?\]/g),
  ].every(([, key, value]) => {
    const actual =
      key === "data-appearance"
        ? appearance
        : key === "data-brand"
          ? brand
          : undefined;
    return actual !== undefined && (!value || actual === value.trim());
  });
}
export function rootTokens(
  appearance = "light",
  brand = "blue",
  styles = globalStyles(),
) {
  const declarations = new Map();
  let order = 0;
  for (const { ast } of styles)
    ast.walkRules((rule) => {
      // Viewport/forced-color-specific tokens require browser evidence; do not assume their state.
      for (let parent = rule.parent; parent; parent = parent.parent)
        if (parent.type === "atrule") return;
      for (const selector of rule.selectors) {
        if (!matchesRoot(selector.trim(), appearance, brand)) continue;
        const specificity = 1 + (selector.match(/\[/g)?.length ?? 0);
        rule.walkDecls(/^--/, (declaration) => {
          const candidate = {
            value: declaration.value,
            specificity,
            order: order++,
            important: !!declaration.important,
          };
          const current = declarations.get(declaration.prop);
          if (
            !current ||
            Number(candidate.important) > Number(current.important) ||
            (candidate.important === current.important &&
              (candidate.specificity > current.specificity ||
                (candidate.specificity === current.specificity &&
                  candidate.order > current.order)))
          )
            declarations.set(declaration.prop, candidate);
        });
      }
    });
  return Object.fromEntries(
    [...declarations].map(([key, declaration]) => [key, declaration.value]),
  );
}
export function resolveColorValue(value, tokens, trail = []) {
  return value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]+))?\)/g,
    (_, name, fallback) => {
      if (trail.includes(name))
        throw new Error(`Circular CSS token: ${[...trail, name].join(" -> ")}`);
      const next = tokens[name] ?? fallback;
      if (next === undefined) throw new Error(`Missing CSS token ${name}`);
      return resolveColorValue(next, tokens, [...trail, name]);
    },
  );
}
export function rgba(input) {
  const value = input.trim().toLowerCase();
  if (value === "transparent") return [0, 0, 0, 0];
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.test(value)) {
    const hex = value.slice(1),
      full =
        hex.length <= 4 ? [...hex].map((char) => char + char).join("") : hex;
    return [0, 2, 4]
      .map((offset) => parseInt(full.slice(offset, offset + 2), 16) / 255)
      .concat(full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1);
  }
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (!match) throw new Error(`Unsupported CSS color: ${input}`);
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4)
    throw new Error(`Invalid CSS color: ${input}`);
  const channels = parts.map((part, index) =>
    part.endsWith("%")
      ? parseFloat(part) / 100
      : Number(part) / (index < 3 ? 255 : 1),
  );
  if (channels.length === 3) channels.push(1);
  if (
    channels.some(
      (channel) => !Number.isFinite(channel) || channel < 0 || channel > 1,
    )
  )
    throw new Error(`Out-of-range CSS color: ${input}`);
  return channels;
}
export function composite(foreground, background) {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  if (!alpha) return [0, 0, 0, 0];
  return foreground
    .slice(0, 3)
    .map(
      (channel, index) =>
        (channel * foreground[3] +
          background[index] * background[3] * (1 - foreground[3])) /
        alpha,
    )
    .concat(alpha);
}
export function luminance(color) {
  const linear = color
    .slice(0, 3)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
export function contrast(foreground, background) {
  if (background[3] !== 1)
    throw new Error(
      "A contrast background must be composited onto an opaque surface",
    );
  const values = [
    luminance(composite(foreground, background)),
    luminance(background),
  ].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
export function contrastPairs() {
  const pairs = [];
  for (const background of textSurfaces) {
    for (const foreground of [
      "--text-primary",
      "--text-secondary",
      "--text-muted",
      "--input-placeholder",
      "--accent-primary",
      "--accent-admin",
    ])
      pairs.push({
        foreground,
        background,
        minimum: 4.5,
        purpose: "normal text",
      });
    if (surfaces.includes(background))
      for (const foreground of ["--border-focus", "--border-control"])
        pairs.push({
          foreground,
          background,
          minimum: 3,
          purpose: "essential control/focus boundary",
        });
    for (const status of statusNames)
      pairs.push({
        foreground: `--status-${status}`,
        background,
        minimum: 4.5,
        purpose: "unfilled status text",
      });
  }
  for (const status of statusNames)
    pairs.push({
      foreground: `--status-${status}`,
      background: `--status-${status}-bg`,
      minimum: 4.5,
      purpose: "status text on status tint",
    });
  for (const status of ["warning", "danger"])
    pairs.push({
      foreground: `--status-${status}`,
      background: `--status-${status}-hover`,
      minimum: 4.5,
      purpose: "status action hover label",
    });
  for (const background of ["--bg-hover", "--bg-active"])
    for (const foreground of [
      "--text-primary",
      "--text-secondary",
      "--accent-primary",
    ])
      pairs.push({
        foreground,
        background,
        minimum: 4.5,
        purpose: "hovered/selected navigation and options",
      });
  for (const action of ["primary", "admin"])
    for (const state of ["bg", "hover"])
      pairs.push({
        foreground: `--action-${action}-text`,
        background: `--action-${action}-${state}`,
        minimum: 4.5,
        purpose: "filled action label",
      });
  return pairs;
}
export function measureTheme(
  appearance = "light",
  brand = "blue",
  styles = globalStyles(),
) {
  const tokens = rootTokens(appearance, brand, styles);
  return contrastPairs().map((pair) => {
    const foreground = resolveColorValue(`var(${pair.foreground})`, tokens),
      background = resolveColorValue(`var(${pair.background})`, tokens);
    const bg = rgba(background);
    const ratio = contrast(rgba(foreground), bg);
    return {
      appearance,
      brand,
      ...pair,
      foreground_value: foreground,
      background_value: background,
      ratio,
      passed: ratio >= pair.minimum,
    };
  });
}
export function componentColorLiterals(root = projectRoot) {
  const violations = [];
  for (const folder of ["src/components", "src/pages"])
    for (const filename of readdirSync(join(root, folder)).filter((file) =>
      file.endsWith(".vue"),
    )) {
      const file = join(folder, filename),
        source = readFileSync(join(root, file), "utf8"),
        { descriptor } = parseSfc(source);
      for (const style of descriptor.styles)
        postcss
          .parse(style.content, { from: file })
          .walkDecls("color", (declaration) => {
            if (
              /#(?:[\da-f]{3,8})\b|(?:rgba?|hsla?|oklch|color-mix)\(/i.test(
                declaration.value,
              )
            )
              violations.push({
                file,
                selector: declaration.parent.selector,
                value: declaration.value,
                line: style.loc.start.line - 1 + declaration.source.start.line,
              });
          });
    }
  return violations;
}
export function declaredRole(selector, property, file, root = projectRoot) {
  const normalized = (value) => value.trim().replaceAll("'", '"');
  const sheets = file
    ? parseSfc(readFileSync(join(root, file), "utf8")).descriptor.styles.map(
        (style) => ({ ast: postcss.parse(style.content) }),
      )
    : globalStyles(root);
  let result;
  for (const { ast } of sheets)
    ast.walkRules((rule) => {
      if (
        !rule.selectors.some(
          (value) => normalized(value) === normalized(selector),
        )
      )
        return;
      rule.walkDecls(property, (declaration) => {
        result = declaration.value.replace(/\s+/g, "");
      });
    });
  return result;
}
export function staticContrastReport() {
  const styles = globalStyles(),
    measurements = appearances.flatMap((appearance) =>
      brands.flatMap((brand) => measureTheme(appearance, brand, styles)),
    );
  const component_literals = componentColorLiterals();
  return {
    checked_at: new Date().toISOString(),
    scope:
      "Declared CSS tokens and source role mapping only; rendered DOM, opacity, state inheritance, gradients and images require root browser verification.",
    metric: "WCAG 2.2 contrast ratio (sRGB)",
    css_import_order: styles.map((style) => style.file),
    measurements,
    component_literals,
    passed:
      measurements.every((item) => item.passed) && !component_literals.length,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const report = staticContrastReport(),
    flag = process.argv.indexOf("--report");
  if (flag >= 0)
    writeFileSync(
      process.argv[flag + 1],
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        measured_pairs: report.measurements.length,
        failed_pairs: report.measurements.filter((item) => !item.passed),
        component_literals: report.component_literals,
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 1;
}
