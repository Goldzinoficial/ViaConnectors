import { SiteHeader } from "@/components/SiteHeader";
import { GitHubSignInButton } from "@/components/GitHubSignInButton";
import styles from "./page.module.css";

export default function LoginPage() {
  return (
    <>
      <SiteHeader />
      <div className={styles.wrap}>
        <h1 className={`serif-italic ${styles.title}`}>Sign in to ViaConnectors</h1>
        <p className={styles.subtitle}>
          We use your GitHub account to find and install connectors for you.
        </p>
        <GitHubSignInButton />
      </div>
    </>
  );
}
