import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  headless: true,
  chromiumSandbox: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = async (name) => {
  await mkdir("qa", { recursive: true });
  await page.screenshot({ path: `qa/${name}.png`, fullPage: true });
};
const expectText = async (t) => {
  await page.getByText(t, { exact: false }).first().waitFor();
};
try {
  await page.goto("http://localhost:5173");
  await expectText("欢迎回来");
  await shot("login-desktop");
  await page.getByRole("button", { name: "体验客户工作台" }).click();
  await expectText("你的云端业务，井然有序。");
  await shot("dashboard-desktop");
  await page.getByRole("link", { name: "选购服务" }).click();
  await page.getByRole("button", { name: "选择此方案" }).first().waitFor();
  await shot("plans-desktop");
  await page.getByRole("button", { name: "选择此方案" }).first().click();
  await expectText("确认你的云服务器");
  await page.keyboard.press("Escape");
  if (await page.locator("dialog[open]").count())
    throw new Error("Escape did not close order dialog");
  await page.getByRole("button", { name: "选择此方案" }).first().click();
  await page
    .getByLabel("服务器名称", { exact: true })
    .fill("qa-browser-" + Date.now().toString().slice(-7));
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "创建待付款订单", exact: true })
    .click();
  await page.waitForURL("**/orders");
  await expectText("待付款");
  await shot("orders-desktop");
  await page.getByRole("link", { name: "账单与付款" }).click();
  await page
    .getByRole("button", { name: /查看账单 / })
    .first()
    .click();
  await expectText("账单详情");
  await page.getByRole("button", { name: "检查支付可用性" }).click();
  await expectText("未发生扣款");
  await shot("invoice-desktop");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByLabel("搜索记录").fill("impossible-no-record");
  await expectText("没有匹配的账单");
  await page.getByLabel("搜索记录").fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("link", { name: "工作台", exact: true }).click();
  await shot("dashboard-mobile");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) throw new Error("Mobile body overflows horizontally");
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("link", { name: "选购服务" }).click();
  await shot("plans-mobile");
  await page.getByRole("button", { name: "选择此方案" }).first().click();
  await shot("order-mobile");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expectText("欢迎回来");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "体验管理后台" }).click();
  await expectText("掌握全局，从容运营。");
  await shot("admin-desktop");
  for (const title of ["客户管理", "全部订单", "账单管理", "审计日志"]) {
    await page.getByRole("link", { name: title, exact: true }).click();
    await page.locator("h1").filter({ hasText: title }).waitFor();
  }
  await shot("audit-desktop");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS: real API customer login, order create, invoice, payment fail-closed, search, dialogs, mobile navigation/overflow, logout, admin pages. No browser runtime errors.",
  );
} finally {
  await browser.close();
}
