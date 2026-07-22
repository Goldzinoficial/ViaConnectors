"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { fetchReadme, resolveToken, getStoredToken } from "@/lib/githubClient";
import styles from "./Readme.module.css";

// `valign` sits in rehype-sanitize's default *wildcard* attribute list
// (applies to every tag), already pre-mapped to the React prop name
// `vAlign` — which React itself doesn't recognize as a valid DOM prop, so
// it logs a dev warning on every table cell that has it. Modern browsers
// ignore the attribute anyway (CSS `vertical-align` replaced it), so it's
// dropped here.
const wildcardAttrs = (defaultSchema.attributes?.["*"] ?? []).filter(
  (a) => (Array.isArray(a) ? a[0] : a) !== "vAlign"
);

const readmeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "picture", "source"],
  attributes: {
    ...defaultSchema.attributes,
    "*": wildcardAttrs,
    source: ["srcSet", "media", "type", "sizes"],
    img: [...(defaultSchema.attributes?.img ?? []), "width", "height", "align"],
    p: [...(defaultSchema.attributes?.p ?? []), "align"],
  },
};

export function Readme({ owner, repo }: { owner: string; repo: string }) {
  const { data: session } = useSession();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const token = resolveToken(session?.accessToken ?? null);

    fetchReadme(owner, repo, token).then(({ content: c, error: e }) => {
      if (cancelled) return;
      if (e) setError(e);
      else setContent(c);
    });

    return () => {
      cancelled = true;
    };
  }, [owner, repo, session?.accessToken]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (content === null) return <p className={styles.loading}>Loading README…</p>;

  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, readmeSchema]]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
