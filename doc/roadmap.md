# Monster Paws roadmap

Frontier = first unchecked item under **Now**. Check items off as they ship;
pin dogfood findings and deferred sub-tasks to items as carry-ins.

## Now

- [x] **0. ToS research (blocking).** Done 2026-07-29 → **ADR-0006**:
      Petfinder API dead, Adopt-a-Pet closed; RescueGroups is the sole
      aggregator backbone (Tracker pixel, candid key application, purge
      exception); shelter-issued keys are Tier 1; AI art gated on verified
      shelters (photo unlocks → monster art at verification).
      Carry-in → item 1: schema needs `source` tags + set-deletion path.
      Carry-in → item 2: apply for the RescueGroups API key early — approval
      latency is on the critical path.
- [ ] **1. Scaffold.** Next.js + TypeScript + Drizzle + Postgres + pg-boss
      monorepo shape per ADR-0001/0003; docker-compose for local dev;
      CLAUDE.md Commands section filled in the same commit; vitest +
      Playwright wired with one passing test each.
- [ ] **2. Ingest v0.** RescueGroups adapter (v5 preferred, v2 fallback) →
      raw append-only payloads (source-tagged) → normalizer → canonical
      animal records; golden fixtures from real payloads; Tracker pixel on
      detail pages.
- [ ] **3. Animal pages.** ISR public pages (browse + detail) rendering real
      local shelters' animals — this is the demo *and* the v1 supply side.

## Next

- [ ] **4. Donation flow.** Every.org integration + donor accounts; card on
      donate — framed real photo by default; AI art (ADR-0004 pipeline v0,
      built and exercised internally) ships in production **only for
      consented shelters**, credited "Permission to digify <pet> given by
      <shelter>". Collection page.
- [ ] **5. Local consent outreach.** Permission emails to 3–5 local
      shelters: display + digify consent (one email = the ADR-0006 gate).
      **Milestone: one real donation reaches one real shelter.** Verified-
      tier pitch (Shelterluv key, attestations) follows with whichever
      shelter warms up first.
- [ ] **6. Shelterluv integration.** Approval → poller → care-event diffing.
- [ ] **7. Attestation pipeline.** Shelter keys, weekly batch-confirm
      dashboard, hash anchoring, R2 flat-file mirror, public verification page.

## Later

- [ ] **8. Update generation + faithfulness evals.** LLM donor updates from
      confirmed events; the no-unattested-claims harness; adoption
      "graduation" moment + gotcha-day card.
- [ ] **9. Style LoRA.** Fine-tune the "Monster Paws look"; identity conditioning;
      CLIP-QC harness proper.
- [ ] **10. Entity resolution at scale.** Second/third listing source; dedup
      across feeds; trust-hierarchy merge.
- [ ] **11. PWA push** for sponsors; **Expo app** when push friction costs
      engagement.
- [ ] **12. Vet co-signing.**
