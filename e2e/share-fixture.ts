import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

/**
 * Stands in for the share source (ADR-0036): the crew's own paintings, under the
 * layout `npm run share -- publish` writes. Its manifest is hostile on purpose:
 * the extra fields prove a page shows the name and kind and nothing else.
 */
export const SHARE_TOKEN = "crewFixtureToken-000_A";
export const SHARE_MANIFEST = {
  name: "Beetle",
  kind: "Bloodhound",
  email: "fixture-donor@example.com",
  amount: 4242,
  intentId: "fixture-intent-id",
  donorName: "Fixture Donor",
};

const PAINTINGS = ["beetle", "plum", "marty", "stacey"];
const CREW_DIR = path.resolve(__dirname, "..", "public", "brand", "crew");

export async function startShareFixture(port: number): Promise<() => Promise<void>> {
  const server = createServer(async (req, res) => {
    const match = /^\/share\/([^/]+)\/(manifest\.json|([1-4])\.jpg)$/.exec(req.url ?? "");
    if (!match || match[1] !== SHARE_TOKEN) {
      res.writeHead(404).end();
      return;
    }
    if (match[2] === "manifest.json") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(SHARE_MANIFEST));
      return;
    }
    const file = path.join(CREW_DIR, `${PAINTINGS[Number(match[3]) - 1]}-painting.jpg`);
    res.writeHead(200, { "content-type": "image/jpeg" }).end(await readFile(file));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return () => new Promise((resolve) => server.close(() => resolve()));
}

// Run directly for a look in the dev server: `npx tsx e2e/share-fixture.ts 3198`, with SHARE_BASE_URL pointing here.
if (process.argv[1]?.endsWith("share-fixture.ts")) {
  void startShareFixture(Number(process.argv[2] ?? 3198)).then(() => {
    console.log(`share fixture up: /share/${SHARE_TOKEN}`);
  });
}
