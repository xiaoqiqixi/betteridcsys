// Real MySQL-backed browser gate. Only session login/logout writes are allowed.
// The explicitly labelled GET fault is NOT persistence or backend-failure proof.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "@playwright/test";
import {
  assertLocalizedClose,
  assertCurrencyScope,
  assertAuditCopy,
  assertReadFailureCopy,
  malformedReadReply,
} from "./ui-copy-boundaries.mjs";

const { firefox } = await import(
  pathToFileURL(
    path.join(process.env.PLAYWRIGHT_MODULE_DIR, "playwright/index.mjs"),
  ).href
);
const scratch = process.env.ASTER_BILLING_BROWSER_CASE;
const credentials = JSON.parse(
  await fs.readFile(path.join(scratch, "credentials.json"), "utf8"),
);
const origin = credentials.origin;
assert.match(origin, /^https:\/\/localhost:[1-9]\d{0,4}$/);
const mode = process.argv[2];
assert.ok(["untrusted", "trusted", "acceptance"].includes(mode));
const profile = path.join(scratch, "firefox-profile");
const output = path.join(scratch, "public");
const progressState = {
  schema: "aster-billing-browser-progress-v1",
  phase: "browser-start",
  role: "none",
  size: "none",
  locale: "none",
  fault_hits: 0,
  fault_http_200: 0,
  fault_fulfilled: 0,
  fault_failed: 0,
};
async function progress(phase, labels = {}) {
  Object.assign(progressState, labels, { phase });
  const pending = path.join(scratch, "progress.pending");
  await fs.writeFile(pending, JSON.stringify(progressState), { mode: 0o600 });
  await fs.rename(pending, path.join(scratch, "progress.json"));
}
await progress("browser-start");
const context = await firefox.launchPersistentContext(profile, {
  headless: true,
  ignoreHTTPSErrors: false,
  acceptDownloads: false,
  serviceWorkers: "block",
  firefoxUserPrefs: { "security.enterprise_roots.enabled": false },
});
const page = context.pages()[0] || (await context.newPage());
page.setDefaultTimeout(20000);
const writes = [],
  violations = [],
  cases = [],
  screenshots = [];
await context.route("**/*", async (route) => {
  const request = route.request(),
    url = new URL(request.url());
  if (url.origin !== origin) {
    violations.push("external_request");
    await route.abort();
  } else if (
    !["GET", "HEAD"].includes(request.method()) &&
    !(
      request.method() === "POST" &&
      ["/api/v1/auth/login", "/api/v1/auth/logout"].includes(url.pathname)
    )
  ) {
    violations.push("business_write");
    await route.abort();
  } else {
    if (request.method() === "POST") writes.push(url.pathname);
    await route.continue();
  }
});

try {
  if (mode === "untrusted") {
    await progress("tls-untrusted-navigation");
    let rejected = false;
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded" });
    } catch (error) {
      rejected = /SEC_ERROR_UNKNOWN_ISSUER|SEC_ERROR_UNTRUSTED_ISSUER/.test(
        String(error),
      );
    }
    assert.ok(rejected, "Actual Firefox must reject the unknown localhost CA");
    await fs.writeFile(
      path.join(output, "tls.json"),
      JSON.stringify({
        untrusted_ca_rejected: true,
        private_profile_ca_trusted: false,
        ignore_https_errors: false,
        host_trust_modified: false,
      }),
      { mode: 0o600 },
    );
  } else if (mode === "trusted") {
    await progress("tls-trusted-navigation");
    const response = await page.goto(origin, {
      waitUntil: "domcontentloaded",
    });
    assert.equal(response?.status(), 200);
    assert.equal(new URL(page.url()).origin, origin);
    assert.deepEqual(violations, []);
    const file = path.join(output, "tls.json");
    const previous = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(previous.untrusted_ca_rejected, true);
    await fs.writeFile(
      file,
      JSON.stringify({ ...previous, private_profile_ca_trusted: true }),
    );
  } else {
    const dialog = () => page.getByRole("dialog").last();
    async function close() {
      await assertLocalizedClose(page);
      await dialog().locator(".panel-header button[aria-label]").click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    async function goto(route) {
      await page.goto(`${origin}/#${route}`, { waitUntil: "domcontentloaded" });
      await expect(
        page.locator(".ui-loading,.gh-loading,.gfo-loading"),
      ).toHaveCount(0);
    }
    async function language(locale) {
      if ((await page.locator("html").getAttribute("lang")) === locale) return;
      await progress("language-open", { locale });
      await page.locator(".locale-trigger").click();
      await progress("language-select");
      await dialog()
        .getByRole("combobox", { name: /^(语言|Language)$/ })
        .click();
      await page
        .getByRole("option", {
          name: locale === "en" ? "English" : "简体中文",
          exact: true,
        })
        .click();
      await progress("language-close");
      await close();
      await progress("language-assert");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    }
    async function currency(code, reporting) {
      await progress("currency-open");
      await page.locator(".locale-trigger").click();
      await progress("currency-select");
      await dialog()
        .getByRole("combobox", {
          name: reporting
            ? /^(报表币种|Report currency)$/
            : /^(购买币种|Purchase currency)$/,
        })
        .click();
      await page.getByRole("option", { name: new RegExp(code + "$") }).click();
      await progress("currency-assert");
      await assertCurrencyScope(page, reporting, code);
    }
    async function shot(name) {
      await progress("screenshot");
      const dimensions = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert.ok(
        dimensions.scroll <= dimensions.client + 1,
        "Document must not overflow horizontally",
      );
      await page.screenshot({ path: path.join(output, name), fullPage: true });
      screenshots.push(name);
    }
    async function session() {
      return await page.evaluate(async () => {
        const response = await fetch("/api/v1/session", {
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("session read failed");
        return (await response.json()).data;
      });
    }
    for (const [size, width, height] of [
      ["desktop", 1440, 1000],
      ["mobile", 375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      for (const role of ["customer", "admin"]) {
        await progress("reset-preferences", { role, size, locale: "zh-CN" });
        await context.clearCookies();
        await page.goto(origin);
        await page.evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
        });
        // Hash navigation does not reconstruct the module-level workspace.
        // Reload after clearing preferences so one role cannot inherit the
        // previous role's in-memory language/purchase currency.
        await progress("reset-reload");
        await page.reload({ waitUntil: "domcontentloaded" });
        await goto("/catalog");
        await progress("default-preferences");
        await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
        await expect(page.locator(".locale-currency")).toHaveText("CNY");
        await progress("login-open");
        await page.locator(".header-login").click();
        await assertLocalizedClose(page);
        await progress("login-fill");
        await dialog()
          .locator("input[type=email]")
          .fill(credentials[role].email);
        await dialog()
          .locator("input[autocomplete=current-password]")
          .fill(credentials[role].password);
        await progress("login-submit");
        await dialog()
          .getByRole("button", { name: /^(登录|Sign in)$/, exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.locator(".header-login")).toHaveCount(0);
        await progress("login-session");
        const authenticated = await session();
        assert.equal(authenticated.demo_mode, false);
        assert.equal(authenticated.user?.role, role);
        await progress("login-cookie");
        const cookies = await context.cookies(origin);
        const secure = cookies.find(
          (cookie) => cookie.name === "__Host-aster_session",
        );
        assert.ok(
          secure?.secure && secure.httpOnly && secure.sameSite === "Strict",
        );
        assert.equal(
          cookies.some((cookie) => cookie.name === "aster_demo_session"),
          false,
        );
        for (const locale of ["zh-CN", "en"]) {
          await progress("language-open", { locale });
          await language(locale);
          await goto(role === "admin" ? "/admin/finance" : "/catalog");
          // Scope description must remain correct even for default CNY reports.
          await currency("CNY", role === "admin");
          await close();
          await currency("USD", role === "admin");
          await shot(`scope-${role}-${size}-${locale}.png`);
          await close();
          cases.push({
            id: `currency-${role}-${size}-${locale}`,
            passed: true,
          });
          await progress("audit-navigation");
          if (role === "admin") {
            await goto("/catalog");
            await expect(page.locator(".locale-currency")).toHaveText("CNY");
            await goto("/admin/audit");
          } else await goto("/audit");
          await progress("audit-assert");
          await assertAuditCopy(
            page,
            "order.created",
            locale === "en" ? "Order created" : "订单已创建",
          );
          if (role === "admin") await shot(`audit-${size}-${locale}.png`);
          cases.push({ id: `audit-${role}-${size}-${locale}`, passed: true });
          if (role === "customer") {
            await progress("read-fault-baseline");
            await goto("/home");
            await expect(page.locator(".gh-workspace")).toBeVisible();
            const pattern = `${origin}/api/v1/overview*`;
            const faults = {
              fault_hits: 0,
              fault_http_200: 0,
              fault_fulfilled: 0,
              fault_failed: 0,
            };
            const pending = new Set();
            await progress("read-fault-inject", faults);
            await page.route(pattern, async (route) => {
              const injection = (async () => {
                faults.fault_hits++;
                try {
                  assert.equal(route.request().method(), "GET");
                  const actual = await route.fetch({ maxRedirects: 0 });
                  assert.equal(actual.status(), 200);
                  faults.fault_http_200++;
                  const payload = await actual.json();
                  assert.ok(
                    payload &&
                      typeof payload.data === "object" &&
                      payload.data !== null,
                  );
                  await route.fulfill(malformedReadReply(actual));
                  faults.fault_fulfilled++;
                } catch {
                  faults.fault_failed++;
                  await route.abort("failed").catch(() => {});
                }
              })();
              pending.add(injection);
              try {
                await injection;
              } finally {
                pending.delete(injection);
              }
            });
            await page.reload({ waitUntil: "domcontentloaded" });
            await progress("read-fault-delivery", faults);
            await expect
              .poll(() => faults.fault_fulfilled + faults.fault_failed)
              .toBeGreaterThan(0);
            await progress("read-fault-assert", faults);
            assert.equal(faults.fault_failed, 0);
            assert.ok(faults.fault_http_200 > 0 && faults.fault_fulfilled > 0);
            await assertReadFailureCopy(page, async (phase) =>
              progress(phase, faults),
            );
            await progress("read-fault-recover", faults);
            await page.unroute(pattern);
            await Promise.all([...pending]);
            await progress("read-fault-recover", faults);
            assert.equal(faults.fault_failed, 0);
            assert.equal(faults.fault_hits, faults.fault_fulfilled);
            await page
              .getByRole("alert")
              .getByRole("button", {
                name: locale === "en" ? "Retry" : "重新加载",
                exact: true,
              })
              .click();
            await expect(page.locator(".gh-workspace")).toBeVisible();
            cases.push({
              id: `synthetic-get-fault-${size}-${locale}`,
              passed: true,
            });
          }
        }
        await progress("logout-open");
        // Open the actual responsive account menu and revoke the real DB session.
        if (await page.locator(".idc-sidebar .account-trigger").isVisible())
          await page.locator(".idc-sidebar .account-trigger").click();
        else {
          await page
            .getByRole("button", { name: /^(打开导航|Open navigation)$/ })
            .click();
          await dialog()
            .getByRole("button", { name: /^(账户|Account)$/ })
            .click();
        }
        await assertLocalizedClose(page);
        await progress("logout-submit");
        await dialog()
          .getByRole("button", { name: /^(退出登录|Sign out)$/ })
          .click();
        await expect(page.locator(".header-login")).toBeVisible();
        await progress("logout-session");
        assert.equal((await session()).user, null);
      }
    }
    await progress("report-assert");
    assert.deepEqual(violations, []);
    assert.equal(writes.filter((value) => value.endsWith("/login")).length, 4);
    assert.equal(writes.filter((value) => value.endsWith("/logout")).length, 4);
    assert.equal(cases.length, 20);
    assert.equal(screenshots.length, 12);
    await progress("report-write");
    await fs.writeFile(
      path.join(output, "report.json"),
      JSON.stringify(
        {
          schema: "aster-billing-browser-mysql-v1",
          passed: true,
          api_mode: "production",
          mysql_fixture: true,
          synthetic_get_faults: 4,
          business_writes: 0,
          authenticated_logins: 4,
          authenticated_logouts: 4,
          cases,
          screenshots,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
} finally {
  await context.close();
}
