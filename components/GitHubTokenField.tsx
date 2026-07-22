"use client";

import { useEffect, useState } from "react";
import { getStoredToken, setStoredToken, clearCache } from "@/lib/githubClient";
import styles from "./GitHubTokenField.module.css";

export function GitHubTokenField() {
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setToken(getStoredToken() ?? "");
  }, []);

  function handleSave() {
    setStoredToken(token);
    clearCache(); // force a refresh on next page load
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleClear() {
    setToken("");
    setStoredToken("");
    clearCache();
    setSaved(false);
  }

  return (
    <div className={styles.field}>
      <p className={styles.hint}>
        Paste a <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className={styles.link}>GitHub personal access token</a> to
        get <strong>5 000 req/hour</strong> instead of 60. No special scopes needed — a fine-grained token with zero permissions works fine.
      </p>
      <div className={styles.inputRow}>
        <input
          type="password"
          className={styles.input}
          value={token}
          onChange={(e) => { setToken(e.target.value); setSaved(false); }}
          placeholder="ghp_xxxxxxxxxxxx or github_pat_…"
          spellCheck={false}
          autoComplete="off"
        />
        <button className={styles.saveBtn} onClick={handleSave}>
          {saved ? "✓ Saved" : "Save"}
        </button>
        {token && (
          <button className={styles.clearBtn} onClick={handleClear} title="Remove token">
            ✕
          </button>
        )}
      </div>
      <p className={styles.subhint}>
        Stored only in your browser&apos;s localStorage — never sent to our server.
      </p>
    </div>
  );
}
