import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { ConnectorBrowser } from "@/components/ConnectorBrowser";
import { SettingsIcon } from "@/components/icons";
import { getAllConnectors } from "@/lib/registry";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const connectors = await getAllConnectors();

  return (
    <>
      <SiteHeader />
      <main className={`container ${styles.main}`}>
        <div className={styles.hero}>
          <div className={`mono ${styles.eyebrow}`}>
            <span className={styles.eyebrowDot} />
            api.github.com/search — live
          </div>
          <h1 className={`serif-italic ${styles.title}`}>
            Connectors for your AI, zero effort.
          </h1>
        </div>

        <ConnectorBrowser connectors={connectors} />

        <div className={styles.footer}>
          <Link href="/settings" className={styles.settings}>
            <SettingsIcon className={styles.settingsIcon} />
            Settings
          </Link>
          <span className={styles.version}>v0.1.0</span>
        </div>
      </main>
    </>
  );
}
