import Link from "next/link";
import { LogoMark, SettingsIcon } from "./icons";
import { ThemeToggle } from "./ThemeToggle";
import { AuthButton } from "./AuthButton";
import styles from "./SiteHeader.module.css";

export function SiteHeader({ nav }: { nav?: { href: string; label: string }[] }) {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Link href="/" className={styles.brand}>
          <LogoMark className={styles.mark} />
          ViaConnectors
        </Link>
        <div className={styles.actions}>
          {nav?.map((item) => (
            <Link key={item.href} href={item.href} className={styles.navLink}>
              {item.label}
            </Link>
          ))}
          <AuthButton />
          <Link href="/settings" className={styles.iconBtn} aria-label="Settings">
            <SettingsIcon className={styles.settingsIcon} />
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
