-- The canonical countries and destinations the marketplace opens with.
--
-- Reference data belongs in a migration, not the seed script: the public site
-- reads it, so production needs it, and `db:seed` is a development convenience
-- nobody runs against production. Every insert is ON CONFLICT DO NOTHING keyed on
-- the slug, so re-running is a no-op and anything an editor has since changed is
-- left exactly as they changed it.
--
-- These are PLATFORM rows. Seeding them here is what stops the first vendor from
-- inventing "Serengeti NP" and fragmenting the marketplace.

INSERT INTO "countries" ("name","slug","iso_code","short_description","seo_title","seo_description") VALUES
	('Tanzania','tanzania','TZ',
	 'The northern circuit, the southern parks, Kilimanjaro and Zanzibar — most of East Africa''s best-known journeys start here.',
	 'Tanzania safaris and tours',
	 'Safaris, treks and beach journeys in Tanzania, run by licensed Tanzanian operators.'),
	('Kenya','kenya','KE',
	 'The Mara, the Rift Valley lakes, and a coast that has been trading for a thousand years.',
	 'Kenya safaris and tours',
	 'Safaris and tours in Kenya, run by licensed local operators.'),
	('Uganda','uganda','UG',
	 'Gorillas and chimpanzees in the west, the source of the Nile in the south.',
	 'Uganda gorilla trekking and safaris',
	 'Gorilla trekking, chimpanzee tracking and safaris in Uganda, run by licensed local operators.'),
	('Rwanda','rwanda','RW',
	 'Mountain gorillas in the Virungas, and one of the most walkable capitals on the continent.',
	 'Rwanda gorilla trekking and tours',
	 'Gorilla trekking and tours in Rwanda, run by licensed local operators.')
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

-- country_id is resolved BY SLUG rather than hardcoded: ids are generated, and this
-- file must stay re-runnable against a database that already holds the rows.
INSERT INTO "destinations" (
	"country_id","name","slug","destination_type","short_description",
	"best_time_summary","recommended_stay_min","recommended_stay_max","status",
	"seo_title","seo_description"
)
SELECT c."id", v."name", v."slug", v."dtype"::"destination_type", v."short_description",
       v."best_time", v."stay_min", v."stay_max", 'PUBLISHED'::"content_status",
       v."seo_title", v."seo_description"
FROM (VALUES
	-- Tanzania. Zanzibar is a DESTINATION under Tanzania, never a country.
	('tanzania','Serengeti','serengeti','NATIONAL_PARK',
	 'The migration, and the plains it crosses.','June – October',3,4,
	 'Serengeti safaris','Serengeti safaris and Great Migration tours run by licensed Tanzanian operators.'),
	('tanzania','Ngorongoro','ngorongoro','CONSERVATION_AREA',
	 'A collapsed caldera holding its own ecosystem.','June – October',1,2,
	 'Ngorongoro Crater tours','Ngorongoro Crater safaris run by licensed Tanzanian operators.'),
	('tanzania','Tarangire','tarangire','NATIONAL_PARK',
	 'Baobabs, and the largest elephant herds in the north.','June – October',1,2,
	 'Tarangire safaris','Tarangire National Park safaris run by licensed Tanzanian operators.'),
	('tanzania','Lake Manyara','lake-manyara','NATIONAL_PARK',
	 'A shallow soda lake under the Rift wall.','June – October',1,1,
	 'Lake Manyara safaris','Lake Manyara National Park safaris run by licensed Tanzanian operators.'),
	('tanzania','Kilimanjaro','kilimanjaro','MOUNTAIN',
	 'The roof of Africa, walked up rather than climbed.','January – March, June – October',6,9,
	 'Kilimanjaro treks','Kilimanjaro climbs on every route, run by licensed Tanzanian operators.'),
	('tanzania','Arusha','arusha','CITY',
	 'Where the northern circuit begins, and most journeys spend their first night.','Year round',1,1,
	 'Arusha tours and day trips','Arusha day trips and safari departures run by licensed Tanzanian operators.'),
	('tanzania','Zanzibar','zanzibar','ISLAND',
	 'Reef, dhow and Stone Town.','June – October, December – February',4,7,
	 'Zanzibar holidays','Zanzibar beach and culture journeys run by licensed Tanzanian operators.'),
	('tanzania','Nyerere National Park','nyerere','NATIONAL_PARK',
	 'The Rufiji river, and boat safaris instead of game drives.','June – October',2,3,
	 'Nyerere safaris','Nyerere National Park safaris and boat safaris run by licensed Tanzanian operators.'),
	('tanzania','Ruaha','ruaha','NATIONAL_PARK',
	 'Tanzania''s largest park, and its quietest.','June – October',2,3,
	 'Ruaha safaris','Ruaha National Park safaris run by licensed Tanzanian operators.'),
	-- Kenya
	('kenya','Masai Mara','masai-mara','GAME_RESERVE',
	 'The northern half of the migration''s circuit, at close quarters.','July – October',3,4,
	 'Masai Mara safaris','Masai Mara safaris run by licensed Kenyan operators.'),
	('kenya','Amboseli','amboseli','NATIONAL_PARK',
	 'Elephants, with Kilimanjaro behind them.','June – October, January – February',1,2,
	 'Amboseli safaris','Amboseli National Park safaris run by licensed Kenyan operators.'),
	('kenya','Tsavo','tsavo','NATIONAL_PARK',
	 'Red elephants and open country, on the road to the coast.','June – October',2,3,
	 'Tsavo safaris','Tsavo National Park safaris run by licensed Kenyan operators.'),
	('kenya','Nairobi','nairobi','CITY',
	 'A capital with a national park on its doorstep.','Year round',1,2,
	 'Nairobi tours and day trips','Nairobi day trips and safari departures run by licensed Kenyan operators.')
) AS v("country_slug","name","slug","dtype","short_description","best_time","stay_min","stay_max","seo_title","seo_description")
JOIN "countries" c ON c."slug" = v."country_slug"
ON CONFLICT ("slug") DO NOTHING;
