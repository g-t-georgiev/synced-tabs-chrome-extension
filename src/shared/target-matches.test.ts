import { describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_TARGET_MATCHES,
  hostRules,
  matchesUrl,
  parseTargetMatches,
} from "./target-matches";

describe("parseTargetMatches", () => {
  it("splits on commas and whitespace", () => {
    const value = " http://localhost/* ,https://ci.example.test/*\n http://127.0.0.1/*";
    expect(parseTargetMatches(value)).toEqual([
      "http://localhost/*",
      "https://ci.example.test/*",
      "http://127.0.0.1/*",
    ]);
  });

  it("falls back to local dev servers when unset or empty", () => {
    expect(parseTargetMatches(undefined)).toEqual(DEFAULT_TARGET_MATCHES);
    expect(parseTargetMatches("  ")).toEqual(DEFAULT_TARGET_MATCHES);
  });

  it("skips invalid patterns and reports them", () => {
    const warn = vi.fn();

    expect(parseTargetMatches("localhost, https://ci.example.test/*, ftp://x/*", warn)).toEqual([
      "https://ci.example.test/*",
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("accepts ports, wildcard schemes and subdomains", () => {
    expect(
      parseTargetMatches("http://localhost:8080/*, *://ci.example.test/*, https://*.example.com/*"),
    ).toHaveLength(3);
  });

  it("rejects paths other than /*, which match_origin_as_fallback doesn't allow", () => {
    const warn = vi.fn();

    expect(parseTargetMatches("https://*.example.com/app/*, https://x.test/", warn)).toEqual(
      DEFAULT_TARGET_MATCHES,
    );
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toContain("the path must be /*");
  });
});

describe("hostRules / matchesUrl", () => {
  const accepts = (patterns: string[], url: string) =>
    matchesUrl(new URL(url), hostRules(patterns));

  it("ignores case and the path", () => {
    expect(accepts(["http://localhost/*"], "http://LOCALHOST/game?seed=1")).toBe(true);
  });

  it("keeps the scheme, unless it's *", () => {
    expect(accepts(["https://ci.example.test/*"], "https://ci.example.test/")).toBe(true);
    expect(accepts(["https://ci.example.test/*"], "http://ci.example.test/")).toBe(false);
    expect(accepts(["*://ci.example.test/*"], "http://ci.example.test/")).toBe(true);
  });

  it("matches any port without one, and only that port with one", () => {
    expect(accepts(["http://localhost/*"], "http://localhost:8081/")).toBe(true);
    expect(accepts(["http://localhost:8080/*"], "http://localhost:8080/")).toBe(true);
    expect(accepts(["http://localhost:8080/*"], "http://localhost:8081/")).toBe(false);
    expect(accepts(["http://localhost:80/*"], "http://localhost/")).toBe(true); // default port
    expect(accepts(["http://localhost:*/*"], "http://localhost:3000/")).toBe(true);
  });

  it("matches a wildcard domain and its subdomains only", () => {
    const patterns = ["https://*.preview.example/*"];
    expect(accepts(patterns, "https://preview.example/")).toBe(true);
    expect(accepts(patterns, "https://a.b.preview.example/")).toBe(true);
    expect(accepts(patterns, "https://evilpreview.example/")).toBe(false);
  });

  it("never matches everything from a bare * host", () => {
    expect(hostRules(["*://*/*"])).toEqual([]);
  });
});
