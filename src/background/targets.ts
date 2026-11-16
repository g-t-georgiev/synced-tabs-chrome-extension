import { TARGET_HOSTS } from "../shared/constants";
import { matchesHost, type HostRule } from "../shared/target-matches";

/**
 * Whether a tab URL belongs to a mirrored app: http(s) on a configured hostname, any port.
 * `hosts` defaults to the build's `VITE_TARGET_MATCHES`.
 */
export function isTargetUrl(
  url: string | undefined,
  hosts: readonly HostRule[] = TARGET_HOSTS,
): boolean {
  if (!url) return false;

  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === "http:" || protocol === "https:") && matchesHost(hostname, hosts);
  } catch {
    return false;
  }
}
