// Real HTTPS read-only settings DTO check. No settings writes, SMTP tests, update checks or handoffs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = dirname(dirname(fileURLToPath(import.meta.url))),
  origin = process.env.IDC_TEST_ORIGIN;
if (
  !origin ||
  new URL(origin).protocol !== "https:" ||
  !process.env.IDC_TEST_CREDENTIALS
)
  throw new Error(
    "Explicit HTTPS origin and private credential file required. Use NODE_EXTRA_CA_CERTS for a private test CA.",
  );
const credentials = JSON.parse(
    readFileSync(process.env.IDC_TEST_CREDENTIALS, "utf8"),
  ),
  out = mkdtempSync(join(root, "tests/.settings-api-check-")),
  results = [];
let client,
  session = null,
  cookie = "";
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
      "src/services/settings-input.ts",
      "src/services/update-contract.ts",
    ],
    { cwd: root, stdio: "inherit" },
  );
  writeFileSync(join(out, "package.json"), '{"type":"commonjs"}');
  const require = createRequire(import.meta.url),
    { createApiClient } = require(join(out, "services/api.js")),
    { settingsResponse } = require(join(out, "services/settings-input.js")),
    { updateStatus, nativeOperation } = require(
      join(out, "services/update-contract.js"),
    );
  client = createApiClient({
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
      const response = await fetch(new URL(path, origin), { ...init, headers });
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
  await client.refreshSession();
  await client.write("/auth/login", credentials.admin);
  assert.equal(session.user?.role, "admin");
  assert.equal(session.demo_mode, false);
  for (const [kind, path] of [
    ["site", "/admin/site-settings"],
    ["currencies", "/admin/currencies"],
    ["email", "/admin/email-settings"],
    ["integrations", "/admin/integrations"],
  ]) {
    const value = await client.read(path);
    assert.equal(
      settingsResponse(kind, value),
      true,
      `Invalid live ${kind} DTO`,
    );
    results.push({
      check: `GET ${path} accepted by exact settings read guard`,
      passed: true,
    });
  }
  assert.equal(updateStatus(await client.read("/admin/updates")), true);
  results.push({
    check: "GET /admin/updates accepted by official update guard",
    passed: true,
  });
  assert.equal(
    nativeOperation(await client.read("/admin/updates/operation")),
    true,
  );
  results.push({
    check: "GET /admin/updates/operation accepted by receipt guard",
    passed: true,
  });
  const report = {
    checked_at: new Date().toISOString(),
    mode: "real-https-api-settings-read-contract",
    demo_mode: false,
    business_writes: 0,
    smtp_sends: 0,
    update_checks: 0,
    handoffs: 0,
    results,
    passed: true,
  };
  if (process.env.IDC_TEST_REPORT)
    writeFileSync(
      process.env.IDC_TEST_REPORT,
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(
    JSON.stringify({
      passed: true,
      checks: results.length,
      business_writes: 0,
      smtp_sends: 0,
      handoffs: 0,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      passed: false,
      completed_checks: results.length,
      code: /^[A-Z0-9_]+$/.test(error?.code || "")
        ? error.code
        : "SETTINGS_CONTRACT_FAILED",
      status: typeof error?.status === "number" ? error.status : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  if (client && session?.user)
    try {
      await client.write("/auth/logout", {});
    } catch {
      process.exitCode = 1;
    }
  rmSync(out, { recursive: true, force: true });
}
