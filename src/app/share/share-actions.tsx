"use client";

import { useEffect, useState } from "react";

const primary =
  "inline-block rounded-cuddly bg-leaf px-5 py-2.5 font-bold text-white shadow-md transition-colors hover:bg-leaf-deep";
const secondary =
  "inline-block rounded-cuddly border-2 border-leaf bg-card px-4 py-2 text-sm font-bold text-leaf-deep transition-colors hover:bg-leaf hover:text-white";

/**
 * Save and Share for one painting (ADR-0036). `useState` only, as the first
 * client island was (ADR-0015 decision 7 as amended). The platform links are
 * plain links, never a platform's widget or script (ADR-0032).
 */
export function ShareActions({
  pageUrl,
  imagePath,
  fileName,
  title,
}: {
  pageUrl: string;
  imagePath: string;
  fileName: string;
  title: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedForInstagram, setSavedForInstagram] = useState(false);

  // Fetched ahead of the tap: Safari refuses `navigator.share` when an await sits between the tap and the call.
  useEffect(() => {
    if (typeof navigator.canShare !== "function") return;
    const abort = new AbortController();
    fetch(imagePath, { signal: abort.signal })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob) return;
        const ready = new File([blob], fileName, { type: "image/jpeg" });
        if (navigator.canShare({ files: [ready] })) setFile(ready);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [imagePath, fileName]);

  async function shareFile() {
    if (!file) return;
    // Files alone: a URL beside them makes some apps drop the image. A cancelled sheet rejects, and that's fine.
    await navigator.share({ files: [file], title }).catch(() => {});
  }

  async function copyLink() {
    await navigator.clipboard.writeText(pageUrl);
    setCopied(true);
  }

  const url = encodeURIComponent(pageUrl);
  const text = encodeURIComponent(title);
  const links = [
    { label: "X", href: `https://x.com/intent/post?url=${url}&text=${text}` },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${url}` },
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${url}` },
    { label: "Bluesky", href: `https://bsky.app/intent/compose?text=${text}%20${url}` },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <a href={imagePath} download={fileName} className={primary}>
          Save
        </a>
        {file && (
          <button type="button" onClick={shareFile} className={primary}>
            Share the image
          </button>
        )}
        {links.map((link) => (
          <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className={secondary}>
            {link.label}
          </a>
        ))}
        {/* Instagram has no share link: the image goes through the phone's sheet, or is saved to post by hand (ADR-0036). */}
        {file ? (
          <button type="button" onClick={shareFile} className={secondary}>
            Instagram
          </button>
        ) : (
          <a href={imagePath} download={fileName} onClick={() => setSavedForInstagram(true)} className={secondary}>
            Instagram
          </a>
        )}
        <button type="button" onClick={copyLink} aria-live="polite" className={secondary}>
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      {savedForInstagram && (
        <p role="status" className="mt-3 text-sm text-muted">
          Saved. Instagram doesn&apos;t take links, so post the image from its app or at{" "}
          <a href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer" className="font-semibold underline">
            instagram.com
          </a>
          .
        </p>
      )}
    </div>
  );
}
