/**
 * Hero art (#413) — one drawn plate per vertical, keyed by the face it owns.
 *
 * The six images are the SAME object: the brand cube, with each trade doing
 * something different to it (repeats it, wraps it round the world, draws it
 * out of data, pierces it, builds it, lights it from inside). That is why the
 * key is the FACE, not the slug: slugs are translated and there are two per
 * vertical, while the cross never reorders — the same map the menu, the
 * emblem and the die already share (`FACE_BY_SLUG` in nav.ts).
 *
 * Each plate is TWO files: a transparent SVG drawing and, under it, a real
 * NASA photograph. The founder, 2026-08-29: *"que NO pierda los dibujitos…
 * usemos las fotos como background… pero tendrás que quitarles peso."* So the
 * drawing is still the subject and the photograph is only the room it hangs
 * in — darkened, desaturated and cropped at build time so the photograph's
 * own subject lands under the drawing's. Both halves are generated, never
 * hand-edited:
 * `docs/design/hero-rotativo/generate.py` draws the plates and `grounds.py`
 * treats the photographs (and records what each one is and who to credit).
 *
 * They live in `public/assets/` rather than the CMS for the reason §7 of the
 * project rules gives for team photos and logos: R2 media is not seedable, so
 * a clean rebuild would lose them and every environment would need a manual
 * upload.
 */
import { FACE_BY_SLUG, FACE_ORDER, type FaceKey } from "./nav";

/** face → the plate that vertical wears. */
export const HERO_ART: Record<FaceKey, string> = {
	ec: "/assets/hero/ec.svg",
	cdn: "/assets/hero/cdn.svg",
	bd: "/assets/hero/bd.svg",
	int: "/assets/hero/int.svg",
	gf: "/assets/hero/gf.svg",
	ia: "/assets/hero/ia.svg",
};

/**
 * Two files per ground, and both are needed: AVIF at 2160x1350 is what every
 * device actually downloads, and the 720x450 JPEG is the `<img>` inside the
 * `<picture>` for the browsers that cannot read AVIF. The format is what makes
 * the resolution affordable — nine times the pixels of the old ground for a
 * quarter more weight — and the resolution is what stopped the photograph
 * looking defocused on a retina screen, since a full-bleed band paints far
 * more device pixels than its viewport is wide.
 */
export type HeroGround = { avif: string; jpg: string };

/**
 * face → the photograph that vertical hangs in. Each was chosen because it
 * SAYS what its drawing says — a crowd of stars under a wall of cubes, a deep
 * field under a point cloud — and each crop is then solved so the thing the
 * photograph shows lands under the thing the drawing means. See
 * `docs/design/hero-rotativo/grounds.py` for the anchor of every one.
 */
export const HERO_GROUND: Record<FaceKey, HeroGround> = {
	ec: { avif: "/assets/hero/ground/ec.avif", jpg: "/assets/hero/ground/ec.jpg" },
	cdn: { avif: "/assets/hero/ground/cdn.avif", jpg: "/assets/hero/ground/cdn.jpg" },
	bd: { avif: "/assets/hero/ground/bd.avif", jpg: "/assets/hero/ground/bd.jpg" },
	int: { avif: "/assets/hero/ground/int.avif", jpg: "/assets/hero/ground/int.jpg" },
	gf: { avif: "/assets/hero/ground/gf.avif", jpg: "/assets/hero/ground/gf.jpg" },
	ia: { avif: "/assets/hero/ground/ia.avif", jpg: "/assets/hero/ground/ia.jpg" },
};

/** The plates in the canonical order the home rotates through. */
export const HERO_ART_ORDER: string[] = FACE_ORDER.map((face) => HERO_ART[face]);

/** The grounds in that same order, so slide `i` and ground `i` cross-fade together. */
export const HERO_GROUND_ORDER: HeroGround[] = FACE_ORDER.map((face) => HERO_GROUND[face]);

/**
 * The plate a service slug wears, in either locale — `null` for anything that
 * is not one of the six verticals, which is how a plain CMS page (contacto,
 * quiénes somos) keeps the ordinary light hero instead of silently borrowing
 * a vertical's image.
 */
export function heroArtForSlug(slug: string | undefined): string | null {
	const face = slug ? FACE_BY_SLUG[slug] : undefined;
	return face ? HERO_ART[face] : null;
}

/** The photograph that goes under `heroArtForSlug`, or `null` on the same terms. */
export function heroGroundForSlug(slug: string | undefined): HeroGround | null {
	const face = slug ? FACE_BY_SLUG[slug] : undefined;
	return face ? HERO_GROUND[face] : null;
}

/**
 * The verticals whose hero is a scene rather than a held plate. Each scene is
 * a real place photographed, drawn, and then made into the vertical's own
 * instrument, on the band every scene shares (HeroScene.astro):
 *
 * - `radar` (#529, #567) — the Cabo Peñas lighthouse, the whole photograph:
 *   dusk falls, the lantern lights up and its beam is a radar's sweep — the
 *   counter-image of the castle-and-moat perimeter, which is why it belongs
 *   to the edge-security page.
 * - `bridge` (#531) — the Vizcaya Bridge between Portugalete and Las Arenas:
 *   the two banks with no bridge, the bridge laid as a technical drawing, then
 *   what plugs into it, because the bridge is the bus.
 * - `vision` (#537) — the tanker and the escort tug under that same bridge,
 *   one level closer: photographed, then seen by a machine (one colour, monitor
 *   lines), then read by it — a homage to the Terminator's HUD, whose mission
 *   is set by people: assist, never replace.
 *
 * Assets, like the plates, live in `public/assets/` because R2 media is not
 * seedable (project rules §7); the photographs' credits are in
 * `docs/design/hero-rotativo/README.md`.
 */
/**
 * Where a scene stops laying its art behind the copy and gives it its own row under the first screen's copy
 * (#543): phones and tablets, the same boundary the menu uses. hero-scene.css states it as a media query;
 * the scenes' scripts read it from here.
 */
export const SCENE_ROW = "(max-width: 1100px)";

/** One clock for every opening (#553), in ms; hero-scene.css declares the same two beats for the CSS
 *  (--beat-draw, --beat-drawn). The photograph alone until `draw`, the drawing complete by `drawn`, the
 *  payoff after it, everything at rest by `end`. */
export const SCENE_BEATS = { draw: 2000, drawn: 4500, end: 8000 } as const;

export type HeroSceneKind = "radar" | "bridge" | "vision" | "elevation" | "store" | "sky";
export const HERO_SCENE: Partial<Record<FaceKey, HeroSceneKind>> = { cdn: "radar", int: "bridge", ia: "vision", gf: "elevation", ec: "store", bd: "sky" };

/** The scene this slug (either locale) opens with, or `null` for a held plate or a plain page. */
export function heroSceneForSlug(slug: string | undefined): HeroSceneKind | null {
	const face = slug ? FACE_BY_SLUG[slug] : undefined;
	return (face && HERO_SCENE[face]) || null;
}

export const HERO_BRIDGE = {
	/** the two banks without the bridge or the sky, cut off just under the tug, restored (photo_restore.py: SeedVR2 + its own whites), our lettering on the tanker's stern (stern_label.py): WebP with alpha, 1320×730 */
	banks: "/assets/hero/int-puente-aviles.webp",
	/** the same at 960 px for phones, where the frame is 125vw (a 412 px phone at 1.75 needs 900) */
	banksSmall: "/assets/hero/int-puente-aviles-960.webp",
	/** the same at 2016 px, for double-density desktops: at 1320 a 1575 px screen stretched it to nearly twice its pixels */
	banksLarge: "/assets/hero/int-puente-aviles-2016.webp",
	/** the bridge as an architect's drawing on the same frame, in the bridge's own red, cut to the band its ink occupies (rows 390–926 of 1344): WebP with alpha, 1320×351 */
	plan: "/assets/hero/int-puente-trazo.webp",
	planSmall: "/assets/hero/int-puente-trazo-960.webp",
};

/** The frame is about 75 % of a 1440 × 900 viewport on desktops (it is sized by the band) and 125 % of it on phones. */
export const HERO_BRIDGE_SIZES = "(max-width: 767px) 125vw, 75vw";

export const HERO_VISION = {
	/** the tanker's stern, the tug and the quay, cut from the bridge's Commons original, restored (photo_restore.py: SeedVR2 + its own whites) and with our lettering on the stern (stern_label.py): WebP, 1320×852 */
	photo: "/assets/hero/ia-remolcador-aviles.webp",
	/** the same at 720 px for phones, where the frame is 98vw (a 412 px phone at 1.75 needs 707) */
	photoSmall: "/assets/hero/ia-remolcador-aviles-720.webp",
	/** the same at 2016 px, for double-density desktops */
	photoLarge: "/assets/hero/ia-remolcador-aviles-2016.webp",
};

/** The frame is 1.55 × 81 % of the band's height on desktops (about 63 % of a 1575 × 791 viewport) and 98 % of the width on phones. */
export const HERO_VISION_SIZES = "(max-width: 767px) 98vw, 63vw";

export const HERO_ELEVATION = {
	/** the riverside with the museum taken out (FLUX, blended inside its silhouette only), in black and white: WebP, 1320×645 */
	plot: "/assets/hero/gf-solar-bn.webp",
	plotSmall: "/assets/hero/gf-solar-bn-720.webp",
	plotLarge: "/assets/hero/gf-solar-bn-2016.webp",
	/** the Guggenheim from across the river (Sergio S.C, CC BY-SA 2.0), the photographer's mark painted out: WebP, 1320×645 */
	photo: "/assets/hero/gf-guggenheim-restaurado.webp",
	photoSmall: "/assets/hero/gf-guggenheim-restaurado-720.webp",
	photoLarge: "/assets/hero/gf-guggenheim-restaurado-2016.webp",
};

/** The frame is 2.05 × 86 % of the band's height on desktops (about 88 % of a 1575 × 791 viewport) and up to 125 % of the width below 1100 px; phones ask for 98vw so a 412 px phone at 1.75 (707 px) takes the 720 file (Lighthouse's mobile run scored 0.92 with the 1320). The photograph waits at low priority: it is not seen before 3.8 s and competed with the plot, the LCP. */
export const HERO_ELEVATION_SIZES = "(max-width: 767px) 98vw, (max-width: 1100px) 125vw, 88vw";

export const HERO_STORE = {
	/** the grid of an automated warehouse, robots on its rails (Techwords, CC BY-SA 4.0), restored, the brand painted out: WebP, 1320×714 */
	photo: "/assets/hero/ec-almacen-restaurado.webp",
	photoSmall: "/assets/hero/ec-almacen-restaurado-720.webp",
	photoLarge: "/assets/hero/ec-almacen-restaurado-2016.webp",
};

/** The same frame rules as the elevation's: 1.85 × 86 % of the band on desktops, up to 125 % of the width below 1100 px, 98vw on phones so a 412 px phone takes the 720 file. Here the photograph IS the first paint. */
export const HERO_STORE_SIZES = HERO_ELEVATION_SIZES;

/**
 * The home's voyage (#560, founder 2026-10-05: "From the coast to the stars"). The home stopped
 * showing the drawn plates: it shows the six verticals' PHOTOGRAPHS, never their animations (those
 * belong to each page), in an order that tells one story — the coast, the bridge over the ría,
 * the tug under that same bridge, up the river to the museum, the warehouse, night over the Teide.
 * It is deliberately not FACE_ORDER: the menu, the footer and the area rows keep theirs.
 */
export const HOME_VOYAGE: FaceKey[] = ["cdn", "int", "ia", "gf", "ec", "bd"];

/** The voyage's order for any list keyed by slug; unmapped entries drop out. */
export function sortByVoyage<T extends { id: string; slug?: string }>(entries: T[]): T[] {
	const rank = (e: T) => HOME_VOYAGE.indexOf(FACE_BY_SLUG[e.slug ?? e.id]);
	return entries.filter((e) => rank(e) !== -1).sort((a, b) => rank(a) - rank(b));
}

/**
 * Each slide's photograph, written at 720, 1320, 2016 and 3024 px as `<stem>-720.webp`, `<stem>.webp`,
 * `<stem>-2016.webp` and `<stem>-3024.webp` (a 1512 px wide laptop at 2x needs the last). Four are the home's own (docs/design/hero-rotativo/faro.py, home_voyage.py):
 * the lighthouse as a whole photograph without its masts or sheds, the bridge WITH its bridge, and the
 * warehouse further away. The tug is the AI page's own photograph: the bridge and the tug are two
 * slides, each its own subject, with the cut between them (founder, 2026-10-06: "abandono la idea de
 * que integración e IA vayan anidadas… que se note el salto"). `focus` is the object-position that keeps the subject right of the copy on desktops;
 * `focusNarrow`, where given, the one for the photograph's strip on phones and tablets.
 */
export type HomePhoto = { stem: string; width: number; height: number; focus: string; focusNarrow?: string };
export const HOME_PHOTO: Record<FaceKey, HomePhoto> = {
	// desktops: the lighthouse a little further right of the copy (founder, 2026-10-06); phones and
	// tablets show a narrow slice of the frame, which has to be the one with the lighthouse in it
	cdn: { stem: "/assets/hero/home-faro-limpio", width: 1320, height: 707, focus: "20% 50%", focusNarrow: "70% 50%" },
	int: { stem: "/assets/hero/home-puente-salida", width: 1320, height: 880, focus: "50% 45%" },
	ia: { stem: "/assets/hero/ia-remolcador-aviles", width: 1320, height: 852, focus: "70% 50%" },
	gf: { stem: "/assets/hero/gf-guggenheim-restaurado", width: 1320, height: 645, focus: "62% 50%" },
	ec: { stem: "/assets/hero/home-almacen", width: 1320, height: 707, focus: "62% 55%" },
	bd: { stem: "/assets/hero/bd-observatorio-entero", width: 1320, height: 880, focus: "50% 60%" },
};
/** Phones (#720): the photograph covers the whole band, a portrait box, so a 3:2 to 2:1 frame is drawn 2.5–3.5 times
 * the screen's width. 170vw asks for the file that crop needs, short of the sharpest: which file each phone takes is
 * recorded in docs/architecture.md («Phones, the photograph behind the copy»). They load after the page. */
export const HOME_PHOTO_SIZES = "(max-width: 767px) 170vw, 100vw";

/**
 * The home title's tail, per vertical (#580, brief §3.2): the on-band tint where the h1 stands on the
 * flat band (phones, tablets) and the lift it needs over that vertical's photograph (desktops). The
 * values are theme.css tokens; this is only which one each face takes.
 */
export const HERO_TAIL: Record<FaceKey, { band: string; photo: string; phone?: string }> = {
	cdn: { band: "var(--color-tail-cdn)", photo: "var(--color-tail-cdn-photo)" },
	int: { band: "var(--color-tail-int)", photo: "var(--color-tail-int-photo)" },
	ia: { band: "var(--color-tail-ia)", photo: "var(--color-tail-ia-photo)" },
	// a phone's shade lets less of the Guggenheim's light through than a desktop's veil keeps out (#720)
	gf: { band: "var(--color-tail-gf)", photo: "var(--color-tail-gf-photo)", phone: "var(--color-tail-gf-phone)" },
	ec: { band: "var(--color-tail-ec)", photo: "var(--color-tail-ec-photo)" },
	bd: { band: "var(--color-tail-bd)", photo: "var(--color-tail-bd-photo)" },
};

/** A home photograph's 1320 px file and its srcset. */
export function homePhotoSources(photo: HomePhoto): { src: string; srcset: string } {
	const src = `${photo.stem}.webp`;
	return { src, srcset: `${photo.stem}-720.webp 720w, ${src} 1320w, ${photo.stem}-2016.webp 2016w, ${photo.stem}-3024.webp 3024w` };
}

/**
 * The CDN opening's photograph is the home's own (#567, founder 2026-10-05: «la página de cdn tb cambia»):
 * the whole lighthouse, masts and sheds painted out, the frame extended to the left (faro.py). What the
 * scene plays over it is measured on it (`faro.py measure` → src/assets/hero/cdn-faro.json).
 */
export const HERO_RADAR = {
	...homePhotoSources(HOME_PHOTO.cdn),
	width: HOME_PHOTO.cdn.width,
	height: HOME_PHOTO.cdn.height,
	/** the lighthouse's profile, orange line work on alpha, lossless — #529's drawing (cdn-faro-plan) under a new
	 *  name, registered on this photograph by `faro.py register` */
	plan: "/assets/hero/cdn-faro-perfil.webp",
	/** the same drawing at 660 px */
	planSmall: "/assets/hero/cdn-faro-perfil-660.webp",
};
/** The drawing is about 31 % of the frame's width: about 66vw on phones, 30vw on desktops. */
export const HERO_RADAR_PLAN_SIZES = "(max-width: 1100px) 66vw, 30vw";

/** The radar's rings, in the photograph's 1320 px units, centred on the lantern: one every `step`, as far as
 *  `reach` (past the band's left edge at every width), and the dashed one at the light's nominal range, 35
 *  nautical miles (es.wikipedia, Faro de Cabo Peñas) — 10 nm a ring. The labelled rings are the first four. */
export const RADAR_RINGS = { step: 80, reach: 1440, range: 280 } as const;

export const HERO_SKY = {
	/** three robotic-telescope domes at the Teide Observatory, the sea and an island on the horizon (Mike Peel, CC BY-SA 4.0), whole, restored, the operator's logo painted out of the doors: WebP, 1320×880 */
	photo: "/assets/hero/bd-observatorio-entero.webp",
	photoSmall: "/assets/hero/bd-observatorio-entero-720.webp",
	photoLarge: "/assets/hero/bd-observatorio-entero-2016.webp",
};

/** The elevation's sizes: the frame is 1.5 × 86 % of the band on desktops (less where the band is narrow, so the left dome clears the seal), up to 125 % of the width below 1100 px, 98vw on phones so a 412 px phone takes the 720 file. The photograph is the first paint. */
export const HERO_SKY_SIZES = HERO_ELEVATION_SIZES;

/** The lighthouse's frame is sized like the observatory's (86 % of the band, wider than tall): the same sizes, so a 412 px phone takes the 720 file. */
export const HERO_RADAR_SIZES = HERO_ELEVATION_SIZES;
