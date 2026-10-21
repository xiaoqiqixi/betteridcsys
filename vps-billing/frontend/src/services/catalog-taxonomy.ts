export interface CatalogType {
  id: string;
  name: string;
  sort_order: number;
  enabled: boolean;
}

export interface CatalogRegion extends CatalogType {
  type_id: string;
}

export interface CatalogNode extends CatalogType {
  region_id: string;
}

export interface CatalogTaxonomy {
  revision: number;
  types: CatalogType[];
  regions: CatalogRegion[];
  nodes: CatalogNode[];
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9_.-]{1,64}$/.test(value) &&
  value !== "." &&
  value !== "..";
const validEntry = (value: unknown, maxBytes = 120): value is CatalogType =>
  object(value) &&
  validId(value.id) &&
  typeof value.name === "string" &&
  !!value.name.trim() &&
  new TextEncoder().encode(value.name).length <= maxBytes &&
  !/[\u0000-\u001f\u007f]/.test(value.name) &&
  Number.isSafeInteger(value.sort_order) &&
  (value.sort_order as number) >= 0 &&
  (value.sort_order as number) <= 1000000 &&
  typeof value.enabled === "boolean";

/** Validate identities and parentage before rendering a selectable catalog. */
export function validCatalogTaxonomy(value: unknown): value is CatalogTaxonomy {
  if (
    !object(value) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !Array.isArray(value.types) ||
    !Array.isArray(value.regions) ||
    !Array.isArray(value.nodes) ||
    value.types.length > 128 ||
    value.regions.length > 512 ||
    value.nodes.length > 2048 ||
    !value.types.every((item) => validEntry(item))
  )
    return false;
  const types = new Set(value.types.map((item) => item.id));
  const regions = new Set<string>();
  if (types.size !== value.types.length) return false;
  for (const item of value.regions) {
    if (
      !validEntry(item, 480) ||
      [...item.name].length > 120 ||
      !object(item) ||
      !validId(item.type_id) ||
      !types.has(item.type_id) ||
      regions.has(item.id)
    )
      return false;
    regions.add(item.id);
  }
  const nodes = new Set<string>();
  for (const item of value.nodes) {
    if (
      !validEntry(item) ||
      item.name !== item.name.trim() ||
      !object(item) ||
      !validId(item.region_id) ||
      !regions.has(item.region_id) ||
      nodes.has(item.id)
    )
      return false;
    nodes.add(item.id);
  }
  return true;
}

export function sortCatalogEntries<T extends CatalogType>(items: T[]): T[] {
  return [...items].sort(
    (left, right) =>
      left.sort_order - right.sort_order ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}
