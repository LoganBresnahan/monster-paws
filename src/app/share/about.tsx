import Link from "next/link";

/** What a stranger who followed a shared link needs next. Words about Monster Paws only: nothing about the donor (ADR-0036). */
export function AboutMonsterPaws() {
  return (
    <section className="mt-14 rounded-cuddly border-2 border-paw/30 bg-card p-6 text-center">
      <h2 className="text-xl font-bold">What is Monster Paws?</h2>
      <p className="mx-auto mt-2 max-w-xl text-muted">
        Sponsor a real shelter animal and get a keepsake painting in their likeness.{" "}
        <span className="font-semibold text-foreground">Every donation goes to the shelter. We keep $0.</span>
      </p>
      <Link
        href="/animals"
        className="mt-5 inline-block rounded-cuddly bg-leaf px-6 py-3 font-bold text-white shadow-md transition-colors hover:bg-leaf-deep"
      >
        See adoptable animals
      </Link>
    </section>
  );
}
