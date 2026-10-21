// Node standard-library tests of our independent adapter, never Gemini UI code.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { test, after } from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = mkdtempSync(join(root, "tests/.data-check-"));
after(() => rmSync(out, { recursive: true, force: true }));
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
    "src/services/demo.ts",
    "src/composables/useWorkspace.ts",
  ],
  { cwd: root, stdio: "inherit" },
);
writeFileSync(join(out, "package.json"), '{"type":"commonjs"}');
const require = createRequire(import.meta.url);
const money = require(join(out, "types/idc.js"));
const { createDemoClient, DEMO_CUSTOMER_ID, DEMO_ADMIN_ID } = require(
  join(out, "services/demo.js"),
);
const { createApiClient } = require(join(out, "services/api.js"));
const { useWorkspace } = require(join(out, "composables/useWorkspace.js"));
const rejected = (code) => (error) => error.code === code;
function demo() {
  let role = "customer";
  return {
    client: createDemoClient(() => role),
    setRole: (value) => {
      role = value;
    },
  };
}
async function catalogInput(client, changes = {}) {
  const catalog = await client.read("/admin/catalog");
  return {
    name: "独立报价演示",
    description: "合成示例",
    type_id: "standard",
    region_id: "standard-hkg",
    node_id: "standard-hkg-a",
    taxonomy_revision: catalog.taxonomy_revision,
    region: "香港 HKG",
    cpu: 2,
    memory_gb: 4,
    disk_gb: 80,
    transfer_tb: 2,
    available: false,
    prices: [],
    revision: catalog.revision,
    currency_revision: catalog.currency_revision,
    reason: "合成测试新增",
    ...changes,
  };
}

test("exact money: safe-integer maximum, precision 0–6 and snapshot formatting", () => {
  assert.equal(
    money.parseMinor("9007199254740.991", 3),
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(
    money.formatMinor(Number.MAX_SAFE_INTEGER, 3),
    "9007199254740.991",
  );
  assert.equal(
    money.formatMinor(Number.MAX_SAFE_INTEGER, 6),
    "9007199254.740991",
  );
  assert.equal(money.parseMinor("0.000001", 6), 1);
  assert.equal(money.parseMinor("39", 2), 3900);
  assert.equal(money.parseMinor("10", 0), 10);
  assert.equal(
    money.formatMoney(3900, {
      code: "CNY",
      name: "人民币",
      prefix: "¥",
      suffix: "",
      decimal_places: 2,
    }),
    "¥39.00 CNY",
  );
  assert.equal(money.formatMoney(3900, undefined), "—");
  assert.equal(
    money.formatMoney(Number.MAX_SAFE_INTEGER + 1, {
      code: "CNY",
      name: "",
      prefix: "¥",
      suffix: "",
      decimal_places: 2,
    }),
    "—",
  );
});
test("money rejects signs, float/exponent tricks, rounding, zeros and overflow", () => {
  for (const value of [
    "0",
    "0.00",
    "01.00",
    "+1",
    "-1",
    "1e2",
    ".5",
    "1.",
    " 1",
    "1 ",
    "1.001",
    "90071992547409.92",
    "NaN",
  ])
    assert.throws(() => money.parseMinor(value, 2), value);
  assert.throws(() => money.parseMinor("1.0", 0));
  assert.throws(() => money.parseMinor("1", 7));
  assert.throws(() => money.formatMinor(0.1, 2));
});
test("public plans preserve unavailable zero quote rather than fabricate USD conversion", async () => {
  const { client } = demo();
  const plans = await client.read("/plans", { currency: "USD" });
  const missing = plans.find((plan) => plan.id === "sin-studio");
  assert.equal(missing.price_minor, 0);
  assert.equal(missing.available, false);
  await assert.rejects(
    client.read("/plans", { currency: "JPY" }),
    rejected("CURRENCY_DISABLED"),
  );
  await assert.rejects(client.read("/admin/catalog"), rejected("FORBIDDEN"));
});
test("catalog create, edit, independent prices, draft duplication and stale revisions", async () => {
  const { client, setRole } = demo();
  setRole("admin");
  const input = await catalogInput(client, {
    available: true,
    prices: [
      { currency: "CNY", amount_minor: 5900, available: true },
      { currency: "USD", amount_minor: 1100, available: true },
    ],
  });
  const created = await client.write("/admin/catalog", input);
  assert.equal(created.plan.available, true);
  assert.equal(created.plan.prices[1].amount_minor, 1100);
  await assert.rejects(
    client.write("/admin/catalog", input),
    rejected("CATALOG_CONFLICT"),
  );
  const duplicated = await client.write(
    `/admin/catalog/${created.plan.id}/duplicate`,
    {
      revision: created.revision,
      currency_revision: created.currency_revision,
      taxonomy_revision: created.taxonomy_revision,
      reason: "复制合成商品",
    },
  );
  assert.notEqual(duplicated.plan.id, created.plan.id);
  assert.equal(duplicated.plan.available, false);
  const edited = await client.write(
    `/admin/catalog/${created.plan.id}`,
    await catalogInput(client, {
      name: "新规格",
      cpu: 8,
      prices: [{ currency: "CNY", amount_minor: 7900, available: true }],
    }),
  );
  assert.equal(edited.plan.cpu, 8);
  assert.equal(edited.plan.available, false);
  await assert.rejects(
    client.write(
      "/admin/catalog",
      await catalogInput(client, { available: true }),
    ),
    rejected("INVALID_CATALOG"),
  );
  await assert.rejects(
    client.write(
      "/admin/catalog",
      await catalogInput(client, {
        prices: [{ currency: "CNY", amount_minor: 1.1, available: true }],
      }),
    ),
    rejected("INVALID_BODY"),
  );
});
test("create order is idempotent pending only; checkout cannot become a paid result", async () => {
  const { client } = demo();
  const plan = (await client.read("/plans", { currency: "CNY" }))[0];
  const input = {
    plan_id: plan.id,
    hostname: "demo-new",
    currency: "CNY",
    quote: {
      price_minor: plan.price_minor,
      decimal_places: 2,
      price_revision: plan.price_revision,
    },
  };
  await assert.rejects(
    client.write("/orders", input),
    rejected("IDEMPOTENCY_KEY_REQUIRED"),
  );
  await assert.rejects(
    client.write(
      "/orders",
      { ...input, quote: { ...input.quote, price_minor: 1 } },
      { "Idempotency-Key": "test-stale-quote" },
    ),
    rejected("PRICE_CHANGED"),
  );
  const created = await client.write("/orders", input, {
    "Idempotency-Key": "test-order-once",
  });
  assert.equal(created.status, "pending_payment");
  assert.equal(created.service_id, undefined);
  assert.deepEqual(
    await client.write("/orders", input, {
      "Idempotency-Key": "test-order-once",
    }),
    created,
  );
  await assert.rejects(
    client.write(
      "/orders",
      { ...input, hostname: "other" },
      { "Idempotency-Key": "test-order-once" },
    ),
    rejected("IDEMPOTENCY_CONFLICT"),
  );
  const detail = await client.read(`/orders/${created.id}`);
  assert.equal(detail.invoice.status, "unpaid");
  assert.equal(detail.service, null);
  await assert.rejects(
    client.write(`/invoices/${detail.invoice.id}/checkout`, {}),
    rejected("PAYMENT_NOT_CONFIGURED"),
  );
  assert.equal(
    (await client.read(`/invoices/${detail.invoice.id}`)).status,
    "unpaid",
  );
});
test("safe cancel atomically voids invoice; repeat adds no duplicate audit or fake service", async () => {
  const { client } = demo();
  const order = (await client.read("/orders"))[0];
  const before = await client.read("/audit-events");
  const result = await client.write(`/orders/${order.id}/cancel`, {
    reason: "取消合成测试",
  });
  assert.equal(result.order.status, "cancelled");
  assert.equal(result.invoice.status, "void");
  await client.write(`/orders/${order.id}/cancel`, {
    reason: "重复取消合成测试",
  });
  const after = await client.read("/audit-events");
  assert.equal(after.items.length, before.items.length + 1);
  await assert.rejects(
    client.write(`/orders/${order.id}`, { status: "paid" }),
    rejected("NOT_FOUND"),
  );
});
test("admin account version/role/disable guards and customer read ownership", async () => {
  const { client, setRole } = demo();
  setRole("admin");
  const self = await client.read(`/admin/customer-accounts/${DEMO_ADMIN_ID}`);
  await assert.rejects(
    client.write(`/admin/customer-accounts/${self.id}`, {
      name: self.name,
      role: "customer",
      disabled: false,
      revision: self.revision,
      reason: "错误自降权",
    }),
    rejected("SELF_ACCOUNT_CHANGE"),
  );
  const account = await client.read(
    `/admin/customer-accounts/${DEMO_CUSTOMER_ID}`,
  );
  const changed = await client.write(`/admin/customer-accounts/${account.id}`, {
    name: "更新的合成客户",
    role: "customer",
    disabled: false,
    revision: account.revision,
    reason: "更新合成姓名",
  });
  assert.equal(changed.revision, 2);
  assert.equal(changed.email, account.email);
  await assert.rejects(
    client.write(`/admin/customer-accounts/${account.id}`, {
      name: "过期修改",
      role: "admin",
      disabled: false,
      revision: 1,
      reason: "过期合成版本",
    }),
    rejected("ACCOUNT_CONFLICT"),
  );
  setRole("customer");
  assert.equal((await client.read("/orders")).length, 3);
  assert.equal((await client.read("/services"))[0].customer_id, undefined);
  assert.equal(
    (await client.read(`/orders/${(await client.read("/orders"))[0].id}`))
      .customer,
    undefined,
  );
  await assert.rejects(
    client.read("/admin/customer-accounts"),
    rejected("FORBIDDEN"),
  );
});
test("cursor pagination binds filter and identity; no owner field for client audit", async () => {
  const { client, setRole } = demo();
  setRole("admin");
  const first = await client.read("/admin/customer-accounts", { limit: 1 });
  assert.equal(first.items.length, 1);
  assert.equal(first.has_more, true);
  const second = await client.read("/admin/customer-accounts", {
    limit: 1,
    cursor: first.next_cursor,
  });
  assert.notEqual(second.items[0].id, first.items[0].id);
  await assert.rejects(
    client.read("/admin/customer-accounts", {
      limit: 1,
      role: "admin",
      cursor: first.next_cursor,
    }),
    rejected("INVALID_ACCOUNT_QUERY"),
  );
  setRole("customer");
  const audit = await client.read("/audit-events");
  assert.ok(audit.items.every((event) => !Object.hasOwn(event, "owner_id")));
  await assert.rejects(
    client.read("/audit-events", { owner_id: DEMO_CUSTOMER_ID }),
    rejected("INVALID_AUDIT_QUERY"),
  );
});
test("historical money and snapshots do not mutate with catalog changes", async () => {
  const { client, setRole } = demo();
  const history = await client.read("/orders");
  setRole("admin");
  await client.write(
    "/admin/catalog/hkg-essential",
    await catalogInput(client, {
      name: "不同今日名称",
      cpu: 32,
      prices: [{ currency: "CNY", amount_minor: 12900, available: true }],
    }),
  );
  setRole("customer");
  assert.deepEqual(await client.read("/orders"), history);
  const long = history.find((order) => order.currency === "KWD");
  assert.ok(
    money
      .formatMoney(long.total_minor, long.currency_format)
      .includes("9007199254740.991"),
  );
});
test("real transport obtains CSRF, sends quote/idempotency and same-origin only", async () => {
  const calls = [],
    sessions = [];
  const created = (await demo().client.read("/orders"))[0];
  const client = createApiClient({
    locale: () => "en",
    onSession: (value) => sessions.push(value),
    fetcher: async (url, init) => {
      calls.push([url, init]);
      return Response.json(
        {
          data:
            url === "/api/v1/session"
              ? {
                  user: null,
                  csrf_token: "synthetic-test-token",
                  demo_mode: false,
                }
              : created,
        },
        { status: url === "/api/v1/session" ? 200 : 201 },
      );
    },
  });
  await assert.rejects(
    client.write("/orders", {}, {}),
    rejected("IDEMPOTENCY_KEY_REQUIRED"),
  );
  assert.equal(calls.length, 0);
  const body = {
    plan_id: "a",
    hostname: "host",
    currency: "CNY",
    quote: { price_minor: 3900, decimal_places: 2, price_revision: 7 },
  };
  await client.write("/orders", body, {
    "Idempotency-Key": "test-real-transport",
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1].headers["X-CSRF-Token"], "synthetic-test-token");
  assert.equal(calls[1][1].headers["Idempotency-Key"], "test-real-transport");
  assert.equal(calls[1][1].credentials, "same-origin");
  assert.equal(calls[1][1].cache, "no-store");
  assert.deepEqual(JSON.parse(calls[1][1].body), body);
  assert.equal(sessions.length, 1);
  await assert.rejects(
    client.read("https://example.com/leak"),
    rejected("INVALID_REQUEST"),
  );
  await assert.rejects(client.read("/../session"), rejected("INVALID_REQUEST"));
});
test("real transport preserves valid request ID, suppresses diagnostics and never retries failure", async () => {
  let calls = 0;
  const client = createApiClient({
    locale: () => "zh-CN",
    onSession: () => {},
    fetcher: async () => {
      calls++;
      return Response.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "/host/private-secret-path",
            request_id: "b".repeat(32),
          },
        },
        { status: 500, headers: { "X-Request-ID": "a".repeat(32) } },
      );
    },
  });
  await assert.rejects(
    client.read("/orders"),
    (error) =>
      error.status === 500 &&
      error.code === "INTERNAL_ERROR" &&
      error.requestId === "a".repeat(32) &&
      !error.message.includes("private-secret"),
  );
  assert.equal(calls, 1);
});

test("non-JSON gateway GET 502/503/504 is service unavailable, localized and never retried or exposed", async () => {
  const privateHTML =
    "<html><title>proxy failure</title><p>/private/upstream-secret token=synthetic-secret</p></html>";
  for (const locale of ["zh-CN", "en"]) {
    for (const status of [502, 503, 504]) {
      const calls = [];
      const client = createApiClient({
        locale: () => locale,
        onSession: () => {},
        fetcher: async (...args) => {
          calls.push(args);
          return new Response(privateHTML, {
            status,
            headers: {
              "Content-Type": "text/html",
              "X-Request-ID": "c".repeat(32),
            },
          });
        },
      });
      await assert.rejects(
        client.read("/overview", { currency: "CNY" }),
        (error) => {
          assert.equal(error.code, "SERVICE_UNAVAILABLE");
          assert.equal(error.status, status);
          assert.equal(error.uncertain, false);
          assert.equal(error.requestId, "c".repeat(32));
          assert.equal(error.details, undefined);
          assert.match(
            error.message,
            locale === "en"
              ? /service is temporarily unavailable/i
              : /服务暂时不可用/,
          );
          assert.doesNotMatch(
            error.message,
            /<html>|upstream-secret|synthetic-secret|token=/,
          );
          return true;
        },
      );
      assert.equal(calls.length, 1);
      assert.equal(calls[0][1].method, "GET");
    }
  }
});

test("non-JSON POST 503 remains uncertain with its exact intent and no automatic retry", async () => {
  const calls = [];
  const client = createApiClient({
    locale: () => "en",
    onSession: () => {},
    fetcher: async (url, init) => {
      calls.push([url, init]);
      if (url === "/api/v1/session")
        return Response.json({
          data: { user: null, csrf_token: "fixture-token", demo_mode: false },
        });
      return new Response("<html>private upstream diagnostic</html>", {
        status: 503,
        headers: {
          "Content-Type": "text/html",
          "X-Request-ID": "unsafe-private-diagnostic",
        },
      });
    },
  });
  const body = {
    plan_id: "owned-plan",
    hostname: "owned-host",
    currency: "CNY",
    quote: { price_minor: 3900, decimal_places: 2, price_revision: 7 },
  };
  await assert.rejects(
    client.write("/orders", body, {
      "Idempotency-Key": "one-confirmed-intent",
    }),
    (error) => {
      assert.equal(error.code, "SERVICE_UNAVAILABLE");
      assert.equal(error.status, 503);
      assert.equal(error.uncertain, true);
      assert.equal(error.requestId, undefined);
      assert.equal(error.details, undefined);
      assert.doesNotMatch(
        error.message,
        /<html>|upstream diagnostic|unsafe-private/,
      );
      return true;
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(([, init]) => init.method === "POST").length, 1);
  assert.deepEqual(JSON.parse(calls[1][1].body), body);
  assert.equal(calls[1][1].headers["Idempotency-Key"], "one-confirmed-intent");
});

test("malformed successful JSON still fails the response contract, not the service-availability path", async () => {
  for (const method of ["GET", "POST"]) {
    const calls = [];
    const client = createApiClient({
      locale: () => "en",
      onSession: () => {},
      fetcher: async (url, init) => {
        calls.push([url, init]);
        if (url === "/api/v1/session")
          return Response.json({
            data: { user: null, csrf_token: "fixture-token", demo_mode: false },
          });
        return new Response("<html>not a valid success</html>", {
          status: 200,
        });
      },
    });
    const request =
      method === "GET"
        ? client.read("/overview")
        : client.write("/owned-fixture", { value: "synthetic" });
    await assert.rejects(request, (error) => {
      assert.equal(error.code, "INVALID_RESPONSE");
      assert.equal(error.status, 200);
      assert.equal(error.uncertain, method === "POST");
      assert.doesNotMatch(error.message, /<html>|not a valid success/);
      return true;
    });
    assert.equal(calls.filter(([, init]) => init.method === method).length, 1);
  }
});

test("write ambiguity is preserved, no malformed success or network error becomes success", async () => {
  let writes = 0;
  for (const malformed of [true, false]) {
    const client = createApiClient({
      locale: () => "en",
      onSession: () => {},
      fetcher: async (url) => {
        if (url.endsWith("/session"))
          return Response.json({
            data: { user: null, csrf_token: "token", demo_mode: false },
          });
        writes++;
        if (malformed) return new Response("not json", { status: 201 });
        throw new Error("disconnect");
      },
    });
    await assert.rejects(
      client.write("/auth/login", {
        email: "x@example.invalid",
        password: "not-real",
      }),
      (error) => error.uncertain === true,
    );
  }
  assert.equal(writes, 2);
});
test("workspace starts on real API, demo requires an explicit switch and discards pre-switch responses", async () => {
  const workspace = useWorkspace();
  assert.equal(workspace.mode.value, "api");
  assert.equal(workspace.session.value, null);
  assert.equal(workspace.sessionVerified.value, false);
  assert.equal(workspace.locale.value, "zh-CN");
  workspace.setMode("demo");
  assert.equal(workspace.sessionVerified.value, true);
  const pending = workspace.read("/orders");
  workspace.setDemoRole("admin");
  await assert.rejects(pending, rejected("STALE_RESPONSE"));
  assert.equal(workspace.role.value, "admin");
  workspace.setDemoRole("customer");
  assert.equal(workspace.currency.value, "CNY");
  assert.equal(workspace.reportCurrency.value, "CNY");
});
test("runtime contracts reject malformed core data instead of typed-cast success", async () => {
  for (const [path, value] of [
    ["/orders", {}],
    ["/invoices", [{ amount_minor: 3900 }]],
    ["/plans", [{ available: true, price_minor: 0 }]],
    ["/admin/catalog", { revision: 1, items: [] }],
    ["/orders/id", { order: {}, invoice: null }],
  ]) {
    const client = createApiClient({
      locale: () => "en",
      onSession: () => {},
      fetcher: async () => Response.json({ data: value }),
    });
    await assert.rejects(client.read(path), rejected("INVALID_RESPONSE"));
  }
  const plans = await demo().client.read("/plans", { currency: "USD" });
  const client = createApiClient({
    locale: () => "en",
    onSession: () => {},
    fetcher: async () => Response.json({ data: plans }),
  });
  assert.deepEqual(await client.read("/plans"), plans);
});

test("login rotates CSRF, refreshes the real session and logout accepts the backend anonymous DTO", async () => {
  const calls = [],
    sessions = [];
  let loggedIn = false,
    token = "anon-token";
  const user = {
    id: "a".repeat(32),
    name: "Local test",
    email: "local@example.invalid",
    role: "admin",
  };
  const client = createApiClient({
    locale: () => "zh-CN",
    onSession: (value) => sessions.push(value),
    fetcher: async (url, init) => {
      calls.push([url, init]);
      if (url.endsWith("/auth/login")) {
        assert.equal(init.headers["X-CSRF-Token"], "anon-token");
        loggedIn = true;
        token = "login-token";
      }
      if (url.endsWith("/auth/logout")) {
        assert.equal(init.headers["X-CSRF-Token"], "login-token");
        loggedIn = false;
        token = "logout-token";
        return Response.json({ data: { user: null, csrf_token: token } });
      }
      return Response.json({
        data: {
          user: loggedIn ? user : null,
          csrf_token: token,
          demo_mode: false,
        },
      });
    },
  });
  await client.write("/auth/login", {
    email: user.email,
    password: "test-only",
  });
  assert.deepEqual(
    calls.map(([url]) => url),
    ["/api/v1/session", "/api/v1/auth/login", "/api/v1/session"],
  );
  assert.equal(sessions.at(-1).user.id, user.id);
  await client.write("/auth/logout", {});
  assert.equal(sessions.at(-1).user, null);
  assert.equal(sessions.at(-1).csrf_token, "logout-token");
});
test("FORBIDDEN verifies role without turning a still-valid customer session into logout or replaying POST", async () => {
  let writes = 0,
    reads = 0;
  const sessions = [];
  const user = {
    id: "b".repeat(32),
    name: "Customer",
    email: "customer@example.invalid",
    role: "customer",
  };
  const client = createApiClient({
    locale: () => "en",
    onSession: (value) => sessions.push(value),
    fetcher: async (url) => {
      if (url.endsWith("/session")) {
        reads++;
        return Response.json({
          data: { user, csrf_token: "token", demo_mode: false },
        });
      }
      writes++;
      return Response.json(
        { error: { code: "FORBIDDEN", message: "not shown" } },
        { status: 403 },
      );
    },
  });
  await assert.rejects(
    client.write("/admin/site-settings", {}),
    rejected("FORBIDDEN"),
  );
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  assert.equal(sessions.at(-1).user.role, "customer");
});
test("CSRF_INVALID clears stale identity and does not replay the rejected write", async () => {
  let writes = 0;
  const sessions = [],
    invalid = [];
  const client = createApiClient({
    locale: () => "en",
    onSession: (value) => sessions.push(value),
    onSessionInvalid: (value) => invalid.push(value),
    fetcher: async (url) => {
      if (url.endsWith("/session"))
        return Response.json({
          data: {
            user: {
              id: "c".repeat(32),
              name: "Admin",
              email: "admin@example.invalid",
              role: "admin",
            },
            csrf_token: "token",
            demo_mode: false,
          },
        });
      writes++;
      return Response.json(
        { error: { code: "CSRF_INVALID", message: "not shown" } },
        { status: 403 },
      );
    },
  });
  await assert.rejects(
    client.write("/admin/site-settings", {}),
    rejected("CSRF_INVALID"),
  );
  assert.equal(writes, 1);
  assert.equal(sessions.at(-1).user, null);
  assert.equal(invalid.length, 1);
});
test("login fences a late anonymous session read so it cannot undo the new identity", async () => {
  let readCount = 0,
    resolveOld;
  const sessions = [];
  const user = {
    id: "d".repeat(32),
    name: "New user",
    email: "new@example.invalid",
    role: "customer",
  };
  const client = createApiClient({
    locale: () => "en",
    onSession: (value) => sessions.push(value),
    fetcher: async (url) => {
      if (url.endsWith("/auth/login"))
        return Response.json({
          data: { user, csrf_token: "new-token", demo_mode: false },
        });
      readCount++;
      if (readCount === 2)
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      return Response.json({
        data: {
          user: readCount === 1 ? null : user,
          csrf_token: readCount === 1 ? "anon" : "new-token",
          demo_mode: false,
        },
      });
    },
  });
  await client.refreshSession();
  const oldRead = client.read("/session");
  const oldRejected = assert.rejects(oldRead, rejected("STALE_RESPONSE"));
  await client.write("/auth/login", {
    email: user.email,
    password: "test-only",
  });
  resolveOld(
    Response.json({
      data: { user: null, csrf_token: "old-anonymous", demo_mode: false },
    }),
  );
  await oldRejected;
  assert.equal(sessions.at(-1).user.id, user.id);
  assert.equal(sessions.at(-1).csrf_token, "new-token");
});
test("an acknowledged auth write with failed confirmation is uncertain, never a confirmed login", async () => {
  let reads = 0,
    writes = 0;
  const invalid = [];
  const client = createApiClient({
    locale: () => "en",
    onSession: () => {},
    onSessionInvalid: (value) => invalid.push(value),
    fetcher: async (url) => {
      if (url.endsWith("/session")) {
        reads++;
        if (reads > 1) throw new Error("offline");
        return Response.json({
          data: { user: null, csrf_token: "anon", demo_mode: false },
        });
      }
      writes++;
      return Response.json({
        data: {
          user: {
            id: "e".repeat(32),
            name: "User",
            email: "u@example.invalid",
            role: "customer",
          },
          csrf_token: "new",
          demo_mode: false,
        },
      });
    },
  });
  await assert.rejects(
    client.write("/auth/login", {}),
    (error) => error.code === "SESSION_REFRESH_FAILED" && error.uncertain,
  );
  assert.equal(writes, 1);
  assert.equal(invalid.length, 1);
});

test("taxonomy is a real four-level registry and catalog rejects mismatched or stale parentage", async () => {
  const { client, setRole } = demo();
  const publicTree = await client.read("/catalog-taxonomy");
  assert.ok(publicTree.types.length >= 2);
  const plans = await client.read("/plans");
  for (const plan of plans) {
    assert.equal(plan.taxonomy_revision, publicTree.revision);
    assert.ok(
      publicTree.regions.some(
        (r) =>
          r.id === plan.region_id &&
          r.type_id === plan.type_id &&
          r.name === plan.region,
      ),
    );
    assert.ok(
      publicTree.nodes.some(
        (node) => node.id === plan.node_id && node.region_id === plan.region_id,
      ),
    );
    assert.equal(Object.hasOwn(plan, "line_id"), false);
  }
  await assert.rejects(
    client.write("/admin/catalog-taxonomy", {}),
    rejected("FORBIDDEN"),
  );
  setRole("admin");
  await assert.rejects(
    client.write(
      "/admin/catalog",
      await catalogInput(client, { type_id: "compute" }),
    ),
    rejected("INVALID_CATALOG"),
  );
  await assert.rejects(
    client.write(
      "/admin/catalog",
      await catalogInput(client, {
        taxonomy_revision: publicTree.revision + 1,
      }),
    ),
    rejected("TAXONOMY_CONFLICT"),
  );
});

test("taxonomy draft edits are revisioned, audited, sorted and disabled entries stay private", async () => {
  const { client, setRole } = demo();
  setRole("admin");
  const original = await client.read("/admin/catalog-taxonomy");
  const next = {
    ...original,
    types: [
      ...original.types,
      { id: "paused", name: "待开放", sort_order: 9, enabled: false },
    ],
    regions: [
      ...original.regions,
      {
        id: "paused-hkg",
        type_id: "paused",
        name: "香港",
        sort_order: 0,
        enabled: true,
      },
    ],
    reason: "新增停用分类",
  };
  const saved = await client.write("/admin/catalog-taxonomy", next);
  assert.equal(saved.revision, original.revision + 1);
  await assert.rejects(
    client.write("/admin/catalog-taxonomy", next),
    rejected("TAXONOMY_CONFLICT"),
  );
  assert.ok(
    (await client.read("/admin/audit-events")).items.some(
      (e) => e.action === "catalog.taxonomy_updated",
    ),
  );
  setRole("customer");
  const visible = await client.read("/catalog-taxonomy");
  assert.equal(
    visible.types.some((t) => t.id === "paused"),
    false,
  );
  assert.equal(
    visible.regions.some((r) => r.id === "paused-hkg"),
    false,
  );
});

test("taxonomy cannot retire or remove published parents and failed writes preserve the registry", async () => {
  const { client, setRole } = demo();
  setRole("admin");
  const tree = await client.read("/admin/catalog-taxonomy");
  const disabled = {
    ...tree,
    types: tree.types.map((t) => ({ ...t, enabled: false })),
    reason: "拒绝停用在售类型",
  };
  await assert.rejects(
    client.write("/admin/catalog-taxonomy", disabled),
    rejected("TAXONOMY_IN_USE"),
  );
  const removed = {
    ...tree,
    regions: [],
    nodes: [],
    reason: "拒绝移除引用地区",
  };
  await assert.rejects(
    client.write("/admin/catalog-taxonomy", removed),
    rejected("TAXONOMY_IN_USE"),
  );
  assert.deepEqual(await client.read("/admin/catalog-taxonomy"), tree);
});

test("classification rename expires old quotes, preserves historic bytes and allows original order replay", async () => {
  const { client, setRole } = demo();
  const oldHistory = await client.read("/orders");
  const plan = (await client.read("/plans"))[0];
  const body = {
    plan_id: plan.id,
    hostname: "taxonomy-preserved",
    currency: plan.currency,
    quote: {
      price_minor: plan.price_minor,
      decimal_places: plan.currency_format.decimal_places,
      price_revision: plan.price_revision,
    },
  };
  const key = { "Idempotency-Key": "taxonomy-historical-replay" };
  const created = await client.write("/orders", body, key);
  const allHistory = await client.read("/orders");
  setRole("admin");
  const tree = await client.read("/admin/catalog-taxonomy");
  await client.write("/admin/catalog-taxonomy", {
    ...tree,
    regions: tree.regions.map((r) =>
      r.id === plan.region_id ? { ...r, name: "新的地区展示名称" } : r,
    ),
    reason: "只修改当前分类名称",
  });
  setRole("customer");
  assert.deepEqual(await client.read("/orders"), allHistory);
  assert.deepEqual((await client.read("/orders")).slice(1), oldHistory);
  assert.deepEqual(await client.write("/orders", body, key), created);
  await assert.rejects(
    client.write("/orders", body, {
      "Idempotency-Key": "taxonomy-new-attempt-key",
    }),
    rejected("PRICE_CHANGED"),
  );
  const current = (await client.read("/plans")).find((p) => p.id === plan.id);
  assert.equal(current.price_minor, plan.price_minor);
  assert.equal(current.currency, plan.currency);
  assert.equal(
    current.currency_format.decimal_places,
    plan.currency_format.decimal_places,
  );
  assert.equal(current.region, "新的地区展示名称");
});

test("nodes are revisioned real parents, never a bypass around product region or history", async () => {
  const { client, setRole } = demo();
  setRole("admin");
  const tree = await client.read("/admin/catalog-taxonomy");
  const added = await client.write("/admin/catalog-taxonomy", {
    ...tree,
    nodes: [
      ...tree.nodes,
      {
        id: "hkg-empty-node",
        region_id: "standard-hkg",
        name: "香港二区",
        sort_order: 20,
        enabled: true,
      },
    ],
    reason: "新增节点",
  });
  assert.equal(added.revision, tree.revision + 1);
  await assert.rejects(
    client.write(
      "/admin/catalog",
      await catalogInput(client, { node_id: "compute-tyo-a" }),
    ),
    rejected("INVALID_CATALOG"),
  );
  const moved = structuredClone(added);
  moved.nodes.find((n) => n.id === "standard-hkg-a").region_id = "standard-sin";
  await assert.rejects(
    client.write("/admin/catalog-taxonomy", {
      ...moved,
      reason: "禁止移动在用节点",
    }),
    rejected("TAXONOMY_IN_USE"),
  );
  const disabled = await client.write("/admin/catalog-taxonomy", {
    ...added,
    nodes: added.nodes.map((n) =>
      n.id === "hkg-empty-node" ? { ...n, enabled: false } : n,
    ),
    reason: "停用未使用节点",
  });
  setRole("customer");
  const visible = await client.read("/catalog-taxonomy");
  assert.ok(!visible.nodes.some((n) => n.id === "hkg-empty-node"));
  const plans = await client.read("/plans");
  assert.ok(
    plans.every((p) =>
      visible.nodes.some(
        (n) => n.id === p.node_id && n.region_id === p.region_id,
      ),
    ),
  );
  assert.equal(visible.revision, disabled.revision);
});
