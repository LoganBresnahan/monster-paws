import Link from "next/link";

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

/**
 * One animal on the browse grid (ADR-0015 decision 5). The whole card is the
 * link: a card whose photo, name and location are three separate targets is
 * three ways to miss.
 *
 * The photo is contained in a FIXED 4:3 frame, unlike the detail page's frame
 * which takes the photo's own ratio (ADR-0015 as amended 2026-09-04). A grid
 * needs cards of one height, and the choice is between a uniform frame that
 * shows the whole photo with some ground around it and one that crops — and
 * cropping is what put a dog's head outside the frame on the detail page. The
 * space is reserved before the third-party image arrives either way.
 */
export function AnimalCard({
  href,
  name,
  facts,
  photo,
  footer,
  fallbackEmoji,
}: {
  href: string;
  name: string;
  facts: string;
  /** the licensed display row's first photo, or none — never a photo from an unlicensed row */
  photo?: { url: string; width: number; height: number };
  footer?: string;
  fallbackEmoji: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-cuddly border-2 border-paw/30 bg-card shadow-sm transition-colors hover:border-paw"
    >
      {/* `absolute inset-0`, not a flex child: an aspect-ratio box GROWS to fit
          content that is taller than it, so a portrait photo would set the
          card's height and the row would come out ragged. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-paw/10">
        {photo ? (
          <AnimalPhoto
            src={photo.url}
            alt={name}
            width={photo.width}
            height={photo.height}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <span aria-hidden className="absolute inset-0 flex items-center justify-center text-5xl">
            {fallbackEmoji}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-lg font-bold group-hover:text-leaf-deep">{name}</h3>
        <p className="mt-1 text-sm text-muted">{facts}</p>
        {footer && <p className="mt-auto pt-3 text-xs text-muted">{footer}</p>}
      </div>
    </Link>
  );
}

/**
 * Both pages render an animal without a photo, so the stand-in is one function:
 * a species that says "dog" on browse and "🐾" on detail would read as two
 * different animals. Any deeper fact comes from `animals` — never from
 * `animal_display`, which is licensed expression, not fact.
 */
export function speciesEmoji(species: string): string {
  if (species === "dog") return "🐶";
  if (species === "cat") return "🐱";
  return "🐾";
}
