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
const eyebrow = "font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft";

function loadSettings(): { provider: Provider; key: string } {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw) as { provider: Provider; key: string };
  } catch {}
  return { provider: "anthropic", key: "" };
}

function age(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return days < 1 ? "today" : days < 60 ? `${days}d` : `${Math.round(days / 30)}mo`;
}

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
    <main className="mx-auto max-w-6xl px-6 pb-24 pt-8 sm:px-10">
      <header className="flex items-start justify-between border-b-2 border-ink pb-4">
        <div>
          <p className={eyebrow}>An agent that reads the docket</p>
          <h1 className="mt-1 font-serif text-6xl leading-none sm:text-8xl">
            Triage <em className="text-signal">Desk</em>
          </h1>
        </div>
        <div className="relative pt-2 text-right">
          <button onClick={() => setKeyOpen((o) => !o)} className="font-mono text-xs uppercase tracking-widest underline underline-offset-4 hover:text-signal">
            {settings.key ? `${PROVIDERS[settings.provider].label} key set` : "Add API key"}
          </button>
          {keyOpen && (
            <div className="absolute right-0 z-10 mt-3 w-72 border-2 border-ink bg-paper p-4 text-left">
              <p className="mb-3 text-xs text-ink-soft">Stays in this browser. Requests go straight to the provider.</p>
              <select
                value={settings.provider}
                onChange={(e) => saveSettings({ ...settings, provider: e.target.value as Provider })}
                className="mb-2 w-full border border-ink bg-transparent px-2 py-1.5 font-mono text-sm"
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
                className="w-full border border-ink bg-transparent px-2 py-1.5 font-mono text-sm outline-none focus:border-signal"
              />
            </div>
          )}
        </div>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(input);
        }}
        className="mt-8 flex flex-wrap items-end gap-x-4 gap-y-3"
      >
        <label htmlFor="repo" className="font-serif text-3xl italic">Docket for</label>
        <input
          id="repo"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="owner/name"
          className="min-w-[14rem] flex-1 border-0 border-b-2 border-ink bg-transparent pb-1 font-mono text-2xl outline-none placeholder:text-ink-soft/50 focus:border-signal"
        />
        <button className="border-2 border-ink px-5 py-2 font-mono text-xs uppercase tracking-widest transition hover:bg-ink hover:text-paper" disabled={loading}>
          {loading ? "Loading" : "Open"}
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-soft">
        try
        {EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => { setInput(ex); load(ex); }} className="underline underline-offset-4 hover:text-signal">
            {ex}
          </button>
        ))}
      </div>
      {error && <p className="mt-4 font-mono text-sm text-signal">{error}</p>}

      {repo && selected && (
        <div className="mt-10 grid gap-10 lg:grid-cols-[22rem_1fr]">
          <nav aria-label="Open issues" className="lg:max-h-[75vh] lg:overflow-y-auto lg:pr-3">
            <p className={`${eyebrow} mb-2`}>{issues.length} open, newest first</p>
            <ul>
              {issues.map((i) => (
                <li key={i.number}>
                  <button
                    onClick={() => pick(i)}
                    className={`grid w-full grid-cols-[3.2rem_1fr] gap-2 border-t border-[var(--rule)] py-3 text-left transition ${
                      selected.number === i.number ? "bg-ink text-paper" : "hover:bg-paper-deep"
                    }`}
                  >
                    <span className="pl-2 font-mono text-xs opacity-70">#{i.number}</span>
                    <span className="pr-2">
                      <span className="block text-[15px] leading-snug">{i.title}</span>
                      <span className="mt-1 block font-mono text-[11px] opacity-70">
                        {age(i.createdAt)} &middot; {i.comments} comments{rulings[i.number] ? ` · ${rulings[i.number].priority}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <article>
            <p className={eyebrow}>Case #{selected.number} &middot; opened by {selected.author} {age(selected.createdAt)} ago</p>
            <h2 className="mt-2 font-serif text-4xl leading-tight sm:text-5xl">{selected.title}</h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selected.labels.map((l) => (
                <span key={l} className="border border-ink-soft px-2 py-0.5 font-mono text-xs text-ink-soft">{l}</span>
              ))}
            </div>
            <p className="mt-5 line-clamp-6 max-w-2xl whitespace-pre-wrap text-[15px] leading-relaxed text-ink-soft">
              {selected.body || "(no description)"}
            </p>
            <a href={selected.url} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-xs underline underline-offset-4 hover:text-signal">
              Open on GitHub
            </a>

            <div className="mt-8">
              <button
                onClick={rule}
                disabled={running}
                className="bg-ink px-6 py-3 font-mono text-xs uppercase tracking-[0.2em] text-paper transition hover:bg-signal disabled:opacity-60"
              >
                {running ? "Investigating..." : ruling ? "Rule again" : "Rule on this issue"}
              </button>
            </div>

            {(steps.length > 0 || running) && (
              <div className="mt-8">
                <p className={`${eyebrow} mb-2`}>Working notes</p>
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
  );
}
