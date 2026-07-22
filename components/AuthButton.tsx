"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { GitHubIcon } from "./icons";
import styles from "./AuthButton.module.css";

export function AuthButton() {
  const { data: session, status } = useSession();

  if (status === "loading") return null;

  if (session?.user) {
    return (
      <button
        className={styles.userButton}
        onClick={() => signOut({ callbackUrl: "/" })}
        title="Sign out"
      >
        {session.user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.user.image} alt="" className={styles.avatar} />
        ) : (
          <GitHubIcon className={styles.icon} />
        )}
        <span className={styles.name}>{session.user.name ?? "Account"}</span>
      </button>
    );
  }

  return (
    <button className={styles.signIn} onClick={() => signIn("github")}>
      <GitHubIcon className={styles.icon} />
      Sign in
    </button>
  );
}
