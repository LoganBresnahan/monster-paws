/**
 * The rendering primitives the animal pages share (ADR-0016: a pattern both
 * pages use lives here and `/design` renders THIS, never a copy of it).
 */

/**
 * A listing photo, hotlinked from the source's CDN exactly as it was published
 * (ADR-0015 decision 3). Never `next/image`: its loader fetches the file onto
 * our server and caches it there, which is the copy the display license does
 * not cover (ADR-0006 as amended) — and `unoptimized` would still leave the
 * next contributor one prop away from turning it back on.
 */
export function AnimalPhoto({
  src,
  alt,
  className,
  priority,
  width,
  height,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
  /** the source's published pixel size, when it publishes one — never a guess */
  width?: number;
  height?: number;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see above: hotlinked, never proxied
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      className={className}
    />
  );
}

/**
 * The Pet Adoption Tracker pixel, required on every RescueGroups detail page by
 * the API terms (ADR-0006 decision 2). The URL is read from the display row,
 * never synthesized — and it is not decorative, so it must not be conditioned
 * on anything a layout change could switch off.
 */
export function TrackerPixel({ src }: { src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a tracking pixel, not content
    <img src={src} alt="" width={1} height={1} aria-hidden className="h-px w-px opacity-0" />
  );
}
