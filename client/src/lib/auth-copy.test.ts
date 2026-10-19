import { describe, expect, it } from "vitest";
import { authErrorMessage, NETWORK_ERROR, RESET_LINK_INVALID, SERVER_ERROR, WRONG_CREDENTIALS } from "./auth-copy";

const api = (status: number, body: unknown) => new Error(`${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);

describe("auth error messages", () => {
  it("a failed fetch is the connection, never the account", () => {
    expect(authErrorMessage(new TypeError("Failed to fetch"), "login")).toBe(NETWORK_ERROR);
  });
  it("a wrong email or password says one thing, whichever was wrong", () => {
    expect(authErrorMessage(api(401, { message: "Invalid email or password" }), "login")).toBe(WRONG_CREDENTIALS);
  });
  it("keeps the server's own sentence for a refused form or a throttle", () => {
    expect(authErrorMessage(api(400, { message: "Password must be at least 6 characters" }), "signup")).toBe("Password must be at least 6 characters");
    expect(authErrorMessage(api(429, { message: "Too many sign-in attempts. Please wait a few minutes and try again." }), "login")).toMatch(/Too many sign-in attempts/);
  });
  it("never shows a raw status line or a gateway page", () => {
    expect(authErrorMessage(api(500, { message: "Failed to login" }), "login")).toBe(SERVER_ERROR);
    expect(authErrorMessage(api(502, "<html>Bad gateway</html>"), "signup")).toBe(SERVER_ERROR);
    expect(authErrorMessage(api(400, "<html></html>"), "reset")).toBe(RESET_LINK_INVALID);
  });
});
