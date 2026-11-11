import { describe, expect, it } from "vite-plus/test";
import { isTargetUrl } from "./targets";

describe("isTargetUrl", () => {
  it.each([
    "http://localhost/",
    "http://localhost:8080/game?seed=1",
    "http://localhost:8081/",
    "https://localhost:5173/",
    "http://127.0.0.1:8080/",
    "https://frontend-dev.octoplay.dev/games/branch-x/",
  ])("accepts %s", (url) => {
    expect(isTargetUrl(url)).toBe(true);
  });

  it.each([
    "https://example.com/?next=localhost",
    "https://example.com/localhost/",
    "http://localhost.evil.example/",
    "http://evil-localhost/",
    "https://frontend-dev.octoplay.dev.evil.example/",
    "https://sub.frontend-dev.octoplay.dev/",
    "chrome://extensions/",
    "file:///C:/localhost/index.html",
    "not a url",
    "",
    undefined,
  ])("rejects %s", (url) => {
    expect(isTargetUrl(url)).toBe(false);
  });
});
