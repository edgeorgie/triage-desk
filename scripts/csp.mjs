import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
const CSP_META = /<meta http-equiv="Content-Security-Policy"[^>]*>|<meta name="referrer"[^>]*>/g;

export function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const [, body] of html.matchAll(INLINE_SCRIPT)) {
    if (body.trim()) hashes.add(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  }
  return [...hashes];
}

/** The static export has no server to proxy analytics, so the deploy may name the vendor host; nothing is allowed otherwise. */
export function analyticsOrigins(host) {
  return host ? [host, "https://us-assets.i.posthog.com"] : [];
}

export function buildPolicy(hashes, connect = [], scripts = []) {
  return [
    "default-src 'self'",
    `script-src ${["'self'", ...hashes, ...scripts].join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src ${["'self'", ...connect].join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export function addCsp(html, connect = [], scripts = []) {
  const clean = html.replace(CSP_META, "");
  const policy = buildPolicy(inlineScriptHashes(clean), connect, scripts);
  const tags = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="strict-origin-when-cross-origin">`;
  if (!/<head[^>]*>/.test(clean)) return clean;
  return clean.replace(/<head[^>]*>/, (open) => open + tags);
}

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

/** Static hosts such as GitHub Pages cannot send headers, so the policy ships as a meta tag in every exported page. */
export function applyCsp(dir, connect = [], scripts = []) {
  let count = 0;
  for (const file of htmlFiles(dir)) {
    writeFileSync(file, addCsp(readFileSync(file, "utf8"), connect, scripts));
    count++;
  }
  return count;
}
