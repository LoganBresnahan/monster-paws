import { describe, expect, it } from "vitest";
import { spokenAnimalName } from "@/core/email/animal-name";

// Fixture provenance: names sampled at random from the dev `animals` table on 2026-11-04 and the
// expected names read by hand by Claude from those samples. The crew's are from `src/ui/crew.ts`.
describe("what the mail calls an animal", () => {
  it.each([
    ["Beetle", "Beetle"],
    ["Sparrow (Courtesy Post) Foster or Adopt Me!", "Sparrow"],
    ["COURTESY POST: Kobe", "Kobe"],
    ["Koa - (Courtesy Post) - Adopt Me!", "Koa"],
    ["Evee (Courtesy Post) -Adopt Me", "Evee"],
    ["MIKEY - Bonded with Gilligan", "Mikey"],
    ["Gus & Shawn *BONDED*", "Gus & Shawn"],
    ["Blu Girl *Adopt*", "Blu Girl"],
    ["*TILLAMOOK", "Tillamook"],
    ["*MAPLE COOKIE", "Maple Cookie"],
    ["Gypsy Dancer * IN FOSTER *", "Gypsy Dancer"],
    ["Hal, a loving shadow", "Hal"],
    ["Rocket, Willow Grove area (FCID 07/22/2026-138)", "Rocket"],
    ["Gumbo (FCID# 08/10/2026 - 15 Trainer)", "Gumbo"],
    ["Maverick~adopted!", "Maverick"],
    ["Jace-pending adoption-in a Foster Home", "Jace"],
    ["Bella -$75 Adoption Fee! Diamond Dog!", "Bella"],
    ["Alexander:  Not At the Shelter (Wendy)", "Alexander"],
    ["Sheldon @ The Cat's Brew", "Sheldon"],
    ["Luna #begs-for-kisses", "Luna"],
    ["Louise 101726", "Louise"],
    ["Popcorn 4839", "Popcorn"],
    ["Buttons/ ADOPTED", "Buttons"],
    ["Mary-Jane", "Mary-Jane"],
    ["O'Malley", "O'Malley"],
    ["Duke Of Temu (In Foster)", "Duke Of Temu"],
    ["Liv Sponsored Adoption Fee", "Liv"],
    ["Qupid Ferguson Bonded To Donner", "Qupid Ferguson"],
  ])("%s is %s", (published, spoken) => {
    expect(spokenAnimalName(published)).toBe(spoken);
  });

  it.each([
    ["A310627"],
    ["A1933279"],
    ["(NURSING,RESCUE ONLY)"],
    ["URGENT FOSTER HOMES NEEDED FOR CATS"],
    ["Male Pitweiler (Courtesy Post)"],
    ["1234"],
    [""],
    ["🐾"],
  ])("%s leaves no name, so the mail never prints it", (published) => {
    expect(spokenAnimalName(published)).toBeNull();
  });
});
