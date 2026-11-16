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

/**
 * `scheme://host[:port]/*` with an http(s) or `*` scheme; the host may start with `*.`.
 * The path must be `/*`: the manifest's content script uses `match_origin_as_fallback`,
 * which Chrome only accepts with that path.
 */
const MATCH_PATTERN = /^(\*|https?):\/\/(\*|(?:\*\.)?[^/*:]+)(?::(\d+|\*))?\/\*$/;

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
    if (!ok) {
      warn(
        `Ignoring match pattern "${pattern}" in VITE_TARGET_MATCHES: expected scheme://host/* ` +
          `(http, https or *; the path must be /*).`,
      );
    }
    return ok;
  });

  return valid.length ? valid : [...DEFAULT_TARGET_MATCHES];
}

/**
 * What one pattern accepts: a scheme (or both), a host (exact, or a domain with its
 * subdomains for `*.example.com`), and a port (any when the pattern names none, like Chrome).
 */
export interface HostRule {
  scheme: "http" | "https" | "*";
  host: string;
  subdomains: boolean;
  /** Exact port, or undefined for any. */
  port?: string;
}

/** The rules the patterns describe, for the worker's tab check. */
export function hostRules(patterns: readonly string[]): HostRule[] {
  return patterns.flatMap((pattern): HostRule[] => {
    const match = MATCH_PATTERN.exec(pattern);
    if (!match) return [];
    const [, scheme, host, port] = match as unknown as [
      string,
      HostRule["scheme"],
      string,
      string?,
    ];
    if (host === "*") return [];
    const exactPort = port && port !== "*" ? port : undefined;
    return [
      host.startsWith("*.")
        ? { scheme, host: host.slice(2).toLowerCase(), subdomains: true, port: exactPort }
        : { scheme, host: host.toLowerCase(), subdomains: false, port: exactPort },
    ];
  });
}

const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" };

/** Whether an http(s) URL is accepted by one of the rules: scheme, host and port. */
export function matchesUrl(url: URL, rules: readonly HostRule[]): boolean {
  const name = url.hostname.toLowerCase();
  const port = url.port || DEFAULT_PORTS[url.protocol];
  return rules.some((rule) => {
    const schemeOk = rule.scheme === "*" || `${rule.scheme}:` === url.protocol;
    const hostOk = rule.subdomains
      ? name === rule.host || name.endsWith(`.${rule.host}`)
      : name === rule.host;
    const portOk = rule.port === undefined || rule.port === port;
    return schemeOk && hostOk && portOk;
  });
}
