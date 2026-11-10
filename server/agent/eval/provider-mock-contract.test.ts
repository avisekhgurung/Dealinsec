/**
 * The eval suite replaces whole modules with vi.mock, so a mock that is missing an export the pipeline calls does
 * not disable a feature — it throws a TypeError inside a run step, which a run-driving test can only report as
 * "run did not finish" (that is how adding opportunitySources() to the pipeline broke every outbound eval at once).
 * This test states the contract directly: the mock must stand in for every function the real module exports.
 */
import { describe, expect, it } from "vitest";
import * as realProvider from "../../discovery/provider";
import { discoveryProviderMock } from "./world-mocks";

describe("the discovery provider mock", () => {
  it("stands in for every function the real module exports", async () => {
    const mock = (await discoveryProviderMock()) as Record<string, unknown>;
    const missing = Object.entries(realProvider)
      .filter(([, v]) => typeof v === "function")
      .map(([k]) => k)
      .filter((k) => typeof mock[k] !== "function");
    expect(missing).toEqual([]);
  });

  it("reports no community demand source, so an eval run never scans and never reaches the network", async () => {
    const mock = (await discoveryProviderMock()) as { opportunitySources: () => unknown[] };
    expect(mock.opportunitySources()).toEqual([]);
  });

  it("reports no Social Intent source either: an eval can't reach Hacker News, Reddit or a billed web search", async () => {
    const mock = (await discoveryProviderMock()) as { socialSources: () => Promise<unknown[]> };
    expect(await mock.socialSources()).toEqual([]);
  });
});
