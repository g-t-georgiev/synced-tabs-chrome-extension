import { TARGET_HOSTNAMES } from "../shared/constants";

/** Whether a tab URL belongs to a mirrored app: http(s) on a target hostname, any port. */
export function isTargetUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === "http:" || protocol === "https:") && TARGET_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}
