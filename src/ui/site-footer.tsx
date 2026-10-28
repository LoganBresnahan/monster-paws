import Link from "next/link";
import { CONTACT_EMAIL, SOCIAL_LINKS, SOURCE_URL } from "@/ui/site";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t-2 border-paw/20 px-6 py-8 text-sm text-muted">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-3 xl:flex-row xl:justify-between">
        <p className="whitespace-nowrap">
          © {new Date().getFullYear()} Monster Paws · Donations coming soon!
        </p>
        <nav aria-label="Site" className="flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-6 xl:flex-nowrap">
          <a href={`mailto:${CONTACT_EMAIL}`} className="whitespace-nowrap hover:text-foreground">
            Contact: <span className="font-medium text-foreground">{CONTACT_EMAIL}</span>
          </a>
          {/* Text links only: a platform's icon carries its own brand terms (ADR-0032). */}
          <span className="flex flex-wrap justify-center gap-x-5 gap-y-2 xl:flex-nowrap">
            {SOCIAL_LINKS.map(({ label, href }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="me noopener noreferrer"
                className="underline hover:text-foreground"
              >
                {label}
              </a>
            ))}
          </span>
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap underline hover:text-foreground"
          >
            Source on GitHub
          </a>
          {/* `/design` 404s in production (ADR-0016), so a link to it must never render there. */}
          {process.env.NODE_ENV !== "production" && (
            <Link href="/design" className="underline hover:text-foreground">
              Design
            </Link>
          )}
        </nav>
      </div>
    </footer>
  );
}
