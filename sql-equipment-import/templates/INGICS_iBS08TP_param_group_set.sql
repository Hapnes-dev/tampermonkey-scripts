-- INGICS iBS08TP / iBS08P (BLE, BC88 frame) on the MQTT driver - param, group and set rows.
-- Import beside the MQTT defaults: this file adds the list only, not the driver process or
-- its settings, which "INGICS param group set and mqtt defaults" already carries.
--
-- iBS08TP (subtype 0x49) and iBS08P (0x4B) send the same fields: F1 = internal temperature
-- and F2 = probe temperature (PT100 on the P), int16 / 100 C. The BC88 frame keeps battery,
-- the event byte, F1 and F2 at the iBS03 offsets, so those keep the iBS03 driver keys.
-- user and subtype sit at new offsets (MSD 19-21 against iBS03 11-13): they read right
-- only once the driver decodes BC88. mfg should read 2092 (0x082C) and beacon 48264
-- (0xBC88) for an iBS08, against 13 and 48259 for an iBS03.

INSERT INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(now(), 'ibs08tp', 'ibs08tp_param', 'ibs08tp_groups');

CREATE TABLE IF NOT EXISTS `iw_par_ibs08tp_groups` LIKE `iw_par_sysinfo_groups`;
CREATE TABLE IF NOT EXISTS `iw_par_ibs08tp_param` LIKE `iw_par_sysinfo_param`;
CREATE TABLE IF NOT EXISTS `iw_set_ibs08tp` LIKE `iw_set_sysinfo`;

INSERT INTO `iw_par_ibs08tp_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
('0000-00-00 00:00:00', 'default_link', 1, '', ''),
('0000-00-00 00:00:00', 'group_alias', 1, 'temp', 'Temperature (internal)'),
('0000-00-00 00:00:00', 'group_alias', 2, 'tempext', 'Temperature (probe)'),
('0000-00-00 00:00:00', 'group_alias', 3, 'event', 'Event'),
('0000-00-00 00:00:00', 'group_alias', 4, 'device_status', 'Device status'),
('0000-00-00 00:00:00', 'group', 1, 'temp', 'temperature'),
('0000-00-00 00:00:00', 'group', 2, 'temp', 'hlimit'),
('0000-00-00 00:00:00', 'group', 3, 'temp', 'llimit'),
('0000-00-00 00:00:00', 'group', 4, 'temp', 'delay'),
('0000-00-00 00:00:00', 'group', 5, 'temp', 'halm'),
('0000-00-00 00:00:00', 'group', 6, 'temp', 'lalm'),
('0000-00-00 00:00:00', 'group', 1, 'tempext', 'temperature_ext'),
('0000-00-00 00:00:00', 'group', 2, 'tempext', 'hlimit_ext'),
('0000-00-00 00:00:00', 'group', 3, 'tempext', 'llimit_ext'),
('0000-00-00 00:00:00', 'group', 4, 'tempext', 'delay_ext'),
('0000-00-00 00:00:00', 'group', 5, 'tempext', 'halm_ext'),
('0000-00-00 00:00:00', 'group', 6, 'tempext', 'lalm_ext'),
('0000-00-00 00:00:00', 'group', 1, 'event', 'event1'),
('0000-00-00 00:00:00', 'group', 1, 'device_status', 'battery'),
('0000-00-00 00:00:00', 'group', 2, 'device_status', 'blimit'),
('0000-00-00 00:00:00', 'group', 3, 'device_status', 'balm'),
('0000-00-00 00:00:00', 'group', 4, 'device_status', 'gateway'),
('0000-00-00 00:00:00', 'group', 5, 'device_status', 'signal'),
('0000-00-00 00:00:00', 'group', 6, 'device_status', 'adl1'),
('0000-00-00 00:00:00', 'group', 7, 'device_status', 'adt1'),
('0000-00-00 00:00:00', 'group', 8, 'device_status', 'adf1'),
('0000-00-00 00:00:00', 'group', 9, 'device_status', 'adl2'),
('0000-00-00 00:00:00', 'group', 10, 'device_status', 'adt2'),
('0000-00-00 00:00:00', 'group', 11, 'device_status', 'mfg'),
('0000-00-00 00:00:00', 'group', 12, 'device_status', 'beacon'),
('0000-00-00 00:00:00', 'group', 13, 'device_status', 'user'),
('0000-00-00 00:00:00', 'group', 14, 'device_status', 'subtype');

INSERT INTO `iw_par_ibs08tp_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
('0000-00-00 00:00:00', 'adl1', '0_ADL_1', 'AD1 Length', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'adl1', ''),
('0000-00-00 00:00:00', 'adt1', '0_ADT_1', 'AD1 Type', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'adt1', ''),
('0000-00-00 00:00:00', 'adf1', '0_ADF_1', 'AD1 Flags', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'adf1', ''),
('0000-00-00 00:00:00', 'adl2', '0_ADL_2', 'AD2 Length', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'adl2', ''),
('0000-00-00 00:00:00', 'adt2', '0_ADT_2', 'AD2 Type', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'adt2', ''),
('0000-00-00 00:00:00', 'mfg', '0_MFG_1', 'Manufacturer vendor code', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'mfg', ''),
('0000-00-00 00:00:00', 'beacon', '0_BEA_1', 'Beacon code and type', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'beacon', ''),
('0000-00-00 00:00:00', 'battery', '0_BAT_1', 'Battery voltage', '', 'Analog value', 'float', '', '', 'r', 'V', '%.2f', '', '', '', '', '', '', '', 'battery', ''),
('0000-00-00 00:00:00', 'blimit', 'BLIMIT_AI_1', 'Low battery limit', '', 'Analog values', 'float', '', '-1', 'vrw', 'V', '%.1f', '0', '6', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'balm', 'BALM_AI_1', 'Low battery', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}'),
('0000-00-00 00:00:00', 'event1', '0_EVE_1', 'Event (button pressed)', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'event1', ''),
('0000-00-00 00:00:00', 'temperature', '0_TEMP_1', 'Temperature (internal)', '', 'Analog value', 'float', '', '', 'r', '&deg;C', '%.1f', '', '', '', '', '', '', '', 'temperature', ''),
('0000-00-00 00:00:00', 'user', '0_USER_1', 'User', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'user', ''),
('0000-00-00 00:00:00', 'subtype', '0_SUB_1', 'Subtype', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'subtype', ''),
('0000-00-00 00:00:00', 'signal', '0_SS_1', 'Signal strength (RSSI)', '', 'Integer value', 'integer', '', '', 'r', 'dBm', '%.0f', '', '', '', '', '', '', '', 'signal', ''),
('0000-00-00 00:00:00', 'gateway', '0_GAT_1', 'Selected gateway id', '', 'String', 'string', '', '', 'r', '', '', '', '', '', '', '', '', '', 'gateway', ''),
('0000-00-00 00:00:00', 'hlimit', 'HLIMIT_AI_1', 'High internal temperature alarm limit', '', 'Analog values', 'float', '', '-1', 'vrw', '&deg;C', '%.1f', '-50', '150', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'llimit', 'LLIMIT_AI_1', 'Low internal temperature alarm limit', '', 'Analog values', 'float', '', '-1', 'vrw', '&deg;C', '%.1f', '-50', '150', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'delay', 'DELAY_AI_1', 'Alarm delay', '', 'Integral values', 'integer', '', '-1', 'vrw', 'min.', '%.0f', '0', '240', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'halm', 'HALM_AI_1', 'High internal temperature', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}'),
('0000-00-00 00:00:00', 'lalm', 'LALM_AI_1', 'Low internal temperature', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}'),
('0000-00-00 00:00:00', 'temperature_ext', '0_TEMP_EXT_1', 'Temperature (probe)', '', 'Analog value', 'float', '', '', 'r', '&deg;C', '%.1f', '', '', '', '', '', '', '', 'temperature_ext', ''),
('0000-00-00 00:00:00', 'hlimit_ext', 'HLIMIT_EXT_AI_1', 'High probe temperature alarm limit', '', 'Analog values', 'float', '', '-1', 'vrw', '&deg;C', '%.1f', '-100', '250', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'llimit_ext', 'LLIMIT_EXT_AI_1', 'Low probe temperature alarm limit', '', 'Analog values', 'float', '', '-1', 'vrw', '&deg;C', '%.1f', '-100', '250', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'delay_ext', 'DELAY_EXT_AI_1', 'Probe alarm delay', '', 'Integral values', 'integer', '', '-1', 'vrw', 'min.', '%.0f', '0', '240', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'halm_ext', 'HALM_EXT_AI_1', 'High probe temperature', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}'),
('0000-00-00 00:00:00', 'lalm_ext', 'LALM_EXT_AI_1', 'Low probe temperature', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}');

INSERT INTO `iw_set_ibs08tp` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
('0000-00-00 00:00:00', 'temperature', '1', '1', 'norm', 'min', '1', '', '', 0),
('0000-00-00 00:00:00', 'temperature_ext', '1', '1', 'norm', 'min', '1', '', '', 0),
('0000-00-00 00:00:00', 'signal', '1', '0', 'norm', 'min', '1', '', '', 0),
('0000-00-00 00:00:00', 'gateway', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'battery', '1', '0', 'norm', 'day', '1', '', '', 0),
('0000-00-00 00:00:00', 'blimit', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'balm', '1', '0', 'norm', 'change', '', 'C', '', 0),
('0000-00-00 00:00:00', 'adl1', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'adt1', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'adf1', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'adl2', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'adt2', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'mfg', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'beacon', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'user', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'subtype', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'hlimit', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'llimit', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'delay', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'halm', '1', '0', 'norm', 'change', '', 'A', '', 0),
('0000-00-00 00:00:00', 'lalm', '1', '0', 'norm', 'change', '', 'A', '', 0),
('0000-00-00 00:00:00', 'hlimit_ext', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'llimit_ext', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'delay_ext', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'halm_ext', '1', '0', 'norm', 'change', '', 'A', '', 0),
('0000-00-00 00:00:00', 'lalm_ext', '1', '0', 'norm', 'change', '', 'A', '', 0);
