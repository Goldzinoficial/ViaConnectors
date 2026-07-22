import { ThemeToggle } from "./ThemeToggle";
import styles from "./SettingsThemeRow.module.css";

export function SettingsThemeRow() {
  return (
    <div className={styles.row}>
      <span>Theme</span>
      <ThemeToggle />
    </div>
  );
}
