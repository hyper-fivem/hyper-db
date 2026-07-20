-- Mock database of a very large FiveM server — MariaDB 11.4 dialect.
-- Mirrors seed-pg.sql: 1M players, 20M inventory rows, 1.2M vehicles.
-- Uses the SEQUENCE engine (seq_1_to_N). Inventory loads in 1M-row batches
-- to keep transactions inside redo/undo comfort.
drop table if exists inventory_items;
drop table if exists owned_vehicles;
drop table if exists players;

create table players (
  id         bigint primary key,
  identifier varchar(60) not null,
  name       varchar(40) not null,
  job        varchar(20) not null,
  job_grade  int not null,
  cash       int not null,
  bank       int not null,
  position   json not null,
  skin       json not null,
  metadata   json not null,
  last_seen  timestamp not null
) engine=innodb;

create table inventory_items (
  id       bigint auto_increment primary key,
  owner    bigint not null,
  item     varchar(40) not null,
  count    int not null,
  slot     int not null,
  metadata json not null
) engine=innodb;

create table owned_vehicles (
  id     bigint primary key,
  owner  bigint not null,
  plate  varchar(8) not null,
  model  varchar(40) not null,
  props  json not null,
  stored tinyint(1) not null,
  garage varchar(30) not null
) engine=innodb;

insert into players
select seq,
       concat('license:', md5(seq)),
       concat('Player_', seq),
       elt(1 + (seq % 6), 'unemployed','police','ambulance','mechanic','taxi','gang'),
       seq % 5,
       floor(rand() * 5000),
       floor(rand() * 500000),
       json_object('x', round(rand()*8000-4000, 2), 'y', round(rand()*8000-4000, 2),
                   'z', round(rand()*100, 2), 'heading', round(rand()*360, 1)),
       json_object(
         'model', if(seq % 2 = 0, 'mp_m_freemode_01', 'mp_f_freemode_01'),
         'face', json_object('father', floor(rand()*45), 'mother', floor(rand()*45), 'mix', round(rand(), 2)),
         'hair', json_object('style', floor(rand()*80), 'color', floor(rand()*60), 'highlight', floor(rand()*60)),
         'mask',   json_object('drawable', floor(rand()*200), 'texture', floor(rand()*10)),
         'torso',  json_object('drawable', floor(rand()*400), 'texture', floor(rand()*10)),
         'legs',   json_object('drawable', floor(rand()*150), 'texture', floor(rand()*10)),
         'shoes',  json_object('drawable', floor(rand()*100), 'texture', floor(rand()*10)),
         'undershirt', json_object('drawable', floor(rand()*180), 'texture', floor(rand()*10)),
         'accessory',  json_object('drawable', floor(rand()*150), 'texture', floor(rand()*10)),
         'armor',  json_object('drawable', floor(rand()*50), 'texture', floor(rand()*4)),
         'hat',    json_object('drawable', floor(rand()*160), 'texture', floor(rand()*10)),
         'glasses',json_object('drawable', floor(rand()*40), 'texture', floor(rand()*10)),
         'watch',  json_object('drawable', floor(rand()*30), 'texture', floor(rand()*5)),
         'overlays', json_object('beard', floor(rand()*28), 'eyebrows', floor(rand()*33),
                                 'blush', floor(rand()*6), 'lipstick', floor(rand()*9),
                                 'ageing', floor(rand()*14), 'makeup', floor(rand()*74))
       ),
       json_object('level', floor(rand()*100), 'xp', floor(rand()*100000),
                   'clan', concat('clan', seq % 50), 'vip', rand() < 0.05,
                   'hunger', floor(rand()*100), 'thirst', floor(rand()*100),
                   'stress', floor(rand()*100), 'licenses', json_array('driver')),
       now() - interval floor(rand() * 90 * 86400) second
from seq_1_to_1000000;

-- inventory in 1M-row batches (20 batches)
delimiter //
create or replace procedure seed_inventory()
begin
  declare b int default 0;
  while b < 20 do
    insert into inventory_items (owner, item, count, slot, metadata)
    select 1 + ((seq - 1) div 20),
           elt(1 + (seq % 20), 'bread','water','bandage','medkit','phone','radio','lockpick','weapon_pistol','ammo_9mm','repairkit',
                               'fishingrod','fish','burger','cola','joint','goldbar','diamond','iron','plastic','screwdriver'),
           1 + floor(rand() * 10),
           1 + ((seq - 1) % 20),
           if(seq % 7 = 0,
              json_object('durability', floor(rand()*100), 'serial', md5(seq)),
              json_object())
    from seq_1_to_20000000
    where seq > b * 1000000 and seq <= (b + 1) * 1000000;
    set b = b + 1;
  end while;
end//
delimiter ;
call seed_inventory();
drop procedure seed_inventory;

insert into owned_vehicles
select seq,
       1 + (seq % 1000000),
       upper(lpad(hex(seq), 8, '0')),
       elt(1 + (seq % 12), 'sultan','elegy','kuruma','dominator','futo','blista','baller','zentorno','t20','adder','bati','sanchez'),
       json_object(
         'engine', floor(rand()*4), 'brakes', floor(rand()*3), 'transmission', floor(rand()*3),
         'suspension', floor(rand()*4), 'armor', floor(rand()*5), 'turbo', rand() < 0.5,
         'colorPrimary', floor(rand()*160), 'colorSecondary', floor(rand()*160),
         'pearlescent', floor(rand()*160), 'wheels', floor(rand()*12), 'wheelColor', floor(rand()*160),
         'windowTint', floor(rand()*6), 'neon', json_array(rand()<0.2, rand()<0.2, rand()<0.2, rand()<0.2),
         'neonColor', json_array(floor(rand()*255), floor(rand()*255), floor(rand()*255)),
         'plateIndex', floor(rand()*5), 'fuelLevel', round(rand()*100, 1),
         'bodyHealth', round(900 + rand()*100, 1), 'engineHealth', round(900 + rand()*100, 1),
         'extras', json_object('1', rand()<0.5, '2', rand()<0.5),
         'livery', floor(rand()*5), 'xenonColor', floor(rand()*13)
       ),
       rand() < 0.7,
       elt(1 + (seq % 6), 'legion','pillbox','paleto','sandy','airport','docks')
from seq_1_to_1200000;

-- Indexes after bulk load (MariaDB: no partial/GIN/INCLUDE equivalents;
-- covering achieved with composite secondary indexes)
create unique index players_identifier on players (identifier);
create index players_bank on players (bank desc);
create unique index inventory_owner_slot on inventory_items (owner, slot);
create index inventory_item on inventory_items (item);
create unique index vehicles_plate on owned_vehicles (plate);
create index vehicles_owner on owned_vehicles (owner, stored);

analyze table players, inventory_items, owned_vehicles;

select 'players' t, count(*) rows_ from players
union all select 'inventory_items', count(*) from inventory_items
union all select 'owned_vehicles', count(*) from owned_vehicles;
