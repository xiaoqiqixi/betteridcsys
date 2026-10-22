// Synthetic configuration-only browser checks. No real controller or business write.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { assertConfigurationWrites } from "./configuration-write-contract.mjs";
import {
  accessiblePanel,
  apiData,
  assertScreenSafe,
  closePanel,
  createScreen,
  dialog,
  fixture,
  goto,
  noOverflow,
  permit,
} from "./e2e-support.mjs";
const digest = (spec) =>
  createHash("sha256").update(JSON.stringify(spec)).digest("hex");
export async function probeProductConfiguration(browser, base, storage) {
  const screen = await createScreen(browser, base, storage);
  const { page, context, state } = screen;
  try {
    const catalog = await apiData(context, base, "/api/v1/admin/catalog");
    assert.ok(catalog.items.length);
    const plan = catalog.items[0],
      path = `/admin/catalog/${plan.id}/product-configuration`;
    const disabled = {
      mode: "disabled",
      controller_id: "",
      remote_product_id: "",
      resources: null,
    };
    let current = {
      plan_id: plan.id,
      revision: 1,
      spec: disabled,
      configuration_sha256: digest(disabled),
      price_revision: catalog.revision,
    };
    fixture(state, "GET", path, () => current);
    fixture(state, "POST", path, ({ request }) => {
      const body = request.postDataJSON();
      assert.deepEqual(Object.keys(body).sort(), [
        "reason",
        "revision",
        "spec",
      ]);
      assert.equal(body.revision, current.revision);
      assert.equal(body.spec.mode, "custom");
      assert.equal(body.spec.controller_id, "synthetic-controller");
      assert.equal(body.spec.remote_product_id, "");
      assert.equal(Object.keys(body.spec.resources).length, 17);
      assert.equal(body.spec.resources.compute_node_id, "");
      assert.equal(body.spec.resources.datacenter_id, "synthetic-dc");
      current = {
        plan_id: plan.id,
        revision: current.revision + 1,
        spec: body.spec,
        configuration_sha256: digest(body.spec),
        price_revision: current.price_revision + 3,
      };
      return current;
    });
    for (const width of [320, 375, 720, 1440]) {
      current = {
        ...current,
        spec: disabled,
        configuration_sha256: digest(disabled),
      };
      await page.setViewportSize({ width, height: width === 375 ? 480 : 900 });
      await goto(page, base, "/admin/catalog");
      await page
        .locator(".product-row")
        .first()
        .getByRole("button", { name: "产品配置", exact: true })
        .click();
      const panel = dialog(page);
      await expect(panel.locator(".configuration-modes button")).toHaveCount(3);
      await accessiblePanel(page);
      await panel
        .locator(".configuration-modes button")
        .filter({ hasText: "自定义资源规格" })
        .click();
      await panel.getByLabel(/目标主控标识/).fill("synthetic-controller");
      await panel
        .getByLabel("数据中心 ID", { exact: true })
        .fill("synthetic-dc");
      await panel
        .getByLabel("系统镜像 ID", { exact: true })
        .fill("synthetic-image");
      await expect(
        panel.getByLabel("计算节点 ID", { exact: true }),
      ).toHaveValue("");
      const network = panel.getByRole("combobox").first();
      await network.focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(network).toContainText("VPC 网络");
      await panel
        .getByLabel(/操作原因/)
        .fill("Synthetic UI-only configuration boundary");
      const preview = JSON.parse(await panel.locator("pre").textContent());
      assert.equal(preview.resources.network_type, "vpc");
      assert.equal(preview.resources.memory_mib, 4096);
      assert.equal(preview.resources.bandwidth_mbps, 0);
      await noOverflow(page);
      const dimensions = await panel.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          viewport: innerWidth,
          inputs: [...node.querySelectorAll("input")].map(
            (input) => input.getBoundingClientRect().width,
          ),
        };
      });
      assert.ok(
        dimensions.left >= -1 && dimensions.right <= dimensions.viewport + 1,
      );
      assert.ok(
        dimensions.inputs.length === 16 &&
          dimensions.inputs.every((value) => value >= 100),
      );
      permit(state, path);
      const save = panel.getByRole("button", { name: "保存配置", exact: true });
      await save.scrollIntoViewIfNeeded();
      await save.focus();
      await page.keyboard.press("Enter");
      await expect(panel.getByRole("status")).toContainText(
        "仅用于后续新订单，保存不会立即开通",
      );
      await closePanel(page);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    assertConfigurationWrites(state.writes, path, 4);
    assertScreenSafe(screen);
    return 4;
  } finally {
    await context.close();
  }
}
