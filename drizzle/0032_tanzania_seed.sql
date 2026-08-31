-- The canonical Tanzania tourism directory, and the travel-style taxonomy.
--
-- SEED BROADLY, FEATURE SELECTIVELY. The directory knows the places a real
-- itinerary needs so a vendor can always find the right one; is_featured decides
-- the far smaller set the public sees as filters. Those are different questions
-- and the schema keeps them apart.
--
-- Deliberately NOT here: every village, waterfall, lodge and viewpoint. Smaller
-- places belong in a destination's highlights or an itinerary day, not as rows
-- that fragment the directory. Kilimanjaro's routes (Machame, Lemosho, Rongai…)
-- are ROUTES, not destinations, and belong to tour metadata.
--
-- Also not here: cultures. Maasai, Hadzabe and Datoga are peoples and
-- experiences, not geography, and making them destinations would be both a
-- modelling error and a distasteful one.
--
-- Everything is ON CONFLICT DO NOTHING on the slug, so re-running changes
-- nothing and anything an editor has since rewritten survives untouched.

/* ------------------------------------------------------------- destinations -- */

INSERT INTO "destinations" ("country_id","name","slug","destination_type","short_description","status","is_featured","sort_order")
SELECT c."id", v."name", v."slug", v."dtype", v."descr", 'PUBLISHED'::"content_status", v."feat", v."ord"
FROM (VALUES
	-- ── Northern circuit ────────────────────────────────────────────────────
	('Serengeti National Park','serengeti-national-park','NATIONAL_PARK','The migration, and the plains it crosses.',true,10),
	('Ngorongoro Conservation Area','ngorongoro-conservation-area','CONSERVATION_AREA','A collapsed caldera holding its own ecosystem, and the people who live alongside it.',true,20),
	('Tarangire National Park','tarangire-national-park','NATIONAL_PARK','Baobabs, and the largest elephant herds in the north.',true,40),
	('Lake Manyara National Park','lake-manyara-national-park','NATIONAL_PARK','A shallow soda lake under the Rift wall.',true,50),
	('Arusha National Park','arusha-national-park','NATIONAL_PARK','Meru''s forested foothills, close enough for a first or last day.',false,0),
	('Mkomazi National Park','mkomazi-national-park','NATIONAL_PARK','Dry country under the Pare mountains, with rhino and wild dog.',false,0),
	('Lake Natron','lake-natron','LAKE','A soda lake below Ol Doinyo Lengai, and East Africa''s flamingo breeding ground.',false,0),
	('Lake Eyasi','lake-eyasi','LAKE','A rift valley lake at the edge of the Serengeti ecosystem.',false,0),
	('Arusha','arusha','CITY','Where the northern circuit begins, and most journeys spend their first night.',false,0),
	('Moshi','moshi','CITY','The town under Kilimanjaro, and the usual base before a climb.',false,0),
	('Karatu','karatu','CITY','Farmland on the crater highlands, an overnight between parks.',false,0),

	-- ── Mountains and trekking ──────────────────────────────────────────────
	('Mount Kilimanjaro','mount-kilimanjaro','MOUNTAIN','The roof of Africa, walked up rather than climbed.',true,30),
	('Mount Meru','mount-meru','MOUNTAIN','Tanzania''s second mountain, and the best acclimatisation there is.',false,0),
	('Usambara Mountains','usambara-mountains','MOUNTAIN','Cloud forest and hill villages in the Eastern Arc.',false,0),
	('Udzungwa Mountains National Park','udzungwa-mountains-national-park','NATIONAL_PARK','Waterfalls and endemic primates, walked rather than driven.',false,0),
	('Kitulo National Park','kitulo-national-park','NATIONAL_PARK','The southern highlands plateau, and its orchids.',false,0),
	('Eastern Arc Mountains','eastern-arc-mountains','MOUNTAIN','An ancient forest chain with species found nowhere else.',false,0),

	-- ── Southern circuit ────────────────────────────────────────────────────
	('Nyerere National Park','nyerere-national-park','NATIONAL_PARK','The Rufiji river, and boat safaris instead of game drives.',true,60),
	('Ruaha National Park','ruaha-national-park','NATIONAL_PARK','Tanzania''s largest park, and its quietest.',true,70),
	('Mikumi National Park','mikumi-national-park','NATIONAL_PARK','Open floodplain within a day of Dar es Salaam.',true,80),
	-- Kept DISTINCT from Nyerere on purpose: the park was carved out of the
	-- reserve, but tours still sell them separately and merging them would lose
	-- that distinction permanently.
	('Selous Game Reserve','selous-game-reserve','GAME_RESERVE','The reserve surrounding Nyerere, still sold in its own right.',false,0),
	('Iringa','iringa','CITY','Highland town on the road to Ruaha.',false,0),
	('Morogoro','morogoro','CITY','Below the Uluguru mountains, on the southern road.',false,0),

	-- ── Western circuit ─────────────────────────────────────────────────────
	('Gombe National Park','gombe-national-park','NATIONAL_PARK','Forest above Lake Tanganyika, and the chimpanzees studied there since 1960.',false,0),
	('Mahale Mountains National Park','mahale-mountains-national-park','NATIONAL_PARK','Mountains meeting the lake, reached by boat.',false,0),
	('Katavi National Park','katavi-national-park','NATIONAL_PARK','Floodplain and hippo pools, with almost nobody there.',false,0),
	('Kigoma','kigoma','CITY','The lake port, and the way in to Gombe and Mahale.',false,0),
	('Lake Tanganyika','lake-tanganyika','LAKE','The second deepest lake on earth.',false,0),
	('Rubondo Island National Park','rubondo-island-national-park','NATIONAL_PARK','A forested island in Lake Victoria.',false,0),
	('Saanane Island National Park','saanane-island-national-park','NATIONAL_PARK','A small island park within sight of Mwanza.',false,0),
	('Mwanza','mwanza','CITY','The lake city, and the northern way into the Serengeti.',false,0),
	('Lake Victoria','lake-victoria','LAKE','Africa''s largest lake, along Tanzania''s northern edge.',false,0),

	-- ── North-western parks ─────────────────────────────────────────────────
	('Burigi-Chato National Park','burigi-chato-national-park','NATIONAL_PARK','Lakes and savanna in the north-west.',false,0),
	('Ibanda-Kyerwa National Park','ibanda-kyerwa-national-park','NATIONAL_PARK','Kagera river country on the Ugandan border.',false,0),
	('Rumanyika-Karagwe National Park','rumanyika-karagwe-national-park','NATIONAL_PARK','Rolling hills and wetland in Karagwe.',false,0),
	('Kigosi National Park','kigosi-national-park','NATIONAL_PARK','Miombo woodland and swamp in the west.',false,0),
	('Ugalla River National Park','ugalla-river-national-park','NATIONAL_PARK','River and woodland, among the least visited parks.',false,0),

	-- ── Coast ───────────────────────────────────────────────────────────────
	('Saadani National Park','saadani-national-park','NATIONAL_PARK','Where the bush meets the Indian Ocean.',false,0),
	('Dar es Salaam','dar-es-salaam','CITY','The largest city, and most arrivals.',false,0),
	('Bagamoyo','bagamoyo','HERITAGE_SITE','A caravan and slave-trade port, and its remains.',false,0),
	('Pangani','pangani','BEACH','A quiet river mouth and beaches north of Saadani.',false,0),
	('Tanga','tanga','CITY','The northern coastal city, near Amboni and the Usambaras.',false,0),
	('Kilwa','kilwa','CITY','The mainland base for the Kilwa heritage islands.',false,0),
	('Kilwa Kisiwani','kilwa-kisiwani','HERITAGE_SITE','A Swahili city-state in ruins, and a World Heritage site.',false,0),
	('Songo Mnara','songo-mnara','HERITAGE_SITE','The stone town on the island south of Kilwa Kisiwani.',false,0),

	-- ── Zanzibar archipelago ────────────────────────────────────────────────
	('Zanzibar','zanzibar','ISLAND','Reef, dhow and Stone Town.',true,15),
	('Stone Town','stone-town-zanzibar','HERITAGE_SITE','The old town of Zanzibar City, and a World Heritage site.',false,0),
	('Nungwi','nungwi','BEACH','The northern tip, where the tide never strands the swimming.',false,0),
	('Kendwa','kendwa','BEACH','Wide sand and sunsets, next along from Nungwi.',false,0),
	('Paje','paje','BEACH','The south-east kite-surfing coast.',false,0),
	('Jambiani','jambiani','BEACH','A long village beach south of Paje.',false,0),
	('Matemwe','matemwe','BEACH','The north-east coast, closest to Mnemba.',false,0),
	('Kiwengwa','kiwengwa','BEACH','East coast sand and reef.',false,0),
	('Michamvi','michamvi','BEACH','The peninsula between the east coast and Chwaka Bay.',false,0),
	('Jozani–Chwaka Bay','jozani-chwaka-bay','FOREST','Zanzibar''s forest park, and its red colobus.',false,0),
	('Prison Island','prison-island-changuu','ISLAND','Changuu, its quarantine history and its tortoises.',false,0),
	('Mnemba Atoll','mnemba','MARINE_AREA','The reef off Zanzibar''s north-east corner.',false,0),
	('Pemba Island','pemba-island','ISLAND','Clove country and steep reef, north of Unguja.',false,0),

	-- ── Marine ──────────────────────────────────────────────────────────────
	('Mafia Island','mafia-island','ISLAND','Whale sharks, reef and almost no crowds.',true,90),
	('Mafia Island Marine Park','mafia-island-marine-park','MARINE_AREA','The protected reef and channel around Mafia.',false,0),
	('Mnazi Bay–Ruvuma Estuary','mnazi-bay-ruvuma-estuary','MARINE_AREA','The far southern coast at the Mozambican border.',false,0),
	('Tanga Coelacanth Marine Park','tanga-coelacanth-marine-park','MARINE_AREA','Deep reef off Tanga, and the fish it is named for.',false,0),

	-- ── Cultural and heritage ───────────────────────────────────────────────
	('Kondoa Rock-Art Sites','kondoa-rock-art-sites','HERITAGE_SITE','Rock paintings on the Maasai escarpment, some thousands of years old.',false,0),
	('Mto wa Mbu','mto-wa-mbu','CULTURAL_AREA','A market town where many of Tanzania''s languages meet.',false,0),
	('Engaruka','engaruka','HERITAGE_SITE','The remains of a large irrigated farming settlement.',false,0),
	('Materuni','materuni','CULTURAL_AREA','Waterfalls and coffee farms on Kilimanjaro''s lower slopes.',false,0),

	-- ── Lakes and other ─────────────────────────────────────────────────────
	('Lake Duluti','lake-duluti','LAKE','A crater lake outside Arusha.',false,0),
	('Lake Chala','lake-chala','LAKE','A crater lake on the Kenyan border.',false,0),
	('Lake Jipe','lake-jipe','LAKE','A shallow border lake under the Pare mountains.',false,0),
	('Lake Rukwa','lake-rukwa','LAKE','A shifting salt lake in the south-west.',false,0),
	('Lake Nyasa','lake-nyasa-tanzania','LAKE','The Tanzanian shore of Lake Malawi.',false,0),

	-- ── Remaining cities ────────────────────────────────────────────────────
	('Dodoma','dodoma','CITY','The capital, in the centre of the country.',false,0),
	('Mbeya','mbeya','CITY','The southern highlands city, near Kitulo and Lake Nyasa.',false,0)
) AS v("name","slug","dtype","descr","feat","ord")
CROSS JOIN LATERAL (SELECT "id" FROM "countries" WHERE "slug" = 'tanzania') c
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

-- The featured set for rows that already existed before this seed ran.
UPDATE "destinations" SET "is_featured" = true, "sort_order" = v."ord"
FROM (VALUES
	('serengeti-national-park',10),('zanzibar',15),('ngorongoro-conservation-area',20),
	('mount-kilimanjaro',30),('tarangire-national-park',40),('lake-manyara-national-park',50),
	('nyerere-national-park',60),('ruaha-national-park',70),('mikumi-national-park',80),
	('mafia-island',90)
) AS v("slug","ord")
WHERE "destinations"."slug" = v."slug";--> statement-breakpoint

/* ----------------------------------------------------------- travel styles -- */

-- Deliberately small. A taxonomy a traveller can hold in their head beats one
-- that is technically exhaustive: fifty styles would each match a handful of
-- tours and none would help anybody choose.
INSERT INTO "travel_styles" ("name","slug","short_description","is_featured","sort_order") VALUES
	('Safari','safari','Game drives in Tanzania''s parks and reserves.',true,10),
	('Beach','beach','Zanzibar, Mafia and the mainland coast.',true,20),
	('Kilimanjaro & Trekking','trekking','Kilimanjaro, Meru and the mountain routes.',true,30),
	('Wildlife','wildlife','Trips built around particular animals and seasons.',true,40),
	('Cultural','cultural','Heritage sites, towns and the people who live there.',true,50),
	('Luxury','luxury','Small camps, private vehicles and quiet corners.',true,60),
	('Family','family','Paced and priced for travelling with children.',true,70),
	('Honeymoon','honeymoon','Safari and the coast, usually together.',true,80),
	('Adventure','adventure','Walking, paddling, cycling and camping.',false,90),
	('Photography','photography','Timed and positioned for the light.',false,100),
	('Private Tour','private-tour','Your own vehicle, guide and itinerary.',false,110),
	('Group Tour','group-tour','Joining a scheduled departure.',false,120),
	('Birding','birding','The Rift lakes, the Eastern Arc and the coast.',false,130),
	('Walking Safari','walking-safari','On foot with an armed guide.',false,140),
	('Marine & Diving','marine-diving','Reef, whale sharks and the marine parks.',false,150)
ON CONFLICT ("slug") DO NOTHING;
