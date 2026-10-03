import { describe, expect, it } from "vitest";
import { activeProviderName } from "./provider";

const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;

describe("which search provider runs", () => {
  it("none when nothing is configured", () => {
    expect(activeProviderName(env({}))).toBeNull();
    expect(activeProviderName(env({ DISCOVERY_PROVIDER: "brave" }))).toBeNull();
  });
  it("whichever key exists; the free one wins if both do", () => {
    expect(activeProviderName(env({ BRAVE_SEARCH_API_KEY: "b" }))).toBe("brave");
    expect(activeProviderName(env({ LANGSEARCH_API_KEY: "l" }))).toBe("langsearch");
    expect(activeProviderName(env({ BRAVE_SEARCH_API_KEY: "b", LANGSEARCH_API_KEY: "l" }))).toBe("langsearch");
  });
  it("an explicit choice is honoured, and needs its own key", () => {
    expect(activeProviderName(env({ DISCOVERY_PROVIDER: "brave", BRAVE_SEARCH_API_KEY: "b", LANGSEARCH_API_KEY: "l" }))).toBe("brave");
    expect(activeProviderName(env({ DISCOVERY_PROVIDER: "LangSearch", LANGSEARCH_API_KEY: "l", BRAVE_SEARCH_API_KEY: "b" }))).toBe("langsearch");
    expect(activeProviderName(env({ DISCOVERY_PROVIDER: "brave", LANGSEARCH_API_KEY: "l" }))).toBeNull();
  });
  it("an unknown name falls back to whatever key exists rather than failing", () => {
    expect(activeProviderName(env({ DISCOVERY_PROVIDER: "bing", LANGSEARCH_API_KEY: "l" }))).toBe("langsearch");
  });
});
