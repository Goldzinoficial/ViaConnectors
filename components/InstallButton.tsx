"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { Connector } from "@/lib/connectors";
import { DEFAULT_PLATFORM_ID } from "@/lib/platforms";
import { CloseIcon, TrashIcon } from "./icons";
import styles from "./InstallButton.module.css";

type Status = "idle" | "installing" | "done" | "warning" | "error";
type Location = "auto" | "file";

export function InstallButton({
  connector,
  className,
  ghostClassName,
  onInstalled,
  onUninstalled,
}: {
  connector: Connector;
  className?: string;
  ghostClassName?: string;
  onInstalled?: () => void;
  onUninstalled?: () => void;
}) {
  const [status, setStatus] = useState<Status>(connector.installed ? "done" : "idle");
  const [message, setMessage] = useState<string | null>(null);
  // Set when this app has no native way to install the connector but found
  // the repo's own documented installer in its README — shown as a
  // copy-to-clipboard command rather than run automatically (see
  // ForeignInstallHint in lib/claudeCode.ts for why).
  const [foreignCommand, setForeignCommand] = useState<{ command: string; platform: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [location, setLocation] = useState<Location>("auto");
  const [uninstalling, setUninstalling] = useState(false);
  // Pre-filled from Settings, if you've saved a path there before — shown
  // openly in the "Select file" field so you can see and change it, rather
  // than silently applied behind "Automatic".
  const [filePath, setFilePath] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("vc-claude-cli-path") ?? "" : ""
  );
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  async function pickFile() {
    setPicking(true);
    setPickError(null);
    try {
      const res = await fetch("/api/pick-claude-file", { method: "POST" });
      const data = await res.json();
      if (data.path) setFilePath(data.path);
      else if (data.error) setPickError(data.error);
    } catch {
      setPickError("Couldn't open the file picker.");
    } finally {
      setPicking(false);
    }
  }

  // "Automatic" means automatic — it must never quietly fall back to a
  // custom path saved in Settings, or picking it would sometimes still use
  // a stale/wrong path with no way to tell why. Only "Select file" (either
  // typed here or saved earlier in Settings) provides an explicit override.
  async function runInstall(claudeBin: string | undefined) {
    setModalOpen(false);
    setStatus("installing");
    setMessage(null);
    setForeignCommand(null);
    setCopied(false);
    const platform = localStorage.getItem("vc-target-platform") ?? DEFAULT_PLATFORM_ID;

    try {
      const res = await fetch("/api/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: connector.id, platform, claudeBin }),
      });
      const data = await res.json();
      // A successful `claude mcp add`/`plugin install` call isn't proof it
      // actually works — data.verified reflects a real post-install check
      // (connection health for MCP, registration file for plugins/skills).
      // Surface that distinction instead of a blanket green "Installed".
      setStatus(data.ok ? (data.verified === false ? "warning" : "done") : "error");
      setMessage(data.message);
      setForeignCommand(data.foreignCommand ?? null);
      if (data.ok) onInstalled?.();
    } catch {
      setStatus("error");
      setMessage("Network error while installing.");
    }
  }

  function confirmInstall() {
    if (location === "file") {
      runInstall(filePath.trim());
      return;
    }
    runInstall(undefined);
  }

  async function runUninstall() {
    setUninstalling(true);
    try {
      const res = await fetch("/api/uninstall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: connector.id }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus("idle");
        setMessage(null);
        onUninstalled?.();
      } else {
        setMessage(data.message);
      }
    } catch {
      setMessage("Network error while uninstalling.");
    } finally {
      setUninstalling(false);
    }
  }

  const isGhost = status === "done" || status === "warning";
  const label =
    status === "installing"
      ? "Installing…"
      : status === "done"
        ? "Installed"
        : status === "warning"
          ? "Installed ⚠"
          : status === "error"
            ? "Retry"
            : "Install";

  return (
    <div>
      <div className={styles.row}>
        <button
          className={`${className ?? ""} ${isGhost ? (ghostClassName ?? "") : ""}`}
          onClick={() => setModalOpen(true)}
          disabled={status === "installing" || status === "done"}
        >
          {label}
        </button>
        {isGhost && (
          <button
            className={styles.uninstallBtn}
            onClick={runUninstall}
            disabled={uninstalling}
            aria-label={`Uninstall ${connector.name}`}
            title="Uninstall"
          >
            <TrashIcon className={styles.uninstallIcon} />
          </button>
        )}
      </div>
      {(status === "error" || status === "warning") && message && (
        <p style={{ fontSize: 11, color: status === "error" ? "#f87171" : "#facc15", marginTop: 6, whiteSpace: "pre-line" }}>
          {message}
        </p>
      )}
      {status === "error" && foreignCommand && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>{foreignCommand.platform}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <code
              style={{
                flex: 1,
                fontSize: 11,
                fontFamily: "ui-monospace, SF Mono, Consolas, monospace",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "6px 8px",
                overflowX: "auto",
                whiteSpace: "pre",
              }}
            >
              {foreignCommand.command}
            </code>
            <button
              style={{
                fontSize: 11,
                background: "var(--pill-bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "6px 10px",
                flexShrink: 0,
                color: "var(--fg)",
              }}
              onClick={() => {
                navigator.clipboard.writeText(foreignCommand.command).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {modalOpen &&
        createPortal(
          // Rendered straight into <body> instead of inline here — a modal
          // nested inside a card that has any transform on it (this one
          // lifts on hover) would otherwise get pinned to that card's box
          // instead of the actual viewport, since position:fixed anchors to
          // the nearest transformed ancestor, not always the page itself.
          <div className={styles.overlay} onClick={() => setModalOpen(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHead}>
                <h2 className={styles.modalTitle}>Select install location</h2>
                <button className={styles.closeBtn} onClick={() => setModalOpen(false)} aria-label="Close">
                  <CloseIcon className={styles.closeIcon} />
                </button>
              </div>
              <p className={styles.modalDesc}>
                Installing <strong>{connector.name}</strong> for Claude Code.
              </p>

              <label className={styles.option}>
                <input
                  type="radio"
                  name="install-location"
                  checked={location === "auto"}
                  onChange={() => setLocation("auto")}
                />
                <div>
                  <div className={styles.optionTitle}>Automatic</div>
                  <div className={styles.optionHint}>Find Claude Code on this machine automatically.</div>
                </div>
              </label>

              <label className={styles.option}>
                <input
                  type="radio"
                  name="install-location"
                  checked={location === "file"}
                  onChange={() => setLocation("file")}
                />
                <div>
                  <div className={styles.optionTitle}>Select file…</div>
                  <div className={styles.optionHint}>Point to the Claude Code executable yourself.</div>
                </div>
              </label>

              {location === "file" && (
                <div className={styles.filePicker}>
                  <input
                    type="text"
                    className={styles.filePathInput}
                    value={filePath}
                    onChange={(e) => setFilePath(e.target.value)}
                    placeholder="e.g. C:\Users\you\AppData\Roaming\npm\claude.cmd"
                    spellCheck={false}
                  />
                  <button className={styles.browseBtn} onClick={pickFile} disabled={picking}>
                    {picking ? "Opening…" : "Browse…"}
                  </button>
                </div>
              )}
              {pickError && <p className={styles.pickError}>{pickError}</p>}

              <div className={styles.modalActions}>
                <button className={styles.cancelBtn} onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button
                  className={styles.confirmBtn}
                  onClick={confirmInstall}
                  disabled={location === "file" && !filePath.trim()}
                >
                  Install
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
