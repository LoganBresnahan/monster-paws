"use client";

import { useState } from "react";
import type { DisplayPhoto } from "@/core/ingest/pipeline";
import { AnimalPhoto } from "./animal";

/**
 * The detail page's photos: one large photo, the rest as thumbnails that
 * replace it (ADR-0015 decision 7 as amended 2026-09-04 — the first client
 * island, `useState` only, no state library).
 *
 * The frame takes the SELECTED photo's own aspect ratio, from the dimensions
 * the source published beside the URL. That is what makes the whole photo
 * visible with neither a crop nor letterbox bars, and it still reserves the
 * space before the image arrives — these URLs are third-party and uncached, so
 * a frame that sizes itself to a loaded image moves the page under a reader's
 * thumb. Never substitute a default ratio for a missing one: the normalizer
 * drops a photo whose size the source did not publish, precisely so this
 * component never has to guess (ADR-0015 as amended).
 *
 * The cap is on HEIGHT, not the ratio: a tall portrait is shown whole and
 * smaller rather than pushing the animal's name off the screen.
 */
/** Tall photos are shown whole and smaller rather than pushing the animal's name off the screen. */
const HERO_MAX_HEIGHT = "32rem";

export function AnimalGallery({ photos, name }: { photos: DisplayPhoto[]; name: string }) {
  const [selected, setSelected] = useState(0);
  const hero = photos[Math.min(selected, photos.length - 1)];

  return (
    <div>
      {/* The height cap is spent as a WIDTH limit, so the ratio still holds: a
          `max-height` on a full-width box lets the frame stay wider than the
          photo and the bars come straight back. */}
      <div
        className="mx-auto w-full overflow-hidden rounded-cuddly border-2 border-paw/30 bg-paw/10"
        style={{
          aspectRatio: `${hero.width} / ${hero.height}`,
          maxWidth: `calc(${HERO_MAX_HEIGHT} * ${hero.width} / ${hero.height})`,
        }}
      >
        <AnimalPhoto
          key={hero.url}
          src={hero.url}
          alt={`${name}, photo ${selected + 1} of ${photos.length}`}
          width={hero.width}
          height={hero.height}
          priority
          className="h-full w-full object-contain"
        />
      </div>

      {photos.length > 1 && (
        <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-6">
          {photos.map((photo, i) => (
            <button
              key={photo.url}
              type="button"
              onClick={() => setSelected(i)}
              aria-label={`Show photo ${i + 1} of ${name}`}
              aria-current={i === selected}
              className={`aspect-square overflow-hidden rounded-cuddly border-2 bg-paw/10 transition-colors ${
                i === selected ? "border-honey-deep" : "border-paw/20 hover:border-paw"
              }`}
            >
              {/* Cropped, unlike the hero: at 80px a thumbnail is a target to
                  press, not the photo anyone is reading the animal from. */}
              <AnimalPhoto src={photo.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
