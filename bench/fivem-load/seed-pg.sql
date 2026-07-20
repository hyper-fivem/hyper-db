-- Mock database of a very large FiveM server — PostgreSQL 18 dialect.
-- 1M registered players, 20M inventory rows, 1.2M owned vehicles.
-- Deterministic lookup keys so the load generator can address rows without
-- reading first: identifier = 'license:' || md5(id::text),
--                plate      = upper(lpad(to_hex(vehicle_id), 8, '0')).
\timing on
set maintenance_work_mem = '1GB';

drop table if exists inventory_items, owned_vehicles, players cascade;

create table players (
  id         bigint primary key,
  identifier varchar(60) not null,
  name       varchar(40) not null,
  job        varchar(20) not null,
  job_grade  int not null,
  cash       int not null,
  bank       int not null,
  position   jsonb not null,
  skin       jsonb not null,
  metadata   jsonb not null,
  last_seen  timestamptz not null
);

create table inventory_items (
  id       bigint generated always as identity,
  owner    bigint not null,
  item     varchar(40) not null,
  count    int not null,
  slot     int not null,
  metadata jsonb not null
);

create table owned_vehicles (
  id     bigint primary key,
  owner  bigint not null,
  plate  varchar(8) not null,
  model  varchar(40) not null,
  props  jsonb not null,
  stored boolean not null,
  garage varchar(30) not null
);

insert into players
select i,
       'license:' || md5(i::text),
       'Player_' || i,
       (array['unemployed','police','ambulance','mechanic','taxi','gang'])[1 + (i % 6)],
       i % 5,
       (random() * 5000)::int,
       (random() * 500000)::int,
       jsonb_build_object('x', (random()*8000-4000)::numeric(8,2), 'y', (random()*8000-4000)::numeric(8,2),
                          'z', (random()*100)::numeric(6,2), 'heading', (random()*360)::numeric(5,1)),
       jsonb_build_object(
         'model', case when i % 2 = 0 then 'mp_m_freemode_01' else 'mp_f_freemode_01' end,
         'face', jsonb_build_object('father', (random()*45)::int, 'mother', (random()*45)::int, 'mix', round(random()::numeric, 2)),
         'hair', jsonb_build_object('style', (random()*80)::int, 'color', (random()*60)::int, 'highlight', (random()*60)::int),
         'mask',   jsonb_build_object('drawable', (random()*200)::int, 'texture', (random()*10)::int),
         'torso',  jsonb_build_object('drawable', (random()*400)::int, 'texture', (random()*10)::int),
         'legs',   jsonb_build_object('drawable', (random()*150)::int, 'texture', (random()*10)::int),
         'shoes',  jsonb_build_object('drawable', (random()*100)::int, 'texture', (random()*10)::int),
         'undershirt', jsonb_build_object('drawable', (random()*180)::int, 'texture', (random()*10)::int),
         'accessory',  jsonb_build_object('drawable', (random()*150)::int, 'texture', (random()*10)::int),
         'armor',  jsonb_build_object('drawable', (random()*50)::int, 'texture', (random()*4)::int),
         'hat',    jsonb_build_object('drawable', (random()*160)::int, 'texture', (random()*10)::int),
         'glasses',jsonb_build_object('drawable', (random()*40)::int, 'texture', (random()*10)::int),
         'watch',  jsonb_build_object('drawable', (random()*30)::int, 'texture', (random()*5)::int),
         'overlays', jsonb_build_object('beard', (random()*28)::int, 'eyebrows', (random()*33)::int,
                                        'blush', (random()*6)::int, 'lipstick', (random()*9)::int,
                                        'ageing', (random()*14)::int, 'makeup', (random()*74)::int)
       ),
       jsonb_build_object('level', (random()*100)::int, 'xp', (random()*100000)::int,
                          'clan', 'clan' || (i % 50), 'vip', random() < 0.05,
                          'hunger', (random()*100)::int, 'thirst', (random()*100)::int,
                          'stress', (random()*100)::int, 'licenses', jsonb_build_array('driver')),
       now() - (random() * interval '90 days')
from generate_series(1, 1000000) i;

-- 20 slots per player, ~1 in 7 items carries metadata (weapons/valuables)
insert into inventory_items (owner, item, count, slot, metadata)
select 1 + ((i - 1) / 20),
       (array['bread','water','bandage','medkit','phone','radio','lockpick','weapon_pistol','ammo_9mm','repairkit',
              'fishingrod','fish','burger','cola','joint','goldbar','diamond','iron','plastic','screwdriver'])[1 + (i % 20)],
       1 + (random() * 10)::int,
       1 + ((i - 1) % 20),
       case when i % 7 = 0
            then jsonb_build_object('durability', (random()*100)::int, 'serial', md5(i::text))
            else '{}'::jsonb end
from generate_series(1, 10000000) i;

insert into inventory_items (owner, item, count, slot, metadata)
select 1 + ((i - 1) / 20),
       (array['bread','water','bandage','medkit','phone','radio','lockpick','weapon_pistol','ammo_9mm','repairkit',
              'fishingrod','fish','burger','cola','joint','goldbar','diamond','iron','plastic','screwdriver'])[1 + (i % 20)],
       1 + (random() * 10)::int,
       1 + ((i - 1) % 20),
       case when i % 7 = 0
            then jsonb_build_object('durability', (random()*100)::int, 'serial', md5(i::text))
            else '{}'::jsonb end
from generate_series(10000001, 20000000) i;

insert into owned_vehicles
select i,
       1 + (i % 1000000),
       upper(lpad(to_hex(i), 8, '0')),
       (array['sultan','elegy','kuruma','dominator','futo','blista','baller','zentorno','t20','adder','bati','sanchez'])[1 + (i % 12)],
       jsonb_build_object(
         'engine', (random()*4)::int, 'brakes', (random()*3)::int, 'transmission', (random()*3)::int,
         'suspension', (random()*4)::int, 'armor', (random()*5)::int, 'turbo', random() < 0.5,
         'colorPrimary', (random()*160)::int, 'colorSecondary', (random()*160)::int,
         'pearlescent', (random()*160)::int, 'wheels', (random()*12)::int, 'wheelColor', (random()*160)::int,
         'windowTint', (random()*6)::int, 'neon', jsonb_build_array(random()<0.2, random()<0.2, random()<0.2, random()<0.2),
         'neonColor', jsonb_build_array((random()*255)::int, (random()*255)::int, (random()*255)::int),
         'plateIndex', (random()*5)::int, 'fuelLevel', (random()*100)::numeric(5,1),
         'bodyHealth', (900 + random()*100)::numeric(6,1), 'engineHealth', (900 + random()*100)::numeric(6,1),
         'extras', jsonb_build_object('1', random()<0.5, '2', random()<0.5),
         'livery', (random()*5)::int, 'xenonColor', (random()*13)::int
       ),
       random() < 0.7,
       (array['legion','pillbox','paleto','sandy','airport','docks'])[1 + (i % 6)]
from generate_series(1, 1200000) i;

-- Indexes AFTER bulk load. PG 18 features used deliberately:
--   covering unique (INCLUDE), partial index, GIN, desc btree for top-N.
alter table inventory_items add primary key (id);
create unique index players_identifier on players (identifier);
create index players_bank on players (bank desc);
create index players_metadata on players using gin (metadata jsonb_path_ops);
create unique index inventory_owner_slot on inventory_items (owner, slot) include (item, count);
create index inventory_item on inventory_items (item);
create unique index vehicles_plate on owned_vehicles (plate);
create index vehicles_owner on owned_vehicles (owner);
create index vehicles_out on owned_vehicles (owner) where not stored;

vacuum analyze players, inventory_items, owned_vehicles;

select 'players' t, count(*), pg_size_pretty(pg_total_relation_size('players')) from players
union all select 'inventory_items', count(*), pg_size_pretty(pg_total_relation_size('inventory_items')) from inventory_items
union all select 'owned_vehicles', count(*), pg_size_pretty(pg_total_relation_size('owned_vehicles')) from owned_vehicles;
