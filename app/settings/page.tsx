import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { PlatformPicker } from "@/components/PlatformPicker";
import { SettingsThemeRow } from "@/components/SettingsThemeRow";
import { GitHubTokenField } from "@/components/GitHubTokenField";
import { ClaudeCliPathField } from "@/components/ClaudeCliPathField";
import styles from "./page.module.css";

export default function SettingsPage() {
  return (
    <>
      <SiteHeader />
      <main className={`container ${styles.main}`}>
        <Link href="/dashboard" className={styles.back}>
          ← Back to connectors
        </Link>

        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>
          Choose which AI tool ViaConnectors should install connectors for.
        </p>

        <p className={styles.sectionLabel}>Appearance</p>
        <SettingsThemeRow />

        <p className={styles.sectionLabel}>Target platform</p>
        <PlatformPicker />

        <p className={styles.sectionLabel}>Claude Code CLI path</p>
        <ClaudeCliPathField />

        <p className={styles.sectionLabel}>GitHub API token</p>
        <GitHubTokenField />
      </main>
    </>
  );
}
