"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import type { Connector, ConnectorCategory } from "@/lib/connectors";
import { parseGithubUrl } from "@/lib/githubUrl";
import {
  discoverConnectors,
  quickFillCategory,
  fetchCategoryPage,
  searchConnectorsByText,
  resolveToken,
  getLastRateInfo,
  type DiscoveryProgress,
} from "@/lib/githubClient";
import { ConnectorCard } from "./ConnectorCard";
import {
  FiltersIcon,
  McpTabIcon,
  PluginsTabIcon,
  SearchIcon,
  SkillsTabIcon,
} from "./icons";
import styles from "./ConnectorBrowser.module.css";

const tabs: { key: ConnectorCategory; label: string; Icon: typeof PluginsTabIcon }[] = [
  { key: "plugin", label: "Plugins", Icon: PluginsTabIcon },
  { key: "mcp", label: "MCPs", Icon: McpTabIcon },
  { key: "skill", label: "Skills", Icon: SkillsTabIcon },
];

// Everything rendered here is already sitting in memory (cached discovery,
// no network needed) — a small batch made sense when each page was a real
// wait, but now it just throttles how much of the already-loaded set the
// scroll reveals at once. A bigger batch (plus a wider sentinel margin
// below) makes scrolling feel like the full set is already there.
const PAGE_SIZE = 30;

// Installed connectors lead the grid — after that, most stars first.
function sortConnectors(list: Connector[]): Connector[] {
  return [...list].sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return b.stars - a.stars;
  });
}

export function ConnectorBrowser({ connectors: serverConnectors }: { connectors: Connector[] }) {
  const { data: session } = useSession();
  const [liveConnectors, setLiveConnectors] = useState<Connector[]>([]);
  const [progress, setProgress] = useState<DiscoveryProgress | null>(null);
  const [discoveryDone, setDiscoveryDone] = useState(false);

  const [category, setCategory] = useState<ConnectorCategory>("plugin");
  const [query, setQuery] = useState("");
  const [authorQuery, setAuthorQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const discoveryStarted = useRef(false);

  // Accumulates everything found so far — background discovery and direct
  // searches both feed into the same map, keyed by connector id, so neither
  // one overwrites what the other found.
  const foundById = useRef<Map<string, Connector>>(new Map());

  // What's actually already installed on this machine — fetched once from
  // the server (which reads Claude Code's own config/plugin files) and
  // applied to every connector as it's discovered, so pre-existing installs
  // show as installed without you ever having clicked Install in this app.
  const installedRepos = useRef<{ mcp: string[]; plugin: Set<string> } | null>(null);

  function applyInstalledFlag(c: Connector): Connector {
    if (c.installed) return c;
    const info = installedRepos.current;
    if (!info) return c;
    const repoInfo = parseGithubUrl(c.githubUrl);
    if (!repoInfo) return c;
    const key = `${repoInfo.owner}/${repoInfo.repo}`.toLowerCase();
    const isInstalled = c.category === "mcp" ? info.mcp.some((s) => s.includes(key)) : info.plugin.has(key);
    return isInstalled ? { ...c, installed: true } : c;
  }

  function mergeFound(list: Connector[]) {
    for (const c of list) foundById.current.set(c.id, applyInstalledFlag(c));
    setLiveConnectors(sortConnectors([...foundById.current.values()]));
  }

  // Re-checks every connector already sitting in foundById against the
  // current installedRepos — unlike mergeFound, this doesn't need a new
  // list, it re-scans what's already there.
  function reapplyInstalledFlags() {
    for (const [id, c] of foundById.current) {
      foundById.current.set(id, applyInstalledFlag(c));
    }
    setLiveConnectors(sortConnectors([...foundById.current.values()]));
  }

  useEffect(() => {
    fetch("/api/installed")
      .then((r) => r.json())
      .then((data: { mcpSources: string[]; pluginRepos: string[] }) => {
        installedRepos.current = {
          mcp: data.mcpSources.map((s) => s.toLowerCase()),
          plugin: new Set(data.pluginRepos.map((s) => s.toLowerCase())),
        };
        // Re-check everything already loaded — most of it arrived before
        // this fetch resolved.
        reapplyInstalledFlags();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Called by a card right after a real install succeeds — flips this one
  // connector to installed and re-sorts, so it jumps to the front instead
  // of waiting for the next unrelated background update to reshuffle it.
  function markInstalled(id: string) {
    const existing = foundById.current.get(id);
    if (existing) foundById.current.set(id, { ...existing, installed: true });
    setLiveConnectors(sortConnectors([...foundById.current.values()]));
  }

  function markUninstalled(id: string) {
    const existing = foundById.current.get(id);
    if (existing) foundById.current.set(id, { ...existing, installed: false });
    setLiveConnectors(sortConnectors([...foundById.current.values()]));
  }

  // Read by the discovery loop before picking its next topic, so switching
  // tabs reprioritizes remaining GitHub topics toward whatever's on screen.
  const priorityCategory = useRef<ConnectorCategory>(category);
  useEffect(() => {
    priorityCategory.current = category;
  }, [category]);

  // Reprioritizing the background loop still means waiting your turn behind
  // whatever page it's mid-fetch on — visibly slow the first time you open a
  // tab it hasn't reached yet. So the first time a tab looks thin, jump the
  // queue with a one-shot top-starred fill for just that category (page 1 of
  // its topics), instead of waiting out the slow round-robin.
  const quickFilledCategories = useRef<Set<ConnectorCategory>>(new Set());
  useEffect(() => {
    if (quickFilledCategories.current.has(category)) return;
    quickFilledCategories.current.add(category);

    const have = [...foundById.current.values()].filter((c) => c.category === category).length;
    if (have >= 12) return;

    const token = resolveToken(session?.accessToken ?? null);
    quickFillCategory(category, token).then(mergeFound);
  }, [category, session?.accessToken]);

  // Client-side discovery — runs in the browser, not the server
  useEffect(() => {
    if (discoveryStarted.current) return;
    discoveryStarted.current = true;

    const token = resolveToken(session?.accessToken ?? null);

    discoverConnectors(
      token,
      (p, found) => {
        setProgress(p);
        mergeFound(found);
      },
      priorityCategory
    ).then(() => {
      setDiscoveryDone(true);
    });
  }, [session?.accessToken]);

  // Typing a search pulls matches directly from *all* of GitHub — not
  // scoped to the active tab's topics, since most repos aren't tagged
  // consistently enough for that to reliably find anything. Each result is
  // categorized the same way discovery is, so it lands under the right
  // tab regardless of which one was open when you searched. Debounced so
  // each keystroke doesn't fire a request.
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) return;

    const token = resolveToken(session?.accessToken ?? null);
    const handle = setTimeout(() => {
      searchConnectorsByText(text, token).then(mergeFound);
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, session?.accessToken]);

  // Use live connectors when available, otherwise fall back to server-provided ones
  const connectors = liveConnectors.length > 0 ? liveConnectors : serverConnectors;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return connectors.filter((c) => {
      if (c.category !== category) return false;
      // GitHub's search already matched name OR description server-side —
      // matching only `name` here would silently throw description-only
      // hits right back out after the network call found them.
      if (q && !c.name.toLowerCase().includes(q) && !c.description.toLowerCase().includes(q)) return false;
      if (authorQuery && !c.owner.toLowerCase().includes(authorQuery.toLowerCase())) return false;
      return true;
    });
  }, [connectors, category, query, authorQuery]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [category, query, authorQuery]);

  const visibleCountRef = useRef(visibleCount);
  useEffect(() => {
    visibleCountRef.current = visibleCount;
  }, [visibleCount]);

  // Reaching the bottom of what's already known (not just scrolled into
  // view — the *actual* end of the loaded set for this tab) pulls the next
  // page straight from GitHub instead of waiting for the background loop
  // to eventually get there, so the list keeps extending itself live as
  // you scroll. Stops per category once a page comes back empty or GitHub's
  // page-10 ceiling is hit — same cap the background loop respects.
  const categoryNextPage = useRef<Map<ConnectorCategory, number>>(new Map());
  const categoryExhausted = useRef<Set<ConnectorCategory>>(new Set());
  const categoryFetching = useRef<Set<ConnectorCategory>>(new Set());

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        setVisibleCount((v) => Math.min(v + PAGE_SIZE, filtered.length));

        const remaining = filtered.length - visibleCountRef.current;
        if (
          remaining < PAGE_SIZE &&
          !categoryExhausted.current.has(category) &&
          !categoryFetching.current.has(category)
        ) {
          categoryFetching.current.add(category);
          const page = categoryNextPage.current.get(category) ?? 2;
          const token = resolveToken(session?.accessToken ?? null);
          fetchCategoryPage(category, page, token).then((found) => {
            categoryFetching.current.delete(category);
            if (found.length === 0 || page >= 10) {
              categoryExhausted.current.add(category);
            } else {
              categoryNextPage.current.set(category, page + 1);
            }
            mergeFound(found);
          });
        }
      },
      { rootMargin: "800px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [filtered.length, category, session?.accessToken]);

  const visible = filtered.slice(0, visibleCount);
  const rateInfo = getLastRateInfo();

  return (
    <div>
      <p className={`mono ${styles.liveCount}`}>{connectors.length.toLocaleString()} integrations analyzed</p>

      <div className={styles.searchRow}>
        <div className={styles.search}>
          <SearchIcon className={styles.searchIcon} />
          <input
            placeholder="Search connectors..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className={styles.advBtn} onClick={() => setFiltersOpen((v) => !v)}>
          <FiltersIcon className={styles.advIcon} />
          Filters
        </button>
      </div>

      {filtersOpen && (
        <div className={styles.advPanel}>
          <label className={styles.advField}>
            <span>Name</span>
            <input
              placeholder="e.g. figma-mcp"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className={styles.advField}>
            <span>Author</span>
            <input
              placeholder="e.g. anthropic"
              value={authorQuery}
              onChange={(e) => setAuthorQuery(e.target.value)}
            />
          </label>
          <label className={styles.advField}>
            <span>Type</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ConnectorCategory)}
            >
              {tabs.map(({ key, label }) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className={styles.tabs}>
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`${styles.tab} ${category === key ? styles.tabActive : ""}`}
            onClick={() => setCategory(key)}
          >
            <Icon className={styles.tabIcon} />
            {label}
          </button>
        ))}
      </div>

      {/* Discovery status bar */}
      {!discoveryDone && progress && (
        <div className={styles.statusBar}>
          <span className={styles.statusPulse} />
          <span className={styles.statusText}>
            Discovering from GitHub… {progress.loaded} repos found
            {progress.rateLimited && " (rate limit — waiting…)"}
          </span>
        </div>
      )}

      {rateInfo && (
        <div className={styles.rateBar}>
          <span className={styles.rateLabel}>
            API: {rateInfo.remaining}/{rateInfo.limit} remaining
            {rateInfo.authenticated ? " (authenticated ✓)" : " (anonymous)"}
          </span>
        </div>
      )}

      <div className={styles.grid} key={category}>
        {visible.map((connector, i) => (
          <div
            key={connector.id}
            className={styles.cardIn}
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
          >
            <ConnectorCard connector={connector} onInstalled={markInstalled} onUninstalled={markUninstalled} />
          </div>
        ))}
        {filtered.length === 0 && <p className={styles.empty}>No connectors match your search.</p>}
      </div>

      {visibleCount < filtered.length && <div ref={sentinelRef} className={styles.sentinel} />}
    </div>
  );
}
