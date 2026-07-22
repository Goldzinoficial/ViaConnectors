"use client";

import { useEffect, useState } from "react";
import styles from "./GitHubTokenField.module.css";

const STORAGE_KEY = "vc-claude-cli-path";

export function ClaudeCliPathField() {
  const [path, setPath] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPath(localStorage.getItem(STORAGE_KEY) ?? "");
  }, []);

  function handleSave() {
    localStorage.setItem(STORAGE_KEY, path.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleClear() {
    setPath("");
    localStorage.removeItem(STORAGE_KEY);
    setSaved(false);
  }

  return (
    <div className={styles.field}>
      <p className={styles.hint}>
        Only needed if the <code>claude</code> command isn&apos;t on your system PATH — installs
        run it directly, so point this at the full path to the Claude Code executable.
      </p>
      <div className={styles.inputRow}>
        <input
          type="text"
          className={styles.input}
          value={path}
          onChange={(e) => { setPath(e.target.value); setSaved(false); }}
          placeholder="e.g. C:\Users\you\AppData\Roaming\npm\claude.cmd"
          spellCheck={false}
          autoComplete="off"
        />
        <button className={styles.saveBtn} onClick={handleSave}>
          {saved ? "✓ Saved" : "Save"}
        </button>
        {path && (
          <button className={styles.clearBtn} onClick={handleClear} title="Reset to default">
            ✕
          </button>
        )}
      </div>
      <p className={styles.subhint}>
        Stored only in your browser&apos;s localStorage. Leave empty to use the default (
        <code>claude</code> on PATH).
      </p>
    </div>
  );
}
