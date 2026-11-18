#!/usr/bin/env node
/**
 * ci-check-layout.mjs — the geometry gate (#453).
 *
 * The areas block shipped as six white boxes, each carrying a full paragraph.
 * Measured on the running stack before this change: 1695px tall on a 390px
 * phone — two whole screens for six names — with row heights of 214, 282, 282,
 * 283, 259 and 305px. Ragged item heights are the actual reason a list starts
 * demanding boxes to tidy it up, so the fix equalises the lines and drops the
 * box. This gate is what keeps it equalised, because nothing else in CI can
 * see composition:
 *
 *   · `copy-baseline` freezes the WORDS. It froze the duplicated excerpt too,
 *     happily, for as long as it was there.
 *   · `ci-check-design-tokens.py` reads CSS as text and never opens a browser.
 *   · `ci-check-a11y.mjs` measures contrast and reflow, and a ragged list is
 *     neither illegible nor overflowing.
 *   · `ci-check-var-resolves.mjs` asks whether a declaration survived, not
 *     what it drew.
 *
 * Three assertions to begin with, all over the rendered page:
 *
 *   G1  every ROW list has equal row heights — max − min ≤ 8px — at 390, 768
 *       and 1440. Eight pixels is a hairline plus a rounding error, not a
 *       design allowance: two rows that differ by more than that read as two
 *       different things.
 *
 *   G2  a ROW draws no box AT REST. No radius, no shadow, and the left accent
 *       transparent. The colour is a state — hover, focus, current — and a row
 *       that paints a container at rest is a card. Six of them are a grid
 *       pretending to be a list, which is exactly what #453 removed.
 *
 *   G3  no long run of copy is printed twice on the same page. The e-commerce
 *       excerpt used to appear verbatim in the hero card and again in the areas
 *       row, twenty lines apart, which is what made the block read as filler.
 *       That defect is invisible to every other gate: the copy baseline had it
 *       frozen in, and a duplicate is neither a contrast nor a token fault.
 *
 * Six more arrived with the footer (#454), which had the same class of defect —
 * geometry no gate could see:
 *
 *   G4  the reference strip is ONE line where there is room for one. Measured
 *       before the change: 6 marks and a seventh alone below, at both 1024 and
 *       1440, because the strip inherited the reading column's 840px while the
 *       set needs ~930. A lone mark under a full line reads as an accident, and
 *       the marks are the credibility of the page.
 *
 *   G5  every line of the strip is centred within it (±8px). Flex centres a
 *       partial line for free; a grid does not, and the obvious "tidy this into
 *       a grid" refactor is exactly what would leave a wrapped mark hard left.
 *
 *   G6  nothing in the footer is centre-aligned. It used to be centred below
 *       768px and left above it, so the same footer read as two designs
 *       depending on the phone in your hand. Checked at all four widths, which
 *       is what makes "one alignment everywhere" a measurement and not a hope.
 *
 *   G7  the EU emblem renders at least 37.8 CSS px tall — 1cm at 96dpi, the
 *       minimum in `eu-emblem-rules_es.pdf` p.10, whose duty that same document
 *       extends to "sitios web y sus versiones móviles". Measured on the FLAG,
 *       not the lockup around it: each mark declares the flag's share of its own
 *       artwork in `data-emblem-ratio`, because a 40px lockup whose flag is 88%
 *       of it renders a 35px emblem while looking compliant. The single 2560×242
 *       JPEG we shipped rendered it at 18.2px on a 390px phone: a compliance
 *       failure, penalty 10% of the aid, that no gate here could see and no
 *       amount of reading the CSS would reveal.
 *
 *   G8  every link in the footer's nav lists renders at one size. There were
 *       five — 13, 14, 17, 18 and 20px — and the home's own body copy sat below
 *       two of them.
 *
 *   G10 nothing in the footer crosses the page's ONE measure. `theme.css` says
 *       it in as many words — "There is no second measure. A page has ONE width
 *       and everything inside it shares one edge." Nothing could check it until
 *       now, and the first draft of this very footer broke it: both sides of the
 *       signature row were shrinkable, the columns lost, shrank to 403px, and
 *       their `nowrap` children painted the CTA 73.7px past the container's
 *       right edge. The reference banner is exempt by construction — it carries
 *       its own, wider measure, for marks rather than prose.
 *
 *   G11 the EU emblem outweighs every other mark on the funding line by at least
 *       1.3×. `Orden HFP/1030/2021` art. 9.4 binds only "al menos de forma tan
 *       prominente y visible como los otros logotipos", which equal heights meet.
 *       The `Guía de Justificación` red.es asks a compliance screenshot against
 *       recommends "como mínimo, un 30% más grande que el resto de los
 *       logotipos", and the Enero 2022 identity manual makes that ratio binding
 *       for cartelería. Meeting the strictest of the three costs one declaration.
 *
 *   G12 no rule that selects a funding mark may fade, recolour, rotate, crop or
 *       otherwise modify it. The marks are supplied artwork: the EU emblem's own
 *       usage rules and the `Manual de Identidad` both say they may be SCALED and
 *       nothing else, and art. 34.3 of Orden ETD/1498/2021 makes carrying them
 *       correctly an obligation rather than a courtesy — art. 38.4 prices a
 *       publicity breach at 10% of the awarded aid. G7 and G11 protect the size
 *       half; nothing protected the integrity half.
 *
 *       This one reads the STYLESHEET, not the rendered rest state, and that is
 *       the whole point: a `:hover` or `:focus` rule that fades a mark on
 *       interaction is invisible to any measurement of the page at rest, and
 *       interaction is the plausible way this breaks — somebody gives every
 *       footer image a tasteful hover.
 *
 *       The walk reads declarations BEFORE recursing. The obvious shape is
 *       wrong and fails silently, which is how #470's version of this reported
 *       clean forever while its own control passed: CSS Nesting gives every
 *       CSSStyleRule its own `cssRules` — an empty list when nothing is nested,
 *       and truthy — so `if (r.cssRules) { walk(r.cssRules); continue; }` skips
 *       every ordinary rule in the sheet. Measured on the built `Base` sheet on
 *       2026-09-02: 222 top-level rules, 14 reached. So the gate does not take
 *       its own walk on trust either — it counts the style rules it actually
 *       READ against the number the sheet declares at top level, and refuses to
 *       report clean if it read fewer. Counting rules *visited* would not do:
 *       the wrong shape still enters every top-level rule, recurses into its
 *       empty `cssRules` and reads nothing, so it scores 222 of 222 visited and
 *       0 leaves. The leaf count is the one that tells them apart.
 *
 *   G19 a framed photograph paints a frame and nothing else: four border edges
 *       of one width and one colour, and no shadow. `docs/design-system.md`
 *       used to list *photograph* among PANEL's surfaces, which would have
 *       given the three faces on the home a 4px accent stripe and the site's
 *       only shadow. The tree never did that, and the answer (#482) is that a
 *       photograph is not a container at all — a container holds content, and
 *       an image IS content. Its border is a frame on the picture, not chrome
 *       around a box, which is why the benchmark's instrument counts it as a
 *       tuple and the system does not name it. This assertion is what keeps
 *       the tree on the side of that answer: the drift ran doc-to-tree once
 *       and could as easily run the other way.
 *
 *   G20 no body copy runs past MEASURE_MAX characters a line. Measured the way
 *       `bench-visual.mjs` measures it — box width divided by the mean advance
 *       of a-z in the element's OWN resolved font — because faces differ by
 *       more than 10% in average advance and an em approximation compares the
 *       CSS rather than the type.
 *
 *       Two things this deliberately does NOT do (#481). It does not cap a
 *       line's width: `theme.css` says "there is no second measure… everything
 *       inside it ends at the same edge" (#304), and a max-width on prose is
 *       exactly the second edge that forbids. The lever is type size, which is
 *       why the fix that ships with this assertion is 16px -> 18px and not a
 *       narrower column. And it ignores anything under BODY_MIN_PX: at one
 *       measure, smaller type buys more characters by arithmetic, every site
 *       in the benchmark set does the same (Test Double 106, Simple Thread
 *       194 in fine print), and an assertion that fired on a 13px disclaimer
 *       would be asserting the column width under another name.
 *
 *   G9  the footer paints no ground of its own — transparent, or at worst the
 *       body's own colour. Giving the footer its own band is what makes a footer
 *       read as bolt-on, and the rule that used to be here painted
 *       `--color-secondary` over a body that is already that colour: a band
 *       waiting to become visible the day either token moves.
 *
 * Four more with the page openings (#456), where the defect was that the
 * header's own height was a magic number nobody had measured:
 *
 *   G15 `--header-h` matches the header the browser actually draws. Twelve
 *       declarations across eight stylesheets used to spell the opening inset
 *       as `calc(80px + …)` below 768 and `calc(100px + …)` above it. The
 *       header measures 69px and 78px. BOTH literals were wrong — the desktop
 *       one by 22px — and nothing could say so, because a wrong constant is
 *       not a wrong declaration. This is the assertion that makes the token a
 *       measurement instead of a guess.
 *
 *   G16 every document opening reserves the same inset: `--header-h` plus
 *       `--open-clear`, and nothing else. Before, the same h1 opened at 104,
 *       140 or 160px depending on which stylesheet the page happened to
 *       import — six different values across the page types at 1440. The two
 *       photographic bands are exempt BY NAME in `OPENING_ROUTES`, not by
 *       accident: their copy is centred against a plate whose subject is
 *       registered to that column at build time, and top-aligning it ran the
 *       kicker straight through the drawing. Measured, then reverted.
 *
 *   G17 nothing decorative is painted `position: fixed` behind the document.
 *       `.s-emblem-bg` was a 340px cube at 7% opacity fixed across the whole
 *       viewport at `z-index: -1`. Being fixed, its relationship to the copy
 *       was whatever the scroll offset happened to be: on «Quiénes somos» it
 *       crossed the boot console, the lede, a section heading and four
 *       paragraphs at once. A fixed layer below the content cannot be composed
 *       with anything, which is the whole objection, and it is invisible to
 *       every other gate — it changes no contrast, no token and no word.
 *
 *   G21 every document opening that is not photographic closes on
 *       `--rhythm-section`, the same as every section after it (#570). The
 *       band-less pages (privacy, search, the 404) had kept 80px, `/referencias`
 *       8px on top, the 404 a literal inset, and nothing measured a bottom.
 *
 *   G22 no page scrolls sideways at the phone width. The header's global
 *       `.search-hint` (nowrap) leaked onto the search page's own paragraph of
 *       the same name and pushed the document to 452px in a 393px viewport —
 *       on one page, in one locale, invisible to a gate that read four routes.
 *
 *   G18 `.s-hero__card` opens above the fold at 390×844. The card is the only
 *       thing in the hero band that says what we do; a phone that has to
 *       scroll to reach it is a phone that was shown a picture and a heading.
 *
 *   G23 the home's first kicker sentence — who we work for — ends above the
 *       fold at 393×659, an iPhone 15 Pro's viewport with Safari's bars. With
 *       the photograph's strip on top it ended at 718 there, and a first-time
 *       reader saw a cube, an index and half a heading (#572, #643).
 *
 * Deliberately NOT a screenshot diff. A pixel diff over 26 routes would go red
 * on every PR in this redesign by design, get re-baselined on sight, and become
 * furniture. Machines assert geometry; whether the composition is any good is a
 * human judgement and pretending otherwise is how a redesign gets approved by a
 * green checkmark.
 *
 * Exit 0 clean · 1 found something · 3 the scan itself is blind or broke.
 *
 * Usage: node scripts/ci-check-layout.mjs [base-url]   default :8787
 */
import puppeteer from "puppeteer";
import { cdpDiagnosis, stackDiagnosis } from "./lib/stack-probe.mjs";
import { HOST_NEUTRAL } from "./lib/host-neutral.mjs";

const BASE = (process.argv[2] || "http://localhost:8787").replace(/\/$/, "");

/**
 * The lists that are ROWs, and the pages that render them. Empty since #580:
 * the home's areas list was the site's one ROW list, and it left with the
 * October home (the «nosotros» card indexes the verticals now). G1 and G2 stay,
 * with their plant, for the next list built in that chrome — add it here in the
 * same commit. G3 keeps its own control below either way.
 */
const ROW_LISTS = [];
/** Pages whose whole copy must not repeat itself. */
const PROSE_ROUTES = ["/", "/en"];
/**
 * G20. 75 is the top of the conventional 45-75 range and the value the tree
 * actually holds across these routes; the home was the widest of the nine sites
 * `bench-visual.mjs` measured, and the one block past the range was body copy,
 * not fine print. Measured at 1440 only: the column is `clamp(880px, …, 1040px)`,
 * so the widest viewport is where a line is longest, and every narrower one is
 * covered by the same assertion passing here.
 */
const MEASURE_MAX = 75;
const BODY_MIN_PX = 16;
const MEASURE_CHARS = 60;
const MEASURE_ROUTES = ["/", "/en", "/comercio-electronico", "/quienes-somos"];
/** G19: the framed photographs, and the pages that render them. The team's faces
 *  left the home (#565); Quiénes somos is where they are framed now. */
const FRAME_ROUTES = ["/quienes-somos", "/en/about-us"];
const FRAME_SELECTOR = ".team-card__photo img";
/** The footer is the same on every route but the home, which shows the references
 *  band higher up and leaves it out of its footer (#562); one full footer per locale
 *  is the whole surface. */
const FOOTER_ROUTES = ["/quienes-somos", "/en/about-us"];
/**
 * The width from which the whole reference set must fit on one line. Below it
 * the strip wraps and G5 takes over; above it a wrapped mark is the orphan.
 */
const STRIP_ONE_LINE_FROM = 1024;
/**
 * 1cm at 96dpi — the emblem minimum in `eu-emblem-rules_es.pdf` p.10. It is the
 * FLAG's height, not the lockup's, which is why each mark declares the flag's
 * share of its own artwork in `data-emblem-ratio`: a 40px lockup whose flag is
 * 88% of it renders a 35px emblem and fails while looking compliant.
 */
const EMBLEM_MIN_PX = 37.8;

/** How much larger the EU emblem must render than every other funding mark. */
const EMBLEM_PROMINENCE = 1.3;

// G12 — the properties that would modify a supplied mark rather than scale it.
// The salvaged issue named five; the other seven are the same assertion reached
// by other spellings, and a rule that says "no rotation" while `rotate: 45deg`
// sails past is theatre. `clip-path` and `mask-image` are here because the
// usage rules forbid cropping in as many words, and `mix-blend-mode` because
// blending a flag into its ground recolours it without naming a colour.
const INTEGRITY_PROPS = [
	"filter", "-webkit-filter", "opacity", "transform", "rotate", "scale",
	"translate", "clip-path", "-webkit-clip-path", "mask-image",
	"-webkit-mask-image", "mix-blend-mode", "text-decoration-line",
];

// The identity value of each of the above — the value that means "unmodified".
// `transition` is deliberately absent from the props list: a transition alone
// changes nothing, and the state it transitions TO is a rule of its own, which
// this gate reads.
const INTEGRITY_IDENTITY = new Set(["", "none", "1", "normal", "0deg", "0px", "auto"]);

const FUNDING_SELECTOR = "footer-funding";
/**
 * The open menu, and the two things about it a screenshot cannot argue with.
 *
 * One route per locale carries a current SPECIALTY, one a current SITE link:
 * the two rows are marked by different machinery and only one of them was
 * broken, so measuring a page where the specialty is current would have
 * reported the site row green forever.
 */
const MENU_ROUTES = [
	"/cdn-waf-seguridad-edge-cloudflare",
	"/quienes-somos",
	"/en/cdn-waf-edge-security-cloudflare",
	"/en/about-us",
];
/** Desktop only: on a phone the panel stacks the die first and scrolling is correct. */
const MENU_SIZES = [
	{ width: 1440, height: 900 },
	{ width: 1280, height: 800 },
];
/**
 * How much of the viewport the open panel may leave empty above its first
 * element and below its last. Measured on the defect (#455) at 1440x900: 169px
 * above and 197px below a 458px list, which is 41% of the screen the reader
 * just asked to be shown, and the half above pushes the first specialty a third
 * of the way down it. The reworked panel measures 11%. 25% is the line: well
 * clear of the fixed state, well under the broken one, and not a number the
 * next honest layout has to negotiate with.
 */
const MENU_WASTE_MAX = 25;

const WIDTHS = [390, 768, 1440];
/**
 * 1024 is in here and not in WIDTHS because it is where the strip has least to
 * spare: the measure is capped at 1140px, so 1024 leaves 984px of room for a
 * set that needs ~932. Fifty-two pixels. That is the width a new reference, or
 * a wider mark, breaks first — and it is invisible at 1440.
 */
const FOOTER_WIDTHS = [390, 768, 1024, 1440];
/**
 * One route per page type, both locales, with the selector of the section that
 * opens it.
 *
 * `photographic: true` marks a band that carries a plate. Those two are exempt
 * from G16 and from nothing else: the plate's cube is registered to a centred
 * column at build time, so the copy cannot be top-aligned to the shared inset
 * without landing on the drawing. That was measured on this branch and
 * reverted, and the exemption is written down here rather than being a hole in
 * the assertion.
 */
const OPENING_ROUTES = [
	{ route: "/", opening: ".s-hero", photographic: true },
	// no service page opens with a plate since #556: Big Data, the last one, opens with a scene like the other five
	{ route: "/quienes-somos", opening: ".s-hero" },
	{ route: "/contacto", opening: ".s-contact" },
	{ route: "/deconstruyendo", opening: ".dc-hero" },
	{ route: "/referencias", opening: ".s-hero" },
	{ route: "/politica-de-privacidad", opening: ".legal" },
	{ route: "/en", opening: ".s-hero", photographic: true },
	{ route: "/en/about-us", opening: ".s-hero" },
	{ route: "/en/contact", opening: ".s-contact" },
	{ route: "/en/deconstructing", opening: ".dc-hero" },
	{ route: "/en/references", opening: ".s-hero" },
	{ route: "/en/privacy-policy", opening: ".legal" },
	// the band-less page types, out of every route list until #570
	{ route: "/search", opening: ".search-page" },
	{ route: "/en/search", opening: ".search-page" },
	{ route: "/no-existe-ci", opening: ".not-found" },
	{ route: "/en/no-such-page-ci", opening: ".not-found" },
];
/** The openings are measured at the two widths the tokens switch between. */
const OPENING_WIDTHS = [390, 1440];
/** The phone the hero card has to fit on. iPhone 14/15 at 1×. */
const FOLD = { width: 390, height: 844 };
/** Routes whose hero carries the card. */
const CARD_ROUTES = ["/", "/en"];
/**
 * G23: the phone the home's «for whom» has to fit on. Smaller than FOLD on
 * purpose: 844 is an iPhone 15's whole screen, 659 what Safari leaves of a
 * 15 Pro's with its bars showing (Playwright's `iPhone 15 Pro` viewport).
 */
const WHO_FOLD = { width: 393, height: 659 };

/** A hairline plus a rounding error. Not a design allowance. */
const TOLERANCE = 8;
/** Shorter than this and a repeat is a label ("Ver más"), not duplicated prose. */
const PROSE_MIN = 60;

const fail = (m) => console.error(`✗ ${m}`);
const ok = (m) => console.log(`✓ ${m}`);

const die = async (e) => {
	// the diagnosis first, then the error itself — a healthy stack makes the
	// former say nothing, and exiting 3 in silence helps nobody
	const d = await stackDiagnosis(BASE).catch(() => cdpDiagnosis(e));
	if (d) console.error(d);
	console.error(e?.stack || e);
	process.exit(3);
};
process.on("unhandledRejection", die);
// A gate that crashes must exit 3, not 1: "the scan broke" and "the page is
// wrong" are different answers and a stack trace under a red X reads as the
// second one. The first draft of this file threw here — inside `PLANT`, on a
// page whose markup had moved — and reported exit 1 with a raw TypeError.
process.on("uncaughtException", die);

/* ── measurements, taken in the page ───────────────────────────────────── */

/** G1 + G2: row geometry and the chrome each row paints at rest. */
const MEASURE_ROWS = ({ list, item }) => {
	const ul = document.querySelector(list);
	if (!ul) return null; // the caller turns a missing list into a blind-scan exit
	const items = [...ul.querySelectorAll(item)];
	if (items.length === 0) return { items: 0 };
	const transparent = (c) => c === "transparent" || /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)$/.test(c);
	return {
		items: items.length,
		heights: items.map((el) => Math.round(el.getBoundingClientRect().height)),
		chrome: items.map((el) => {
			const cs = getComputedStyle(el);
			return {
				radius: ["Top", "Bottom"].flatMap((v) => ["Left", "Right"].map((h) => cs[`border${v}${h}Radius`])),
				shadow: cs.boxShadow,
				accent: cs.borderLeftColor,
			};
		}),
	};
};

/** G3: every run of visible copy on the page, long ones only. */
const MEASURE_PROSE = (min) => {
	const seen = [];
	const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	for (let n = walk.nextNode(); n; n = walk.nextNode()) {
		const el = n.parentElement;
		if (!el || el.closest("script, style, template, noscript")) continue;
		// what is not painted is not a repeat a reader can see
		if (!el.getClientRects().length) continue;
		const text = n.nodeValue.replace(/\s+/g, " ").trim();
		if (text.length >= min) seen.push(text);
	}
	return seen;
};

/**
 * G4–G9: the footer's geometry.
 *
 * `aligned` is a fixed selector list rather than every element: `text-align`
 * inherits, so walking the whole subtree would report one planted centre a
 * dozen times, and the `.btn` CTA centres its own label legitimately. If one of
 * these classes is renamed the list stops matching and the control below turns
 * that into exit 3 — the same contract the row selectors already carry.
 */
const MEASURE_FOOTER = () => {
	const footer = document.querySelector(".site-footer");
	if (!footer) return null;

	const row = footer.querySelector(".ref-banner__row");
	const marks = row ? [...row.querySelectorAll("img")] : [];
	let stripLines = [];
	if (row && marks.length) {
		const strip = row.getBoundingClientRect();
		const byTop = new Map();
		for (const img of marks) {
			const b = img.getBoundingClientRect();
			const top = Math.round(b.top);
			if (!byTop.has(top)) byTop.set(top, []);
			byTop.get(top).push(b);
		}
		stripLines = [...byTop.entries()].map(([top, bs]) => ({
			top,
			n: bs.length,
			// the line's own centre against the strip's. Measured from the marks
			// themselves, not from their tracks: a grid centres tracks, and a
			// half-empty last track is exactly how a wrapped mark drifts left.
			offset:
				(Math.min(...bs.map((b) => b.left)) + Math.max(...bs.map((b) => b.right))) / 2 -
				(strip.left + strip.right) / 2,
		}));
	}

	const ALIGNED = [
		".footer-signature",
		".footer-signature__house",
		".footer-signature__line",
		".footer-cols",
		".footer-col",
		".footer-col h3",
		".footer-list",
		".footer-list li",
		".footer-legal__inner",
	];
	const aligns = [];
	for (const sel of ALIGNED)
		for (const el of footer.querySelectorAll(sel))
			aligns.push({ sel, align: getComputedStyle(el).textAlign });

	return {
		marks: marks.length,
		stripLines,
		aligns,
		alignedSelectors: ALIGNED.filter((sel) => footer.querySelector(sel)).length,
		// only the images that carry the EU emblem: the ratio is the flag's share
		// of the artwork's height, because the 1cm floor is the FLAG's, not the
		// lockup's, and the flag is 88% of the cut we ship
		funding: [...footer.querySelectorAll(".footer-funding__mark[data-emblem-ratio]")].map((img) => ({
			alt: (img.alt || "").slice(0, 32),
			ratio: parseFloat(img.dataset.emblemRatio),
			h: img.getBoundingClientRect().height,
		})),
		// every mark on the funding line, emblem or not: G11 compares them
		fundingAll: [...footer.querySelectorAll(".footer-funding__mark")].map((img) => ({
			alt: (img.alt || "").slice(0, 32),
			h: img.getBoundingClientRect().height,
			emblem: img.hasAttribute("data-emblem-ratio"),
		})),
		// G10: the one measure, read off the funding row's content box — it is a
		// plain `.container`, so its content edges ARE the page's edges. Anything in
		// the footer painting outside them has invented a second measure. Skipped:
		// `.container` elements themselves (their border box is the measure plus its
		// own padding, by definition), the full-bleed bands, and the reference
		// banner, which carries its own wider measure on purpose.
		outside: (() => {
			const box = footer.querySelector(".footer-funding");
			if (!box) return null;
			const r = box.getBoundingClientRect();
			const cs = getComputedStyle(box);
			const left = r.left + parseFloat(cs.paddingLeft);
			const right = r.right - parseFloat(cs.paddingRight);
			const skip = ".container, .site-footer, .footer-main, .footer-legal";
			const worst = new Map();
			for (const el of footer.querySelectorAll("*")) {
				if (el.closest(".ref-banner") || el.matches(skip)) continue;
				const b = el.getBoundingClientRect();
				if (!b.width && !b.height) continue;
				// 1px of slack: sub-pixel layout, not a second edge
				const over = Math.max(left - b.left, b.right - right);
				if (over <= 1) continue;
				const cls = typeof el.className === "string" ? el.className.trim() : "";
				const sel = el.tagName.toLowerCase() + (cls ? "." + cls.split(/\s+/).join(".") : "");
				if (!worst.has(sel) || worst.get(sel) < over) worst.set(sel, over);
			}
			return [...worst]
				.map(([sel, over]) => ({ sel, over: +over.toFixed(1) }))
				.sort((a, b) => b.over - a.over);
		})(),
		links: [...footer.querySelectorAll(".footer-list a, .footer-list button")].map((el) => ({
			text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 28),
			size: getComputedStyle(el).fontSize,
		})),
		footerBg: getComputedStyle(footer).backgroundColor,
		bodyBg: getComputedStyle(document.body).backgroundColor,
	};
};

/* ── the positive control ──────────────────────────────────────────────── */

/**
 * Plant one violation of each assertion on a real page, plus one shape that
 * must NOT be reported, and require the scan to judge all four correctly.
 * Without this the gate can only prove that it found nothing — which is also
 * what a broken selector proves. #462's own gate was blind to the bug that
 * motivated it, and its control is the only reason anyone found out.
 */
/**
 * G13 + G14: what the open panel does with its own height, and whether the row
 * you are ON looks different from the row under the pointer.
 *
 * `skin` deliberately reads more than colour. 1.4.1 is the reason the site row
 * needed fixing at all — it went from #6B6B6B to #1E1E1E to say "you are here",
 * which is exactly what hovering any OTHER row did, so the two states were one
 * picture. Comparing the whole skin rather than one property is what keeps this
 * honest when the marker later changes shape.
 */
const MEASURE_MENU = () => {
	const bar = document.querySelector(".menu-bar");
	const kids = [...document.querySelectorAll(".menu-inner > *")]
		.map((e) => e.getBoundingClientRect())
		.filter((r) => r.height > 0);
	if (!bar || !kids.length) return null;
	const top = Math.min(...kids.map((k) => k.top));
	const bot = Math.max(...kids.map((k) => k.bottom));
	const above = Math.max(0, Math.round(top - bar.getBoundingClientRect().bottom));
	const below = Math.max(0, Math.round(innerHeight - bot));
	const skin = (el) => {
		const c = getComputedStyle(el);
		return {
			bg: c.backgroundColor,
			color: c.color,
			weight: c.fontWeight,
			deco: c.textDecorationLine,
			left: `${c.borderLeftWidth} ${c.borderLeftColor}`,
			radius: c.borderRadius,
			shadow: c.boxShadow,
		};
	};
	const groups = [];
	for (const sel of [".spec-link", ".site-link"]) {
		const all = [...document.querySelectorAll(`#menu-dialog ${sel}`)];
		const at = all.findIndex((a) => a.getAttribute("aria-current") === "page");
		if (at < 0) continue;
		const restAt = all.findIndex((a, i) => i !== at);
		groups.push({
			sel,
			text: all[at].textContent.trim().replace(/\s+/g, " ").slice(0, 40),
			cur: skin(all[at]),
			restAt,
		});
	}
	return {
		above,
		below,
		vh: innerHeight,
		waste: Math.round((100 * (above + below)) / innerHeight),
		groups,
		rows: document.querySelectorAll("#menu-dialog .spec-link").length,
		console: getComputedStyle(document.querySelector(".search-form--menu") || document.body).display,
	};
};

/** G19: what a framed photograph paints besides its frame. */
const MEASURE_FRAMES = (sel) =>
	[...document.querySelectorAll(sel)].map((el, i) => {
		const c = getComputedStyle(el);
		const side = (p) => ["Top", "Right", "Bottom", "Left"].map((s) => c[`border${s}${p}`]);
		return {
			i: i + 1,
			alt: (el.getAttribute("alt") || "").trim().slice(0, 32),
			widths: side("Width"),
			colors: side("Color"),
			shadow: c.boxShadow,
		};
	});

/** G20: every block of body copy, in characters of its own type. */
const MEASURE_COPY = ({ min, chars }) => {
	const ctx = document.createElement("canvas").getContext("2d");
	const out = [];
	for (const el of document.querySelectorAll("main *")) {
		const own = [...el.childNodes]
			.filter((n) => n.nodeType === 3)
			.map((n) => n.textContent.trim())
			.join(" ");
		if (own.length < chars) continue;
		const r = el.getBoundingClientRect();
		if (r.width < 60) continue;
		const s = getComputedStyle(el);
		if (parseFloat(s.fontSize) < min) continue;
		ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
		const advance = ctx.measureText("abcdefghijklmnopqrstuvwxyz").width / 26;
		if (!advance || !isFinite(advance)) continue;
		out.push({
			what: (el.className || el.tagName).toString().split(" ")[0].slice(0, 28),
			size: s.fontSize,
			width: Math.round(r.width),
			ch: Math.round(r.width / advance),
		});
	}
	return out;
};

/** Read one link's skin again, now that the pointer is on it. */
const MEASURE_HOVER = (sel, i) =>
	((el) => {
		if (!el) return null;
		const c = getComputedStyle(el);
		return {
			bg: c.backgroundColor,
			color: c.color,
			weight: c.fontWeight,
			deco: c.textDecorationLine,
			left: `${c.borderLeftWidth} ${c.borderLeftColor}`,
			radius: c.borderRadius,
			shadow: c.boxShadow,
		};
	})(document.querySelectorAll(`#menu-dialog ${sel}`)[i]);

const PLANT = ({ item, claim }) => {
	// declared in here, not module scope: `page.evaluate` ships the function
	// source to the browser and nothing that surrounds it
	const MARK = "a sentence long enough to count as prose, printed here twice on purpose";
	const items = [...document.querySelectorAll(item)];
	if (items.length < 3) return { missing: `${item} — only ${items.length} found, need 3 to plant` };
	const claimOf = (el) => el.querySelector(claim);
	if (!claimOf(items[0])) return { missing: claim };
	// A — row 1 grows: G1 must see the raggedness.
	claimOf(items[0]).textContent =
		"a claim long enough to wrap onto a second line and un-equalise this row, ".repeat(4);
	// B — row 2 draws a box at rest: G2 must see the chrome, and must name row 2.
	items[1].style.borderRadius = "24px";
	items[1].style.boxShadow = "0 2px 10px rgba(0,0,0,.06)";
	// C — a long run of copy printed twice: G3 must see the duplicate. The text
	//     is fixed rather than borrowed from a row, so the plant does not depend
	//     on any real claim happening to be longer than PROSE_MIN.
	for (const _ of [0, 1]) {
		const p = document.createElement("p");
		p.textContent = MARK;
		document.body.appendChild(p);
	}
	// D — row 3 gets an inline style that is not chrome. Nothing new may be
	//     reported about it.
	items[2].style.color = "#1E1E1E";
	return { missing: null };
};

/**
 * G20's plant. It widens one block far past anything the page contains, so the
 * finding it produces cannot already be in the baseline — the same lesson G19's
 * plant learned on its first revert. A second block gets a change that moves no
 * width, and nothing new may be said about it.
 */
const PLANT_COPY = ({ min, chars }) => {
	const wide = [...document.querySelectorAll("main *")].filter((el) => {
		const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ");
		const s = getComputedStyle(el);
		return own.length >= chars && el.getBoundingClientRect().width >= 60 && parseFloat(s.fontSize) >= min;
	});
	if (wide.length < 2) return { missing: `only ${wide.length} block(s) of body copy, need 2 to plant` };
	wide[0].style.width = "3000px";
	wide[0].style.maxWidth = "none";
	wide[1].style.fontStyle = "italic";
	return { missing: null };
};

/**
 * G19's plant. It makes a photograph into the PANEL the doc used to claim it
 * was — the shadow and the 4px accent edge — because that is the exact drift
 * this assertion exists to refuse, and the one a reader of the old doc would
 * introduce in good faith.
 */
const PLANT_FRAMES = (sel) => {
	const imgs = [...document.querySelectorAll(sel)];
	if (imgs.length < 2) return { missing: `${sel} — only ${imgs.length} found, need 2 to plant` };
	// A — photograph 1 becomes a PANEL. Both traits, both must be reported.
	//     The VALUES are deliberately ones nothing in the tree uses. This control
	//     judges by difference, so planting `--shadow-card` and a 4px edge would
	//     add no new finding on the very day someone gives the photographs those
	//     two traits for real — the control would fail as "blind" (exit 3) when
	//     the truth is "the page is wrong" (exit 1). That is the trap this file
	//     documents at the row control above, and it caught this plant on its
	//     first revert too.
	imgs[0].style.boxShadow = "0 0 0 7px rgb(255, 0, 255)";
	// the whole edge, not just its width: a width alone paints nothing where the
	// photograph has no border style of its own — Quiénes somos' do not (#565), and
	// the plant went unreported there. A plant must not need what it checks.
	imgs[0].style.borderTop = "9px solid rgb(255, 0, 255)";
	// B — photograph 2 gets a change that is not chrome. Nothing new may be
	//     said about it.
	imgs[1].style.objectFit = "contain";
	return { missing: null };
};

/**
 * The footer's plant. Same contract: one violation per assertion, one shape
 * that must stay unreported, and every finding judged by difference.
 */
const PLANT_FOOTER = () => {
	const footer = document.querySelector(".site-footer");
	if (!footer) return { missing: ".site-footer" };
	const need = (sel) => {
		const el = footer.querySelector(sel);
		return el || null;
	};

	// A — the strip is made to wrap, and the lines it wraps into are made to stop
	//     being centred. G4 (more than one line) and G5 (off-centre) both.
	//
	//     Three overrides, because the plant must not assume how the strip is
	//     laid out today: `--ref-cols` is what wraps a grid, a narrow measure is
	//     what wraps a flex row, and `justify-content` is what pushes the lines
	//     off centre in either. The first draft planted only the grid variable,
	//     and reverting the strip to its old flex row made this control exit 3
	//     ("the scan is blind") while the real orphan sat there unreported —
	//     which is the failure mode a control exists to prevent, not to cause.
	const row = need(".ref-banner__row");
	if (!row) return { missing: ".ref-banner__row" };
	const marks = row.querySelectorAll("img").length;
	if (marks < 3) return { missing: `.ref-banner__row img — only ${marks}, need 3 to plant` };
	row.style.setProperty("--ref-cols", String(marks - 1));
	row.style.maxWidth = "220px";
	row.style.justifyContent = "flex-start";

	// B — the signature block goes centred. text-align inherits, so its children
	//     go with it; the legal row is a sibling and must NOT.
	const sig = need(".footer-signature");
	if (!sig) return { missing: ".footer-signature" };
	sig.style.textAlign = "center";

	// C — an emblem shrunk to what the old single JPEG actually rendered at 390.
	const emblem = need(".footer-funding__mark[data-emblem-ratio]");
	if (!emblem) return { missing: ".footer-funding__mark[data-emblem-ratio]" };
	emblem.style.height = "18.2px";

	// D — one link out of step with the rest.
	const link = need(".footer-list a, .footer-list button");
	if (!link) return { missing: ".footer-list a" };
	link.style.fontSize = "13px";

	// E — the footer takes a ground of its own.
	footer.style.backgroundColor = "rgb(244, 244, 244)";

	// G — a block wider than the measure. It has to be a LEFT-anchored one: the
	//     column row is pinned to the right edge by `space-between`, so widening
	//     anything inside it grows the row leftwards and the right edge never
	//     moves. The first draft of this plant widened the CTA and changed the
	//     overflow by exactly 0px — the revert proof is what caught that.
	const line = need(".footer-signature__line");
	if (!line) return { missing: ".footer-signature__line" };
	line.style.width = "900px";

	// H — the other funding mark rises to the emblem's height, so the emblem stops
	//     outweighing it. C already trips G11 from the emblem's side; this trips it
	//     from the other mark's side, the half of the comparison C cannot reach.
	const other = footer.querySelector(".footer-funding__mark:not([data-emblem-ratio])");
	if (!other) return { missing: ".footer-funding__mark:not([data-emblem-ratio])" };
	other.style.height = "62px";

	// F — the legal row gets a change that is not geometry. Nothing new may be
	//     reported about it, and in particular it must not go centred with B.
	const legal = need(".footer-legal__inner");
	if (!legal) return { missing: ".footer-legal__inner" };
	legal.style.fontStyle = "italic";

	return { missing: null };
};

/* ── the scan ──────────────────────────────────────────────────────────── */

const judgeRows = (m, where) => {
	const found = [];
	const spread = Math.max(...m.heights) - Math.min(...m.heights);
	if (spread > TOLERANCE)
		found.push({ g: "G1", where, msg: `rows differ by ${spread}px (heights ${m.heights.join(", ")})` });
	m.chrome.forEach((c, i) => {
		const r = c.radius.find((v) => parseFloat(v) > 0);
		if (r) found.push({ g: "G2", where, msg: `row ${i + 1} has a ${r} corner radius at rest` });
		if (c.shadow && c.shadow !== "none")
			found.push({ g: "G2", where, msg: `row ${i + 1} has a shadow at rest — \`${c.shadow}\`` });
		const opaque = !(c.accent === "transparent" || /,\s*0\s*\)$/.test(c.accent));
		if (opaque) found.push({ g: "G2", where, msg: `row ${i + 1}'s left accent is painted at rest — ${c.accent}` });
	});
	return found;
};

const judgeProse = (runs, where) => {
	const count = new Map();
	for (const t of runs) count.set(t, (count.get(t) || 0) + 1);
	return [...count.entries()]
		.filter(([, n]) => n > 1)
		.map(([t, n]) => ({ g: "G3", where, msg: `printed ${n}× — "${t.slice(0, 72)}…"` }));
};

/** G20. */
const judgeCopy = (blocks, where) =>
	blocks
		.filter((b) => b.ch > MEASURE_MAX)
		.map((b) => ({
			g: "G20",
			where,
			msg: `\`${b.what}\` runs ${b.ch} characters a line — ${b.size} across ${b.width}px`,
		}));

/** G19. A frame is four equal edges of one colour, and nothing else. */
const judgeFrames = (frames, where) => {
	const out = [];
	for (const f of frames) {
		const what = f.alt ? `“${f.alt}”` : `image ${f.i}`;
		if (f.shadow && f.shadow !== "none")
			out.push({ g: "G19", where, msg: `${what} carries a shadow — \`${f.shadow}\`` });
		if (new Set(f.widths).size > 1)
			out.push({
				g: "G19",
				where,
				msg: `${what} draws an accent edge — borders are ${f.widths.join(" / ")} (top/right/bottom/left)`,
			});
		if (new Set(f.colors).size > 1)
			out.push({
				g: "G19",
				where,
				msg: `${what} paints its frame in more than one colour — ${[...new Set(f.colors)].join(" / ")}`,
			});
	}
	return out;
};

const judgeFooter = (m, where, width) => {
	const found = [];

	// G4 — one line where there is room for one
	if (width >= STRIP_ONE_LINE_FROM && m.stripLines.length > 1)
		found.push({
			g: "G4",
			where,
			msg: `the reference strip wraps into ${m.stripLines.length} lines (${m.stripLines
				.map((l) => l.n)
				.join(" + ")}) with ${width}px to work in`,
		});

	// G5 — and every line it does draw is centred in it
	for (const l of m.stripLines)
		if (Math.abs(l.offset) > TOLERANCE)
			found.push({
				g: "G5",
				where,
				msg: `a strip line of ${l.n} mark(s) sits ${l.offset.toFixed(1)}px off the strip's centre`,
			});

	// G6 — one alignment, and it is not centre
	for (const a of m.aligns)
		if (a.align === "center" || a.align === "right" || a.align === "end")
			found.push({ g: "G6", where, msg: `\`${a.sel}\` is text-align: ${a.align}` });

	// G7 — the emblem keeps its mandated size
	for (const f of m.funding) {
		const emblem = f.h * (f.ratio || 1);
		if (emblem < EMBLEM_MIN_PX)
			found.push({
				g: "G7",
				where,
				msg: `the emblem renders ${emblem.toFixed(1)}px tall (a ${f.h.toFixed(1)}px lockup × ${
					f.ratio || 1
				}), under the ${EMBLEM_MIN_PX}px minimum — "${f.alt}"`,
			});
	}

	// G8 — one link size
	const sizes = [...new Set(m.links.map((l) => l.size))];
	if (sizes.length > 1)
		found.push({
			g: "G8",
			where,
			msg: `footer links render at ${sizes.length} sizes (${sizes.join(", ")}) — ${m.links
				.map((l) => `${l.text}=${l.size}`)
				.join(" · ")}`,
		});

	// G10 — one measure. `MEASURE_FOOTER` has already done the comparison in the
	//       page and hands back only what crossed the line. 12, not 6: the list is
	//       deduplicated by selector already, and a cap tight enough to truncate it
	//       can swallow the very finding a positive control looks for. It did.
	for (const x of (m.outside || []).slice(0, 12))
		found.push({ g: "G10", where, msg: `\`${x.sel}\` paints ${x.over}px outside the measure` });

	// G11 — the emblem outweighs every other mark on the funding line.
	for (const e of m.fundingAll.filter((f) => f.emblem))
		for (const other of m.fundingAll.filter((f) => !f.emblem)) {
			const ratio = other.h ? e.h / other.h : Infinity;
			if (ratio < EMBLEM_PROMINENCE)
				found.push({
					g: "G11",
					where,
					msg: `the EU emblem renders ${e.h.toFixed(1)}px against ${other.h.toFixed(1)}px for "${other.alt}" — ${ratio.toFixed(2)}×, under the ${EMBLEM_PROMINENCE}× the justification guide asks for`,
				});
		}

	// G9 — no ground of its own. Transparent is the strongest form of that: the
	// document's ground simply continues. Equal-to-the-body also passes, because
	// a footer that repaints the body colour draws no band either — it is only
	// fragile, and G9 is what catches it the day one of the two tokens moves.
	const noGround = m.footerBg === m.bodyBg || /,\s*0\s*\)$/.test(m.footerBg) || m.footerBg === "transparent";
	if (!noGround)
		found.push({ g: "G9", where, msg: `the footer is ${m.footerBg} over a body that is ${m.bodyBg}` });

	return found;
};

/* ── G12: read the stylesheets, not the rest state ──────────────────────── */
const MEASURE_FUNDING_CSS = ({ props, identity, needle }) => {
	const idOK = new Set(identity);
	const offenders = [];
	const sheets = [];

	for (const sheet of document.styleSheets) {
		let list;
		try { list = sheet.cssRules; } catch { continue; }   // cross-origin, not ours
		if (!list) continue;

		// `top` is what the sheet declares at depth 0; `topStyle` how many of
		// those are ordinary style rules. `leaves` is how many style rules the
		// walk actually READ, at any depth. The last two are what prove the
		// walk: `visited` cannot, because the wrong shape still *enters* every
		// top-level rule — it recurses into each one's empty `cssRules` and
		// reads nothing. Measured: under the wrong walk this sheet reports
		// visited 222 of 222 and leaves 0. That is why the issue asked for the
		// leaf count and not the rule count.
		const acc = { href: sheet.href || "inline", top: list.length, topStyle: 0, visited: 0, leaves: 0, matched: 0 };

		// Declarations BEFORE recursion, and recursion only into a list with
		// something in it. Reversing these two lines is the #470 bug: every
		// CSSStyleRule owns a (usually empty, always truthy) `cssRules`, so
		// `if (r.cssRules) { walk(...); continue; }` walks past the entire sheet.
		const walk = (rules, depth) => {
			for (const r of rules) {
				acc.visited++;
				if (depth === 0 && r.style && r.selectorText) acc.topStyle++;
				if (r.style && r.selectorText) {
					acc.leaves++;
					if (r.selectorText.includes(needle)) {
						acc.matched++;
						for (const prop of props) {
							const value = r.style.getPropertyValue(prop).trim().toLowerCase();
							if (!idOK.has(value))
								offenders.push({ sheet: acc.href, selector: r.selectorText, prop, value });
						}
					}
				}
				if (r.cssRules && r.cssRules.length) walk(r.cssRules, depth + 1);
			}
		};
		walk(list, 0);
		sheets.push(acc);
	}
	return { offenders, sheets };
};

const judgeFunding = (m, where) => {
	const found = [];
	for (const o of m.offenders)
		found.push({
			g: "G12",
			where,
			msg: `\`${o.selector}\` declares \`${o.prop}: ${o.value}\` — a funding mark may be scaled and not modified (${o.sheet.split("/").pop()})`,
		});
	return found;
};
/** G13 + G14, from one measurement plus the hovered readings taken beside it. */
const judgeMenu = (m, hovered, where) => {
	const found = [];
	if (m.waste > MENU_WASTE_MAX) {
		found.push({
			g: "G13",
			where,
			msg: `${m.waste}% of the viewport is empty paper — ${m.above}px above the panel's first element and ${m.below}px below its last, in ${m.vh}px`,
		});
	}
	for (const grp of m.groups) {
		const h = hovered[grp.sel];
		if (!h) continue;
		const differs = Object.keys(grp.cur).filter((k) => grp.cur[k] !== h[k]);
		if (!differs.length) {
			found.push({
				g: "G14",
				where,
				msg: `\`${grp.sel}\` marks the current page ("${grp.text}") exactly as it marks the one under the pointer — same ${Object.keys(grp.cur).join(", ")}`,
			});
		}
	}
	return found;
};

/** G15 + G16 + G17 + G18: the opening, the token it is spelled from, and what
 *  is painted behind the page. */
const MEASURE_OPENING = (sel) => {
	const px = (v) => parseFloat(v) || 0;
	const root = getComputedStyle(document.documentElement);
	const header = document.querySelector("header");
	const opening = document.querySelector(sel);
	const card = document.querySelector(".s-hero__card");
	// the kicker's first block is «for whom», read by position like the template does
	const who = document.querySelector(".s-hero__kicker p");

	// Every layer painted behind the document. `position: fixed` with a
	// negative z-index is the shape: the header is fixed and positive, a
	// modal's scrim is fixed and positive, and nothing legitimate on this
	// site sits below the content and outside the scroll at once.
	const behind = [];
	for (const el of document.querySelectorAll("body *")) {
		const cs = getComputedStyle(el);
		if (cs.position !== "fixed" || cs.display === "none") continue;
		const z = parseInt(cs.zIndex, 10);
		if (!Number.isFinite(z) || z >= 0) continue;
		const r = el.getBoundingClientRect();
		const cls = typeof el.className === "string" ? el.className.trim() : "";
		behind.push({
			sel: el.tagName.toLowerCase() + (cls ? "." + cls.split(/\s+/).join(".") : ""),
			w: Math.round(r.width),
			h: Math.round(r.height),
			opacity: cs.opacity,
		});
	}

	// the token resolved by the browser, not parsed: it is a var() of a var()
	const probe = document.createElement("div");
	probe.style.paddingTop = "var(--rhythm-section)";
	document.body.append(probe);
	const rhythm = px(getComputedStyle(probe).paddingTop);
	probe.remove();
	const doc = document.documentElement;

	return {
		headerFound: !!header,
		headerH: header ? header.getBoundingClientRect().height : null,
		rhythm,
		padBottom: opening ? px(getComputedStyle(opening).paddingBottom) : null,
		overflowX: doc.scrollWidth - doc.clientWidth,
		tokenHeaderH: px(root.getPropertyValue("--header-h")),
		tokenClear: px(root.getPropertyValue("--open-clear")),
		openingFound: !!opening,
		padTop: opening ? px(getComputedStyle(opening).paddingTop) : null,
		cardFound: !!card,
		cardTop: card ? card.getBoundingClientRect().top : null,
		whoFound: !!who,
		whoBottom: who ? who.getBoundingClientRect().bottom : null,
		vh: window.innerHeight,
		behind,
	};
};

/** G15: the token drifts from the box it claims to describe. */
const PLANT_HEADER_TOKEN = () => {
	if (!document.querySelector("header")) return { missing: "header" };
	document.documentElement.style.setProperty("--header-h", "40px");
	return {};
};

/** G16: one opening reserves an inset of its own invention. */
const PLANT_OPENING_INSET = (sel) => {
	if (!document.querySelector(sel)) return { missing: sel };
	const st = document.createElement("style");
	st.textContent = `${sel} { padding-top: 213px !important; }`;
	document.head.append(st);
	return {};
};

/** G21: an opening closes on a bottom of its own. */
const PLANT_OPENING_BOTTOM = (sel) => {
	if (!document.querySelector(sel)) return { missing: sel };
	const st = document.createElement("style");
	st.textContent = `${sel} { padding-bottom: 80px !important; }`;
	document.head.append(st);
	return {};
};

/** G22: something too wide for the page. */
const PLANT_SIDEWAYS = () => {
	const main = document.querySelector("main");
	if (!main) return { missing: "main" };
	main.insertAdjacentHTML("beforeend", '<div class="ci-plant-wide" style="width:3000px;height:1px"></div>');
	return {};
};

/** G17: the watermark comes back. */
const PLANT_FIXED_LAYER = () => {
	document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="ci-plant-watermark" aria-hidden="true" style="position:fixed;inset:0;z-index:-1;opacity:0.07"></div>'
	);
	return {};
};

/** G18: the card falls below the fold. */
const PLANT_CARD_BELOW_FOLD = () => {
	if (!document.querySelector(".s-hero__card")) return { missing: ".s-hero__card" };
	const st = document.createElement("style");
	// the card itself, by `translate`: on a tablet it stands on the photograph's foot above the heading
	// (#560), on a phone after the kicker (#572) — pushing the copy would move it on one and not the
	// other, and on a phone it would trip G23 too
	st.textContent = ".s-hero__card { translate: 0 900px !important; }";
	document.head.append(st);
	return {};
};

/** G23: «for whom» pushed under the fold. `translate` and not a margin: a
 *  margin would carry the card down with it and trip G18 too, and one plant
 *  must fire one gate. */
const PLANT_WHO_BELOW_FOLD = () => {
	if (!document.querySelector(".s-hero__kicker p")) return { missing: ".s-hero__kicker p" };
	const st = document.createElement("style");
	st.textContent = ".s-hero__kicker { translate: 0 900px !important; }";
	document.head.append(st);
	return {};
};

/* ── judgement ─────────────────────────────────────────────────────────── */

/** G15 + G16 + G17. */
const judgeOpening = (m, where, spec) => {
	const found = [];
	const r = (n) => Math.round(n * 10) / 10;

	if (Math.abs(m.tokenHeaderH - m.headerH) > 1)
		found.push({
			g: "G15",
			where,
			msg: `--header-h says ${m.tokenHeaderH}px, the header draws ${r(m.headerH)}px`,
		});

	if (!spec.photographic) {
		const want = m.tokenHeaderH + m.tokenClear;
		if (Math.abs(m.padTop - want) > 1)
			found.push({
				g: "G16",
				where,
				msg: `\`${spec.opening}\` reserves ${r(m.padTop)}px where the opening inset is ${want}px`,
			});
	}

	if (!spec.photographic && Math.abs(m.padBottom - m.rhythm) > 1)
		found.push({
			g: "G21",
			where,
			msg: `\`${spec.opening}\` closes on ${r(m.padBottom)}px where the section rhythm is ${m.rhythm}px`,
		});

	if (m.overflowX > 1)
		found.push({
			g: "G22",
			where,
			msg: `the document scrolls sideways by ${m.overflowX}px`,
		});

	for (const b of m.behind)
		found.push({
			g: "G17",
			where,
			msg: `\`${b.sel}\` is painted fixed behind the document at ${b.w}\u00d7${b.h}, opacity ${b.opacity}`,
		});

	return found;
};

/** G23. Only where the home's kicker is: other openings have none. */
const judgeWho = (m, where) => {
	if (m.whoBottom == null) return [];
	return m.whoBottom <= m.vh
		? []
		: [{ g: "G23", where, msg: `«for whom» ends at ${Math.round(m.whoBottom)}px in a ${m.vh}px viewport` }];
};

/** G18. */
const judgeCard = (m, where) => {
	if (m.cardTop == null) return [];
	return m.cardTop < m.vh
		? []
		: [{ g: "G18", where, msg: `\`.s-hero__card\` opens at ${Math.round(m.cardTop)}px in a ${m.vh}px viewport` }];
};

const browser = await puppeteer.launch({
	headless: "new",
	args: ["--no-sandbox", ...HOST_NEUTRAL],
	protocolTimeout: 300_000,
});

const open = async (route, width, height = 900) => {
	const page = await browser.newPage();
	await page.setViewport({ width, height, isMobile: width < 768, hasTouch: width < 768 });
	await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60_000 });
	await page.evaluate(() => document.fonts.ready);
	return page;
};

/**
 * Bring the footer into play before measuring it.
 *
 * Every mark down there is `loading="lazy"` and below the fold, and an unloaded
 * `<img>` with `width:auto;height:auto` lays out at 0×0 — so a scan that does
 * not scroll measures seven marks stacked at one coordinate and calls it a
 * single, perfectly centred line. That is not a hypothetical: the first
 * measurement taken for #454 reported exactly that, and the strip's real
 * behaviour (6 + 1 at 1440) only appeared once the images were made to load.
 */
const settleFooter = async (page) => {
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await page.evaluate(
		() =>
			new Promise((resolve) => {
				const imgs = [...document.querySelectorAll(".site-footer img")];
				let left = imgs.filter((i) => !i.complete).length;
				if (!left) return resolve();
				const done = () => --left <= 0 && resolve();
				for (const i of imgs) if (!i.complete) i.addEventListener("load", done), i.addEventListener("error", done);
				setTimeout(resolve, 5000);
			})
	);
	// one frame for the wrap to settle after the last decode
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};

/**
 * Open the panel and let it finish arriving.
 *
 * The transform runs for 0.5s and a measurement taken mid-slide reads the start
 * frame, which is the panel parked off the right edge — every box in it would
 * report the same geometry and G13 would call a broken panel perfect. The wait
 * is on `open === true` plus the transition, not on a fixed sleep alone.
 */
const openMenu = async (route, { width, height }) => {
	const page = await browser.newPage();
	await page.setViewport({ width, height, deviceScaleFactor: 1 });
	await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60_000 });
	await page.evaluate(() => document.fonts.ready);
	await page.click("#menu-trigger");
	await page.waitForFunction(() => document.getElementById("menu-dialog")?.open === true, {
		timeout: 5_000,
	});
	await page.evaluate(
		() =>
			new Promise((resolve) => {
				const d = document.getElementById("menu-dialog");
				const done = () => resolve();
				d.addEventListener("transitionend", done, { once: true });
				setTimeout(done, 1200);
			})
	);
	return page;
};

/** The hovered readings G14 compares the current row against. */
const hoverSkins = async (page, m) => {
	const out = {};
	for (const grp of m.groups) {
		if (grp.restAt < 0) continue;
		const handles = await page.$$(`#menu-dialog ${grp.sel}`);
		if (!handles[grp.restAt]) continue;
		await handles[grp.restAt].hover();
		await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
		out[grp.sel] = await page.evaluate(MEASURE_HOVER, grp.sel, grp.restAt);
	}
	return out;
};

// ── positive control first: a gate that has not proved it can see is not a gate.
//
// It judges by DIFFERENCE — baseline, then plant, then baseline again — rather
// than by absolute findings. An absolute control silently assumes the page is
// already compliant, so the moment someone reverts the very defect this gate
// exists to catch, the control fails first and the run exits 3 ("the scan is
// broken") instead of 1 ("the page is wrong"). That happened on the first draft
// of this file, on the first revert it was tested against.
if (ROW_LISTS.length) {
	const spec = ROW_LISTS[0];
	const page = await open(spec.route, 390);
	const key = (f) => `${f.g}|${f.msg}`;
	const scan = async () => [
		...judgeRows(await page.evaluate(MEASURE_ROWS, spec), "control"),
		...judgeProse(await page.evaluate(MEASURE_PROSE, PROSE_MIN), "control"),
	];

	const first = await page.evaluate(MEASURE_ROWS, spec);
	if (!first || !first.items) {
		console.error(`✗ blind: \`${spec.list} ${spec.item}\` matches nothing on ${spec.route}.`);
		console.error("  A renamed class makes this gate report clean forever. Update the selectors here in");
		console.error("  the same commit that renames them.");
		await browser.close();
		process.exit(3);
	}

	const before = new Set((await scan()).map(key));
	const planted = await page.evaluate(PLANT, spec);
	if (planted.missing) {
		console.error(`✗ blind: cannot plant on ${spec.route} — \`${planted.missing}\` is not there.`);
		console.error("  The gate is only as honest as its control. Update the selectors here in the same");
		console.error("  commit that renames them.");
		await browser.close();
		process.exit(3);
	}
	const after = await scan();
	const fresh = after.filter((f) => !before.has(key(f)));

	const problems = [];
	for (const g of ["G1", "G2", "G3"])
		if (!fresh.some((f) => f.g === g)) problems.push(`${g} did not fire on a planted violation`);
	// the plant touched row 2's chrome and nothing else's
	for (const f of fresh.filter((f) => f.g === "G2" && !/row 2\b/.test(f.msg)))
		problems.push(`false positive — the plant touched row 2 only, but: ${f.msg}`);
	// no assertion the page was already failing may go quiet under a plant.
	// Compared by GROUP, not by message: a plant legitimately changes the text
	// of a finding — it grows row 1, so G1's height list is a different string
	// afterwards — and that is a mutation, not a masking.
	const groupsOf = (fs) => new Set([...fs].map((f) => (typeof f === "string" ? f.split("|")[0] : f.g)));
	for (const g of groupsOf(before)) if (!groupsOf(after).has(g)) problems.push(`a plant silenced ${g}`);

	if (problems.length) {
		console.error("✗ the positive control failed: the scan is not measuring what it claims.");
		for (const p of problems) console.error(`    ${p}`);
		await browser.close();
		process.exit(3);
	}
	ok("4 planted defects judged correctly — a ragged row, a boxed row, a duplicated paragraph, and a third row it left alone");
	await page.close();
}

// ── G3's own control, for when no ROW list carries it (#580): the same plant's
// duplicated paragraph, judged by difference on the first prose route.
{
	const page = await open(PROSE_ROUTES[0], 390);
	const key = (f) => `${f.g}|${f.msg}`;
	const scan = async () => judgeProse(await page.evaluate(MEASURE_PROSE, PROSE_MIN), "control");
	const before = new Set((await scan()).map(key));
	await page.evaluate(() => {
		const MARK = "a sentence long enough to count as prose, printed here twice on purpose";
		for (const _ of [0, 1]) {
			const p = document.createElement("p");
			p.textContent = MARK;
			document.body.appendChild(p);
		}
	});
	const fresh = (await scan()).filter((f) => !before.has(key(f)));
	if (!fresh.some((f) => f.g === "G3")) {
		console.error("✗ the positive control failed: G3 did not fire on a planted duplicate paragraph.");
		await browser.close();
		process.exit(3);
	}
	ok("a planted duplicate paragraph judged correctly (G3)");
	await page.close();
}

// ── G20's own control: one gate id, one assertion shape, one plant.
{
	const spec = { min: BODY_MIN_PX, chars: MEASURE_CHARS };
	const page = await open(MEASURE_ROUTES[0], 1440);
	const key = (f) => `${f.g}|${f.msg}`;
	const scan = async () => judgeCopy(await page.evaluate(MEASURE_COPY, spec), "control");

	const first = await page.evaluate(MEASURE_COPY, spec);
	if (first.length < 2) {
		console.error(`✗ blind: ${MEASURE_ROUTES[0]} presents ${first.length} block(s) of body copy to measure, need 2.`);
		console.error("  A page that stops carrying prose makes this gate report clean forever.");
		await browser.close();
		process.exit(3);
	}

	const before = new Set((await scan()).map(key));
	const planted = await page.evaluate(PLANT_COPY, spec);
	if (planted.missing) {
		console.error(`✗ blind: cannot plant on ${MEASURE_ROUTES[0]} — ${planted.missing}.`);
		await browser.close();
		process.exit(3);
	}
	const fresh = (await scan()).filter((f) => !before.has(key(f)));

	const problems = [];
	if (!fresh.length) problems.push("a block widened to 3000px went unreported");
	if (fresh.length > 1) problems.push(`the plant widened one block, but ${fresh.length} were reported`);
	const groupsOf = (fs) => new Set([...fs].map((f) => (typeof f === "string" ? f.split("|")[0] : f.g)));
	for (const g of groupsOf(before)) if (!groupsOf(await scan()).has(g)) problems.push(`a plant silenced ${g}`);

	if (problems.length) {
		console.error("✗ the measure control failed: the scan is not measuring what it claims.");
		for (const p of problems) console.error(`    ${p}`);
		await browser.close();
		process.exit(3);
	}
	ok(`1 planted defect judged correctly — a block of body copy widened past the measure, and an italicised one it left alone`);
	await page.close();
}

// ── G19's own control. A separate block because it is a separate assertion
// shape: one gate id, one shape, one plant.
{
	const page = await open(FRAME_ROUTES[0], 1440);
	const key = (f) => `${f.g}|${f.msg}`;
	const scan = async () => judgeFrames(await page.evaluate(MEASURE_FRAMES, FRAME_SELECTOR), "control");

	const first = await page.evaluate(MEASURE_FRAMES, FRAME_SELECTOR);
	if (first.length < 2) {
		console.error(`✗ blind: \`${FRAME_SELECTOR}\` matches ${first.length} image(s) on ${FRAME_ROUTES[0]}, need 2.`);
		console.error("  A renamed class makes this gate report clean forever. Update the selector here in");
		console.error("  the same commit that renames it.");
		await browser.close();
		process.exit(3);
	}
	const who = first[0].alt ? `“${first[0].alt}”` : "image 1";

	const before = new Set((await scan()).map(key));
	const planted = await page.evaluate(PLANT_FRAMES, FRAME_SELECTOR);
	if (planted.missing) {
		console.error(`✗ blind: cannot plant on ${FRAME_ROUTES[0]} — \`${planted.missing}\`.`);
		await browser.close();
		process.exit(3);
	}
	const fresh = (await scan()).filter((f) => !before.has(key(f)));

	const problems = [];
	if (!fresh.some((f) => /carries a shadow/.test(f.msg)))
		problems.push("a planted shadow went unreported");
	if (!fresh.some((f) => /draws an accent edge/.test(f.msg)))
		problems.push("a planted 4px accent edge went unreported");
	for (const f of fresh.filter((f) => !f.msg.startsWith(who)))
		problems.push(`false positive — the plant touched ${who} only, but: ${f.msg}`);
	const groupsOf = (fs) => new Set([...fs].map((f) => (typeof f === "string" ? f.split("|")[0] : f.g)));
	for (const g of groupsOf(before)) if (!groupsOf(await scan()).has(g)) problems.push(`a plant silenced ${g}`);

	if (problems.length) {
		console.error("✗ the frame control failed: the scan is not measuring what it claims.");
		for (const p of problems) console.error(`    ${p}`);
		await browser.close();
		process.exit(3);
	}
	ok(`2 planted defects judged correctly — a photograph given PANEL's shadow and PANEL's accent edge, and a second one it left alone`);
	await page.close();
}

// ── and the same for the footer half, at 1440, where G4 has something to say.
{
	const page = await open(FOOTER_ROUTES[0], 1440);
	await settleFooter(page);
	const key = (f) => `${f.g}|${f.msg}`;
	const scan = async () => judgeFooter(await page.evaluate(MEASURE_FOOTER), "control", 1440);

	const first = await page.evaluate(MEASURE_FOOTER);
	if (!first || !first.marks || !first.funding.length || !first.links.length || first.alignedSelectors < 5) {
		console.error(`✗ blind: the footer on ${FOOTER_ROUTES[0]} does not present what this gate measures.`);
		console.error(
			`  marks=${first?.marks ?? "—"} emblems=${first?.funding.length ?? "—"} links=${
				first?.links.length ?? "—"
			} aligned selectors matched=${first?.alignedSelectors ?? "—"}/9`
		);
		console.error("  A renamed class makes this gate report clean forever. Update the selectors here in");
		console.error("  the same commit that renames them.");
		await browser.close();
		process.exit(3);
	}

	const before = new Set((await scan()).map(key));
	const planted = await page.evaluate(PLANT_FOOTER);
	if (planted.missing) {
		console.error(`✗ blind: cannot plant on the footer — \`${planted.missing}\` is not there.`);
		await browser.close();
		process.exit(3);
	}
	const after = await scan();
	const fresh = after.filter((f) => !before.has(key(f)));

	const problems = [];
	for (const g of ["G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11"])
		if (!fresh.some((f) => f.g === g)) problems.push(`${g} did not fire on a planted violation`);
	// the plant centred the signature block; the legal row is its sibling and
	// must have stayed where it was
	for (const f of fresh.filter((f) => f.g === "G6" && /footer-legal/.test(f.msg)))
		problems.push(`false positive — the plant centred the signature only, but: ${f.msg}`);
	const groupsOf = (fs) => new Set([...fs].map((f) => (typeof f === "string" ? f.split("|")[0] : f.g)));
	for (const g of groupsOf(before)) if (!groupsOf(after).has(g)) problems.push(`a plant silenced ${g}`);

	if (problems.length) {
		console.error("✗ the positive control failed: the footer scan is not measuring what it claims.");
		for (const p of problems) console.error(`    ${p}`);
		await browser.close();
		process.exit(3);
	}
	ok("8 more planted defects judged correctly — an orphaned mark, an off-centre line, a centred block, a shrunken emblem, an odd link size, a ground of its own, a block wider than the measure, a mark raised to the emblem's height — and a legal row it left alone");
	await page.close();
}

// ── G12's own control. One assertion shape, one plant — the #470 lesson: that
//    gate carried two unrelated assertions under one id, the first fired, the
//    second was blind, and the control was satisfied by the first.
//
//    The plant is a top-level `:hover` rule, which is also what proves the walk
//    reads declarations before recursing: under the wrong shape that rule owns
//    an empty-but-truthy `cssRules`, gets walked past, and this control exits 3.
{
	const page = await open(FOOTER_ROUTES[0], 1440);
	await settleFooter(page);
	const args = { props: INTEGRITY_PROPS, identity: [...INTEGRITY_IDENTITY], needle: FUNDING_SELECTOR };
	const scan = async () => judgeFunding(await page.evaluate(MEASURE_FUNDING_CSS, args), "control");

	const first = await page.evaluate(MEASURE_FUNDING_CSS, args);
	const problems = [];

	// Blindness check 1 — the class still exists. A rename makes this gate
	// report clean forever, so it must be updated in the commit that renames.
	const matched = first.sheets.reduce((n, s) => n + s.matched, 0);
	if (!matched)
		problems.push(`no rule anywhere selects \`${FUNDING_SELECTOR}\` — renamed? update this gate in the same commit`);

	// Blindness check 2 — the walk reached everything. This is the assertion
	// #470 needed and did not have: a walk that visits fewer rules than the
	// sheet has at top level has skipped whole branches, and every clean report
	// it produces is worthless. Run once, over the real sheets.
	for (const s of first.sheets)
		if (s.leaves < s.topStyle)
			problems.push(`the walk read ${s.leaves} style rules in ${s.href.split("/").pop()} but the sheet declares ${s.topStyle} at top level alone — it is walking past declarations`);

	const before = new Set((await scan()).map((f) => f.msg));
	await page.addStyleTag({ content: `.${FUNDING_SELECTOR}__mark:hover { opacity: 0.5; }` });
	const fresh = (await scan()).filter((f) => !before.has(f.msg));

	if (!fresh.some((f) => /may be scaled and not modified/.test(f.msg)))
		problems.push("a planted `:hover { opacity: .5 }` on a funding mark went unreported");

	if (problems.length) {
		console.error("✗ the positive control failed: the funding-mark scan is not measuring what it claims.");
		for (const p of problems) console.error(`    ${p}`);
		await browser.close();
		process.exit(3);
	}
	const leaves = first.sheets.reduce((n, s) => n + s.leaves, 0);
	const topStyle = first.sheets.reduce((n, s) => n + s.topStyle, 0);
	ok(`a planted hover-fade on a funding mark was reported — ${leaves} style rules read across ${first.sheets.length} sheets (${topStyle} of them at top level, none walked past), ${matched} selecting a mark`);
	await page.close();
}
// ── and the menu half, where the two plants are the two reverted bugs.
//
// One plant per SHAPE, not one per gate id. G12 in #470 carried two assertions
// under one id, the first fired, the second was blind, and the control was
// satisfied — so each of these is checked for its own message, not merely for
// "something was reported".
//
// Both plants are the defect itself, put back: `align-items: center` is the
// rule that left 41% of the panel empty, and a transparent chip is what made
// "you are here" and "you are hovering" one picture on the site row.
{
	const size = { width: 1440, height: 900 };
	const page = await openMenu("/quienes-somos", size);
	const scan = async () => {
		const m = await page.evaluate(MEASURE_MENU);
		if (!m) return { m: null, found: [] };
		return { m, found: judgeMenu(m, await hoverSkins(page, m), "control") };
	};

	const before = await scan();
	if (!before.m) {
		console.error("✗ THIS GATE IS BLIND — the open panel presents no `.menu-inner` children to measure.");
		await browser.close();
		process.exit(3);
	}
	if (!before.m.groups.some((g) => g.sel === ".site-link")) {
		console.error("✗ THIS GATE IS BLIND — no `.site-link` carries `aria-current` on /quienes-somos, so G14 has nothing to compare.");
		await browser.close();
		process.exit(3);
	}
	if (before.found.length) {
		console.error("✗ THIS GATE IS BLIND — the control page is already failing before anything was planted:");
		for (const f of before.found) console.error(`    ${f.g}  ${f.msg}`);
		await browser.close();
		process.exit(3);
	}

	// The G13 plant reproduces the SYMPTOM, not the CSS that caused it. The
	// first draft planted `align-items: center` — the literal reverted rule —
	// and it stopped working the moment the panel gained a second grid row:
	// `align-items` centres an item inside its row, `align-content` is what
	// spreads the rows, and with two rows the free space split evenly and the
	// bands never grew. A plant tied to the shape of the fix tests the fix, not
	// the invariant. This one shortens the content and lets it float, which is
	// the picture G13 exists to refuse however the CSS arrives at it.
	await page.addStyleTag({
		content:
			".menu-inner { align-content: center !important; }" +
			"#menu-dialog .menu-spec { display: none !important; }" +
			'#menu-dialog .site-link[aria-current="page"] { background: transparent !important; }',
	});
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	const after = await scan();
	const said = (re) => after.found.some((f) => re.test(f.msg));
	const problems = [];
	if (!after.found.some((f) => f.g === "G13")) problems.push("G13 did not fire on a panel floating a short block in a tall viewport");
	if (!said(/empty paper/)) problems.push("G13 fired without naming the empty band");
	if (!after.found.some((f) => f.g === "G14")) problems.push("G14 did not fire on a current row painted like a hovered one");
	if (!said(/under the pointer/)) problems.push("G14 fired without naming the hover comparison");
	await page.close();
	if (problems.length) {
		console.error("✗ THIS GATE IS BLIND — the menu plants did not produce the findings they must:");
		for (const p of problems) console.error(`    ${p}`);
		console.error("  → a green run below would mean nothing.");
		await browser.close();
		process.exit(3);
	}
	ok(`control — a panel floating a short block and a transparent current-chip were both reported (${after.found.length} finding(s))`);
}

// ── and the openings (#456). Four plants, one per SHAPE, each on its own page:
// G12 in #470 carried two assertions under one id, the first fired, the second
// was blind, and the control was satisfied anyway. One id, one plant, one
// message pattern — and every OTHER gate must stay exactly as it was, which is
// what catches a plant that fires the right gate for the wrong reason.
{
	const doc = OPENING_ROUTES.find((o) => !o.photographic && o.route === "/quienes-somos");
	const key = (f) => `${f.g}|${f.msg}`;

	const probe = async (route, spec, width, height, plant, arg) => {
		const page = await open(route, width, height);
		const first = await page.evaluate(MEASURE_OPENING, spec.opening);
		if (!first.headerFound || !first.openingFound || !first.tokenHeaderH) {
			await page.close();
			return {
				blind: `${route} @${width}: header=${first.headerFound} \`${spec.opening}\`=${first.openingFound} --header-h=${first.tokenHeaderH || "unset"}`,
			};
		}
		const scan = async () => {
			const m = await page.evaluate(MEASURE_OPENING, spec.opening);
			return [...judgeOpening(m, "control", spec), ...judgeCard(m, "control"), ...judgeWho(m, "control")];
		};
		const before = new Set((await scan()).map(key));
		const planted = await page.evaluate(plant, arg);
		if (planted?.missing) {
			await page.close();
			return { blind: `cannot plant on ${route} — \`${planted.missing}\` is not there` };
		}
		const after = await scan();
		await page.close();
		return { before, after, fresh: after.filter((f) => !before.has(key(f))) };
	};

	const problems = [];
	const shapes = [
		{ id: "G15", why: "a header token that lies", route: doc.route, spec: doc, w: 1440, h: 900, plant: PLANT_HEADER_TOKEN, arg: undefined, expect: /--header-h says/ },
		{ id: "G16", why: "an opening with an inset of its own", route: doc.route, spec: doc, w: 1440, h: 900, plant: PLANT_OPENING_INSET, arg: doc.opening, expect: /reserves .* where the opening inset is/ },
		{ id: "G17", why: "a watermark fixed behind the page", route: doc.route, spec: doc, w: 1440, h: 900, plant: PLANT_FIXED_LAYER, arg: undefined, expect: /painted fixed behind the document/ },
		{ id: "G21", why: "an opening with a bottom of its own", route: doc.route, spec: doc, w: 1440, h: 900, plant: PLANT_OPENING_BOTTOM, arg: doc.opening, expect: /closes on .* where the section rhythm is/ },
		{ id: "G22", why: "a page that scrolls sideways", route: doc.route, spec: doc, w: 390, h: 844, plant: PLANT_SIDEWAYS, arg: undefined, expect: /scrolls sideways by \d+px/ },
		{
			id: "G18",
			why: "a hero card pushed below the fold",
			route: CARD_ROUTES[0],
			spec: OPENING_ROUTES.find((o) => o.route === CARD_ROUTES[0]),
			w: FOLD.width,
			h: FOLD.height,
			plant: PLANT_CARD_BELOW_FOLD,
			arg: undefined,
			expect: /opens at \d+px in a \d+px viewport/,
		},
		{
			id: "G23",
			why: "«for whom» pushed below a phone's fold",
			route: CARD_ROUTES[0],
			spec: OPENING_ROUTES.find((o) => o.route === CARD_ROUTES[0]),
			w: WHO_FOLD.width,
			h: WHO_FOLD.height,
			plant: PLANT_WHO_BELOW_FOLD,
			arg: undefined,
			expect: /«for whom» ends at \d+px in a \d+px viewport/,
		},
	];

	for (const sh of shapes) {
		const r = await probe(sh.route, sh.spec, sh.w, sh.h, sh.plant, sh.arg);
		if (r.blind) {
			console.error(`✗ blind: ${r.blind}`);
			console.error("  A renamed class or a deleted token makes this gate report clean forever. Update");
			console.error("  `OPENING_ROUTES` here in the same commit that renames them.");
			await browser.close();
			process.exit(3);
		}
		const mine = r.fresh.filter((f) => f.g === sh.id);
		if (!mine.length) problems.push(`${sh.id} did not fire on ${sh.why}`);
		else if (!mine.some((f) => sh.expect.test(f.msg)))
			problems.push(`${sh.id} fired but said something else: ${mine[0].msg}`);
		const groupsOf = (fs) => new Set([...fs].map((f) => (typeof f === "string" ? f.split("|")[0] : f.g)));
		// The plant is one shape; no gate that was quiet may start speaking.
		// Compared by GROUP and not by message: a gate already firing legitimately
		// rewords itself under a plant — move `--header-h` on a tree where an
		// opening still spells its own inset and G16 says "…is 80px" where it said
		// "…is 118px". That is a mutation, not cross-talk, and reading it as
		// cross-talk exits 3 on precisely the tree the gate exists to catch.
		const quietBefore = (g) => !groupsOf(r.before).has(g);
		for (const f of r.fresh.filter((f) => f.g !== sh.id && quietBefore(f.g)))
			problems.push(`${sh.id}'s plant also tripped ${f.g} — the shapes are not independent: ${f.msg}`);
		for (const g of groupsOf(r.before)) if (!groupsOf(r.after).has(g)) problems.push(`${sh.id}'s plant silenced ${g}`);
	}

	if (problems.length) {
		console.error("✗ the positive control failed: the opening scan is not measuring what it claims.");
		for (const p of problems) console.error(`    ${p}`);
		await browser.close();
		process.exit(3);
	}
	ok(`${shapes.length} planted defects judged correctly, one per shape — a header token that lies, an opening with an inset of its own, an opening with a bottom of its own, a page that scrolls sideways, a watermark fixed behind the page, a hero card below the fold, and «for whom» below a phone's fold`);
}

// ── the real scan
const findings = [];
let rowsSeen = 0;

for (const spec of ROW_LISTS) {
	for (const width of WIDTHS) {
		const page = await open(spec.route, width);
		const m = await page.evaluate(MEASURE_ROWS, spec);
		await page.close();
		if (!m || !m.items) {
			console.error(`✗ blind: \`${spec.list} ${spec.item}\` matches nothing on ${spec.route} @${width}.`);
			await browser.close();
			process.exit(3);
		}
		rowsSeen = Math.max(rowsSeen, m.items);
		findings.push(...judgeRows(m, `${spec.route} @${width}`));
	}
}

let framesSeen = 0;
for (const route of FRAME_ROUTES) {
	for (const width of WIDTHS) {
		const page = await open(route, width);
		const frames = await page.evaluate(MEASURE_FRAMES, FRAME_SELECTOR);
		await page.close();
		if (!frames.length) {
			console.error(`✗ blind: \`${FRAME_SELECTOR}\` matches nothing on ${route} @${width}.`);
			await browser.close();
			process.exit(3);
		}
		framesSeen = Math.max(framesSeen, frames.length);
		findings.push(...judgeFrames(frames, `${route} @${width}`));
	}
}

let copyBlocks = 0;
let widest = 0;
for (const route of MEASURE_ROUTES) {
	const page = await open(route, 1440);
	const blocks = await page.evaluate(MEASURE_COPY, { min: BODY_MIN_PX, chars: MEASURE_CHARS });
	await page.close();
	if (!blocks.length) {
		console.error(`✗ blind: ${route} @1440 presents no body copy to measure.`);
		await browser.close();
		process.exit(3);
	}
	copyBlocks += blocks.length;
	widest = Math.max(widest, ...blocks.map((b) => b.ch));
	findings.push(...judgeCopy(blocks, `${route} @1440`));
}

for (const route of PROSE_ROUTES) {
	const page = await open(route, 1440);
	const runs = await page.evaluate(MEASURE_PROSE, PROSE_MIN);
	await page.close();
	findings.push(...judgeProse(runs, route));
}

let marksSeen = 0;
for (const route of FOOTER_ROUTES) {
	for (const width of FOOTER_WIDTHS) {
		const page = await open(route, width);
		await settleFooter(page);
		const m = await page.evaluate(MEASURE_FOOTER);
		await page.close();
		if (!m || !m.marks || !m.funding.length || !m.links.length) {
			console.error(`✗ blind: the footer on ${route} @${width} does not present what this gate measures.`);
			await browser.close();
			process.exit(3);
		}
		marksSeen = Math.max(marksSeen, m.marks);
		findings.push(...judgeFooter(m, `${route} @${width}`, width));
	}
}

// G12 reads stylesheets, so width does not enter into it — but the locales load
// their own page sheets, so both routes are scanned.
let fundingRules = 0;
for (const route of FOOTER_ROUTES) {
	const page = await open(route, 1440);
	await settleFooter(page);
	const m = await page.evaluate(MEASURE_FUNDING_CSS, {
		props: INTEGRITY_PROPS, identity: [...INTEGRITY_IDENTITY], needle: FUNDING_SELECTOR,
	});
	await page.close();
	const matched = m.sheets.reduce((n, s) => n + s.matched, 0);
	const skipping = m.sheets.filter((s) => s.leaves < s.topStyle);
	if (!matched || skipping.length) {
		console.error(`✗ blind: the funding-mark scan on ${route} is not reading what it claims.`);
		if (!matched) console.error(`  no rule selects \`${FUNDING_SELECTOR}\` — renamed?`);
		for (const s of skipping)
			console.error(`  ${s.href.split("/").pop()}: read ${s.leaves} style rules against ${s.topStyle} at top level`);
		await browser.close();
		process.exit(3);
	}
	fundingRules = Math.max(fundingRules, matched);
	findings.push(...judgeFunding(m, route));
}
let menuPanels = 0;
let menuMarked = 0;
for (const route of MENU_ROUTES) {
	for (const size of MENU_SIZES) {
		const page = await openMenu(route, size);
		const m = await page.evaluate(MEASURE_MENU);
		if (!m || !m.rows) {
			console.error(`✗ blind: the open panel on ${route} @${size.width}x${size.height} presents no rows to measure.`);
			await page.close();
			await browser.close();
			process.exit(3);
		}
		const hovered = await hoverSkins(page, m);
		await page.close();
		menuPanels++;
		menuMarked += m.groups.length;
		findings.push(...judgeMenu(m, hovered, `${route} @${size.width}x${size.height}`));
	}
}
// Four routes were chosen so that BOTH marked rows are exercised in both
// locales. If the seed or the nav changes and no page carries a current row any
// more, G14 stops having anything to say and says so instead of passing.
if (menuMarked < menuPanels) {
	console.error(`✗ blind: across ${menuPanels} open panels only ${menuMarked} carried a row with \`aria-current\`, so G14 measured almost nothing.`);
	await browser.close();
	process.exit(3);
}
let openingsSeen = 0;
for (const spec of OPENING_ROUTES) {
	for (const width of OPENING_WIDTHS) {
		const page = await open(spec.route, width);
		const m = await page.evaluate(MEASURE_OPENING, spec.opening);
		await page.close();
		if (!m.headerFound || !m.openingFound || !m.tokenHeaderH) {
			console.error(`✗ blind: ${spec.route} @${width} does not present what this gate measures.`);
			console.error(
				`  header=${m.headerFound} \`${spec.opening}\`=${m.openingFound} --header-h=${m.tokenHeaderH || "unset"}`
			);
			await browser.close();
			process.exit(3);
		}
		openingsSeen++;
		findings.push(...judgeOpening(m, `${spec.route} @${width}`, spec));
	}
}

for (const route of CARD_ROUTES) {
	const page = await open(route, FOLD.width, FOLD.height);
	const m = await page.evaluate(MEASURE_OPENING, ".s-hero");
	await page.close();
	if (!m.cardFound) {
		console.error(`✗ blind: \`.s-hero__card\` is not on ${route} — G18 has nothing to measure.`);
		await browser.close();
		process.exit(3);
	}
	findings.push(...judgeCard(m, `${route} @${FOLD.width}\u00d7${FOLD.height}`));

	const small = await open(route, WHO_FOLD.width, WHO_FOLD.height);
	const w = await small.evaluate(MEASURE_OPENING, ".s-hero");
	await small.close();
	if (!w.whoFound) {
		console.error(`✗ blind: \`.s-hero__kicker p\` is not on ${route} — G23 has nothing to measure.`);
		await browser.close();
		process.exit(3);
	}
	findings.push(...judgeWho(w, `${route} @${WHO_FOLD.width}\u00d7${WHO_FOLD.height}`));
}

await browser.close();

if (findings.length) {
	const by = (g) => findings.filter((f) => f.g === g);
	if (by("G1").length) {
		fail(`${by("G1").length} ROW list(s) have ragged item heights.`);
		console.error("  Equal line counts are what let the box go away (#453). A list whose items differ in");
		console.error("  height is the reason a list starts asking for containers to tidy it up.");
		for (const f of by("G1")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G2").length) {
		fail(`${by("G2").length} ROW(s) draw a container at rest.`);
		console.error("  A ROW is a hairline above and an accent on hover/focus/current — nothing at rest");
		console.error("  (theme.css, the three chromes). Radius, shadow and a painted accent belong to PANEL.");
		for (const f of by("G2")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G3").length) {
		fail(`${by("G3").length} run(s) of copy are printed more than once on the same page.`);
		console.error("  The hero card and the areas row printed the same excerpt verbatim, twenty lines apart,");
		console.error("  which is what made the block read as filler (#453). The copy baseline cannot see this:");
		console.error("  it freezes the duplicate along with everything else.");
		for (const f of by("G3")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G4").length) {
		fail(`the reference strip leaves a mark on a line of its own where the whole set fits.`);
		console.error("  Six marks and a seventh alone below is what the strip did at 1024 and 1440 (#454),");
		console.error("  because it inherited the reading column's width. The marks are the page's credibility;");
		console.error("  an orphan reads as an accident. Widen `.ref-banner__inner`, or drop the column count.");
		for (const f of by("G4")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G5").length) {
		fail(`${by("G5").length} line(s) of the reference strip are not centred within it.`);
		console.error("  Flex centres a partial line for free; a grid does not. If the strip was just tidied");
		console.error("  into columns, the wrapped line is now hard left in track one.");
		for (const f of by("G5")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G6").length) {
		fail(`${by("G6").length} footer element(s) are not left-aligned.`);
		console.error("  The footer was centred below 768px and left above it, so it read as two designs (#454).");
		console.error("  One alignment at every width — the site has one edge and the footer keeps it.");
		for (const f of by("G6")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G7").length) {
		fail(`${by("G7").length} funding emblem(s) render below the mandated minimum.`);
		console.error(`  ${EMBLEM_MIN_PX}px is 1cm at 96dpi — the floor in \`eu-emblem-rules_es.pdf\` p.10, whose duty that`);
		console.error("  same document extends to mobile versions. The composite JPEG we used to ship rendered");
		console.error("  the EU emblem at 18.2px on a 390px phone. Penalty for publicity failures: 10% of the aid");
		console.error("  (Orden ETD/1498/2021 art. 36.4). This is not a taste question.");
		for (const f of by("G7")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G8").length) {
		fail(`footer links render at more than one size.`);
		console.error("  There were five — 13, 14, 17, 18 and 20px — and the home's own body copy sat below two");
		console.error("  of them (#454). One list, one size.");
		for (const f of by("G8")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G10").length) {
		fail(`${by("G10").length} footer element(s) paint outside the page's one measure.`);
		console.error('  `theme.css`: "There is no second measure. A page has ONE width and everything');
		console.error('  inside it shares one edge." The first draft of this footer let both sides of the');
		console.error("  signature row shrink; the columns lost, shrank to 403px, and their `nowrap` children");
		console.error("  hung the CTA 73.7px past the right edge. Give the columns `flex: 0 0 auto` and let");
		console.error("  the line of prose be what gives.");
		for (const f of by("G10")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G11").length) {
		fail(`the EU emblem does not outweigh the other marks on the funding line.`);
		console.error(`  ${EMBLEM_PROMINENCE}× is the "un 30% más grande que el resto de los logotipos" of the`);
		console.error("  `Guía de Justificación` red.es asks a compliance screenshot against — a recommendation");
		console.error("  there, binding for cartelería in the Enero 2022 identity manual, and above the \"al menos");
		console.error("  tan prominente\" floor of Orden HFP/1030/2021 art. 9.4. Meeting the strictest of the");
		console.error("  three costs one CSS declaration, so we meet it.");
		for (const f of by("G11")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G12").length) {
		fail(`${by("G12").length} rule(s) modify a funding mark instead of scaling it.`);
		console.error("  The EU emblem and the Plan de Recuperación logo are supplied artwork: they may be");
		console.error("  scaled, and nothing else — no recolouring, fading, rotation, cropping, filter or");
		console.error("  overlay. The emblem's own usage rules and the `Manual de Identidad` both say so, and");
		console.error("  art. 34.3 of Orden ETD/1498/2021 makes carrying them correctly an obligation. A");
		console.error("  publicity breach is priced at 10% of the awarded aid (art. 38.4).");
		console.error("  If the declaration is on a :hover or :focus rule, note that this gate reads the");
		console.error("  stylesheet precisely because no measurement of the page at rest can see it.");
		for (const f of by("G12")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G13").length) {
		fail(`${by("G13").length} open menu panel(s) waste more than ${MENU_WASTE_MAX}% of the viewport.`);
		console.error("  A full-screen menu is a screen the reader asked for. Centring a 458px list inside");
		console.error("  `min-height: 100vh` left 169px above the first link and 197px below the last (#455) —");
		console.error("  and the half above is the one that hurts, because it pushes the first specialty a");
		console.error("  third of the way down. Anchor the content under the strip and spend the air.");
		for (const f of by("G13")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G14").length) {
		fail(`${by("G14").length} menu row(s) mark the current page exactly as they mark a hovered one.`);
		console.error("  1.4.1: colour alone may not carry information, and this was worse than colour alone —");
		console.error("  the site row went #6B6B6B → #1E1E1E for `aria-current`, which is the same repaint");
		console.error("  hovering any other row performs, so the two states were one picture (#455).");
		for (const f of by("G14")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G15").length) {
		fail(`\`--header-h\` does not match the header the browser draws.`);
		console.error("  The opening inset used to be spelled `calc(80px + …)` below 768 and `calc(100px + …)`");
		console.error("  above it, in twelve declarations across eight stylesheets. The header measures 69px");
		console.error("  and 78px: both literals were wrong, the desktop one by 22px, and nothing in CI could");
		console.error("  say so because a wrong constant is not a wrong declaration. Fix the token, not the");
		console.error("  consumers — that is the whole point of there being one.");
		for (const f of by("G15")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G16").length) {
		fail(`${by("G16").length} opening(s) reserve an inset of their own.`);
		console.error("  Every page type starts the same distance below the header: `--header-h` plus");
		console.error("  `--open-clear`, and nothing else (#456). The same h1 used to open at 104, 140 or 160px");
		console.error("  depending on which stylesheet the page imported. If a new opening genuinely needs its");
		console.error("  own column — a band built around a plate does — add it to `OPENING_ROUTES` as");
		console.error("  `photographic: true`, with the reason, rather than widening the assertion.");
		for (const f of by("G16")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G21").length) {
		fail(`${by("G21").length} opening(s) close on a bottom of their own.`);
		console.error("  Every section has `--rhythm-section` on EACH side (#304), the opening included —");
		console.error("  a band-less page ends on it too, and the footer brings its own (#570).");
		for (const f of by("G21")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G22").length) {
		fail(`${by("G22").length} page(s) scroll sideways.`);
		console.error("  Nothing may scroll horizontally at a phone width (§14). Find the element wider than");
		console.error("  the viewport — the last one was a global class leaking onto a page paragraph (#570).");
		for (const f of by("G22")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G17").length) {
		fail(`${by("G17").length} decorative layer(s) are painted fixed behind the document.`);
		console.error("  A fixed layer below the content cannot be composed with anything: its relationship to");
		console.error("  the copy is whatever the scroll offset happens to be. `.s-emblem-bg` was a 340px cube");
		console.error("  at 7% that crossed the boot console, the lede, a section heading and four paragraphs");
		console.error("  of «Quiénes somos» at once (#456). If the page needs a mark, put it in the opening and");
		console.error("  let it scroll away with the thing it names.");
		for (const f of by("G17")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G18").length) {
		fail(`the hero card does not open above the fold.`);
		console.error(`  ${FOLD.width}\u00d7${FOLD.height} is the phone this has to fit on. The card is the only thing in the band`);
		console.error("  that says what we do; below the fold it is a picture and a heading and nothing else.");
		for (const f of by("G18")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G23").length) {
		fail(`the home's «for whom» does not end above a phone's fold.`);
		console.error(`  ${WHO_FOLD.width}\u00d7${WHO_FOLD.height} is an iPhone 15 Pro with Safari's bars. The kicker's first sentence says who`);
		console.error("  we work for; under the fold, a first-time reader gets a heading and no reader (#572).");
		for (const f of by("G23")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G20").length) {
		fail(`${by("G20").length} block(s) of body copy run past ${MEASURE_MAX} characters a line.`);
		console.error(`  45-75 is the conventional range; this site was the widest of the nine measured by`);
		console.error("  `bench-visual.mjs`, and the one block past it was body copy, not fine print (#481).");
		console.error("  The lever is TYPE SIZE, not width: theme.css says there is no second measure and");
		console.error("  everything inside the column ends at the same edge (#304), so a max-width on prose");
		console.error("  is the second edge that forbids. At one edge, smaller type buys more characters.");
		for (const f of by("G20")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G19").length) {
		fail(`${by("G19").length} framed photograph(s) paint more than a frame.`);
		console.error("  A photograph is not a PANEL and not a container: a container holds content, and an");
		console.error("  image is content. Its border is a frame on the picture, not chrome around a box, so");
		console.error("  it gets four equal edges of one colour and nothing else (#482). Radius, shadow and a");
		console.error("  painted accent edge belong to PANEL, which is a machine surface — an instrument, a");
		console.error("  console, a quoted foreign UI — and there is exactly one of those in the tree.");
		for (const f of by("G19")) console.error(`    ${f.where}  ${f.msg}`);
	}
	if (by("G9").length) {
		fail(`the footer paints a ground of its own.`);
		console.error("  One ground for the whole document, footer included: a separate band is what makes a");
		console.error("  footer read as bolt-on.");
		for (const f of by("G9")) console.error(`    ${f.where}  ${f.msg}`);
	}
	process.exit(1);
}

if (ROW_LISTS.length) ok(`${ROW_LISTS.length} ROW list(s) × ${WIDTHS.length} widths: ${rowsSeen} items each, heights within ${TOLERANCE}px, no chrome at rest`);
ok(`no run of ${PROSE_MIN}+ characters is printed twice on ${PROSE_ROUTES.join(" or ")}`);
ok(
	`${MENU_ROUTES.length} routes × ${MENU_SIZES.length} sizes: the open panel wastes at most ${MENU_WASTE_MAX}% of the viewport and every current row is marked unlike a hovered one`
);
ok(
	`${openingsSeen / OPENING_WIDTHS.length} page openings \u00d7 ${OPENING_WIDTHS.length} widths: \`--header-h\` matches the rendered header, every document opening reserves the same inset and closes on the section rhythm, no page scrolls sideways, nothing is painted fixed behind the page, the hero card opens above the fold at ${FOLD.width}\u00d7${FOLD.height}, and the home's «for whom» ends above it at ${WHO_FOLD.width}\u00d7${WHO_FOLD.height}`
);
ok(
	`the footer holds one alignment, one link size, no ground of its own, ${marksSeen} reference marks on one line from ${STRIP_ONE_LINE_FROM}px and centred lines below it, emblems at or above ${EMBLEM_MIN_PX}px and ${EMBLEM_PROMINENCE}× every other mark, and nothing outside the one measure`
);
ok(`${fundingRules} rule(s) select a funding mark and none of them modifies it — scaled only`);
ok(`${copyBlocks} block(s) of body copy across ${MEASURE_ROUTES.length} routes: widest line ${widest} characters, at or under ${MEASURE_MAX}`);
ok(`${framesSeen} framed photograph(s) × ${WIDTHS.length} widths: a frame and nothing else — no shadow, no accent edge`);
process.exit(0);
