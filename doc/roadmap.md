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

- [ ] **4. Donation flow.** Every.org integration + donor accounts; instant
      keepsake card on donate (ADR-0004 pipeline v0: style-prompted, QC loop);
      collection page.
- [ ] **5. Outreach.** Pitch a local shelter for the verified tier (warmed by
      any aggregator donations). Goal: demo meeting + Shelterluv API request.
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
