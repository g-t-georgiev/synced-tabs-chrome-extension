import { describe, expect, it } from "vite-plus/test";
import { hostRules, parseTargetMatches } from "../shared/target-matches";
import { isTargetUrl } from "./targets";

/** Test hosts, independent of any local `.env`. */
const HOSTS = hostRules(
  parseTargetMatches(
    "http://localhost/*, http://127.0.0.1/*, https://ci.example.test/*, https://*.preview.example/*",
  ),
);

describe("isTargetUrl", () => {
  it.each([
    "http://localhost/",
    "http://localhost:8080/game?seed=1",
    "http://localhost:8081/",
    "http://localhost:5173/",
    "http://127.0.0.1:8080/",
    "https://ci.example.test/games/branch-x/",
    "https://branch-1.preview.example/",
    "https://preview.example/",
  ])("accepts %s", (url) => {
    expect(isTargetUrl(url, HOSTS)).toBe(true);
  });

  it.each([
    "https://example.com/?next=localhost",
    "https://example.com/localhost/",
    "http://localhost.evil.example/",
    "http://evil-localhost/",
    "https://ci.example.test.evil.example/",
    "https://sub.ci.example.test/",
    // The scheme counts: the pattern is http only, like the manifest's matches.
    "https://localhost:5173/",
    "http://ci.example.test/",
    "https://evilpreview.example/",
    "chrome://extensions/",
    "file:///C:/localhost/index.html",
    "not a url",
    "",
    undefined,
  ])("rejects %s", (url) => {
    expect(isTargetUrl(url, HOSTS)).toBe(false);
  });

  it("defaults to the build's hosts, local dev servers when nothing is configured", () => {
    expect(isTargetUrl("http://localhost:8080/")).toBe(true);
  });
});
