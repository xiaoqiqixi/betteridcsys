import { describe, expect, it, vi } from "vitest";
import { malformedReadReply } from "./ui-copy-boundaries.mjs";

describe("browser schema-only fault framing", () => {
  it("requires a genuine 200 before constructing a valid JSON but invalid DTO", () => {
    const headers = vi.fn(() => ({
      "content-length": "4096",
      "content-encoding": "gzip",
      "transfer-encoding": "chunked",
      "set-cookie": "private-upstream-cookie",
    }));
    const result = malformedReadReply({ status: () => 200, headers });
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("application/json");
    expect(Number(result.headers["content-length"])).toBe(
      new TextEncoder().encode(result.body).byteLength,
    );
    expect(JSON.parse(result.body)).toEqual({ data: { malformed_read: true } });
    expect(headers).not.toHaveBeenCalled();
    expect(result.headers).not.toHaveProperty("content-encoding");
    expect(result.headers).not.toHaveProperty("transfer-encoding");
    expect(result.headers).not.toHaveProperty("set-cookie");
    expect(result).not.toHaveProperty("response");
  });
  it.each([201, 204, 302, 401, 403, 500, 503])(
    "never replaces upstream %s with a fake successful read",
    (status) => {
      expect(() => malformedReadReply({ status: () => status })).toThrow();
    },
  );
});
