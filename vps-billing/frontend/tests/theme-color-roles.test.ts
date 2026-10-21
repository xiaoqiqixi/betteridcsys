import { describe, expect, it } from "vitest";
import { declaredRole } from "./theme-contrast.mjs";

// Source contracts protect the connection between the contrast-tested tokens and visible labels.
// Existing Vue behavior suites continue to cover exact amounts, unknown statuses and auth safety.
describe("shared controls consume their contrast-tested semantic role", () => {
  it.each([
    [".btn-primary", "color", "--action-primary-text"],
    [".btn-primary", "background", "--action-primary-bg"],
    [
      ".btn-primary:hover:not(:disabled)",
      "background",
      "--action-primary-hover",
    ],
    [".btn-admin", "color", "--action-admin-text"],
    [".btn-admin", "background", "--action-admin-bg"],
    [".btn-admin:hover:not(:disabled)", "background", "--action-admin-hover"],
    [".btn-danger", "color", "--status-danger"],
    [".btn-danger", "background", "--status-danger-bg"],
    [".error-box", "color", "--status-danger"],
    [".error-box", "background", "--status-danger-bg"],
    [".badge-success", "color", "--status-success"],
    [".badge-success", "background", "--status-success-bg"],
    [".badge-warning", "color", "--status-warning"],
    [".badge-warning", "background", "--status-warning-bg"],
    [".badge-danger", "color", "--status-danger"],
    [".badge-danger", "background", "--status-danger-bg"],
    [".badge-info", "color", "--status-info"],
    [".badge-info", "background", "--status-info-bg"],
    [".badge-neutral", "color", "--status-neutral"],
    [".badge-neutral", "background", "--status-neutral-bg"],
    [".data-table th", "background", "--bg-table-header"],
    [".data-table th", "color", "--text-secondary"],
    ["input::placeholder", "color", "--input-placeholder"],
    [".form-input", "border-color", "--border-control"],
    [".ui-select-trigger", "border", "--border-control"],
  ])("%s %s stays on %s", (selector, property, token) => {
    expect(
      declaredRole(selector, property),
      `${selector} ${property}`,
    ).toContain(`var(${token})`);
  });
});

describe("problematic component status labels and primary/admin actions retain semantic colors", () => {
  it.each([
    ["GeminiHome", ".gh-btn-primary", "color", "--action-primary-text"],
    [
      "GeminiHome",
      ".gh-btn-primary",
      "background-color",
      "--action-primary-bg",
    ],
    [
      "GeminiHome",
      ".gh-btn-primary:hover",
      "background-color",
      "--action-primary-hover",
    ],
    ["GeminiHome", ".gh-alert-icon", "color", "--status-warning"],
    [
      "GeminiHome",
      ".gh-alert-error .gh-alert-icon",
      "color",
      "--status-danger",
    ],
    [
      "GeminiHome",
      '.gh-status-text[data-tone="ok"]',
      "color",
      "--status-success",
    ],
    [
      "GeminiHome",
      '.gh-status-text[data-tone="warn"]',
      "color",
      "--status-warning",
    ],
    ["GeminiFinanceOverview", ".gfo-alert-icon", "color", "--status-danger"],
    [
      "GeminiFinanceOverview",
      ".gfo-cell-val.is-warn",
      "color",
      "--status-warning",
    ],
    [
      "GeminiFinanceOverview",
      '.gfo-status[data-tone="ok"]',
      "color",
      "--status-success",
    ],
    [
      "GeminiFinanceOverview",
      '.gfo-status[data-tone="warn"]',
      "color",
      "--status-warning",
    ],
    [
      "GeminiFinanceOverview",
      ".gfo-table th",
      "background",
      "--bg-table-header",
    ],
    ["GeminiCurrencyEditor", ".gce-btn-admin", "color", "--action-admin-text"],
    [
      "GeminiCurrencyEditor",
      ".gce-btn-admin",
      "background-color",
      "--action-admin-bg",
    ],
    ["GeminiCurrencyEditor", ".gce-btn-danger", "color", "--status-danger"],
    [
      "GeminiCurrencyEditor",
      ".gce-byte-hint.is-over",
      "color",
      "--status-danger",
    ],
    ["GeminiEmailEditor", ".gee-btn-admin", "color", "--action-admin-text"],
    [
      "GeminiEmailEditor",
      ".gee-status-item .is-ready",
      "color",
      "--status-success",
    ],
    [
      "GeminiEmailEditor",
      ".gee-status-item .is-warn",
      "color",
      "--status-warning",
    ],
  ])("%s %s %s stays on %s", (component, selector, property, token) => {
    expect(
      declaredRole(selector, property, `src/components/${component}.vue`),
    ).toBe(`var(${token})`);
  });
  it.each([
    ["OperationsPage", ".feedback-error", "--status-danger"],
    ["OperationsPage", ".feedback-info", "--status-info"],
    ["OperationsPage", ".feedback-warning", "--status-warning"],
    ["OperationsPage", ".demo-note", "--status-warning"],
    ["AdminCatalogPage", ".discard-confirmation h3", "--status-warning"],
    ["AdminCatalogPage", ".edit-action", "--status-warning"],
    ["AdminCatalogPage", ".price-currency small", "--status-warning"],
    ["AdminCatalogPage", ".editor-error", "--status-danger"],
  ])("%s %s keeps problem feedback on %s", (page, selector, token) => {
    expect(declaredRole(selector, "color", `src/pages/${page}.vue`)).toBe(
      `var(${token})`,
    );
  });
});
