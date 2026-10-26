// The founders' own pets, never listings: files under public/brand/crew/ are
// re-encoded from pixels alone, so no EXIF, GPS or generator metadata ships
// (tests/crew-assets.test.ts; consent in doc/consent/0001-the-crew.md).
export type CrewPet = {
  slug: string;
  name: string;
  about: string;
  kind: string;
  age: string;
  she: boolean;
  photo: [number, number];
};

export const CREW: CrewPet[] = [
  { slug: "plum", name: "Plum", about: "Grey Cane Corso puppy, 4 months", kind: "Cane Corso", age: "4 months", she: false, photo: [1054, 1400] },
  { slug: "marty", name: "Marty", about: "Flame Point Siamese, 14", kind: "Flame Point Siamese", age: "14 years", she: false, photo: [1050, 1400] },
  { slug: "beetle", name: "Beetle", about: "Bloodhound, 7", kind: "Bloodhound", age: "7 years", she: true, photo: [1050, 1400] },
  { slug: "stacey", name: "Stacey", about: "Tabby Cat, 14", kind: "Tabby Cat", age: "14 years", she: true, photo: [787, 1400] },
  { slug: "ducky", name: "Ducky", about: "Pit Bull mix, 5", kind: "Pit Bull mix", age: "5 years", she: true, photo: [1400, 1054] },
];

/** Every painting is 1216×832: klein-v1's landscape canvas (ADR-0004). */
export const PAINTING = [1216, 832] as const;
