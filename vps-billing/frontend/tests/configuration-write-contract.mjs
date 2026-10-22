import assert from "node:assert/strict";

// Routes/permits use adapter-relative paths; recorded requests use URL.pathname.
export function assertConfigurationWrites(writes, path, count) {
  assert.equal(writes.length, count);
  assert.ok(
    writes.every(
      (entry) => entry.method === "POST" && entry.path === `/api/v1${path}`,
    ),
    "Every configuration write must target the exact same API endpoint",
  );
}
