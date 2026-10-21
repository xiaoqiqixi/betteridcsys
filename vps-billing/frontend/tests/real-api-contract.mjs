// Real production-mode API smoke: no business writes; credentials are read only from an explicit private file.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const origin = process.env.IDC_TEST_ORIGIN;
if (
  !origin ||
  new URL(origin).protocol !== "https:" ||
  !process.env.IDC_TEST_CREDENTIALS
)
  throw new Error(
    "Set an HTTPS IDC_TEST_ORIGIN, private IDC_TEST_CREDENTIALS, and trusted NODE_EXTRA_CA_CERTS when needed.",
  );
const credentials = JSON.parse(
  readFileSync(process.env.IDC_TEST_CREDENTIALS, "utf8"),
);
const out = mkdtempSync(join(root, "tests/.real-api-check-"));
const results = [];
try {
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "--target",
      "ES2022",
      "--module",
      "commonjs",
      "--moduleResolution",
      "node",
      "--lib",
      "ES2022,DOM",
      "--strict",
      "--skipLibCheck",
      "--outDir",
      out,
      "src/types/idc.ts",
      "src/services/api.ts",
    ],
    { cwd: root, stdio: "inherit" },
  );
  writeFileSync(join(out, "package.json"), '{"type":"commonjs"}');
  const require = createRequire(import.meta.url),
    { createApiClient } = require(join(out, "services/api.js"));
  for (const expectedRole of ["customer", "admin"]) {
    let cookie = "",
      session = null;
    const client = createApiClient({
      locale: () => "zh-CN",
      onSession: (value) => {
        session = value;
      },
      fetcher: async (path, init) => {
        const headers = {
          ...init.headers,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(init.method === "POST"
            ? {
                Origin: origin,
                "Content-Length": String(Buffer.byteLength(init.body ?? "")),
              }
            : {}),
        };
        const response = await fetch(new URL(path, origin), {
          ...init,
          headers,
        });
        if (process.env.IDC_TEST_TRACE === "1")
          console.error(
            JSON.stringify({
              method: init.method,
              path,
              status: response.status,
              content_type: response.headers.get("content-type"),
            }),
          );
        for (const value of response.headers.getSetCookie()) {
          const pair = value.split(";")[0];
          if (pair.startsWith("__Host-aster_session=")) {
            assert.match(value, /; Secure(?:;|$)/i);
            assert.match(value, /; HttpOnly(?:;|$)/i);
            assert.match(value, /; SameSite=Strict(?:;|$)/i);
            cookie = pair;
          }
        }
        return response;
      },
    });
    try {
      await client.refreshSession();
      assert.equal(session.demo_mode, false);
      assert.equal(session.user, null);
      await client.write("/auth/login", credentials[expectedRole]);
      assert.equal(session.demo_mode, false);
      assert.equal(session.user?.role, expectedRole);
      results.push({
        role: expectedRole,
        check: "real-session-login-csrf",
        passed: true,
      });
      let publicTaxonomy;
      for (const path of [
        "/site-settings",
        "/currencies",
        "/catalog-taxonomy",
        "/plans",
        "/overview",
        "/orders",
        "/invoices",
        "/services",
        "/audit-events",
      ]) {
        const query = ["/plans", "/overview"].includes(path)
          ? { currency: "CNY" }
          : path === "/audit-events"
            ? { limit: 1 }
            : undefined;
        const value = await client.read(path, query);
        if (path === "/catalog-taxonomy") {
          publicTaxonomy = value;
          assert.ok(value.types.every((entry) => entry.enabled));
          assert.ok(
            value.regions.every(
              (entry) =>
                entry.enabled &&
                value.types.some(
                  (parent) => parent.id === entry.type_id && parent.enabled,
                ),
            ),
          );
        }
        if (path === "/plans") {
          assert.ok(publicTaxonomy);
          assert.ok(
            value.every(
              (plan) =>
                plan.taxonomy_revision === publicTaxonomy.revision &&
                publicTaxonomy.types.some(
                  (entry) => entry.id === plan.type_id,
                ) &&
                publicTaxonomy.regions.some(
                  (entry) =>
                    entry.id === plan.region_id &&
                    entry.type_id === plan.type_id &&
                    entry.name === plan.region,
                ),
            ),
          );
        }
        results.push({
          role: expectedRole,
          check: `GET ${path}`,
          passed: true,
          ...(Array.isArray(value) ? { item_count: value.length } : {}),
        });
        if (path === "/orders" && value.length) {
          await client.read(`/orders/${encodeURIComponent(value[0].id)}`);
          results.push({
            role: expectedRole,
            check: "GET /orders/{id}",
            passed: true,
          });
        }
        if (path === "/invoices" && value.length) {
          await client.read(`/invoices/${encodeURIComponent(value[0].id)}`);
          results.push({
            role: expectedRole,
            check: "GET /invoices/{id}",
            passed: true,
          });
        }
      }
      if (expectedRole === "customer") {
        await assert.rejects(
          client.read("/admin/catalog"),
          (error) => error.code === "FORBIDDEN" && error.status === 403,
        );
        assert.equal(session.user?.role, "customer");
        results.push({
          role: expectedRole,
          check: "admin-denial-preserves-valid-customer-session",
          passed: true,
        });
      } else {
        let adminTaxonomy;
        for (const path of [
          "/admin/overview",
          "/admin/customers",
          "/admin/customer-accounts",
          "/admin/catalog-taxonomy",
          "/admin/catalog",
          "/admin/currencies",
          "/admin/plan-prices",
          "/admin/orders",
          "/admin/invoices",
          "/admin/services",
          "/admin/audit-events",
          "/admin/site-settings",
          "/admin/email-settings",
          "/admin/integrations",
          "/admin/updates",
          "/admin/updates/operation",
        ]) {
          const query = ["/admin/overview", "/admin/plan-prices"].includes(path)
            ? { currency: "CNY" }
            : ["/admin/audit-events", "/admin/customer-accounts"].includes(path)
              ? { limit: 1 }
              : undefined;
          const value = await client.read(path, query);
          if (path === "/admin/catalog-taxonomy") adminTaxonomy = value;
          if (path === "/admin/catalog") {
            assert.ok(adminTaxonomy);
            assert.equal(value.taxonomy_revision, adminTaxonomy.revision);
            assert.ok(
              value.items.every((plan) =>
                adminTaxonomy.regions.some(
                  (entry) =>
                    entry.id === plan.region_id &&
                    entry.type_id === plan.type_id &&
                    entry.name === plan.region,
                ),
              ),
            );
          }
          results.push({
            role: expectedRole,
            check: `GET ${path}`,
            passed: true,
            ...(Array.isArray(value) ? { item_count: value.length } : {}),
          });
          if (path === "/admin/orders" && value.length) {
            await client.read(
              `/admin/orders/${encodeURIComponent(value[0].id)}`,
            );
            results.push({
              role: expectedRole,
              check: "GET /admin/orders/{id}",
              passed: true,
            });
          }
        }
      }
      await client.write("/auth/logout", {});
      assert.equal(session.user, null);
      assert.equal(session.demo_mode, false);
      await assert.rejects(
        client.read("/orders"),
        (error) => error.code === "AUTH_REQUIRED",
      );
      results.push({
        role: expectedRole,
        check: "logout-revokes-private-access",
        passed: true,
      });
    } finally {
      if (session?.user)
        try {
          await client.write("/auth/logout", {});
        } catch {}
    }
  }
  const report = {
    checked_at: new Date().toISOString(),
    mode: "real-production-http-api",
    demo_mode: false,
    business_writes: 0,
    authentication_writes: true,
    tls_verification: "normal-chain-with-explicit-test-ca",
    results,
    passed: results.every((result) => result.passed),
  };
  if (process.env.IDC_TEST_REPORT)
    writeFileSync(
      process.env.IDC_TEST_REPORT,
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(
    JSON.stringify({
      passed: report.passed,
      checks: results.length,
      business_writes: 0,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      passed: false,
      completed_checks: results.length,
      code: /^[A-Z0-9_]+$/.test(error?.code || "")
        ? error.code
        : "CHECK_FAILED",
      status: typeof error?.status === "number" ? error.status : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
