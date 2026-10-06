"use client";

import { useEffect, useRef, useState } from "react";
import Ledger from "@/components/Ledger";
import Ruling from "@/components/Ruling";
import { PROVIDERS, SYSTEM_PROMPT, createAdapter, runAgent, userPrompt } from "@/lib/agent";
import type { Provider, Step } from "@/lib/agent";
import { listIssues, parseRepo } from "@/lib/github";
import type { Issue } from "@/lib/github";
import type { TriageResult } from "@/lib/triage";

const STORE = "triage-desk.llm";
const EXAMPLES = ["sindresorhus/ky", "pmndrs/zustand", "colinhacks/zod"];

function loadSettings(): { provider: Provider; key: string } {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw) as { provider: Provider; key: string };
  } catch {}
  return { provider: "anthropic", key: "" };
}

function ageDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function age(iso: string): string {
  const d = ageDays(iso);
  return d < 1 ? "today" : d < 60 ? `${d}d` : `${Math.round(d / 30)}mo`;
}

const PRIORITY_DOT: Record<string, string> = { p0: "bg-rose", p1: "bg-tangerine", p2: "bg-lemon", p3: "bg-mint" };

export default function Home() {
  const [input, setInput] = useState("");
  const [repo, setRepo] = useState<{ owner: string; repo: string } | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<{ provider: Provider; key: string }>({ provider: "anthropic", key: "" });
  const [keyOpen, setKeyOpen] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [rulings, setRulings] = useState<Record<number, TriageResult>>({});
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    Promise.resolve().then(() => setSettings(loadSettings()));
  }, []);

  const saveSettings = (next: { provider: Provider; key: string }) => {
    setSettings(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {}
  };

  const load = async (value: string) => {
    const parsed = parseRepo(value);
    if (!parsed) {
      setError("Enter a repository as owner/name or paste its GitHub URL.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const list = await listIssues(parsed.owner, parsed.repo);
      if (list.length === 0) throw new Error("This repository has no open issues.");
      setRepo(parsed);
      setIssues(list);
      setSelected(list[0]);
      setSteps([]);
      setRulings({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load issues.");
    } finally {
      setLoading(false);
    }
  };

  const pick = (issue: Issue) => {
    abort.current?.abort();
    setRunning(false);
    setSelected(issue);
    setSteps([]);
    setError("");
  };

  const rule = async () => {
    if (!repo || !selected) return;
    if (!settings.key) {
      setKeyOpen(true);
      setError("Add your API key first (top right).");
      return;
    }
    setError("");
    setSteps([]);
    setRunning(true);
    const controller = new AbortController();
    abort.current = controller;
    const target = selected;
    try {
      const adapter = createAdapter(settings.provider, settings.key, SYSTEM_PROMPT, userPrompt(`${repo.owner}/${repo.repo}`, target));
      const result = await runAgent({
        adapter,
        ctx: { owner: repo.owner, repo: repo.repo, target, pool: issues },
        onStep: (s) =>
          setSteps((prev) => {
            if (s.kind === "tool") {
              const i = prev.findIndex((p) => p.kind === "tool" && p.id === s.id);
              if (i >= 0) return prev.map((p, n) => (n === i ? s : p));
            }
            return [...prev, s];
          }),
        signal: controller.signal,
      });
      setRulings((r) => ({ ...r, [target.number]: result }));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "The agent failed.");
    } finally {
      setRunning(false);
    }
  };

  const ruling = selected ? rulings[selected.number] : undefined;

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute -right-24 -top-24 h-[28rem] w-[28rem] rounded-full bg-lemon/70 blur-3xl" />
      <main className="relative mx-auto max-w-6xl px-6 pb-28 pt-8 sm:px-10">
        <nav className="flex items-center justify-between">
          <span className="display flex items-center gap-2 text-lg font-bold">
            <span className="bob grid h-8 w-8 place-items-center rounded-xl bg-tangerine text-white">T</span>
            triage desk
          </span>
          <div className="relative">
            <button
              onClick={() => setKeyOpen((o) => !o)}
              className={`rounded-full border-2 border-ink px-4 py-1.5 text-sm font-semibold transition hover:-translate-y-0.5 ${settings.key ? "bg-mint-soft" : "bg-lemon"}`}
            >
              {settings.key ? `${PROVIDERS[settings.provider].label} key set` : "Add API key"}
            </button>
            {keyOpen && (
              <div className="pop absolute right-0 z-10 mt-3 w-72 rounded-3xl border-2 border-ink bg-card p-4 shadow-xl">
                <p className="mb-3 text-xs text-ink-soft">Stays in this browser. Requests go straight to the provider.</p>
                <select
                  value={settings.provider}
                  onChange={(e) => saveSettings({ ...settings, provider: e.target.value as Provider })}
                  className="mb-2 w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm"
                >
                  {Object.entries(PROVIDERS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                <input
                  type="password"
                  value={settings.key}
                  onChange={(e) => saveSettings({ ...settings, key: e.target.value })}
                  placeholder="API key"
                  className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm outline-none focus:border-tangerine"
                />
              </div>
            )}
          </div>
        </nav>

        <header className="rise mt-14">
          <h1 className="display text-6xl font-extrabold leading-[0.95] sm:text-8xl">
            Rule on every
            <br />
            <span className="relative inline-block">
              open issue.
              <svg className="absolute -bottom-3 left-0 w-full" viewBox="0 0 400 18" fill="none" preserveAspectRatio="none" aria-hidden>
                <path className="draw" d="M3 12 C 70 2, 130 16, 200 8 S 340 4, 397 11" stroke="#ff6a2b" strokeWidth="6" strokeLinecap="round" />
              </svg>
            </span>
          </h1>
          <p className="mt-7 max-w-lg text-lg text-ink-soft">An agent reads the issue, hunts for duplicates, checks your labels and files, then hands you a ruling and a reply you can paste.</p>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(input);
          }}
          className="mt-10 flex max-w-2xl items-center gap-2 rounded-full border-2 border-ink bg-card p-2 pl-6 shadow-[6px_6px_0_0_var(--ink)] transition focus-within:shadow-[8px_8px_0_0_var(--tangerine)]"
        >
          <span className="font-mono text-sm text-ink-soft">github.com/</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="owner/name"
            className="min-w-0 flex-1 bg-transparent py-2 font-mono text-lg outline-none placeholder:text-ink-soft/40"
            aria-label="Repository"
          />
          <button disabled={loading} className="rounded-full bg-ink px-6 py-3 text-sm font-bold text-cream transition hover:bg-tangerine active:scale-95 disabled:opacity-60">
            {loading ? "Loading..." : "Open docket"}
          </button>
        </form>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          try
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                setInput(ex);
                load(ex);
              }}
              className="rounded-full bg-card px-3 py-1 font-mono text-[13px] shadow-sm transition hover:-translate-y-0.5 hover:bg-tangerine-soft hover:shadow-md"
            >
              {ex}
            </button>
          ))}
        </div>
        {error && <p className="mt-4 rounded-2xl bg-rose-soft px-4 py-3 text-sm font-medium text-rose">{error}</p>}

        {repo && selected && (
          <div className="mt-14 grid gap-8 lg:grid-cols-[22rem_1fr]">
            <nav aria-label="Open issues" className="lg:max-h-[78vh] lg:overflow-y-auto lg:pr-2">
              <p className="mb-3 font-mono text-xs uppercase tracking-widest text-ink-soft">{issues.length} open &middot; newest first</p>
              <ul className="space-y-2">
                {issues.map((i, n) => {
                  const r = rulings[i.number];
                  const active = selected.number === i.number;
                  return (
                    <li key={i.number} className="rise" style={{ animationDelay: `${Math.min(n, 12) * 35}ms` }}>
                      <button
                        onClick={() => pick(i)}
                        className={`w-full rounded-2xl border-2 p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
                          active ? "border-ink bg-card shadow-[4px_4px_0_0_var(--ink)]" : "border-transparent bg-card/70"
                        }`}
                      >
                        <span className="flex items-center gap-2 font-mono text-[11px] text-ink-soft">
                          #{i.number} &middot; {age(i.createdAt)} &middot; {i.comments} comments
                          {r && <span className={`ml-auto h-2.5 w-2.5 rounded-full ${PRIORITY_DOT[r.priority]}`} title={`Ruled ${r.priority}`} />}
                        </span>
                        <span className="mt-1 block text-[15px] font-semibold leading-snug">{i.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <article key={selected.number} className="rise">
              <p className="font-mono text-xs uppercase tracking-widest text-ink-soft">
                #{selected.number} &middot; {selected.author} &middot; {age(selected.createdAt)} ago
              </p>
              <h2 className="display mt-2 text-4xl font-bold leading-tight sm:text-5xl">{selected.title}</h2>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {selected.labels.map((l) => (
                  <span key={l} className="rounded-full bg-card px-3 py-1 text-xs font-medium shadow-sm">{l}</span>
                ))}
              </div>
              <p className="mt-5 line-clamp-6 max-w-2xl whitespace-pre-wrap text-[15px] leading-relaxed text-ink-soft">{selected.body || "(no description)"}</p>
              <a href={selected.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold underline decoration-tangerine decoration-2 underline-offset-4">
                Open on GitHub
              </a>

              <div className="mt-8">
                <button
                  onClick={rule}
                  disabled={running}
                  className={`rounded-full bg-tangerine px-8 py-4 text-base font-bold text-white shadow-lg shadow-tangerine/30 transition hover:-translate-y-0.5 hover:shadow-xl active:scale-95 disabled:opacity-70 ${running ? "pulse-ring" : ""}`}
                >
                  {running ? "Investigating..." : ruling ? "Rule again" : "Rule on this issue"}
                </button>
              </div>

              {(steps.length > 0 || running) && (
                <div className="mt-10">
                  <p className="mb-4 font-mono text-xs uppercase tracking-widest text-ink-soft">What the agent did</p>
                  <Ledger steps={steps} running={running} />
                </div>
              )}
              {ruling && (
                <div className="mt-8">
                  <Ruling result={ruling} issue={selected} />
                </div>
              )}
            </article>
          </div>
        )}
      </main>
    </div>
  );
}
