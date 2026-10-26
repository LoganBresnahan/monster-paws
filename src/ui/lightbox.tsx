"use client";

import Image from "next/image";
import { useRef, type ReactNode } from "react";

/**
 * Whatever is passed as children becomes a button that opens `src` whole in
 * a modal <dialog>, which brings focus trapping, Esc to close and the
 * backdrop with it — no state library and no portal.
 */
export function Lightbox({
  src,
  width,
  height,
  alt,
  caption,
  label,
  className,
  children,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-label={label}
        className={`cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf ${className ?? ""}`}
      >
        {children}
      </button>
      <dialog
        ref={dialog}
        aria-label={alt}
        // a click on the backdrop lands on the dialog itself, never on its content
        onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
        className="m-auto max-h-[90dvh] max-w-[min(92vw,76rem)] overflow-visible bg-transparent p-0 backdrop:bg-foreground/60"
      >
        <figure className="relative rounded-cuddly border-4 border-card bg-card shadow-2xl">
          <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            sizes="(min-width: 1216px) 76rem, 92vw"
            className="h-auto max-h-[calc(90dvh-3.5rem)] w-auto rounded-t-[1.25rem] object-contain"
          />
          <figcaption className="px-4 py-3 text-left font-bold text-foreground">{caption}</figcaption>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Close"
            className="absolute -top-3 -right-3 grid h-10 w-10 place-items-center rounded-full bg-card text-xl font-bold text-foreground shadow-md hover:bg-honey"
          >
            ✕
          </button>
        </figure>
      </dialog>
    </>
  );
}
