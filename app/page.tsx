import { SiteHeader } from "@/components/SiteHeader";
import { ScrollReveal } from "@/components/ScrollReveal";
import { ConnectorIconChip } from "@/components/icons";
import { GitHubSignInButton } from "@/components/GitHubSignInButton";
import { connectors } from "@/lib/connectors";
import styles from "./page.module.css";

const featuredIcons = connectors.slice(0, 4);

export default function LandingPage() {
  return (
    <>
      <SiteHeader />

      <section className={`container ${styles.hero}`}>
        <ScrollReveal>
          <div className={`mono ${styles.eyebrow}`}>
            <span className={styles.eyebrowDot} />
            api.github.com/search — live
          </div>
        </ScrollReveal>
        <ScrollReveal delay={40}>
          <h1 className={`serif-italic ${styles.title}`}>
            Connectors for your AI, zero effort.
          </h1>
        </ScrollReveal>
        <ScrollReveal delay={80}>
          <p className={styles.subtitle}>
            Discover, install and manage MCPs, plugins and skills for your AI —
            no more digging through READMEs and copy-pasting config.
          </p>
        </ScrollReveal>
        <ScrollReveal delay={160}>
          <GitHubSignInButton />
        </ScrollReveal>
      </section>

      <section className={`container ${styles.features}`}>
        {featuredIcons.map((c, i) => (
          <ScrollReveal key={c.id} delay={i * 90}>
            <div className={styles.featureCard}>
              <ConnectorIconChip icon={c.icon} />
              <div>
                <div className={styles.featureName}>{c.name}</div>
                <p className={styles.featureDesc}>{c.description}</p>
              </div>
            </div>
          </ScrollReveal>
        ))}
      </section>
    </>
  );
}
