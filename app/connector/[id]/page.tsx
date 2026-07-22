import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { ConnectorIconChip, GitHubIcon, StarIcon } from "@/components/icons";
import { InstallButton } from "@/components/InstallButton";
import { Readme } from "@/components/Readme";
import { getConnectorById } from "@/lib/registry";
import { parseGithubUrl } from "@/lib/githubUrl";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function ConnectorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const connector = await getConnectorById(id);
  if (!connector) notFound();
  const repoInfo = parseGithubUrl(connector.githubUrl);

  return (
    <>
      <SiteHeader />
      <main className={`container ${styles.main}`}>
        <Link href="/dashboard" className={styles.back}>
          ← Back to connectors
        </Link>

        <div className={styles.head}>
          <ConnectorIconChip icon={connector.icon} />
          <div>
            <div className={styles.nameRow}>
              <h1 className={styles.name}>{connector.name}</h1>
              <a
                href={connector.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.ghLink}
                aria-label={`Open ${connector.name} on GitHub`}
              >
                <GitHubIcon className={styles.ghIcon} />
              </a>
            </div>
            <p className={styles.author}>by {connector.owner}</p>
          </div>
        </div>

        <div className={styles.metaRow}>
          <span className={styles.stars}>
            <StarIcon className={styles.starIcon} />
            {connector.stars.toLocaleString()}
          </span>
          <span className={styles.trust}>{connector.trustScore}% trust score</span>
          <span>{connector.category.toUpperCase()}</span>
        </div>

        <InstallButton connector={connector} className={styles.install} ghostClassName={styles.installGhost} />

        <div className={styles.readmeSection}>
          {repoInfo ? (
            <Readme owner={repoInfo.owner} repo={repoInfo.repo} />
          ) : (
            <p className={styles.readme}>{connector.readme}</p>
          )}
        </div>
      </main>
    </>
  );
}
