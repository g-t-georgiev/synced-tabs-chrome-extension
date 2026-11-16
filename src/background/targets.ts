import { TARGET_HOSTS } from "../shared/constants";
import { matchesUrl, type HostRule } from "../shared/target-matches";

/**
 * Whether a tab URL belongs to a mirrored app: http(s), accepted by the configured patterns
 * (scheme, host and port, like the manifest's matches). `hosts` defaults to the build's
 * `VITE_TARGET_MATCHES`.
 */
export function isTargetUrl(
  url: string | undefined,
  hosts: readonly HostRule[] = TARGET_HOSTS,
): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const web = parsed.protocol === "http:" || parsed.protocol === "https:";
    return web && matchesUrl(parsed, hosts);
  } catch {
    return false;
  }
}
