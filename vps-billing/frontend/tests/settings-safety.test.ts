import { describe, expect, it } from "vitest";
import {
  currencyInput,
  currencyRegistry,
  displayLink,
  emailInput,
  emailSettings,
  integrationList,
  matchesSettingsSave,
  settingsResponse,
  siteInput,
  smtpRecipient,
} from "../src/services/settings-input";
import {
  nativeOperation,
  updateCandidate,
  updateStatus,
  validHandoff,
} from "../src/services/update-contract";
import {
  candidate,
  currencies,
  email,
  handoff,
  receipt,
  site,
  updates,
} from "./settings-fixtures";

describe("settings request and response boundaries", () => {
  it("validates complete site fields before access and strips unknown write fields", () => {
    expect(() => siteInput(null as any)).toThrow("INVALID_SETTINGS");
    expect(() => siteInput({ ...site(), site_name: undefined } as any)).toThrow(
      "INVALID_SETTINGS",
    );
    expect(
      siteInput({ ...site(), extra: "not-sent" } as any),
    ).not.toHaveProperty("extra");
    expect(() =>
      siteInput({ ...site(), company_name: "hidden\u0085control" }),
    ).toThrow();
    expect(siteInput(site()).default_currency).toBe("CNY");
  });
  it.each([
    "https://example.com:443",
    "https://user@example.com",
    "https://example.local",
    "https://127.0.0.1",
    "https://example.com/#hash",
    "https://example.com\\evil",
    "HTTPS://example.com",
  ])("rejects unsafe/non-contract display URL %s", (url) =>
    expect(displayLink(url)).toBe(false),
  );
  it("allows support paths but only a bare display origin", () => {
    expect(displayLink("https://example.com/help?q=plan")).toBe(true);
    expect(displayLink("https://example.com", true)).toBe(true);
    expect(displayLink("https://example.com/", true)).toBe(false);
    expect(displayLink("https://example.com?", true)).toBe(false);
  });
  it("requires actual read-only registry flags and validates usage counts", () => {
    const c = currencies();
    expect(currencyRegistry(c)).toBe(true);
    delete (c.currencies[0] as any).precision_locked;
    expect(settingsResponse("currencies", c)).toBe(false);
    const malformed = currencies();
    malformed.currencies[0]!.usage!.pending_orders = -1;
    expect(currencyRegistry(malformed)).toBe(false);
  });
  it("keeps registered codes, locked precision and open invoices; never echoes read-only fields", () => {
    const c = currencies();
    const value = currencyInput(c, c);
    expect(value.currencies[0]).not.toHaveProperty("usage");
    expect(value.currencies[0]).not.toHaveProperty("precision_locked");
    expect(() =>
      currencyInput({ ...value, currencies: value.currencies.slice(1) }, c),
    ).toThrow();
    const changed = structuredClone(value);
    changed.currencies[0]!.decimal_places = 3;
    expect(() => currencyInput(changed, c)).toThrow(
      "CURRENCY_PRECISION_LOCKED",
    );
    const disabled = structuredClone(value);
    disabled.currencies[0]!.enabled = false;
    disabled.default_currency = "USD";
    expect(() => currencyInput(disabled, c)).toThrow("CURRENCY_IN_USE");
  });
  it("validates single SMTP recipients and rejects lists, control characters and invalid local parts", () => {
    expect(smtpRecipient("test+one@example.invalid")).toBe(true);
    for (const v of [
      "a@b@c.invalid",
      "a..b@example.invalid",
      "x@example.invalid,y@example.invalid",
      "x\n@example.invalid",
      " x@example.invalid",
    ])
      expect(smtpRecipient(v)).toBe(false);
  });
  it("reads missing-key recovery state but never accepts echoed secrets or invalid plugin flags", () => {
    expect(
      emailSettings({ ...email(), enabled: true, key_configured: false }),
    ).toBe(true);
    expect(emailSettings({ ...email(), password: "must-never-return" })).toBe(
      false,
    );
    expect(
      emailSettings({
        ...email(),
        plugin_status: "approved",
        plugin_available: false,
      }),
    ).toBe(false);
    expect(emailSettings({ ...email(), updated_at: "not-a-time" })).toBe(false);
  });
  it("preserves blank credentials without writing placeholders and never trims a password", () => {
    const e = email();
    const body = emailInput({ ...e, username: "", password: "" }, e);
    expect(body).not.toHaveProperty("username");
    expect(body).not.toHaveProperty("password");
    expect(body).not.toHaveProperty("key_configured");
    expect(
      emailInput({ ...e, password: " synthetic password " }, e).password,
    ).toBe(" synthetic password ");
    expect(() => emailInput({ ...e, username: " user" }, e)).toThrow();
  });
  it("requires both replacement credentials for a new saved destination, or disabled clear-both", () => {
    const e = email();
    expect(() =>
      emailInput({ ...e, host: "other.example.invalid" }, e),
    ).toThrow();
    expect(
      emailInput(
        {
          ...e,
          host: "other.example.invalid",
          username: "new",
          password: "new-secret",
        },
        e,
      ).host,
    ).toBe("other.example.invalid");
    expect(
      emailInput(
        {
          ...e,
          host: "other.example.invalid",
          clear_username: true,
          clear_password: true,
        },
        e,
      ),
    ).toMatchObject({ clear_username: true, clear_password: true });
    expect(() => emailInput({ ...e, clear_password: true }, e)).toThrow();
    expect(() =>
      emailInput(
        { ...e, enabled: true, clear_username: true, clear_password: true },
        e,
      ),
    ).toThrow();
    expect(() =>
      emailInput({ ...e, password: "secret" }, { ...e, key_configured: false }),
    ).toThrow();
  });
  it("accepts empty disabled drafts and local verified-TLS destinations without inventing credentials", () => {
    const e = {
      ...email(),
      host: "",
      from_address: "",
      username_configured: false,
      password_configured: false,
      key_configured: false,
    };
    expect(emailInput(e, e).host).toBe("");
    expect(emailInput({ ...e, host: "::1" }, e).host).toBe("::1");
    expect(() => emailInput({ ...e, host: "0.0.0.0" }, e)).toThrow();
  });
  it("matches the actual submitted fields and new revision before confirming settings writes", () => {
    const s = site();
    expect(matchesSettingsSave("site", { ...s, revision: 2 }, s, s)).toBe(true);
    expect(
      matchesSettingsSave(
        "site",
        { ...s, revision: 2, site_name: "different" },
        s,
        s,
      ),
    ).toBe(false);
    expect(matchesSettingsSave("site", { ...s }, s, s)).toBe(false);
    const e = email(),
      body = emailInput({ ...e, password: "replacement" }, e);
    expect(matchesSettingsSave("email", { ...e, revision: 3 }, body, e)).toBe(
      true,
    );
    expect(
      matchesSettingsSave(
        "email",
        { ...e, revision: 3, password_configured: false },
        body,
        e,
      ),
    ).toBe(false);
  });
  it("does not treat partial integration metadata or a secret value as an acceptable response", () => {
    expect(integrationList({ items: [] })).toBe(true);
    expect(
      integrationList({
        items: [
          {
            id: "smtp",
            name: "SMTP",
            description: "",
            status: "ready",
            capabilities: [],
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("official update and unsigned handoff contracts", () => {
  it("accepts the official complete distribution but not substituted, missing or duplicate assets", () => {
    const c = candidate();
    expect(updateCandidate(c)).toBe(true);
    for (const assets of [
      c.assets.slice(1),
      [...c.assets.slice(0, 3), c.assets[0]!],
      c.assets.map((a, i) =>
        i === 3 ? { ...a, name: "arbitrary-command.sh" } : a,
      ),
      c.assets.map((a, i) => (i === 1 ? { ...a, size: 999999999 } : a)),
    ])
      expect(updateCandidate({ ...c, assets })).toBe(false);
    expect(updateCandidate({ ...c, tag: "v0.5.8" })).toBe(false);
    expect(
      updateCandidate({
        ...c,
        release_url: c.release_url.replace("github.com", "evil.invalid"),
      }),
    ).toBe(false);
  });
  it("distinguishes not checked, unavailable and checked empty status without accepting stale candidates", () => {
    expect(updateStatus(updates())).toBe(true);
    expect(
      updateStatus({
        ...updates(),
        source: { ...updates().source, status: "not_checked" },
        checked_at: "",
        items: [],
      }),
    ).toBe(true);
    expect(
      updateStatus({
        ...updates(),
        source: { ...updates().source, status: "unavailable" },
        checked_at: "",
        items: [],
      }),
    ).toBe(true);
    expect(
      updateStatus({
        ...updates(),
        source: { ...updates().source, status: "unavailable" },
      }),
    ).toBe(false);
    expect(
      updateStatus({ ...updates(), checked_at: "2026-02-30T00:00:00Z" }),
    ).toBe(false);
  });
  it("rejects inconsistent success/rollback receipts, invalid release identity and reversed nanosecond times", () => {
    expect(nativeOperation(receipt())).toBe(true);
    for (const fields of [
      { program_rollback: "verified_old_schema" },
      { phase: "migrate" },
      { maintenance: true },
      { https_ready: false },
      { previous_core_version: "", previous_source_sha: "" },
      { target_source_sha: "not-a-hash" },
      { database_migration: { started: false, completed: true } },
      {
        started_at: "2026-10-21T00:00:00.000000002Z",
        updated_at: "2026-10-21T00:00:00.000000001Z",
      },
    ])
      expect(
        nativeOperation({
          ...receipt(),
          operation: { ...receipt().operation, ...fields },
        }),
      ).toBe(false);
    expect(nativeOperation({ state: "absent", operation: undefined })).toBe(
      false,
    );
  });
  it("accepts a verified rollback only when the previous release is active and the old schema was verified", () => {
    const o = {
      ...receipt().operation,
      status: "rolled_back",
      phase: "readiness",
      active_release_changed: false,
      https_ready: false,
      service_action: "previous_started",
      program_rollback: "verified_old_schema",
      error_code: "operation_failed",
    };
    expect(nativeOperation({ state: "available", operation: o })).toBe(true);
    expect(
      nativeOperation({
        state: "available",
        operation: { ...o, active_release_changed: true },
      }),
    ).toBe(false);
  });
  it("binds an unsigned handoff to the current user, release facts, current versions, policy and exact asset identities", () => {
    const h = handoff(),
      c = candidate(),
      current = updates().current;
    expect(validHandoff(h, c, current, "e".repeat(32))).toBe(true);
    expect(
      validHandoff(
        {
          ...h,
          intent: {
            ...h.intent,
            assets: [...h.intent.assets]
              .reverse()
              .map(({ sha256, size, id, name }) => ({
                sha256,
                size,
                id,
                name,
              })),
          },
        },
        c,
        current,
      ),
    ).toBe(true);
    for (const changed of [
      { actor_id: "a".repeat(32) },
      { repository: "attacker/repository" },
      { current_core_version: "0.5.5" },
      { plugin_policy_revision: 2 },
      { run_id: 999 },
      { assets: h.intent.assets.slice(1) },
    ])
      expect(
        validHandoff(
          { ...h, intent: { ...h.intent, ...changed } },
          c,
          current,
          "e".repeat(32),
        ),
      ).toBe(false);
  });
  it("rejects future-created, expired, negative-duration and overlong handoffs", () => {
    const h = handoff(),
      c = candidate(),
      now = Date.now();
    for (const dates of [
      {
        created_at: new Date(now + 60000).toISOString(),
        expires_at: new Date(now + 120000).toISOString(),
      },
      {
        created_at: new Date(now - 120000).toISOString(),
        expires_at: new Date(now - 60000).toISOString(),
      },
      {
        created_at: new Date(now + 120000).toISOString(),
        expires_at: new Date(now + 60000).toISOString(),
      },
      {
        created_at: new Date(now - 1000).toISOString(),
        expires_at: new Date(now + 1800001).toISOString(),
      },
    ])
      expect(validHandoff({ ...h, intent: { ...h.intent, ...dates } }, c)).toBe(
        false,
      );
  });
});
