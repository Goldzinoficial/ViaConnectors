import type { Connector } from "@/lib/connectors";
import Link from "next/link";
import { ConnectorIconChip, GitHubIcon, InfoIcon, StarIcon } from "./icons";
import { InstallButton } from "./InstallButton";
import { parseGithubUrl } from "@/lib/githubUrl";
import styles from "./ConnectorCard.module.css";

export function ConnectorCard({
  connector,
  onInstalled,
  onUninstalled,
}: {
  connector: Connector;
  onInstalled?: (id: string) => void;
  onUninstalled?: (id: string) => void;
}) {
  const repoInfo = parseGithubUrl(connector.githubUrl);

  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <ConnectorIconChip icon={connector.icon} />
      </div>
      <div className={styles.nameRow}>
        <Link href={`/connector/${connector.id}`} className={styles.name}>
          {connector.name}
        </Link>
        <a
          href={connector.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${connector.name} on GitHub`}
          className={styles.ghLink}
        >
          <GitHubIcon className={styles.ghIcon} />
        </a>
      </div>
      <div className={styles.author}>by {connector.owner}</div>
      <p className={styles.desc}>{connector.description}</p>
      <div className={styles.foot}>
        <span className={styles.stars}>
          <StarIcon className={styles.starIcon} />
          {formatStars(connector.stars)}
        </span>
        <div className={styles.actions}>
          {repoInfo && (
            <Link
              href={`/connector/${connector.id}`}
              target="_blank"
              className={styles.infoBtn}
              aria-label={`Read ${connector.name}'s README`}
            >
              <InfoIcon className={styles.infoIcon} />
            </Link>
          )}
          <InstallButton
            connector={connector}
            className={styles.install}
            ghostClassName={styles.installGhost}
            onInstalled={() => onInstalled?.(connector.id)}
            onUninstalled={() => onUninstalled?.(connector.id)}
          />
        </div>
      </div>
    </div>
  );
}

function formatStars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}
