import { describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_TARGET_MATCHES,
  hostRules,
  matchesHost,
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

  it("accepts ports and wildcard schemes and subdomains", () => {
    expect(
      parseTargetMatches(
        "http://localhost:8080/*, *://ci.example.test/*, https://*.example.com/app/*",
      ),
    ).toHaveLength(3);
  });
});

describe("hostRules / matchesHost", () => {
  const rules = hostRules([
    "http://localhost/*",
    "http://localhost:8080/*",
    "https://*.preview.example/*",
  ]);

  it("ignores scheme, port and path", () => {
    expect(matchesHost("localhost", rules)).toBe(true);
    expect(matchesHost("LOCALHOST", rules)).toBe(true);
  });

  it("matches a wildcard domain and its subdomains only", () => {
    expect(matchesHost("preview.example", rules)).toBe(true);
    expect(matchesHost("a.b.preview.example", rules)).toBe(true);
    expect(matchesHost("evilpreview.example", rules)).toBe(false);
  });

  it("never matches everything from a bare * host", () => {
    expect(hostRules(["*://*/*"])).toEqual([]);
  });
});
