<script lang="ts">
	// The tour composer.
	//
	// Six steps, one page, one URL. Deliberately NOT a router-driven wizard: writing a
	// listing is one long sitting, people jump back and forth between the itinerary and
	// the basics, and a step per route means a navigation — and a lost paragraph — every
	// time they do. So the whole model lives in `draft` here rather than in the DOM: the
	// five inactive steps are unmounted, and nothing typed in them goes with them.
	//
	// What makes it a publishing tool rather than a long form is that three questions are
	// answerable at a glance from anywhere in it: where is this listing in the review,
	// what is still missing and which step holds it, and what has not been saved yet.
	//
	// Nothing on this page approves, publishes, features or requests changes. Those are
	// the marketplace team's acts, and tours:publish is held by no tenant role.
	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';
	import Money from '$components/Money.svelte';
	import { plural, statusLabel } from '$lib/labels';
	import RoutePlanner from '$lib/geo/RoutePlanner.svelte';
	import type { BasemapDoc, LngLat } from '$lib/geo/basemap';
	import type { SubmitFunction } from '@sveltejs/kit';
	let { data, form } = $props();

	const STEPS = [
		{ key: 'basics', label: 'Basics' },
		{ key: 'location', label: 'Location' },
		{ key: 'itinerary', label: 'Itinerary' },
		{ key: 'pricing', label: 'Pricing' },
		{ key: 'media', label: 'Media' },
		{ key: 'review', label: 'Review & submit' }
	] as const;
	type StepKey = (typeof STEPS)[number]['key'];
	let step = $state<StepKey>('basics');

	const stepLabel = new Map<StepKey, string>(STEPS.map((s) => [s.key, s.label]));

	/** The step after this one, for the Next button. The last one has none. */
	function nextStep(key: StepKey) {
		const i = STEPS.findIndex((s) => s.key === key);
		return i < STEPS.length - 1 ? STEPS[i + 1] : null;
	}

	/** Same lifecycle palette as the listing shelf; the words come from statusLabel. */
	const TONES: Record<string, string> = {
		DRAFT: 'bg-slate-100 text-slate-500',
		SUBMITTED: 'bg-warning/10 text-warning',
		IN_REVIEW: 'bg-info/10 text-info',
		CHANGES_REQUESTED: 'bg-danger/10 text-danger',
		APPROVED: 'bg-purple/10 text-purple',
		PUBLISHED: 'bg-success/10 text-success',
		UNPUBLISHED: 'bg-orange/10 text-orange',
		ARCHIVED: 'bg-slate-100 text-slate-400'
	};

	/** The panel behind the badge — the same tones one shade quieter, so the surface
	 *  carries the state and the badge inside it still reads as the label. */
	const PANELS: Record<string, string> = {
		DRAFT: 'border-slate-200 bg-slate-50',
		SUBMITTED: 'border-warning/40 bg-warning/5',
		IN_REVIEW: 'border-info/40 bg-info/5',
		CHANGES_REQUESTED: 'border-danger/50 bg-danger/5',
		APPROVED: 'border-purple/40 bg-purple/5',
		PUBLISHED: 'border-success/40 bg-success/5',
		UNPUBLISHED: 'border-orange/40 bg-orange/5',
		ARCHIVED: 'border-slate-200 bg-slate-50'
	};

	/**
	 * What the status MEANS, and whose move it is next.
	 *
	 * "Submitted" is a word about the platform's queue. The operator's question is only
	 * ever "is this mine to do?", and a status that does not answer it teaches people to
	 * email and ask. Both sentences are written to answer it.
	 */
	const MEANING: Record<string, { means: string; next: string }> = {
		DRAFT: {
			means: 'Only you can see this. Nothing about it is public yet.',
			next: 'Fill in what is still missing, then send it to the Makutano team.'
		},
		SUBMITTED: {
			means: 'With the Makutano team. A listing is usually reviewed within a day.',
			next: 'Nothing to do — the outcome appears on this page.'
		},
		IN_REVIEW: {
			means: 'A reviewer has it open right now.',
			next: 'Nothing to do — the outcome appears on this page.'
		},
		CHANGES_REQUESTED: {
			means: 'The team read it and sent it back with a note.',
			next: 'Answer the note, then send it for review again.'
		},
		APPROVED: {
			means: 'It passed review. It is not on the marketplace yet.',
			next: 'The Makutano team decides when it goes live.'
		},
		PUBLISHED: {
			means: 'Live on the marketplace. Travellers can find it and enquire.',
			// True, and worth saying out loud: the public page reads this listing itself,
			// so a save here is a change to a page travellers are looking at.
			next: 'Anything you save from here changes the live page straight away.'
		},
		UNPUBLISHED: {
			means: 'Taken off the marketplace. Nobody can find it.',
			next: 'Send it for review again when you can run it.'
		},
		ARCHIVED: {
			means: 'Put away. Not on the marketplace, and not being worked on.',
			next: 'Restore it to draft to go on working on it.'
		}
	};
	const meaning = $derived(
		MEANING[data.tour.status] ?? { means: 'This listing is not on the marketplace.', next: '' }
	);

	const fmtDate = (v: string | Date) =>
		new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

	type Day = {
		title: string;
		destinationId: string;
		description: string;
		activities: string;
		accommodation: string;
		meals: string;
		distance: string;
		estimatedTravelTime: string;
		/** The day's own pin. Numbers, not strings: these are dragged, not typed. */
		latitude: number | null;
		longitude: number | null;
		/** DRIVE | FLY | BOAT — how this stop is reached from the previous one. */
		travelMode: string | null;
	};

	/** Everything is held as a string: the server owns the parsing, and a half-typed
	 *  number must not vanish out of an input while it is still being typed. */
	function seed() {
		const t = data.tour;
		return {
			title: t.title,
			shortDescription: t.shortDescription ?? '',
			description: t.description ?? '',
			durationDays: String(t.durationDays ?? 1),
			durationNights: t.durationNights == null ? '' : String(t.durationNights),
			primaryCategoryId: t.primaryCategoryId ?? '',
			travelStyleIds: [...data.travelStyleIds],
			categoryIds: [...data.categoryIds],
			groupType: t.groupType ?? '',
			groupSizeMin: t.groupSizeMin == null ? '' : String(t.groupSizeMin),
			groupSizeMax: t.groupSizeMax == null ? '' : String(t.groupSizeMax),
			ageRequirement: t.ageRequirement ?? '',
			customisable: t.customisable,
			soloFriendly: t.soloFriendly,
			startsAnyDay: t.startsAnyDay,
			accommodationSummary: t.accommodationSummary ?? '',
			transportSummary: t.transportSummary ?? '',
			mealsSummary: t.mealsSummary ?? '',
			bestTimeSummary: t.bestTimeSummary ?? '',
			primaryCountryId: t.primaryCountryId ?? '',
			destinationIds: [...data.destinationIds],
			days: data.itinerary.map(
				(d): Day => ({
					title: d.title,
					destinationId: d.destinationId ?? '',
					description: d.description ?? '',
					activities: (d.activities ?? []).join(', '),
					accommodation: d.accommodation ?? '',
					meals: d.meals ?? '',
					distance: d.distance ?? '',
					estimatedTravelTime: d.estimatedTravelTime ?? '',
					latitude: d.latitude,
					longitude: d.longitude,
					travelMode: d.travelMode
				})
			),
			priceFrom: t.priceFrom ?? '',
			currency: t.currency ?? data.tenant.currency,
			pricingType: t.pricingType
		};
	}

	// untrack: these are STARTING values for a model the vendor then owns. Read
	// reactively they would look like derivations, and every save would overwrite
	// whatever was typed since.
	let draft = $state(untrack(seed));
	let mediaOrder = $state(untrack(() => data.gallery.map((m) => m.id)));

	/* ------------------------------------------------------------ route map ---- */

	// Fetched when the itinerary step is first opened, not on page load: it is
	// ~115 KB of national geometry and most composer visits never reach this step.
	let basemap = $state<BasemapDoc | null>(null);
	let basemapFailed = $state(false);
	let placingDay = $state<number | null>(null);

	$effect(() => {
		if (step !== 'itinerary' || basemap || basemapFailed) return;
		fetch('/geo/tz-basemap.json')
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((doc) => (basemap = doc))
			.catch(() => (basemapFailed = true));
	});

	const destinationById = $derived(new Map(data.destinations.map((d) => [d.id, d])));

	/**
	 * A day's coordinate, in order of specificity: the day's own pin first, then
	 * the coordinate of the destination it names. A vendor who pinned a camp
	 * inside the Serengeti meant the camp.
	 */
	/** Day 1 is arrival, so it has nothing to be reached FROM. */
	const TRAVEL_MODES = [
		{ value: 'DRIVE', label: 'Drive' },
		{ value: 'FLY', label: 'Fly' },
		{ value: 'BOAT', label: 'Boat' }
	];

	const stops = $derived(
		draft.days.map((d, i) => {
			const dest = d.destinationId ? destinationById.get(d.destinationId) : undefined;
			const pinned = d.latitude !== null && d.longitude !== null;
			return {
				dayNumber: i + 1,
				title: d.title,
				placeName: dest?.name ?? null,
				lat: pinned ? d.latitude : (dest?.latitude ?? null),
				lng: pinned ? d.longitude : (dest?.longitude ?? null),
				pinned,
				mode: d.travelMode
			};
		})
	);

	function placePin(dayNumber: number, p: LngLat) {
		const day = draft.days[dayNumber - 1];
		if (!day) return;
		// Five decimals is about a metre — far finer than anything drawn at this scale,
		// and it keeps the posted JSON from carrying float noise.
		day.longitude = Number(p[0].toFixed(5));
		day.latitude = Number(p[1].toFixed(5));
		placingDay = null;
	}

	function clearPin(dayNumber: number) {
		const day = draft.days[dayNumber - 1];
		if (!day) return;
		day.latitude = null;
		day.longitude = null;
	}

	const styleLimitReached = $derived(draft.travelStyleIds.length >= data.maxTravelStyles);

	function toggleStyle(id: string) {
		const at = draft.travelStyleIds.indexOf(id);
		if (at >= 0) draft.travelStyleIds.splice(at, 1);
		else if (!styleLimitReached) draft.travelStyleIds.push(id);
	}

	/** The primary category is always in the set, so it cannot be toggled off here. */
	function toggleCategory(id: string) {
		if (id === draft.primaryCategoryId) return;
		const at = draft.categoryIds.indexOf(id);
		if (at >= 0) draft.categoryIds.splice(at, 1);
		else draft.categoryIds.push(id);
	}
	let heroMediaId = $state(untrack(() => data.tour.heroMediaId ?? ''));

	// A plain let, not $state: comparing it must not make the effect below depend on it.
	let seededFor = untrack(() => data.tour.id);
	$effect(() => {
		// Opening another listing reuses this component, so the model is re-seeded by
		// hand. Without it, one listing's unsaved paragraphs would appear under
		// another listing's title.
		if (data.tour.id === seededFor) return;
		seededFor = data.tour.id;
		draft = seed();
		mediaOrder = data.gallery.map((m) => m.id);
		heroMediaId = data.tour.heroMediaId ?? '';
		step = 'basics';
	});

	$effect(() => {
		const ids = data.gallery.map((m) => m.id);
		// Re-seed only when the SET changed — an upload or a delete. A reorder the vendor
		// has not saved yet has to survive the re-render that follows every other save.
		if (ids.length !== mediaOrder.length || ids.some((id) => !mediaOrder.includes(id))) mediaOrder = ids;
	});

	$effect(() => {
		// The first upload adopts itself as the main photo server-side; mirroring that
		// here stops the Media step from immediately looking unsaved.
		if (!heroMediaId && data.tour.heroMediaId) heroMediaId = data.tour.heroMediaId;
	});

	/* ------------------------------------------------------------- saving ---- */

	type SaveState = 'idle' | 'saving' | 'saved' | 'failed';
	let saved = $state<Record<string, SaveState>>({});

	/** Report what actually happened. A step that failed must never flash "Saved". */
	const track =
		(key: string, onSaved?: () => void): SubmitFunction =>
		() => {
			saved[key] = 'saving';
			return async ({ result, update }) => {
				const ok = result.type === 'success';
				saved[key] = ok ? 'saved' : 'failed';
				// reset: false — the inputs are bound to `draft`, and resetting the form
				// would blank the DOM underneath a model that still holds the text.
				await update({ reset: false });
				// After the update, so a confirm strip closes on the render that already
				// shows the result rather than a frame ahead of it.
				if (ok) onSaved?.();
			};
		};

	/** The upload form is the one here whose inputs are NOT bound to `draft` — the file
	 *  and its alt text belong to the photo just sent, so it is cleared for the next one. */
	const trackUpload: SubmitFunction = () => {
		saved.upload = 'saving';
		return async ({ result, update }) => {
			const ok = result.type === 'success';
			saved.upload = ok ? 'saved' : 'failed';
			await update({ reset: ok });
		};
	};

	/* ------------------------------------------------------- unsaved work ---- */

	/**
	 * The listing as the server last returned it, in the same shape as `draft`.
	 *
	 * Every action on this page re-runs load, so this re-derives after each save and a
	 * step stops reading as unsaved the moment its save lands. Comparing against the
	 * server's own answer rather than against a snapshot means there is no second copy
	 * of the truth to keep in step.
	 */
	const pristine = $derived(seed());

	/**
	 * The category set as the SERVER will hold it.
	 *
	 * setTourCategories writes the primary category into the link set whether or
	 * not the browser sent it, because a category filter that misses the tours
	 * whose main category it is would be useless. The draft does not carry it —
	 * the primary chip is rendered on and disabled rather than selected — so
	 * comparing the raw arrays reported "Not saved yet: Basics" permanently,
	 * immediately after a successful save. Compare what the server would store.
	 */
	const effectiveCategories = (s: { categoryIds: string[]; primaryCategoryId: string }) =>
		s.primaryCategoryId && !s.categoryIds.includes(s.primaryCategoryId)
			? [s.primaryCategoryId, ...s.categoryIds]
			: s.categoryIds;

	const same = (a: string, b: string) => a.trim() === b.trim();
	const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

	/**
	 * Numbers come back in the DATABASE's spelling, not the vendor's.
	 *
	 * A price typed as "1850" is returned by a numeric(14,2) column as "1850.00". Compared
	 * as text, saving it would leave Pricing insisting for the rest of the session that it
	 * had never been saved — the one thing an unsaved marker must never do. Blank still
	 * compares as blank rather than as zero.
	 */
	const sameNumber = (a: string, b: string) => {
		const x = a.trim();
		const y = b.trim();
		return !x || !y ? x === y : Number(x) === Number(y);
	};

	/** The server upper-cases the currency; the input only styles it that way. */
	const sameCurrency = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

	/** The server splits activities on commas and trims each one, so "A,B" and "A, B"
	 *  are the same day. Compared the same way, or a saved itinerary would go on
	 *  claiming it was unsaved until the vendor retyped it to match. */
	const dayPrint = (d: Day) =>
		JSON.stringify([
			d.title.trim(),
			d.destinationId,
			d.description.trim(),
			d.activities
				.split(',')
				.map((a) => a.trim())
				.filter(Boolean),
			d.accommodation.trim(),
			d.meals.trim(),
			d.distance.trim(),
			d.estimatedTravelTime.trim()
		]);

	const BASICS_TEXT = [
		'title',
		'shortDescription',
		'description',
		'groupType',
		'ageRequirement',
		'accommodationSummary',
		'transportSummary',
		'mealsSummary',
		'bestTimeSummary'
	] as const;
	const BASICS_NUMBERS = ['durationDays', 'durationNights', 'groupSizeMin', 'groupSizeMax'] as const;
	const BASICS_FLAGS = ['customisable', 'soloFriendly', 'startsAnyDay'] as const;

	/** The ticks, and the sentence each one puts on the public page. */
	const FEATURES = [
		{
			key: 'customisable' as const,
			label: 'Can be customised',
			hint: 'Travellers may ask to change accommodation, days or destinations.'
		},
		{
			key: 'soloFriendly' as const,
			label: 'Suitable for solo travellers',
			hint: 'One person can book this without a supplement that makes it pointless.'
		},
		{
			key: 'startsAnyDay' as const,
			label: 'Can start any day',
			hint: 'Not tied to fixed departure dates.'
		}
	];

	const unsaved: Record<StepKey, boolean> = $derived({
		basics:
			BASICS_TEXT.some((f) => !same(draft[f], pristine[f])) ||
			BASICS_NUMBERS.some((f) => !sameNumber(draft[f], pristine[f])) ||
			BASICS_FLAGS.some((f) => draft[f] !== pristine[f]) ||
			draft.primaryCategoryId !== pristine.primaryCategoryId ||
			!sameSet(draft.travelStyleIds, pristine.travelStyleIds) ||
			!sameSet(effectiveCategories(draft), effectiveCategories(pristine)),
		location:
			draft.primaryCountryId !== pristine.primaryCountryId || !sameSet(draft.destinationIds, pristine.destinationIds),
		itinerary: draft.days.map(dayPrint).join('|') !== pristine.days.map(dayPrint).join('|'),
		// A new draft shows the account's own currency in the box before anything has
		// been saved, and both sides of this comparison get it from the same place. That
		// is a default on display, not work the vendor did, so it is not called unsaved —
		// the readiness panel above is what says the listing still needs a currency.
		pricing:
			!sameNumber(draft.priceFrom, pristine.priceFrom) ||
			!sameCurrency(draft.currency, pristine.currency) ||
			draft.pricingType !== pristine.pricingType,
		// Photos are not held in `draft`: the gallery the server returned IS the saved
		// order, so it is the thing to compare against.
		media:
			mediaOrder.join(',') !== data.gallery.map((m) => m.id).join(',') || heroMediaId !== (data.tour.heroMediaId ?? ''),
		review: false
	});
	const unsavedSteps = $derived(STEPS.filter((s) => unsaved[s.key]));
	const unsavedNames = $derived(unsavedSteps.map((s) => s.label).join(', '));

	/**
	 * Leaving the PAGE is the only thing that actually loses work.
	 *
	 * Moving between steps keeps everything — the model lives here, not in the DOM — so
	 * that is warned about in place rather than blocked. A navigation away is different:
	 * `draft` goes with the component, and there is no second chance to mention it.
	 */
	let leaving = false;
	let pendingUrl = $state<URL | null>(null);

	beforeNavigate((nav) => {
		if (leaving || !unsavedSteps.length) return;
		nav.cancel();
		// A 'leave' navigation is the tab closing or the address bar. Cancelling it is
		// what asks the browser to put up its own prompt, and there would be no page
		// left to render ours on.
		if (nav.type !== 'leave') pendingUrl = nav.to?.url ?? null;
	});

	async function leaveAnyway() {
		const url = pendingUrl;
		pendingUrl = null;
		leaving = true;
		if (url) await goto(url);
	}

	/* ----------------------------------------------------------- location ---- */

	const byCountry = $derived(data.destinations.filter((d) => d.countryId === draft.primaryCountryId));
	const destinationName = $derived(new Map(data.destinations.map((d) => [d.id, d.name])));

	function chooseCountry(id: string) {
		if (id === draft.primaryCountryId) return;
		// A listing may only visit places inside its own country — the service refuses
		// the rest — so changing country clears a selection that could not be saved.
		draft.primaryCountryId = id;
		draft.destinationIds = [];
	}

	const toggleDestination = (id: string) =>
		(draft.destinationIds = draft.destinationIds.includes(id)
			? draft.destinationIds.filter((x) => x !== id)
			: [...draft.destinationIds, id]);

	/* ---------------------------------------------------------- itinerary ---- */

	const blankDay = (): Day => ({
		title: '',
		destinationId: '',
		description: '',
		activities: '',
		latitude: null,
		longitude: null,
		travelMode: null,
		accommodation: '',
		meals: '',
		distance: '',
		estimatedTravelTime: ''
	});

	/** Removing a day destroys typing that has no other copy, so it asks first; the
	 *  index it is asking about stops meaning anything once the list moves under it. */
	let confirmRemoveDay = $state<number | null>(null);

	const addDay = () => (draft.days = [...draft.days, blankDay()]);
	function removeDay(index: number) {
		draft.days = draft.days.filter((_, n) => n !== index);
		confirmRemoveDay = null;
	}
	function moveDay(index: number, delta: number) {
		const to = index + delta;
		if (to < 0 || to >= draft.days.length) return;
		const next = [...draft.days];
		[next[index], next[to]] = [next[to], next[index]];
		draft.days = next;
		confirmRemoveDay = null;
	}

	/**
	 * What a day may point at.
	 *
	 * The places chosen in Location, never free text. A day still holding a place that
	 * has since been unticked there is listed too, flagged — dropping it silently is
	 * how a vendor loses a day's work without being told.
	 */
	const dayOptions = $derived([
		...draft.destinationIds.map((id) => ({ id, label: destinationName.get(id) ?? 'Unknown place' })),
		...data.destinations
			.filter((d) => !draft.destinationIds.includes(d.id) && draft.days.some((day) => day.destinationId === d.id))
			.map((d) => ({ id: d.id, label: `${d.name} — no longer selected in Location` }))
	]);

	/** Arusha → Tarangire → Serengeti, read off the days. Nobody types the route twice. */
	const route = $derived.by(() => {
		const names: string[] = [];
		for (const day of draft.days) {
			const name = destinationName.get(day.destinationId);
			if (name && name !== names[names.length - 1]) names.push(name);
		}
		return names;
	});

	/* --------------------------------------------------------- photographs ---- */

	const photos = $derived(mediaOrder.map((id) => data.gallery.find((m) => m.id === id)).filter((m) => m !== undefined));
	function movePhoto(index: number, delta: number) {
		const to = index + delta;
		if (to < 0 || to >= mediaOrder.length) return;
		const next = [...mediaOrder];
		[next[index], next[to]] = [next[to], next[index]];
		mediaOrder = next;
	}

	/** Deleting takes the object out of the bucket as well as off the listing, so it
	 *  asks first. Held as the media id: the tiles it sits among are reorderable. */
	let confirmDeletePhoto = $state<string | null>(null);
	const photoToDelete = $derived(photos.find((p) => p.id === confirmDeletePhoto) ?? null);

	const maxMb = $derived(Math.round(data.maxUploadBytes / 1024 / 1024));

	/* ---------------------------------------------------------- readiness ---- */

	/**
	 * The requirements in the service's own words, each beside the step that answers it.
	 *
	 * `data.missing` stays the authority — assertPublishable recomputes it on every save,
	 * and anything it names that this map has not heard of is still shown, just without
	 * somewhere to send the vendor. The page never decides for itself what is ready.
	 */
	const REQUIREMENT_STEP: Record<string, StepKey> = {
		'a title': 'basics',
		'a short description': 'basics',
		'a duration of at least one day': 'basics',
		'a country': 'location',
		'at least one destination': 'location',
		'at least one itinerary day': 'itinerary',
		'a starting price': 'pricing',
		'a currency': 'pricing',
		'a main photo': 'media'
	};

	const checklist = $derived([
		...Object.entries(REQUIREMENT_STEP).map(([label, key]) => ({
			label,
			step: key as StepKey | null,
			done: !data.missing.includes(label)
		})),
		...data.missing
			.filter((m) => !(m in REQUIREMENT_STEP))
			.map((label) => ({ label, step: null as StepKey | null, done: false }))
	]);
	const gaps = $derived(checklist.filter((c) => !c.done));
	const met = $derived(checklist.length - gaps.length);
	const percent = $derived(Math.round((met / checklist.length) * 100));
	const ready = $derived(data.missing.length === 0);

	/** How many of a step's own requirements are still outstanding. Review has none of
	 *  its own, so it carries the whole listing's — it is the step that submits. */
	const stepGaps: Record<StepKey, number> = $derived.by(() => {
		const out = { basics: 0, location: 0, itinerary: 0, pricing: 0, media: 0, review: data.missing.length };
		for (const label of data.missing) {
			const key = REQUIREMENT_STEP[label];
			if (key && key !== 'review') out[key] += 1;
		}
		return out;
	});

	/**
	 * One sentence per step, so "did that land?" is never a guess.
	 *
	 * Unsaved outranks a past success: a step showing "Saved" over typing it has not
	 * been told about is the exact lie this indicator exists to prevent.
	 */
	function saveWord(key: StepKey): { text: string; tone: string; dot: string } {
		if (saved[key] === 'saving') return { text: 'Saving…', tone: 'text-slate-400', dot: 'bg-slate-300' };
		if (saved[key] === 'failed')
			return { text: 'Save failed — nothing was stored', tone: 'font-semibold text-danger', dot: 'bg-danger' };
		if (unsaved[key]) return { text: 'Unsaved changes', tone: 'font-semibold text-slate-700', dot: 'bg-warning' };
		if (saved[key] === 'saved') return { text: 'Saved', tone: 'font-semibold text-success', dot: 'bg-success' };
		return { text: 'All changes saved', tone: 'text-slate-400', dot: 'bg-slate-200' };
	}

	// The vendor half of the lifecycle, mirrored so the page offers only what is legal.
	// The service still decides — this only keeps a dead button off the screen.
	const canSubmit = $derived(['DRAFT', 'CHANGES_REQUESTED', 'UNPUBLISHED'].includes(data.tour.status));
	const canUnpublish = $derived(data.tour.status === 'PUBLISHED');
	const canArchive = $derived(!['PUBLISHED', 'ARCHIVED'].includes(data.tour.status));
	const canRestore = $derived(data.tour.status === 'ARCHIVED');

	/* ------------------------------------------------------------ preview ---- */

	/**
	 * The marketplace card, built from the composer rather than from the saved row.
	 *
	 * These are the same facts a traveller's tour card carries — hero, title, duration,
	 * price, country, places — so the question it answers is "what will this look like",
	 * which is only useful while it is still being written. The footer says plainly when
	 * what is drawn includes changes the marketplace has not been given yet.
	 */
	const hero = $derived(data.gallery.find((m) => m.id === heroMediaId) ?? null);
	const countryName = $derived(data.countries.find((c) => c.id === draft.primaryCountryId)?.name ?? null);
	const PRICING_WORDS: Record<string, string> = {
		PER_PERSON: 'per person',
		PER_GROUP: 'per group',
		FROM: 'starting from'
	};
	const duration = $derived.by(() => {
		const days = Number(draft.durationDays);
		if (!Number.isFinite(days) || days < 1) return null;
		const nights = Number(draft.durationNights);
		if (!draft.durationNights.trim() || !Number.isFinite(nights)) return plural(days, 'day');
		return `${plural(days, 'day')}, ${plural(nights, 'night')}`;
	});

	/* -------------------------------------------------------- step scroll ---- */

	let stepBar = $state<HTMLElement | null>(null);
	$effect(() => {
		// The nav scrolls sideways on a phone, and the step gets changed from the gap
		// chips and the Next buttons as often as from the nav itself — so whichever one
		// is current is brought into view rather than left off the end of the strip.
		stepBar?.querySelector(`[data-step="${step}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
	});
</script>

{#snippet saveBar(key: StepKey, label = 'Save')}
	{@const bar = saveWord(key)}
	{@const next = nextStep(key)}
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-200 px-4 py-3">
		<button class="btn-primary" disabled={!data.canWrite}>{label}</button>
		<span class="inline-flex items-center gap-1.5 text-xs {bar.tone}">
			<span class="h-1.5 w-1.5 shrink-0 rounded-full {bar.dot}"></span>
			{bar.text}
		</span>
		{#if next}
			<button type="button" class="btn-secondary ml-auto" onclick={() => (step = next.key)}>
				Next: {next.label}
			</button>
		{/if}
	</div>
{/snippet}

<svelte:head><title>{data.tour.title} · {data.tenant.name}</title></svelte:head>
<svelte:window onkeydown={(e) => {
		if (e.key === 'Escape') pendingUrl = null;
	}} />

<FormToast {form} successTitle="Listing saved" />

<div class="space-y-3">
	<div class="min-w-0">
		<a href="/app/tours" class="text-xs text-slate-400 hover:underline">← Tours</a>
		<h1 class="mt-0.5 truncate text-xl font-bold tracking-tight text-slate-900 sm:text-lg">
			{draft.title || data.tour.title}
		</h1>
	</div>

	<!-- The state of the thing, and what it means, before anything else on the page. A
	     status word on its own is a fact about the platform's queue; these two sentences
	     are what an operator needs in order to know whether to act. -->
	<section class="rounded-panel border p-4 {PANELS[data.tour.status] ?? 'border-slate-200 bg-slate-50'}">
		<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
			<span class="badge {TONES[data.tour.status] ?? 'bg-slate-100 text-slate-600'}">{statusLabel(data.tour.status)}</span>
			<h2 class="text-sm font-semibold text-slate-700">{meaning.means}</h2>
		</div>
		{#if meaning.next}
			<p class="mt-1 text-xs text-slate-500">
				<span class="font-semibold text-slate-600">What happens next:</span>
				{meaning.next}
			</p>
		{/if}
		{#if data.tour.publishedAt}
			<p class="mt-1 text-xs text-slate-400">Live since {fmtDate(data.tour.publishedAt)}.</p>
		{:else if data.tour.submittedAt}
			<p class="mt-1 text-xs text-slate-400">Sent for review on {fmtDate(data.tour.submittedAt)}.</p>
		{/if}

		<!-- The reviewer's note is the whole reason this listing came back, so it is the
		     loudest thing here: their words, at reading size, above everything the page
		     would otherwise be nagging about. -->
		{#if data.tour.status === 'CHANGES_REQUESTED'}
			<blockquote class="mt-3 border-l-2 border-danger/50 pl-3 text-base leading-6 whitespace-pre-line text-slate-800">
				{data.tour.reviewNote || 'No note was left. Ask the Makutano team what they need before sending it again.'}
			</blockquote>
			{#if data.canWrite}
				<div class="mt-3 flex flex-wrap gap-2">
					<button type="button" class="btn-primary" onclick={() => (step = 'basics')}>Start editing</button>
					<button type="button" class="btn-secondary" onclick={() => (step = 'review')}>Send it back for review</button>
				</div>
			{/if}
		{/if}

		<!-- Completeness, in the service's own words. Nine requirements, each one owned
		     by a step, so "what is missing" and "where do I fix it" are one click apart. -->
		<div class="mt-3 border-t border-slate-200 pt-3">
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
				<span class="text-xs font-semibold text-slate-600">
					{canSubmit ? 'Ready for review' : 'Marketplace requirements'}
				</span>
				<div
					class="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-slate-200"
					role="progressbar"
					aria-valuenow={met}
					aria-valuemin="0"
					aria-valuemax={checklist.length}
					aria-label="Requirements met"
				>
					<div
						class="h-full rounded-full transition-[width] duration-300 {ready ? 'bg-success' : 'bg-warning'}"
						style="width: {percent}%"
					></div>
				</div>
				<span class="text-xs font-semibold tabular-nums {ready ? 'text-success' : 'text-slate-600'}">
					{met} of {checklist.length}
				</span>
				{#if ready}
					<span class="text-xs text-slate-500">Everything the marketplace asks for is filled in.</span>
				{/if}
			</div>
			{#if gaps.length}
				<div class="mt-2 flex flex-wrap gap-1.5">
					{#each gaps as item (item.label)}
						{#if item.step}
							{@const target = item.step}
							<button
								type="button"
								class="badge gap-1 bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-brand-500"
								onclick={() => (step = target)}
							>
								Needs {item.label}
								<span class="text-slate-400">· {stepLabel.get(target)}</span>
							</button>
						{:else}
							<span class="badge bg-white text-slate-600 ring-1 ring-slate-200">Needs {item.label}</span>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	</section>

	{#if !data.canWrite}
		<p class="rounded-panel border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
			You can read this listing but not change it.
		</p>
	{/if}

	<!-- Named, not hinted at. Switching steps keeps everything, so this does not block —
	     but a step whose typing the marketplace has never been given must not be able to
	     go quiet just because the vendor scrolled past it. -->
	{#if unsavedSteps.length}
		<div class="rounded-panel border border-warning/40 bg-warning/5 px-3 py-2.5">
			<p class="text-xs font-semibold text-slate-700">
				Not saved yet: {unsavedNames}.
			</p>
			<p class="mt-0.5 text-xs text-slate-500">
				Moving between steps keeps it all. Reloading or leaving this page is what would drop it.
			</p>
			<div class="mt-2 flex flex-wrap gap-1.5">
				{#each unsavedSteps as s (s.key)}
					<button
						type="button"
						class="badge bg-white text-slate-600 ring-1 ring-warning/50 hover:ring-warning"
						onclick={() => (step = s.key)}
					>
						Go to {s.label}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Steps, not pages: switching one unmounts the others, and every field is bound
	     to `draft`, so nothing typed is lost by moving away and coming back. Six labels
	     do not fit across a phone, so the strip scrolls rather than wrapping into three
	     cramped rows. -->
	<nav
		bind:this={stepBar}
		aria-label="Composer steps"
		class="card flex gap-1 overflow-x-auto p-2 sm:flex-wrap sm:overflow-visible"
	>
		{#each STEPS as s, i (s.key)}
			{@const done = stepGaps[s.key] === 0}
			<button
				type="button"
				data-step={s.key}
				aria-current={step === s.key ? 'step' : undefined}
				class="flex shrink-0 items-center gap-1.5 rounded-panel px-3 py-1.5 text-xs font-medium whitespace-nowrap transition {step ===
				s.key
					? 'bg-brand-500 text-white'
					: 'text-slate-600 hover:bg-slate-100'}"
				onclick={() => (step = s.key)}
			>
				<!-- A tick where the number was, rather than a colour beside it: the number
				     is the only thing the step still needs to say once it is finished, and
				     amber on white is not a distinction anyone should have to see. -->
				{#if done}
					<svg
						viewBox="0 0 20 20"
						class="h-3.5 w-3.5 shrink-0 {step === s.key ? 'text-white' : 'text-success'}"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						aria-hidden="true"
					>
						<path d="m4 10 4 4 8-8" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
					<!-- "Nothing missing", not "finished": the tick means this step holds none
					     of what data.missing names, which is a smaller claim than done. -->
					<span class="sr-only">Nothing missing:</span>
				{:else}
					<span class="tabular-nums opacity-60">{i + 1}.</span>
					<span class="sr-only">Still incomplete:</span>
				{/if}
				{s.label}
				{#if unsaved[s.key]}
					<span class="h-1.5 w-1.5 shrink-0 rounded-full {step === s.key ? 'bg-white' : 'bg-warning'}"></span>
					<span class="sr-only">has unsaved changes</span>
				{/if}
			</button>
		{/each}
	</nav>

	<div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
		<div class="min-w-0 space-y-3">
			{#if step === 'basics'}
				<form method="POST" action="?/saveBasics" use:enhance={track('basics')} class="card">
					<div class="card-header"><h2 class="card-title">Basics</h2></div>
					<div class="grid gap-3 p-4 sm:grid-cols-2">
						<div class="sm:col-span-2">
							<label class="label" for="t-title">Title</label>
							<input id="t-title" name="title" bind:value={draft.title} class="input" placeholder="6-Day Northern Circuit Safari" />
						</div>
						<div class="sm:col-span-2">
							<label class="label" for="t-short">Short description</label>
							<input
								id="t-short"
								name="shortDescription"
								bind:value={draft.shortDescription}
								class="input"
								placeholder="One sentence a traveller reads before anything else."
							/>
						</div>
						<div class="sm:col-span-2">
							<label class="label" for="t-desc">Full description</label>
							<textarea id="t-desc" name="description" bind:value={draft.description} rows="6" class="input"></textarea>
						</div>
						<div>
							<label class="label" for="t-days">Days</label>
							<input id="t-days" name="durationDays" bind:value={draft.durationDays} inputmode="numeric" class="input" />
						</div>
						<div>
							<label class="label" for="t-nights">Nights</label>
							<input id="t-nights" name="durationNights" bind:value={draft.durationNights} inputmode="numeric" class="input" />
						</div>
						<div>
							<label class="label" for="t-category">Category</label>
							<select id="t-category" name="primaryCategoryId" bind:value={draft.primaryCategoryId} class="input">
								<option value="">Choose what this tour is…</option>
								{#each data.categories as c (c.id)}
									<option value={c.id}>{c.name}</option>
								{/each}
							</select>
							<p class="mt-1 text-xs text-slate-500">
								What the tour <em>is</em>. It decides which category page the listing appears on.
							</p>
						</div>
						<div>
							<label class="label" for="t-group">Group type</label>
							<input id="t-group" name="groupType" bind:value={draft.groupType} class="input" placeholder="Private, Small group, Family" />
						</div>
						<div>
							<label class="label" for="t-min">Smallest group</label>
							<input id="t-min" name="groupSizeMin" bind:value={draft.groupSizeMin} inputmode="numeric" class="input" />
						</div>
						<div>
							<label class="label" for="t-max">Largest group</label>
							<input id="t-max" name="groupSizeMax" bind:value={draft.groupSizeMax} inputmode="numeric" class="input" />
						</div>
						<div class="sm:col-span-2">
							<label class="label" for="t-age">Age requirement</label>
							<input id="t-age" name="ageRequirement" bind:value={draft.ageRequirement} class="input" placeholder="Minimum 8 years old" />
						</div>

						<!--
							The three facts a traveller checks first. Unticked means "not
							claimed" rather than "no", so the public page simply stays quiet
							about anything the operator has not affirmed.
						-->
						<div class="sm:col-span-2">
							<span class="label mb-0">Tour features</span>
							<p class="mb-2 mt-1 text-xs text-slate-500">
								Only tick what is true. Each one shows on the listing as a promise.
							</p>
							<div class="grid gap-2 sm:grid-cols-3">
								{#each FEATURES as f (f.key)}
									<label
										class="flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition
											{draft[f.key] ? 'border-emerald-600 bg-emerald-50/60' : 'border-slate-200 hover:border-slate-300'}"
									>
										<input
											type="checkbox"
											name={f.key}
											bind:checked={draft[f.key]}
											class="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
										/>
										<span class="min-w-0">
											<span class="block text-sm font-medium text-slate-900">{f.label}</span>
											<span class="mt-0.5 block text-xs text-slate-500">{f.hint}</span>
										</span>
									</label>
								{/each}
							</div>
						</div>

						<!--
							Travel styles: HOW the trip is experienced, as against what it is.
							Capped, and the cap is the point — a listing tagged with everything
							appears in every filter, which makes the filters useless for the
							vendor too, because travellers stop trusting them.
						-->
						<div class="sm:col-span-2">
							<div class="flex flex-wrap items-baseline justify-between gap-2">
								<span class="label mb-0">Travel styles</span>
								<span class="text-xs {styleLimitReached ? 'font-medium text-amber-700' : 'text-slate-500'}">
									{draft.travelStyleIds.length} of {data.maxTravelStyles} chosen
								</span>
							</div>
							<p class="mb-2 mt-1 text-xs text-slate-500">
								How it is experienced. Choose only the ones that genuinely describe this trip.
							</p>
							<div class="flex flex-wrap gap-2">
								{#each data.travelStyles as s (s.id)}
									{@const on = draft.travelStyleIds.includes(s.id)}
									<button
										type="button"
										class="rounded-full border px-3 py-1.5 text-sm transition
											{on
											? 'border-emerald-600 bg-emerald-600 text-white'
											: styleLimitReached
												? 'cursor-not-allowed border-slate-200 text-slate-300'
												: 'border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-50'}"
										aria-pressed={on}
										disabled={!on && styleLimitReached}
										title={s.shortDescription ?? s.name}
										onclick={() => toggleStyle(s.id)}
									>
										{s.name}
									</button>
								{/each}
							</div>
							{#each draft.travelStyleIds as id (id)}
								<input type="hidden" name="travelStyleIds" value={id} />
							{/each}
						</div>

						<!--
							A safari-and-Zanzibar itinerary genuinely is two categories. The
							primary one is submitted with the set by the server, so it is shown
							as already-on and cannot be turned off here.
						-->
						<div class="sm:col-span-2">
							<span class="label mb-0">Also appears under</span>
							<p class="mb-2 mt-1 text-xs text-slate-500">
								Optional. Only if the trip genuinely spans more than one category.
							</p>
							<div class="flex flex-wrap gap-2">
								{#each data.categories as c (c.id)}
									{@const isPrimary = c.id === draft.primaryCategoryId}
									{@const on = isPrimary || draft.categoryIds.includes(c.id)}
									<button
										type="button"
										class="rounded-full border px-3 py-1.5 text-sm transition
											{on
											? 'border-sky-600 bg-sky-600 text-white'
											: 'border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-50'}
											{isPrimary ? 'cursor-default opacity-90' : ''}"
										aria-pressed={on}
										disabled={isPrimary}
										title={isPrimary ? 'This is the primary category' : (c.shortDescription ?? c.name)}
										onclick={() => toggleCategory(c.id)}
									>
										{c.name}{isPrimary ? ' · primary' : ''}
									</button>
								{/each}
							</div>
							{#each draft.categoryIds as id (id)}
								<input type="hidden" name="categoryIds" value={id} />
							{/each}
						</div>
						<div>
							<label class="label" for="t-acc">Accommodation</label>
							<textarea id="t-acc" name="accommodationSummary" bind:value={draft.accommodationSummary} rows="3" class="input"></textarea>
						</div>
						<div>
							<label class="label" for="t-trans">Transport</label>
							<textarea id="t-trans" name="transportSummary" bind:value={draft.transportSummary} rows="3" class="input"></textarea>
						</div>
						<div>
							<label class="label" for="t-meals">Meals</label>
							<textarea id="t-meals" name="mealsSummary" bind:value={draft.mealsSummary} rows="3" class="input"></textarea>
						</div>
						<div>
							<label class="label" for="t-best">Best time to travel</label>
							<textarea id="t-best" name="bestTimeSummary" bind:value={draft.bestTimeSummary} rows="3" class="input"></textarea>
						</div>
					</div>
					{@render saveBar('basics')}
				</form>
			{/if}

			{#if step === 'location'}
				<form method="POST" action="?/saveLocation" use:enhance={track('location')} class="card">
					<div class="card-header"><h2 class="card-title">Location</h2></div>
					<div class="space-y-4 p-4">
						<div>
							<label class="label" for="t-country">Country</label>
							<select
								id="t-country"
								name="primaryCountryId"
								class="input sm:max-w-xs"
								value={draft.primaryCountryId}
								onchange={(e) => chooseCountry(e.currentTarget.value)}
							>
								<option value="">Choose a country…</option>
								{#each data.countries as country (country.id)}
									<option value={country.id}>{country.name}</option>
								{/each}
							</select>
							<p class="mt-1.5 text-xs text-slate-400">
								The country comes first — the places below are the ones the marketplace already
								publishes for it, and a listing can only visit its own country.
							</p>
						</div>

						{#if draft.primaryCountryId}
							<fieldset>
								<legend class="label">Places this tour visits</legend>
								{#if byCountry.length}
									<div class="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
										{#each byCountry as destination (destination.id)}
											<label
												class="flex cursor-pointer items-center gap-2 rounded-panel border px-3 py-2 text-sm transition {draft.destinationIds.includes(
													destination.id
												)
													? 'border-brand-500 bg-brand-50 text-slate-700'
													: 'border-slate-200 text-slate-600 hover:border-slate-300'}"
											>
												<input
													type="checkbox"
													name="destinationIds"
													value={destination.id}
													checked={draft.destinationIds.includes(destination.id)}
													onchange={() => toggleDestination(destination.id)}
												/>
												<span class="min-w-0 truncate">{destination.name}</span>
											</label>
										{/each}
									</div>
									{#if !draft.destinationIds.length}
										<p class="mt-2 text-xs text-slate-400">
											Nothing ticked yet. Tick every park, town or beach the tour actually stops at —
											these are what a traveller filters by, and each itinerary day names one of them.
										</p>
									{/if}
								{:else}
									<p class="text-xs text-slate-400">
										The marketplace has not published any destinations for this country yet. Ask the
										Makutano team to add the places you sell.
									</p>
								{/if}
							</fieldset>
						{:else}
							<p class="rounded-panel bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
								No country chosen yet. Pick the one this tour runs in and the places it can visit
								appear here — a listing sells inside a single country.
							</p>
						{/if}
					</div>
					{@render saveBar('location')}
				</form>
			{/if}

			{#if step === 'itinerary'}
				<form method="POST" action="?/saveItinerary" use:enhance={track('itinerary')} class="card">
					<div class="card-header">
						<h2 class="card-title">Itinerary</h2>
						<button type="button" class="btn-secondary" onclick={addDay} disabled={!data.canWrite}>Add a day</button>
					</div>
					<!-- The finished list, as one field. The days are reordered and renumbered in
					     the browser, so the browser is what knows the final shape; the server
					     renumbers 1..n from the order it receives. -->
					<input type="hidden" name="days" value={JSON.stringify(draft.days)} />

					<div class="space-y-3 p-4">
						<!-- Read off the days, never typed. Consecutive repeats collapse, so three
						     nights in the Serengeti read as one stop on the route. -->
						{#if route.length}
							<p class="rounded-panel bg-slate-50 px-3 py-2 text-sm text-slate-600">
								<span class="text-xs font-semibold text-slate-400 uppercase">Route</span><br />
								{route.join(' → ')}
							</p>
						{/if}

						{#if basemapFailed}
							<p class="rounded-panel bg-slate-50 px-3 py-2 text-sm text-slate-500">
								The route map could not be loaded. Everything else on this step still works.
							</p>
						{:else if draft.days.length}
							<RoutePlanner
								{basemap}
								{stops}
								{placingDay}
								onplace={placePin}
								onclear={clearPin}
								onstartplacing={(d) => (placingDay = d)}
							/>
						{/if}

						{#each draft.days as day, index (index)}
							<div class="rounded-panel border border-slate-200 p-3">
								<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
									<span class="text-xs font-semibold tracking-wide text-slate-400 uppercase">Day {index + 1}</span>
									{#if confirmRemoveDay === index}
										<div class="flex flex-wrap items-center gap-2">
											<span class="text-xs text-slate-500">Remove day {index + 1} and everything written on it?</span>
											<button type="button" class="btn-danger px-2 py-1 text-xs" onclick={() => removeDay(index)}>Yes, remove</button>
											<button type="button" class="btn-secondary px-2 py-1 text-xs" onclick={() => (confirmRemoveDay = null)}>Keep it</button>
										</div>
									{:else}
										<div class="flex gap-1">
											<button type="button" class="btn-secondary px-2 py-1 text-xs" onclick={() => moveDay(index, -1)} disabled={index === 0}>↑</button>
											<button
												type="button"
												class="btn-secondary px-2 py-1 text-xs"
												onclick={() => moveDay(index, 1)}
												disabled={index === draft.days.length - 1}>↓</button
											>
											<button
												type="button"
												class="btn-danger px-2 py-1 text-xs"
												onclick={() => (confirmRemoveDay = index)}
												disabled={!data.canWrite}>Remove</button
											>
										</div>
									{/if}
								</div>
								<div class="grid gap-3 sm:grid-cols-2">
									<div>
										<label class="label" for="d-title-{index}">Title</label>
										<input id="d-title-{index}" bind:value={day.title} class="input" placeholder="Arusha to Tarangire" />
									</div>
									<div>
										<label class="label" for="d-dest-{index}">Destination</label>
										<select id="d-dest-{index}" bind:value={day.destinationId} class="input">
											<option value="">No destination</option>
											{#each dayOptions as option (option.id)}
												<option value={option.id}>{option.label}</option>
											{/each}
										</select>
									</div>
									<div class="sm:col-span-2">
										<label class="label" for="d-desc-{index}">What happens</label>
										<textarea id="d-desc-{index}" bind:value={day.description} rows="3" class="input"></textarea>
									</div>
									<div class="sm:col-span-2">
										<label class="label" for="d-act-{index}">Activities (comma-separated)</label>
										<input id="d-act-{index}" bind:value={day.activities} class="input" placeholder="Game drive, Sundowner" />
									</div>
									<div>
										<label class="label" for="d-acc-{index}">Accommodation</label>
										<input id="d-acc-{index}" bind:value={day.accommodation} class="input" />
									</div>
									<div>
										<label class="label" for="d-meals-{index}">Meals</label>
										<input id="d-meals-{index}" bind:value={day.meals} class="input" placeholder="Breakfast, Lunch, Dinner" />
									</div>
									<div>
										<label class="label" for="d-dist-{index}">Distance</label>
										<input id="d-dist-{index}" bind:value={day.distance} class="input" placeholder="120 km" />
									</div>
									<div>
										<label class="label" for="d-time-{index}">Travel time</label>
										<input id="d-time-{index}" bind:value={day.estimatedTravelTime} class="input" placeholder="About 2 hours" />
									</div>
									{#if index > 0}
										<!--
											Only from day two: day one is arrival, and there is no
											previous stop to have travelled from. Six hours on the road
											and fifty minutes in a Cessna are not the same day, and the
											route map draws them differently.
										-->
										<div>
											<span class="label mb-0">How they get here</span>
											<div class="mt-1 inline-flex rounded-lg border border-slate-200 p-0.5">
												{#each TRAVEL_MODES as m (m.value)}
													<button
														type="button"
														class="rounded-md px-2.5 py-1 text-xs transition {day.travelMode === m.value
															? 'bg-slate-900 text-white'
															: 'text-slate-600 hover:bg-slate-50'}"
														aria-pressed={day.travelMode === m.value}
														onclick={() => (day.travelMode = day.travelMode === m.value ? null : m.value)}
													>
														{m.label}
													</button>
												{/each}
											</div>
											{#if !day.travelMode}
												<p class="mt-1 text-xs text-slate-400">Optional — left blank the map draws a neutral line.</p>
											{/if}
										</div>
									{/if}
								</div>
							</div>
						{:else}
							<div class="py-8 text-center">
								<p class="text-sm font-medium text-slate-700">No days yet.</p>
								<p class="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500">
									Add day one — arrival is usually the simplest place to start. Name the place each
									day stops at and the route across the top writes itself; a traveller reads this
									before they read anything else you have written.
								</p>
								{#if data.canWrite}
									<button type="button" class="btn-primary mt-4" onclick={addDay}>Add day one</button>
								{/if}
							</div>
						{/each}

						{#if !draft.destinationIds.length}
							<p class="text-xs text-slate-400">
								Choose the places this tour visits in <button type="button" class="text-brand-600 hover:underline" onclick={() => (step = 'location')}>Location</button>
								and each day can name one of them.
							</p>
						{/if}
					</div>
					{@render saveBar('itinerary')}
				</form>
			{/if}

			{#if step === 'pricing'}
				<form method="POST" action="?/savePricing" use:enhance={track('pricing')} class="card">
					<div class="card-header"><h2 class="card-title">Pricing</h2></div>
					<div class="grid gap-3 p-4 sm:grid-cols-3">
						<div>
							<label class="label" for="t-price">Price from</label>
							<input id="t-price" name="priceFrom" bind:value={draft.priceFrom} inputmode="decimal" class="input" placeholder="1850.00" />
						</div>
						<div>
							<label class="label" for="t-currency">Currency</label>
							<input id="t-currency" name="currency" bind:value={draft.currency} class="input uppercase" maxlength="3" placeholder="USD" />
						</div>
						<div>
							<label class="label" for="t-pricing">What the price means</label>
							<select id="t-pricing" name="pricingType" bind:value={draft.pricingType} class="input">
								<option value="PER_PERSON">Per person</option>
								<option value="PER_GROUP">Per group</option>
								<option value="FROM">Starting from</option>
							</select>
						</div>
						<p class="text-xs text-slate-400 sm:col-span-3">
							One starting price is all the marketplace shows. Departure dates, seasonal rates and
							availability are agreed with the traveller in the enquiry that follows.
						</p>
					</div>
					{@render saveBar('pricing')}
				</form>
			{/if}

			{#if step === 'media'}
				<div class="space-y-3">
					<div class="card">
						<div class="card-header"><h2 class="card-title">Add a photo</h2></div>
						{#if data.mediaConfigured}
							<form
								method="POST"
								action="?/uploadPhoto"
								enctype="multipart/form-data"
								use:enhance={trackUpload}
								class="flex flex-wrap items-end gap-2 p-4"
							>
								<label class="block">
									<span class="label">Photo</span>
									<input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/avif" class="input" />
								</label>
								<label class="block min-w-0 flex-1">
									<!-- Captured at upload: alt text belongs to the image, and there is no
									     service call that rewrites it afterwards. Replace the photo to change it. -->
									<span class="label">Describe it (for screen readers and search)</span>
									<input name="altText" class="input w-full" placeholder="Elephants crossing the Tarangire river" />
								</label>
								<button class="btn-primary" disabled={!data.canWrite}>Upload</button>
								<span
									class="text-xs {saved.upload === 'failed'
										? 'font-semibold text-danger'
										: saved.upload === 'saved'
											? 'font-semibold text-success'
											: 'text-slate-400'}"
								>
									{saved.upload === 'saving'
										? 'Uploading…'
										: saved.upload === 'saved'
											? 'Uploaded'
											: saved.upload === 'failed'
												? 'Upload failed — nothing was stored'
												: `JPEG, PNG, WebP or AVIF up to ${maxMb}MB.`}
								</span>
							</form>
						{:else}
							<p class="p-4 text-xs text-slate-500">
								Photo storage is not switched on for this deployment yet, so uploads are unavailable.
							</p>
						{/if}
					</div>

					<form method="POST" action="?/saveMedia" use:enhance={track('media')} class="card">
						<div class="card-header">
							<h2 class="card-title">Photos</h2>
							<span class="text-xs text-slate-400">The main photo is what the marketplace shows first.</span>
						</div>
						<input type="hidden" name="heroMediaId" value={heroMediaId} />
						<div class="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
							{#each photos as photo, index (photo.id)}
								<!-- The url, never the objectKey. -->
								<div class="overflow-hidden rounded-panel border {heroMediaId === photo.id ? 'border-brand-500' : 'border-slate-200'}">
									<input type="hidden" name="mediaIds" value={photo.id} />
									<img src={photo.url} alt={photo.altText ?? ''} class="h-36 w-full object-cover" />
									<div class="flex items-center justify-between gap-1 p-2">
										<button
											type="button"
											class="text-xs {heroMediaId === photo.id ? 'font-semibold text-brand-600' : 'text-slate-500 hover:underline'}"
											onclick={() => (heroMediaId = photo.id)}
										>
											{heroMediaId === photo.id ? 'Main photo' : 'Make main'}
										</button>
										<div class="flex gap-1">
											<button type="button" class="btn-secondary px-2 py-1 text-xs" onclick={() => movePhoto(index, -1)} disabled={index === 0}>←</button>
											<button
												type="button"
												class="btn-secondary px-2 py-1 text-xs"
												onclick={() => movePhoto(index, 1)}
												disabled={index === photos.length - 1}>→</button
											>
											<!-- Only ever opens the confirm below: deleting is not a nested form, and
											     it is not something to fold in beside a reorder arrow either. -->
											<button
												type="button"
												class="btn-danger px-2 py-1 text-xs"
												onclick={() => (confirmDeletePhoto = photo.id)}
												disabled={!data.canWrite}>Delete</button
											>
										</div>
									</div>
									{#if photo.altText}<p class="truncate px-2 pb-2 text-xs text-slate-400">{photo.altText}</p>{/if}
								</div>
							{:else}
								<div class="py-8 text-center sm:col-span-2 xl:col-span-3">
									<p class="text-sm font-medium text-slate-700">No photos yet.</p>
									<p class="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500">
										Upload one above and it becomes the main photo — the single image a traveller
										sees on the marketplace before they read a word of this. A listing cannot be
										sent for review without one.
									</p>
								</div>
							{/each}
						</div>
						{@render saveBar('media', 'Save order & main photo')}
					</form>

					{#if confirmDeletePhoto && data.canWrite}
						<div class="rounded-panel border border-danger/40 bg-danger/5 p-4">
							<h2 class="text-sm font-semibold text-danger">
								Delete {photoToDelete?.altText ? `“${photoToDelete.altText}”` : 'this photo'}?
							</h2>
							<p class="mt-1.5 text-sm text-slate-700">
								It comes off this listing and out of storage. There is no undo, and no copy kept.
							</p>
							<div class="mt-3 flex flex-wrap gap-2">
								<!-- Its own form, outside the one above: a form cannot be nested inside
								     another, and a delete has no business sharing a submit with a reorder. -->
								<form method="POST" action="?/deletePhoto" use:enhance={track('delete', () => (confirmDeletePhoto = null))}>
									<input type="hidden" name="mediaId" value={confirmDeletePhoto} />
									<button class="btn-danger">Yes, delete it</button>
								</form>
								<button type="button" class="btn-secondary" onclick={() => (confirmDeletePhoto = null)}>Keep it</button>
							</div>
							{#if saved.delete === 'failed'}
								<p class="mt-2 text-xs font-semibold text-danger">That did not go through — the photo is still here.</p>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			{#if step === 'review'}
				<div class="space-y-3">
					<div class="card">
						<div class="card-header">
							<h2 class="card-title">Before it goes to the marketplace team</h2>
							<span class="text-xs font-semibold tabular-nums {ready ? 'text-success' : 'text-slate-500'}">
								{met} of {checklist.length}
							</span>
						</div>
						<ul class="divide-y divide-slate-100">
							{#each checklist as item (item.label)}
								<li class="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
									{#if item.done}
										<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0 text-success" fill="none" stroke="currentColor" stroke-width="2">
											<path d="m4 10 4 4 8-8" stroke-linecap="round" stroke-linejoin="round" />
										</svg>
										<span class="text-slate-500">This listing has {item.label}.</span>
									{:else}
										<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0 text-danger" fill="none" stroke="currentColor" stroke-width="2">
											<circle cx="10" cy="10" r="7" />
											<path d="M10 6.5v4.5m0 2.5v.01" stroke-linecap="round" />
										</svg>
										<span class="font-medium text-slate-700">Still needs {item.label}.</span>
										{#if item.step}
											{@const target = item.step}
											<button type="button" class="text-xs text-brand-600 hover:underline" onclick={() => (step = target)}>
												Fix it in {stepLabel.get(target)}
											</button>
										{/if}
									{/if}
								</li>
							{/each}
						</ul>

						<!-- Submitting sends what the SERVER holds. A step still carrying unsaved
						     typing would be reviewed as it was before that typing, which is the one
						     way this page could waste a reviewer's day and the vendor's. -->
						{#if unsavedSteps.length}
							<p class="border-t border-slate-200 bg-warning/5 px-4 py-3 text-xs text-slate-600">
								<span class="font-semibold text-slate-700">{unsavedNames} still {unsavedSteps.length === 1 ? 'holds' : 'hold'} unsaved changes.</span>
								Send it now and the team reviews the saved version, not what is on your screen.
							</p>
						{/if}

						<div class="border-t border-slate-200 p-4">
							{#if canSubmit}
								<form method="POST" action="?/transition" use:enhance={track('submit')} class="flex flex-wrap items-center gap-3">
									<input type="hidden" name="action" value="submit" />
									<!-- Disabled while anything is missing: the service refuses on the same
									     list, so an enabled button here could only ever promise a rejection. -->
									<button class="btn-primary" disabled={!ready || !data.canWrite}>Submit for review</button>
									<span
										class="text-xs {saved.submit === 'failed'
											? 'font-semibold text-danger'
											: saved.submit === 'saved'
												? 'font-semibold text-success'
												: 'text-slate-400'}"
									>
										{saved.submit === 'saving'
											? 'Sending…'
											: saved.submit === 'saved'
												? 'Sent'
												: saved.submit === 'failed'
													? 'Could not send'
													: ready
														? 'The Makutano team reviews it and decides when it goes live.'
														: `Still ${plural(gaps.length, 'thing')} to fill in above.`}
									</span>
								</form>
							{:else}
								<p class="text-sm text-slate-600">
									{#if data.tour.status === 'SUBMITTED' || data.tour.status === 'IN_REVIEW'}
										This listing is with the Makutano team. You will see the outcome here.
									{:else if data.tour.status === 'APPROVED'}
										Approved. The Makutano team decides when it goes live on the marketplace.
									{:else if data.tour.status === 'PUBLISHED'}
										Live on the marketplace. Take it down below if it is no longer bookable.
									{:else}
										This listing is archived. Restore it to go on working on it.
									{/if}
								</p>
							{/if}
						</div>
					</div>

					{#if data.canWrite && (canUnpublish || canArchive || canRestore)}
						<div class="card p-4">
							<h2 class="card-title mb-1">Take it off the shelf</h2>
							<p class="mb-3 text-xs text-slate-400">
								Pulling your own listing is yours to do — a tour you cannot run should not stay
								bookable while somebody reviews the decision.
							</p>
							<div class="flex flex-wrap gap-2">
								{#if canUnpublish}
									<form method="POST" action="?/transition" use:enhance={track('lifecycle')}>
										<input type="hidden" name="action" value="unpublish" />
										<button class="btn-secondary">Take off the marketplace</button>
									</form>
								{/if}
								{#if canArchive}
									<form method="POST" action="?/transition" use:enhance={track('lifecycle')}>
										<input type="hidden" name="action" value="archive" />
										<button class="btn-secondary">Archive</button>
									</form>
								{/if}
								{#if canRestore}
									<form method="POST" action="?/transition" use:enhance={track('lifecycle')}>
										<input type="hidden" name="action" value="restore" />
										<button class="btn-primary">Restore to draft</button>
									</form>
								{/if}
							</div>
							{#if saved.lifecycle === 'failed'}
								<p class="mt-2 text-xs font-semibold text-danger">That did not go through.</p>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- The card a traveller scrolls past on the marketplace, drawn from the composer
		     rather than from the saved row: "what will this look like" is only a useful
		     question while it is still being written. Read-only, and it says so when what
		     it shows is ahead of what the marketplace has been given. On a phone it sits
		     under the step being edited; from xl it rides alongside it. -->
		<aside class="min-w-0 xl:sticky xl:top-[86px]">
			<div class="card overflow-hidden">
				<div class="card-header">
					<h2 class="card-title">What the traveller sees</h2>
					<span class="text-xs text-slate-400">Preview</span>
				</div>
				{#if hero}
					<img src={hero.url} alt={hero.altText ?? ''} class="h-40 w-full object-cover" />
				{:else}
					<div class="flex h-40 items-center justify-center bg-slate-50 px-6 text-center text-xs text-slate-400">
						No main photo yet — most of this card is the picture.
					</div>
				{/if}
				<div class="space-y-2 p-4">
					<p class="text-sm font-semibold text-slate-800">{draft.title.trim() || 'Untitled listing'}</p>
					{#if draft.shortDescription.trim()}
						<p class="text-xs leading-5 text-slate-500">{draft.shortDescription}</p>
					{/if}
					{#if duration || countryName}
						<p class="text-xs text-slate-500">
							{[duration, countryName].filter(Boolean).join(' · ')}
						</p>
					{/if}
					{#if draft.priceFrom.trim() && draft.currency.trim()}
						<p class="text-sm font-semibold text-slate-800">
							From <Money amount={draft.priceFrom} currency={draft.currency.trim().toUpperCase()} />
							<span class="text-xs font-normal text-slate-400">{PRICING_WORDS[draft.pricingType] ?? ''}</span>
						</p>
					{:else}
						<p class="text-xs text-slate-400">No price yet — the card shows a blank where the price goes.</p>
					{/if}
					{#if draft.destinationIds.length}
						<div class="flex flex-wrap gap-1">
							{#each draft.destinationIds as id (id)}
								<span class="badge bg-slate-100 text-slate-600">{destinationName.get(id) ?? 'Unknown place'}</span>
							{/each}
						</div>
					{/if}
					{#if route.length}
						<p class="text-xs leading-5 text-slate-500">
							<span class="font-semibold text-slate-400 uppercase">Route</span><br />
							{route.join(' → ')}
						</p>
					{/if}
				</div>
				<p class="border-t border-slate-200 px-4 py-2 text-xs text-slate-400">
					{#if unsavedSteps.length}
						Includes {plural(unsavedSteps.length, 'change')} you have not saved. The marketplace still has the older version.
					{:else}
						Drawn from this listing as saved. The real card also carries your operator name.
					{/if}
				</p>
			</div>
		</aside>
	</div>
</div>

<!-- The one exit that genuinely loses work: `draft` lives in this component, so a
     navigation away takes every unsaved paragraph with it. -->
{#if pendingUrl}
	<div class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
		<button class="absolute inset-0 cursor-default" onclick={() => (pendingUrl = null)} aria-label="Stay on this page" tabindex="-1"></button>
		<div class="relative z-10 w-full max-w-sm rounded-panel bg-white p-5 shadow-lg" role="dialog" aria-modal="true" aria-labelledby="leave-title">
			<h2 id="leave-title" class="text-sm font-semibold text-slate-800">Leave without saving?</h2>
			<p class="mt-1.5 text-sm text-slate-600">
				{unsavedNames} {unsavedSteps.length === 1 ? 'holds' : 'hold'} changes that exist only in this browser.
				Leaving this page drops them.
			</p>
			<div class="mt-4 flex flex-wrap gap-2">
				<button type="button" class="btn-primary flex-1" onclick={() => (pendingUrl = null)}>Stay and save</button>
				<button type="button" class="btn-danger flex-1" onclick={leaveAnyway}>Leave anyway</button>
			</div>
		</div>
	</div>
{/if}
