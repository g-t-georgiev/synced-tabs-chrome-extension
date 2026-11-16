/**
 * Which pages take part in mirroring, configured by `VITE_TARGET_MATCHES` (see `.env.example`):
 * comma- or whitespace-separated Chrome match patterns, e.g.
 * `http://localhost/*, https://dev.example.com/*`. The build writes them into the manifest's
 * `content_scripts.matches`, and the background worker accepts tabs on the same hostnames.
 *
 * Kept free of other imports: `scripts/build.mjs` imports this file directly.
 */

/** Used when `VITE_TARGET_MATCHES` is unset or empty: local dev servers only. */
export const DEFAULT_TARGET_MATCHES: readonly string[] = [
  "http://localhost/*",
  "http://127.0.0.1/*",
];

/** `scheme://host/path` with an http(s) or `*` scheme; the host may start with `*.`. */
const MATCH_PATTERN = /^(\*|https?):\/\/(\*|(?:\*\.)?[^/*:]+)(?::(?:\d+|\*))?\/.*$/;

/** Splits and validates the configured patterns; invalid entries are reported and skipped. */
export function parseTargetMatches(
  value: string | undefined,
  warn: (message: string) => void = () => {},
): string[] {
  const patterns = (value ?? "")
    .split(/[\s,]+/)
    .map((pattern) => pattern.trim())
    .filter(Boolean);

  const valid = patterns.filter((pattern) => {
    const ok = MATCH_PATTERN.test(pattern);
    if (!ok) warn(`Ignoring invalid match pattern "${pattern}" in VITE_TARGET_MATCHES.`);
    return ok;
  });

  return valid.length ? valid : [...DEFAULT_TARGET_MATCHES];
}

/** A hostname rule: exact (`localhost`) or a domain with its subdomains (`*.example.com`). */
export interface HostRule {
  host: string;
  subdomains: boolean;
}

/** The hostnames the patterns cover, ignoring scheme, port and path. */
export function hostRules(patterns: readonly string[]): HostRule[] {
  return patterns.flatMap((pattern): HostRule[] => {
    const host = MATCH_PATTERN.exec(pattern)?.[2];
    if (!host || host === "*") return [];
    return host.startsWith("*.")
      ? [{ host: host.slice(2).toLowerCase(), subdomains: true }]
      : [{ host: host.toLowerCase(), subdomains: false }];
  });
}

/** Whether `hostname` is covered by one of the rules. */
export function matchesHost(hostname: string, rules: readonly HostRule[]): boolean {
  const name = hostname.toLowerCase();
  return rules.some(({ host, subdomains }) =>
    subdomains ? name === host || name.endsWith(`.${host}`) : name === host,
  );
}
