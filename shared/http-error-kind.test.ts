import { describe, expect, it } from "vitest";
import { httpErrorKind, httpErrorStatus } from "./http-error-kind";

describe("httpErrorKind: what a detail screen may truthfully say", () => {
  it("404 is not found", () => {
    expect(httpErrorKind(new Error('404: {"error":"Contract not found"}'))).toBe("not_found");
    expect(httpErrorKind(new Error("404: Not Found"))).toBe("not_found");
  });
  it("403 is forbidden, whatever the body says", () => {
    expect(httpErrorKind(new Error('403: {"code":"FORBIDDEN","error":"Your role doesn\'t allow viewing this record."}'))).toBe("forbidden");
    expect(httpErrorKind(new Error('403: {"error":"Access denied"}'))).toBe("forbidden");
  });
  it("server errors, rate limits and expired sessions are failures to load, not 'not found'", () => {
    for (const s of ["500: oops", "502: Bad Gateway", "429: slow down", "401: Unauthorized", "409: conflict"]) {
      expect(httpErrorKind(new Error(s))).toBe("failed");
    }
  });
  it("an error with no status (network down, bad JSON) is a failure, never not-found", () => {
    expect(httpErrorKind(new TypeError("Failed to fetch"))).toBe("failed");
    expect(httpErrorKind(new SyntaxError("Unexpected token < in JSON"))).toBe("failed");
    expect(httpErrorKind(null)).toBe("failed");
    expect(httpErrorKind(undefined)).toBe("failed");
    expect(httpErrorKind({ status: 404 })).toBe("failed");
  });
  it("only a leading status counts", () => {
    expect(httpErrorKind(new Error("Request failed: 404: missing"))).toBe("failed");
    expect(httpErrorStatus(new Error("404: x"))).toBe(404);
    expect(httpErrorStatus("403: x")).toBe(403);
    expect(httpErrorStatus(new Error("nope"))).toBeNull();
  });
});
