import Image from "next/image";
import Link from "next/link";

/** The wordmark as the way home on every inner page — never an arrow, which reads as "back to the list". */
export function SiteLogo() {
  return (
    <Link href="/" aria-label="Monster Paws home" className="self-start">
      <Image
        src="/brand/wordmark-v1.png"
        alt="Monster Paws"
        width={582}
        height={326}
        priority
        className="h-auto w-28 transition-transform hover:-rotate-2 hover:scale-105"
      />
    </Link>
  );
}
