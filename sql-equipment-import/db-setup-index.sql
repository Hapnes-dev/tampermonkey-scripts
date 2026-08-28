-- SQL Equipment Import — fleet equipment index (v9.1)
--
-- Run this ONCE on the Toolbox MariaDB (HeidiSQL, mysql CLI, or phpMyAdmin
-- running locally on the toolbox). It cannot be run via the toolbox-sql API
-- because CREATE is blocked there. The panel's "Copy CREATE TABLE" button
-- carries this same statement.
--
-- The table powers searching WITHOUT a plant id: one row per equipment
-- (plant_id + driver_type + order_no) with searchable aggregates of the
-- regulator types, unit names and grp names. The userscript refreshes a
-- plant's rows every time that plant's equipment list is loaded, so the
-- index grows and stays fresh with normal use. MyISAM + utf8mb4 to match
-- the toolbox MariaDB (5.5-safe: a single TIMESTAMP default).

CREATE TABLE IF NOT EXISTS sql_equipment_import.equipment_index (
  plant_id    int          NOT NULL,
  driver_type varchar(64)  NOT NULL,
  order_no    varchar(120) NOT NULL,
  n_units     int          NOT NULL DEFAULT 0,
  regs        varchar(300) NOT NULL DEFAULT '',
  unames      varchar(500) NOT NULL DEFAULT '',
  grps        varchar(300) NOT NULL DEFAULT '',
  updated_at  timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (plant_id, driver_type, order_no)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
