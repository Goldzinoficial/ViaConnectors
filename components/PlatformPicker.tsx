"use client";

import { useEffect, useState } from "react";
import { platforms, DEFAULT_PLATFORM_ID } from "@/lib/platforms";
import styles from "./PlatformPicker.module.css";

const STORAGE_KEY = "vc-target-platform";

export function PlatformPicker() {
  const [selected, setSelected] = useState(DEFAULT_PLATFORM_ID);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setSelected(stored);
  }, []);

  function choose(id: string) {
    setSelected(id);
    localStorage.setItem(STORAGE_KEY, id);
  }

  return (
    <div className={styles.list}>
      {platforms.map((p) => (
        <button
          key={p.id}
          disabled={!p.available}
          className={`${styles.item} ${selected === p.id ? styles.itemActive : ""}`}
          onClick={() => choose(p.id)}
        >
          <span>{p.name}</span>
          {!p.available && <span className={styles.badge}>Coming soon</span>}
          {p.available && selected === p.id && <span className={styles.check}>✓</span>}
        </button>
      ))}
    </div>
  );
}
