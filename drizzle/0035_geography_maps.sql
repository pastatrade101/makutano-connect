-- Maps: coordinates, the 31 regions, and a place for a route to live.
--
-- The marketplace renders its own maps from a basemap built out of the National
-- Bureau of Statistics district shapefile (see scripts/gis/README.md). No tile
-- provider and no API key, which is why the only thing the database needs to
-- carry is a POINT per destination -- the polygons are a static asset, not rows.
--
-- Coordinates were resolved from Wikidata, then from English Wikipedia for the
-- seven the first pass missed, and every one was checked against the region
-- polygons. Four are deliberate corrections rather than the published value:
--
--   lake-nyasa-tanzania       the published centroid is the WHOLE lake, at 12S,
--                             which is in Malawian water and outside Tanzania.
--   lake-victoria             likewise -- the lake's centre is nearer Uganda.
--   mnazi-bay-ruvuma-estuary  the published value is rounded to a whole degree
--                             and lands inland of Mtwara.
--   nyerere / selous          both publish the SAME point, because Nyerere was
--                             carved out of Selous in 2019. Two stacked pins
--                             hide one another, so they are separated along the
--                             axis that actually divides them: Nyerere is the
--                             northern half, the remaining reserve the southern.
--
-- Fourteen destinations sit on water or on small islands and fall outside every
-- land polygon. That is correct, not a defect -- a marine park has no district.
-- They take the nearest region, which is what a reader would say too.

/* ------------------------------------------------------------- coordinates -- */

ALTER TABLE "destinations" ADD COLUMN IF NOT EXISTS "latitude" numeric(9,6);
ALTER TABLE "destinations" ADD COLUMN IF NOT EXISTS "longitude" numeric(9,6);

-- The basemap region a destination sits in. Denormalised on purpose: it is the
-- join key between a database row and a static polygon, it never changes for a
-- fixed point, and every map query would otherwise walk up through parent_id.
ALTER TABLE "destinations" ADD COLUMN IF NOT EXISTS "map_region" text;

-- A region CONTAINS its parks and towns. Kept separate from map_region because
-- this is the browse hierarchy -- one day Zanzibar -> Stone Town -- while
-- map_region is strictly the polygon to paint.
-- SET NULL, not cascade: deleting a region must never delete the Serengeti.
ALTER TABLE "destinations" ADD COLUMN IF NOT EXISTS "parent_id" uuid
	REFERENCES "destinations"("id") ON DELETE SET NULL;

-- Half a coordinate is not a location; it is a bug that renders at the equator.
ALTER TABLE "destinations" DROP CONSTRAINT IF EXISTS "destinations_latlng_check";
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_latlng_check"
	CHECK (("latitude" IS NULL) = ("longitude" IS NULL));

-- REGION joins the place taxonomy. This is the change that would have been
-- impossible while destination_type was a pg enum -- Postgres refuses to USE a
-- new enum value in the transaction that adds it, and drizzle applies pending
-- migrations together. As text with a CHECK it is one line.
ALTER TABLE "destinations" DROP CONSTRAINT IF EXISTS "destinations_type_check";
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_type_check" CHECK ("destination_type" IN (
	'NATIONAL_PARK', 'GAME_RESERVE', 'CONSERVATION_AREA', 'MOUNTAIN', 'ISLAND',
	'BEACH', 'CITY', 'CULTURAL_AREA', 'LAKE', 'HERITAGE_SITE', 'FOREST',
	'MARINE_AREA', 'REGION', 'OTHER'
));

-- An itinerary day may stop somewhere that is not, and should not become, a
-- canonical destination -- a camp, a viewpoint, a river crossing. Seeding the
-- directory with those would fragment it, so a day may carry its own pin.
ALTER TABLE "tour_itinerary_days" ADD COLUMN IF NOT EXISTS "latitude" numeric(9,6);
ALTER TABLE "tour_itinerary_days" ADD COLUMN IF NOT EXISTS "longitude" numeric(9,6);
ALTER TABLE "tour_itinerary_days" DROP CONSTRAINT IF EXISTS "tour_itinerary_days_latlng_check";
ALTER TABLE "tour_itinerary_days" ADD CONSTRAINT "tour_itinerary_days_latlng_check"
	CHECK (("latitude" IS NULL) = ("longitude" IS NULL));

CREATE INDEX IF NOT EXISTS "destinations_parent_idx"
	ON "destinations" ("parent_id") WHERE "parent_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "destinations_map_region_idx"
	ON "destinations" ("map_region") WHERE "status" = 'PUBLISHED';

/* ----------------------------------------------------------------- regions -- */
--
-- The 31 regions, as destinations. Their coordinate is the centroid of the
-- region's largest ring, which is the same anchor the map labels with, so a pin
-- and its label can never disagree.
--
-- NOT featured: featuring an administrative region alongside the Serengeti would
-- be a category error in the filter bar. They are browsable, not promoted.

INSERT INTO "destinations"
	("country_id","name","slug","destination_type","short_description",
	 "status","is_featured","sort_order","latitude","longitude","map_region")
SELECT c."id", v."name", v."slug", 'REGION', v."descr",
       'PUBLISHED'::"content_status", false, v."ord", v."lat", v."lng", v."mapreg"
FROM (VALUES
	('Arusha Region','arusha-region','The gateway to the northern circuit, and where most safaris begin.',-2.95130,35.94300,'arusha',10),
	('Dar es Salaam Region','dar-es-salaam-region','The commercial capital, and the coast''s busiest gateway.',-6.88730,39.26270,'dar-es-salaam',20),
	('Dodoma Region','dodoma-region','The national capital, on the central plateau.',-5.92900,35.92220,'dodoma',30),
	('Geita Region','geita-region','Goldfields, and the woodlands of Burigi-Chato.',-3.31020,31.89970,'geita',40),
	('Iringa Region','iringa-region','Ruaha''s highlands, and the Isimila stone age site.',-7.80320,35.47590,'iringa',50),
	('Kagera Region','kagera-region','Hills facing Rwanda, and the western lakeshore.',-2.03240,31.18180,'kagera',60),
	('Pemba North Region','pemba-north-region','Clove plantations and the diving off Pemba''s northern reefs.',-5.04340,39.77220,'pemba-north',70),
	('Zanzibar North Region','zanzibar-north-region','Nungwi, Kendwa and the island''s northern beaches.',-5.92600,39.29130,'zanzibar-north',80),
	('Katavi Region','katavi-region','Remote floodplain wilderness in the far west.',-6.38730,31.34650,'katavi',90),
	('Kigoma Region','kigoma-region','Gombe, Mahale, and the Lake Tanganyika shore.',-4.58990,30.56170,'kigoma',100),
	('Kilimanjaro Region','kilimanjaro-region','The roof of Africa, and the towns that climb it.',-3.76250,37.64060,'kilimanjaro',110),
	('Pemba South Region','pemba-south-region','Deep-channel diving and the island''s southern villages.',-5.31330,39.74280,'pemba-south',120),
	('Zanzibar South Region','zanzibar-south-region','Jozani forest and the quieter east-coast villages.',-6.24050,39.42420,'zanzibar-south',130),
	('Lindi Region','lindi-region','Kilwa''s ruins, and a coast that stayed undeveloped.',-9.48350,38.40210,'lindi',140),
	('Manyara Region','manyara-region','Rift valley lakes and baobab country between the northern parks.',-4.53580,36.54870,'manyara',150),
	('Mara Region','mara-region','The Tanzanian Serengeti, and the river crossings the migration is known for.',-1.85520,34.39660,'mara',160),
	('Mbeya Region','mbeya-region','Highland crater lakes and the Kitulo plateau.',-8.16050,33.75760,'mbeya',170),
	('Zanzibar Urban West Region','zanzibar-urban-west-region','Stone Town and the island''s harbour.',-6.16920,39.24920,'zanzibar-urban-west',180),
	('Morogoro Region','morogoro-region','Mikumi, Udzungwa and the Uluguru mountains.',-7.92240,36.98910,'morogoro',190),
	('Mtwara Region','mtwara-region','The Makonde plateau, Mnazi bay and the far south coast.',-10.77800,39.11330,'mtwara',200),
	('Mwanza Region','mwanza-region','The lake city, and the rocks and islands around it.',-2.90100,33.20180,'mwanza',210),
	('Njombe Region','njombe-region','Tea and forest across the southern highlands.',-9.45210,34.71490,'njombe',220),
	('Pwani Region','pwani-region','Bagamoyo, Saadani, and the mainland shore facing Zanzibar.',-7.23850,38.62330,'pwani',230),
	('Rukwa Region','rukwa-region','The Rukwa valley, and the approaches to Katavi.',-7.98700,31.40910,'rukwa',240),
	('Ruvuma Region','ruvuma-region','The Mozambique border, and Selous'' southern reach.',-10.72600,36.25210,'ruvuma',250),
	('Shinyanga Region','shinyanga-region','Cotton country south of Lake Victoria.',-3.75420,32.93700,'shinyanga',260),
	('Simiyu Region','simiyu-region','The Serengeti''s southern boundary.',-3.04330,34.29340,'simiyu',270),
	('Singida Region','singida-region','Rock formations and lakes on the central plateau.',-5.74780,34.49600,'singida',280),
	('Songwe Region','songwe-region','Border highlands above Lake Rukwa''s southern shore.',-8.35750,32.72550,'songwe',290),
	('Tabora Region','tabora-region','Miombo woodland, and the old caravan crossroads.',-5.26600,32.82230,'tabora',300),
	('Tanga Region','tanga-region','The Usambara mountains, Amboni caves and a working port.',-5.21950,38.27700,'tanga',310)
) AS v("name","slug","descr","lat","lng","mapreg","ord")
CROSS JOIN (SELECT "id" FROM "countries" WHERE "slug" = 'tanzania') c
ON CONFLICT ("slug") DO NOTHING;

/* ------------------------------------------------- destination coordinates -- */
--
-- Only where none is set: a coordinate an editor has since corrected by hand
-- outranks anything this migration knows.

UPDATE "destinations" d
SET "latitude" = v."lat", "longitude" = v."lng", "map_region" = v."reg"
FROM (VALUES
	('arusha',-3.36667,36.68333,'arusha'),
	('arusha-national-park',-3.25000,36.83333,'arusha'),
	('bagamoyo',-6.43333,38.90000,'pwani'),
	('burigi-chato-national-park',-2.30920,31.17100,'kagera'),
	('dar-es-salaam',-6.81611,39.28028,'dar-es-salaam'),
	('dodoma',-6.18350,35.74600,'dodoma'),
	('eastern-arc-mountains',-6.00000,36.00000,'dodoma'),
	('engaruka',-2.98300,35.95000,'arusha'),
	('gombe-national-park',-4.66667,29.63333,'kigoma'),
	('ibanda-kyerwa-national-park',-1.18333,30.56667,'kagera'),
	('iringa',-7.77000,35.69000,'iringa'),
	('jambiani',-6.31667,39.55000,'zanzibar-south'),
	('jozani-chwaka-bay',-6.26667,39.41667,'zanzibar-south'),
	('karatu',-3.33333,35.66667,'arusha'),
	('katavi-national-park',-6.91667,31.33333,'katavi'),
	('kendwa',-5.75375,39.29061,'zanzibar-north'),
	('kigoma',-5.00000,30.00000,'kigoma'),
	('kigosi-national-park',-3.89000,31.82000,'geita'),
	('kilwa',-9.00000,39.00000,'lindi'),
	('kilwa-kisiwani',-8.98173,39.51722,'lindi'),
	('kitulo-national-park',-9.01667,33.85000,'njombe'),
	('kiwengwa',-5.98547,39.37559,'zanzibar-north'),
	('kondoa-rock-art-sites',-4.72444,35.83389,'dodoma'),
	('lake-chala',-3.31667,37.70000,'kilimanjaro'),
	('lake-duluti',-3.38333,36.78333,'arusha'),
	('lake-eyasi',-3.66667,35.08333,'arusha'),
	('lake-jipe',-3.60694,37.76167,'kilimanjaro'),
	('lake-manyara-national-park',-3.50000,35.83333,'arusha'),
	('lake-natron',-2.41667,36.00000,'arusha'),
	('lake-nyasa-tanzania',-10.35000,34.40000,'njombe'),
	('lake-rukwa',-8.00000,32.35000,'songwe'),
	('lake-tanganyika',-6.10000,29.50000,'kigoma'),
	('lake-victoria',-2.10000,32.90000,'mwanza'),
	('mafia-island',-7.85000,39.78333,'pwani'),
	('mafia-island-marine-park',-7.75194,39.90028,'pwani'),
	('mahale-mountains-national-park',-6.26667,29.93333,'kigoma'),
	('matemwe',-5.86667,39.35000,'zanzibar-north'),
	('materuni',-3.25510,37.40303,'kilimanjaro'),
	('mbeya',-8.90000,33.45000,'mbeya'),
	('michamvi',-6.14182,39.49212,'zanzibar-south'),
	('mikumi-national-park',-7.35000,37.15000,'morogoro'),
	('mkomazi-national-park',-4.29944,38.38944,'tanga'),
	('mnazi-bay-ruvuma-estuary',-10.35000,40.35000,'mtwara'),
	('mnemba',-5.82056,39.38389,'zanzibar-north'),
	('morogoro',-8.00000,37.00000,'morogoro'),
	('moshi',-3.33488,37.34038,'kilimanjaro'),
	('mount-kilimanjaro',-3.06667,37.35917,'kilimanjaro'),
	('mount-meru',-3.24678,36.76025,'arusha'),
	('mto-wa-mbu',-3.37326,35.85302,'arusha'),
	('mwanza',-2.51667,32.90000,'mwanza'),
	('ngorongoro-conservation-area',-3.21000,35.46000,'arusha'),
	('nungwi',-5.72600,39.29600,'zanzibar-north'),
	('nyerere-national-park',-8.60000,37.80000,'lindi'),
	('paje',-6.26652,39.53381,'zanzibar-south'),
	('pangani',-5.40000,38.98333,'tanga'),
	('pemba-island',-5.21667,39.73333,'pemba-south'),
	('prison-island-changuu',-6.11939,39.16557,'zanzibar-urban-west'),
	('ruaha-national-park',-7.53111,34.63694,'iringa'),
	('rubondo-island-national-park',-2.30000,31.83333,'geita'),
	('rumanyika-karagwe-national-park',-1.19100,30.77580,'kagera'),
	('saadani-national-park',-6.00000,38.75000,'pwani'),
	('saanane-island-national-park',-2.54436,32.88972,'mwanza'),
	('selous-game-reserve',-9.50000,37.40000,'lindi'),
	('serengeti-national-park',-2.40000,34.60000,'mara'),
	('songo-mnara',-9.03942,39.55170,'lindi'),
	('stone-town-zanzibar',-6.16494,39.19879,'zanzibar-urban-west'),
	('tanga',-5.00000,38.25000,'tanga'),
	('tanga-coelacanth-marine-park',-5.22300,39.13300,'tanga'),
	('tarangire-national-park',-4.00000,35.97861,'manyara'),
	('udzungwa-mountains-national-park',-7.80000,36.68333,'iringa'),
	('ugalla-river-national-park',-6.17000,32.00000,'katavi'),
	('usambara-mountains',-4.80000,38.42000,'tanga'),
	('zanzibar',-5.90000,39.30000,'zanzibar-north')
) AS v("slug","lat","lng","reg")
WHERE d."slug" = v."slug" AND d."latitude" IS NULL;

/* --------------------------------------------------------------- parentage -- */
--
-- Derived from map_region rather than written as a second list of pairs, so the
-- two can never drift apart.

UPDATE "destinations" d
SET "parent_id" = r."id"
FROM "destinations" r
WHERE r."destination_type" = 'REGION'
  AND r."map_region" = d."map_region"
  AND d."destination_type" <> 'REGION'
  AND d."parent_id" IS NULL;
