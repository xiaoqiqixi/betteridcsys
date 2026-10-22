/** Non-secret administrator configuration; never a public plan or a controller credential. */
export interface ProductResources {
  datacenter_id: string;
  compute_node_id: string;
  node_group_id: string;
  image_id: string;
  cpu_cores: number;
  memory_mib: number;
  system_disk_gib: number;
  system_storage_id: string;
  data_disk_gib: number;
  data_storage_id: string;
  network_type: "normal" | "vpc";
  bandwidth_mbps: number;
  inbound_bandwidth_mbps: number;
  transfer_gib: number;
  traffic_direction: "in" | "out" | "all";
  ipv4_count: number;
  ipv6_count: number;
}
export interface ProductSpec {
  mode: "disabled" | "preset" | "custom";
  controller_id: string;
  remote_product_id: string;
  resources: ProductResources | null;
}
export interface ProductConfiguration {
  plan_id: string;
  revision: number;
  spec: ProductSpec;
  configuration_sha256: string;
  price_revision: number;
}
export const RESOURCE_KEYS = [
  "datacenter_id",
  "compute_node_id",
  "node_group_id",
  "image_id",
  "cpu_cores",
  "memory_mib",
  "system_disk_gib",
  "system_storage_id",
  "data_disk_gib",
  "data_storage_id",
  "network_type",
  "bandwidth_mbps",
  "inbound_bandwidth_mbps",
  "transfer_gib",
  "traffic_direction",
  "ipv4_count",
  "ipv6_count",
] as const satisfies readonly (keyof ProductResources)[];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exact = (
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> =>
  object(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const integer = (value: unknown, min: number, max: number) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max;
const resourceID = (value: unknown, required = false) =>
  typeof value === "string" &&
  ((!required && value === "") ||
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value));
export const disabledProductSpec = (): ProductSpec => ({
  mode: "disabled",
  controller_id: "",
  remote_product_id: "",
  resources: null,
});
export function validProductSpec(value: unknown): value is ProductSpec {
  if (
    !exact(value, ["mode", "controller_id", "remote_product_id", "resources"])
  )
    return false;
  if (value.mode === "disabled")
    return (
      value.controller_id === "" &&
      value.remote_product_id === "" &&
      value.resources === null
    );
  if (
    typeof value.controller_id !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.controller_id)
  )
    return false;
  if (value.mode === "preset")
    return (
      resourceID(value.remote_product_id, true) && value.resources === null
    );
  if (
    value.mode !== "custom" ||
    value.remote_product_id !== "" ||
    !exact(value.resources, RESOURCE_KEYS)
  )
    return false;
  const r = value.resources;
  return (
    [
      "datacenter_id",
      "compute_node_id",
      "node_group_id",
      "system_storage_id",
      "data_storage_id",
    ].every((key) => resourceID(r[key])) &&
    (r.datacenter_id !== "" || r.compute_node_id !== "") &&
    resourceID(r.image_id, true) &&
    integer(r.cpu_cores, 1, 4096) &&
    integer(r.memory_mib, 128, 1073741824) &&
    Number(r.memory_mib) % 128 === 0 &&
    integer(r.system_disk_gib, 1, 16777216) &&
    integer(r.data_disk_gib, 0, 16777216) &&
    (Number(r.data_disk_gib) > 0 || r.data_storage_id === "") &&
    (r.network_type === "normal" || r.network_type === "vpc") &&
    integer(r.bandwidth_mbps, 0, 10000000) &&
    integer(r.inbound_bandwidth_mbps, 0, 10000000) &&
    integer(r.transfer_gib, 0, 1073741824) &&
    (r.traffic_direction === "in" ||
      r.traffic_direction === "out" ||
      r.traffic_direction === "all") &&
    integer(r.ipv4_count, 0, 64) &&
    integer(r.ipv6_count, 0, 256) &&
    Number(r.ipv4_count) + Number(r.ipv6_count) >= 1
  );
}
export function validProductConfiguration(
  value: unknown,
): value is ProductConfiguration {
  return (
    exact(value, [
      "plan_id",
      "revision",
      "spec",
      "configuration_sha256",
      "price_revision",
    ]) &&
    typeof value.plan_id === "string" &&
    /^[A-Za-z0-9_.-]{1,64}$/.test(value.plan_id) &&
    ![".", ".."].includes(value.plan_id) &&
    integer(value.revision, 1, Number.MAX_SAFE_INTEGER) &&
    integer(value.price_revision, 1, Number.MAX_SAFE_INTEGER) &&
    typeof value.configuration_sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.configuration_sha256) &&
    validProductSpec(value.spec)
  );
}
/** Go's ProductSpec/Resources struct order is the canonical hash input. No money or secrets belong here. */
export function canonicalProductSpec(spec: ProductSpec): string {
  if (!validProductSpec(spec)) throw new Error("INVALID_PRODUCT_CONFIGURATION");
  const resources =
    spec.resources === null
      ? null
      : Object.fromEntries(
          RESOURCE_KEYS.map((key) => [key, spec.resources![key]]),
        );
  return JSON.stringify({
    mode: spec.mode,
    controller_id: spec.controller_id,
    remote_product_id: spec.remote_product_id,
    resources,
  });
}
export async function productConfigurationSHA256(
  spec: ProductSpec,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalProductSpec(spec));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
