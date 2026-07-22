"use client";

import { signIn } from "next-auth/react";
import { GitHubIcon } from "./icons";
import styles from "./GitHubSignInButton.module.css";

export function GitHubSignInButton({ className }: { className?: string }) {
  return (
    <button
      className={`${styles.button} ${className ?? ""}`}
      onClick={() => signIn("github", { callbackUrl: "/dashboard" })}
    >
      <GitHubIcon className={styles.icon} />
      Continue with GitHub
    </button>
  );
}
