import { describe, expect, it } from "vitest";
import {
  defaultSiteSettings,
  readPublicSiteSettings,
  readSiteSettings,
  safeSettingsEmailHref,
  safeSettingsURL,
  validateSiteSettings,
} from "../src/lib/settings";

describe("settings trust boundary", () => {
  it("defaults to Chinese/CNY and drops private and undeclared fields from the public model", () => {
    const input = {
      ...defaultSiteSettings,
      secret: "never-copy",
      email_signature: "private signature",
      invoice_address: "private address",
    };
    const result = readPublicSiteSettings(input);
    expect(result.default_locale).toBe("zh-CN");
    expect(result.default_currency).toBe("CNY");
    expect(result).not.toHaveProperty("revision");
    expect(result).not.toHaveProperty("email_signature");
    expect(result).not.toHaveProperty("invoice_address");
    expect(result).not.toHaveProperty("secret");
    expect(readSiteSettings(input)).not.toHaveProperty("secret");
  });
  it("rejects unsupported enums, remote logos, malformed records and unsafe revisions", () => {
    for (const patch of [
      { default_locale: "zh-TW" },
      { default_currency: "EUR" },
      { logo: "https://remote.example/logo.svg" },
      { theme: "body{color:red}" },
      { site_name: null },
      { company_name: {} },
      { invoice_issuer: " " },
      { revision: 0 },
      { revision: 2 ** 53 },
    ]) {
      expect(() =>
        readSiteSettings({ ...defaultSiteSettings, ...patch }),
      ).toThrow("INVALID_SETTINGS_RESPONSE");
    }
    for (const input of [null, [], {}, "text"])
      expect(() => readPublicSiteSettings(input)).toThrow();
  });
  it("uses UTF-8 byte length and rejects controls and unpaired surrogates", () => {
    expect(
      validateSiteSettings({
        ...defaultSiteSettings,
        site_name: "中".repeat(40),
      }),
    ).toEqual([]);
    for (const site_name of [
      "中".repeat(41),
      "bad\nname",
      "bad\u0085name",
      "bad\ud800name",
    ]) {
      expect(
        validateSiteSettings({ ...defaultSiteSettings, site_name }),
      ).toContainEqual({ field: "site_name", reason: "text" });
    }
    expect(
      validateSiteSettings({
        ...defaultSiteSettings,
        email_signature: "first\nsecond",
      }),
    ).toEqual([]);
  });
  it.each([
    "javascript:alert(1)",
    "http://example.com",
    "https://user:password@example.com",
    "https://@example.com",
    "https://example.com#",
    "https://example.com/#fragment",
    "https://example.com\\@evil.example",
    " https://example.com",
    "https://exam\nple.com",
    "https://example.com:invalid",
  ])("does not make unsafe URL clickable: %s", (value) => {
    expect(safeSettingsURL(value)).toBeUndefined();
  });
  it("allows HTTPS support links but restricts display domains to origins", () => {
    expect(safeSettingsURL("https://example.com/help?language=zh-CN")).toBe(
      "https://example.com/help?language=zh-CN",
    );
    expect(safeSettingsURL("https://example.com:8443", true)).toBe(
      "https://example.com:8443/",
    );
    for (const suffix of ["/", "/path", "?", "?x=1", "#fragment"])
      expect(
        safeSettingsURL(`https://example.com${suffix}`, true),
      ).toBeUndefined();
  });
  it("encodes the mailbox local part so query-like characters cannot become mailto headers", () => {
    expect(safeSettingsEmailHref("support?subject=example@example.com")).toBe(
      "mailto:support%3Fsubject%3Dexample%40example.com",
    );
    expect(
      safeSettingsEmailHref("Display <support@example.com>"),
    ).toBeUndefined();
    expect(
      safeSettingsEmailHref("support@example.com\nBcc:other@example.com"),
    ).toBeUndefined();
  });
  it("preserves server display strings when conservative link validation rejects them", () => {
    const input = {
      ...defaultSiteSettings,
      support_email: '"quoted local"@example.com',
      support_url: "https://example.com/#",
    };
    expect(readSiteSettings(input)).toEqual(input);
    expect(readPublicSiteSettings(input).support_email).toBe(
      input.support_email,
    );
    expect(safeSettingsEmailHref(input.support_email)).toBeUndefined();
    expect(safeSettingsURL(input.support_url)).toBeUndefined();
  });
});
