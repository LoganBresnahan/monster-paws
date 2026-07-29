# Dogchain - Architecture & Implementation Plan

> **SUPERSEDED** by `doc/DIRECTION.md` (2026-07-28). Kept for reference only —
> do not build from this document.

## Context

Dogchain is a blockchain project that tokenizes real shelter dogs as NFTs. Users donate (e.g. $10) to a dog shelter and receive a unique AI-generated 2D artwork of that dog as an NFT — a digital keepsake they keep forever. The goal is to drive more donations to shelters by making giving fun and collectible. This is also a learning project for the developer, who is new to blockchain.

---

## Architecture Overview

```
                    [User Browser]
                         |
                  [Vercel / Cloudflare]
                   (SvelteKit App)
                         |
              +----------+----------+
              |                     |
     [Thirdweb TS SDK]        [Railway]
    (Auth + Embedded Wallets  (Express API)
     + custom Svelte UI)           |
              |              +-----+-----+
              |              |     |     |
         [Base Chain]   [Postgres] | [Redis]
       (Smart Contract)        |   | (BullMQ)
              |                |   |
              +---[Pinata]-----+   +--[Replicate API]
                  (IPFS)              (Stable Diffusion)
                                          |
                                   [Future: AWS EC2 GPU]
                                   (Self-hosted SD + fine-tuning)
```

---

## Key Technology Decisions

### Blockchain: Base (Coinbase L2)

- Gas fees < $0.01 per NFT mint — negligible on a $10 donation
- Built by Coinbase — best mainstream user onboarding (Coinbase Smart Wallet, gasless txs)
- Full EVM compatibility — standard Solidity/Hardhat/ethers.js tooling
- Polygon was considered but is mid-migration to zkEVM (uncertain roadmap); Base is more stable
- **Testnet:** Base Sepolia (free faucet ETH from Coinbase)

### Smart Contracts: Solidity + Hardhat + OpenZeppelin

- **Hardhat** over Foundry — tests written in TypeScript (matches the rest of the stack), better docs for learners
- **OpenZeppelin v5** — audited, industry-standard ERC-721 base contracts
- Single contract `DogchainNFT.sol` (ERC-721 + donation tracking + shelter payouts)

### Backend: Express + TypeScript + Prisma + PostgreSQL

- **Express.js** — most documented Node framework, ideal for learning
- **Prisma ORM** — type-safe database access, auto-generated types, visual DB explorer
- **PostgreSQL** — relational model fits the domain (users, shelters, dogs, donations)
- **BullMQ + Redis** — async job queue for art generation pipeline
- **ethers.js v6** — blockchain interaction from the backend

### Frontend: SvelteKit + Tailwind + Thirdweb TS SDK

- **SvelteKit** — simpler mental model than React/Next.js, less boilerplate, compiled for performance. Uses file-based routing and SSR out of the box.
- **Tailwind CSS** — utility-first CSS for fast, responsive UI
- **Thirdweb TypeScript SDK** (not the React SDK) — framework-agnostic core for embedded wallets, gasless transactions, and Base integration. We build custom Svelte components for the login/connect UI on top of the SDK.
  - Thirdweb's React `ConnectButton` won't work in Svelte, so we build our own auth modal as a Svelte component that calls the Thirdweb TS SDK methods directly (`wallet.connect()`, `auth.login()`, etc.)
  - This is more upfront work but gives full control over the UX
- **Svelte stores** — native reactive state management (replaces React Query for most use cases)

### Art Generation: Replicate → Self-hosted Stable Diffusion on AWS

**Phase 1 (MVP): Replicate API**
- Serverless Stable Diffusion via API call (~$0.01–0.04/image)
- Zero infrastructure to manage — just an API key
- Supports SDXL, FLUX, and other models out of the box
- Fast iteration during development

**Phase 2+ (Scale): Self-hosted on AWS**
- EC2 `g4dn.xlarge` (~$0.53/hr on-demand, ~$0.16/hr spot) running Stable Diffusion
- **Fine-tune LoRA models** on specific dog art styles for a consistent "dogchain look"
- No content policy filters (OpenAI sometimes blocks animal-related prompts)
- Cost-effective at scale — hundreds of images/hour from one instance
- Architecture: SQS queue → EC2 GPU worker → S3 → Pinata IPFS

**Migration path:** The backend art service uses an interface/adapter pattern — swap `ReplicateProvider` for `AWSProvider` without changing any calling code.

**All generated images** are pinned to IPFS via **Pinata** for permanent, decentralized storage.

### Hosting

| Component | Service | Cost |
|-----------|---------|------|
| Frontend | Vercel or Cloudflare Pages (SvelteKit adapter) | Free tier |
| Backend API | Railway | ~$5–10/mo |
| Database | Railway (managed Postgres) | Included |
| Redis | Upstash (serverless) | Free tier |
| IPFS | Pinata | Free tier (100 pins) |
| RPC | Thirdweb (or Alchemy) | Free tier |
| Monitoring | Sentry | Free tier |
| GPU (future) | AWS EC2 g4dn.xlarge | ~$0.16/hr spot |

---

## Smart Contract Design

**`DogchainNFT.sol`** — ERC-721 with:
- `mintDog(to, uri, shelter)` — payable, requires minimum donation, mints NFT to donor
- `withdrawShelterFunds()` — shelters pull accumulated donations
- `setShelterApproval(shelter, approved)` — owner approves shelters
- On-chain: token ownership, tokenURI, donation amounts, shelter addresses
- Off-chain (DB + IPFS): dog profiles, AI artwork, user accounts, shelter details

**Donation flow:**
- **Crypto:** User's embedded wallet (via Thirdweb) calls `mintDog()` directly with ETH
- **Fiat (Stripe):** Backend receives Stripe webhook → server-side minter wallet calls `mintDog()` on behalf of user

---

## Database Schema (Prisma)

Core models: `User`, `Shelter`, `Dog`, `Artwork`, `NFT`, `Donation`

- `User` — email or wallet address, linked to donations and NFTs
- `Shelter` — name, location, wallet address (for on-chain payouts), verification status
- `Dog` — name, breed, age, description, photos, shelter reference, status (available/adopted)
- `Artwork` — generated art per dog (prompt, IPFS CID, style enum, generation status)
- `NFT` — on-chain token ID, metadata CID, tx hash, linked to dog + user + donation
- `Donation` — amount, payment method (Stripe/crypto), status, linked to user + shelter + NFT

---

## Project Structure (Monorepo)

```
dogchain/
├── package.json              # Root workspace config
├── pnpm-workspace.yaml
├── .env.example
├── packages/
│   ├── contracts/            # Solidity + Hardhat
│   │   ├── contracts/DogchainNFT.sol
│   │   ├── test/DogchainNFT.test.ts
│   │   ├── scripts/deploy.ts
│   │   └── hardhat.config.ts
│   ├── backend/              # Express API
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   │       ├── routes/       # dogs, shelters, donations, users, admin
│   │       ├── services/
│   │       │   ├── art.service.ts        # Art generation orchestration
│   │       │   ├── art-providers/
│   │       │   │   ├── provider.interface.ts  # Common interface
│   │       │   │   ├── replicate.provider.ts  # Phase 1: Replicate API
│   │       │   │   └── aws.provider.ts        # Phase 2: Self-hosted SD
│   │       │   ├── ipfs.service.ts       # Pinata upload/pin
│   │       │   ├── mint.service.ts       # On-chain minting via ethers.js
│   │       │   ├── payment.service.ts    # Stripe integration
│   │       │   └── shelter.service.ts
│   │       ├── jobs/         # art-generation, mint-nft (BullMQ workers)
│   │       ├── middleware/   # auth, error handling
│   │       └── lib/          # blockchain, prisma, pinata clients
│   ├── web/                  # SvelteKit frontend
│   │   ├── src/
│   │   │   ├── routes/       # SvelteKit file-based routing
│   │   │   │   ├── +page.svelte              # Landing page
│   │   │   │   ├── dogs/
│   │   │   │   │   ├── +page.svelte          # Browse dogs
│   │   │   │   │   └── [id]/
│   │   │   │   │       ├── +page.svelte      # Dog detail
│   │   │   │   │       └── donate/
│   │   │   │   │           ├── +page.svelte   # Donation flow
│   │   │   │   │           └── success/
│   │   │   │   │               └── +page.svelte
│   │   │   │   ├── collection/               # User's NFT collection
│   │   │   │   ├── shelters/                 # Shelter listings
│   │   │   │   └── dashboard/                # Shelter admin panel
│   │   │   ├── lib/
│   │   │   │   ├── stores/                   # Svelte stores (auth, wallet, user)
│   │   │   │   ├── components/               # Reusable Svelte components
│   │   │   │   │   ├── ui/                   # Base UI components
│   │   │   │   │   ├── DogCard.svelte
│   │   │   │   │   ├── NFTCard.svelte
│   │   │   │   │   ├── ConnectWallet.svelte  # Custom Thirdweb wallet UI
│   │   │   │   │   └── DonationForm.svelte
│   │   │   │   ├── thirdweb.ts               # Thirdweb SDK client config
│   │   │   │   ├── api.ts                    # Backend API client
│   │   │   │   └── constants.ts              # Contract addresses, chain config
│   │   ├── svelte.config.js
│   │   └── tailwind.config.ts
│   └── shared/               # Shared types + constants across packages
```

---

## Key Frontend Pages (SvelteKit)

| Route | Purpose |
|-------|---------|
| `/` | Landing — hero, featured dogs, how it works |
| `/dogs` | Browse dogs grid with filters |
| `/dogs/[id]` | Dog detail — story, AI art preview, donate CTA |
| `/dogs/[id]/donate` | Donation flow — amount, payment method, confirm |
| `/dogs/[id]/donate/success` | Minted NFT display + share buttons |
| `/collection` | User's NFT gallery |
| `/collection/[tokenId]` | Single NFT detail |
| `/shelters` | Browse shelters |
| `/shelters/[id]` | Shelter profile + their dogs |
| `/dashboard` | Shelter admin — manage dogs, view donations, payouts |

---

## Development Phases

### Phase 1: Foundation & MVP (Weeks 1–4)
**Goal:** End-to-end crypto donation → NFT mint on testnet

- **Week 1:** Monorepo setup, write + test `DogchainNFT.sol`, deploy to Base Sepolia
- **Week 2:** Backend — Express + Prisma + Postgres, seed data, core API routes, server-side minting via ethers.js
- **Week 3:** Frontend — SvelteKit + Thirdweb TS SDK auth, dog browse/detail pages, Svelte stores
- **Week 4:** Connect donation flow end-to-end (crypto path), "My Collection" page

### Phase 2: Art Generation & Fiat Payments (Weeks 5–7)
- **Week 5:** BullMQ art pipeline — Replicate API for Stable Diffusion, IPFS pinning, metadata assembly
- **Week 6:** Stripe integration — fiat checkout, webhooks, server-side relayer minting
- **Week 7:** Shelter dashboard — manage dogs, view donations, trigger payouts

### Phase 3: Polish & Launch (Weeks 8–10)
- **Week 8:** UX polish — loading states, mobile responsive, social sharing, SEO
- **Week 9:** Testing + security — E2E tests (Playwright), Slither contract analysis, rate limiting, input validation
- **Week 10:** Production deploy — Base mainnet, Railway, Vercel/Cloudflare, Sentry, custom domain

### Phase 4: Future Enhancements (Post-launch)
- **Self-hosted Stable Diffusion on AWS** — EC2 GPU, fine-tuned LoRA models, SQS queue pipeline
- 3D art pipeline (Meshy/Tripo3D — plugs into existing `ArtStyle` enum + provider interface)
- Art style selection for users (cartoon, watercolor, pixel)
- Dog adoption tracking on-chain
- Secondary marketplace with shelter royalties (ERC-2981)
- Gas sponsorship via ERC-4337 Paymaster

---

## Verification Plan

After each phase, verify with:

1. **Contracts:** Run `npx hardhat test` — all tests pass. Verify on Base Sepolia block explorer.
2. **Backend:** `curl` API endpoints. Confirm DB writes via Prisma Studio. Check minting produces valid tx hashes on block explorer.
3. **Frontend:** Manual flow — browse dogs → login → donate → see NFT in collection.
4. **Art pipeline:** Trigger generation job → confirm image appears on IPFS gateway URL.
5. **Fiat flow:** Test Stripe checkout with test cards → confirm webhook triggers mint → NFT appears.
6. **Production:** Smoke test all flows on mainnet with real small donation ($1).
