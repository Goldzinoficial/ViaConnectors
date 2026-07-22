"use client";

import { useEffect, useState } from "react";
import { SunIcon, MoonIcon } from "./icons";
import styles from "./ThemeToggle.module.css";

const THEME_EVENT = "vc-theme-change";

function readTheme(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = localStorage.getItem("vc-theme");
    const initial = stored === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", initial);
    setTheme(initial);

    const onChange = () => setTheme(readTheme());
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("vc-theme", next);
    setTheme(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <button
      className={styles.toggle}
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      {theme === "dark" ? <SunIcon className={styles.icon} /> : <MoonIcon className={styles.icon} />}
    </button>
  );
}
