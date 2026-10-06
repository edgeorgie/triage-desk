export interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  comments: number;
  author: string;
  createdAt: string;
  url: string;
}

export function parseRepo(input: string): { owner: string; repo: string } | null {
  const s = input.trim().replace(/\.git$/, "");
  const short = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (short) return { owner: short[1], repo: short[2] };
  try {
    const u = new URL(s);
    const [owner, repo] = u.pathname.split("/").filter(Boolean);
    if (u.hostname === "github.com" && owner && repo) return { owner, repo };
  } catch {}
  return null;
}

interface ApiIssue {
  number: number;
  title: string;
  body: string | null;
  labels: ({ name?: string } | string)[];
  comments: number;
  user?: { login: string } | null;
  created_at: string;
  html_url: string;
  pull_request?: unknown;
}

export function toIssue(a: ApiIssue): Issue {
  return {
    number: a.number,
    title: a.title,
    body: (a.body ?? "").slice(0, 4000),
    labels: a.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean),
    comments: a.comments,
    author: a.user?.login ?? "ghost",
    createdAt: a.created_at,
    url: a.html_url,
  };
}

// Runs in the browser. Public repos, unauthenticated (60 requests per hour per IP).
export async function listIssues(owner: string, repo: string, perPage = 40): Promise<Issue[]> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=${perPage}&sort=created&direction=desc`);
  if (res.status === 403 || res.status === 429) throw new Error("GitHub rate limit reached. Try again in a few minutes.");
  if (!res.ok) throw new Error(`Repository not found or private (${res.status}).`);
  const data = (await res.json()) as ApiIssue[];
  return data.filter((i) => !i.pull_request).map(toIssue);
}

export async function readRepoFile(owner: string, repo: string, path: string): Promise<string> {
  const url = new URL(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/HEAD/${path.replace(/^\/+/, "")}`);
  if (url.origin !== "https://raw.githubusercontent.com" || !url.pathname.startsWith(`/${owner}/${repo}/HEAD/`) || url.search || url.hash) {
    throw new Error(`Invalid path: ${path}`);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`File not found: ${path}`);
  return (await res.text()).slice(0, 6000);
}
