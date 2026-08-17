
REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
(now(), '0', 'iw_php_app_drv.exe', 'MQTT', '', '');

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(now(), 'ING_TEMP_V3', 'ing_v3_param', 'ing_v3_groups'),
(now(), 'ibs03tp', 'ibs03tp_param', 'ibs03tp_groups'),
(now(), 'ibs03th', 'ibs03th_param', 'ibs03th_groups'),
(now(), 'ING_GW', 'ing_gw_param', 'ing_gw_groups');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(now(), 'idle_event_rate', 'MQTT', '250', 'msec.', '', ''),
(now(), 'sql_queue_poll_time', 'MQTT', '2000', 'msec.', '', ''),
(now(), 'packet_timeout', 'MQTT', '1', 'sec.', '', ''),
(now(), 'max_outstanding_packets', 'MQTT', '-1', '', '', ''),
(now(), 'max_error_count', 'MQTT', '2', '', '', ''),
(now(), 'max_group_count', 'MQTT', '1', '', '', ''),
(now(), 'max_param_block_time', 'MQTT', '2', 'hours', '', ''),
(now(), 'speed_index_norm', 'MQTT', '1', '', '', ''),
(now(), 'speed_index_slow', 'MQTT', '1', '', '', ''),
(now(), 'speed_index_offline', 'MQTT', '10', '', '', ''),
(now(), 'speed_index_block', 'MQTT', '10', '', '', ''),
(now(), 'show_queue_info', 'MQTT', '0', '', '', ''),
(now(), 'com_error_alarm_delay', 'MQTT', '30', 'min.', '', ''),
(now(), 'mqtt_server', 'MQTT', '127.0.0.1', '', '', ''),
(now(), 'mqtt_port', 'MQTT', '1883', '', '', ''),
(now(), 'mqtt_user', 'MQTT', 'iwmac', '', '', ''),
(now(), 'mqtt_pass', 'MQTT', 'iwmacpass', '', '', ''),
(now(), 'thread_queue_timeout', 'MQTT', '60000', '', '', ''),
(now(), 'scripts', 'MQTT', '1;php_drivers/iw_mqtt.php;MQTT', '', '', ''),
(now(), 'php_ini', 'MQTT', '', '', '', ''),
(now(), 'debug_output', 'MQTT', '0', '', '', '');


CREATE TABLE IF NOT EXISTS `iw_par_ibs03th_groups` LIKE `iw_par_sysinfo_groups`;
CREATE TABLE IF NOT EXISTS `iw_par_ibs03th_param` LIKE `iw_par_sysinfo_param`;
CREATE TABLE IF NOT EXISTS `iw_par_ibs03tp_groups` LIKE `iw_par_sysinfo_groups`;
CREATE TABLE IF NOT EXISTS `iw_par_ibs03tp_param` LIKE `iw_par_sysinfo_param`;
CREATE TABLE IF NOT EXISTS `iw_par_ing_gw_groups` LIKE `iw_par_sysinfo_groups`;
CREATE TABLE IF NOT EXISTS `iw_par_ing_gw_param` LIKE `iw_par_sysinfo_param`;
CREATE TABLE IF NOT EXISTS `iw_par_ing_v3_groups` LIKE `iw_par_sysinfo_groups`;
CREATE TABLE IF NOT EXISTS `iw_par_ing_v3_param` LIKE `iw_par_sysinfo_param`;
CREATE TABLE IF NOT EXISTS `iw_set_ibs03th` LIKE `iw_set_sysinfo`;
CREATE TABLE IF NOT EXISTS `iw_set_ibs03tp` LIKE `iw_set_sysinfo`;
CREATE TABLE IF NOT EXISTS `iw_set_ing_gw` LIKE `iw_set_sysinfo`;
CREATE TABLE IF NOT EXISTS `iw_set_ing_temp_v3` LIKE `iw_set_sysinfo`;




REPLACE INTO `iw_par_ibs03th_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
('0000-00-00 00:00:00', 'default_link', 1, '', ''),
('0000-00-00 00:00:00', 'group_alias', 1, 'temp', 'Temperature'),
('0000-00-00 00:00:00', 'group_alias', 2, 'humidity', 'Humidity'),
('0000-00-00 00:00:00', 'group_alias', 3, 'event', 'Event'),
('0000-00-00 00:00:00', 'group_alias', 4, 'device_status', 'Device status'),
('0000-00-00 00:00:00', 'group', 1, 'temp', 'temperature'),
('0000-00-00 00:00:00', 'group', 2, 'temp', 'hlimit'),
('0000-00-00 00:00:00', 'group', 3, 'temp', 'llimit'),
('0000-00-00 00:00:00', 'group', 4, 'temp', 'delay'),
('0000-00-00 00:00:00', 'group', 5, 'temp', 'halm'),
('0000-00-00 00:00:00', 'group', 6, 'temp', 'lalm'),
('0000-00-00 00:00:00', 'group', 1, 'humidity', 'humidity'),
('0000-00-00 00:00:00', 'group', 2, 'humidity', 'hlimit_hum'),
('0000-00-00 00:00:00', 'group', 3, 'humidity', 'llimit_hum'),
('0000-00-00 00:00:00', 'group', 4, 'humidity', 'delay_hum'),
('0000-00-00 00:00:00', 'group', 5, 'humidity', 'halm_hum'),
('0000-00-00 00:00:00', 'group', 6, 'humidity', 'lalm_hum'),
('0000-00-00 00:00:00', 'group', 1, 'event', 'event1'),
('0000-00-00 00:00:00', 'group', 2, 'event', 'event2'),
('0000-00-00 00:00:00', 'group', 3, 'event', 'event3'),
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
('0000-00-00 00:00:00', 'group', 13, 'device_status', 'res1'),
('0000-00-00 00:00:00', 'group', 14, 'device_status', 'res2'),
('0000-00-00 00:00:00', 'group', 15, 'device_status', 'user'),
('0000-00-00 00:00:00', 'group', 16, 'device_status', 'subtype');



REPLACE INTO `iw_par_ibs03th_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
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
('0000-00-00 00:00:00', 'event2', '0_EVE_2', 'Event (moving)', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'event2', ''),
('0000-00-00 00:00:00', 'event3', '0_EVE_3', 'Event (hall sensor activated)', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'event3', ''),
('0000-00-00 00:00:00', 'temperature', '0_TEMP_1', 'Temperature', '', 'Analog value', 'float', '', '', 'r', '&deg;C', '%.1f', '', '', '', '', '', '', '', 'temperature', ''),
('0000-00-00 00:00:00', 'res1', '0_RES_1', 'Reserved (1)', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'res1', ''),
('0000-00-00 00:00:00', 'user', '0_USER_1', 'User', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'user', ''),
('0000-00-00 00:00:00', 'subtype', '0_SUB_1', 'Subtype', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'subtype', ''),
('0000-00-00 00:00:00', 'res2', '0_RES_2', 'Reserved (2)', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'res2', ''),
('0000-00-00 00:00:00', 'signal', '0_SS_1', 'Signal strength (RSSI)', '', 'Integer value', 'integer', '', '', 'r', 'dBm', '%.0f', '', '', '', '', '', '', '', 'signal', ''),
('0000-00-00 00:00:00', 'gateway', '0_GAT_1', 'Selected gateway id', '', 'String', 'string', '', '', 'r', '', '', '', '', '', '', '', '', '', 'gateway', ''),
('0000-00-00 00:00:00', 'hlimit', 'HLIMIT_AI_1', 'High temperature alarm limit', '', 'Analog values', 'float', '', '-1', 'vrw', '&deg;C', '%.1f', '-50', '150', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'llimit', 'LLIMIT_AI_1', 'Low temperature alarm limit', '', 'Analog values', 'float', '', '-1', 'vrw', '&deg;C', '%.1f', '-50', '150', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'delay', 'DELAY_AI_1', 'Alarm delay', '', 'Integral values', 'integer', '', '-1', 'vrw', 'min.', '%.0f', '0', '240', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'halm', 'HALM_AI_1', 'High temperature', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}'),
('0000-00-00 00:00:00', 'lalm', 'LALM_AI_1', 'Low temperature', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}'),
('0000-00-00 00:00:00', 'humidity', '0_HUM_1', 'Humidity', '', 'Analog value', 'float', '', '', 'r', '%', '%.1f', '', '', '', '', '', '', '', 'humidity', ''),
('0000-00-00 00:00:00', 'hlimit_hum', 'HLIMIT_HUM_1', 'High humidity alarm limit', '', 'Analog values', 'float', '', '-1', 'vrw', '%', '%.1f', '0', '100', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'llimit_hum', 'LLIMIT_HUM_1', 'Low humidity alarm limit', '', 'Analog values', 'float', '', '-1', 'vrw', '%', '%.1f', '0', '100', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'delay_hum', 'DELAY_HUM_1', 'Alarm humidity delay', '', 'Integral values', 'integer', '', '-1', 'vrw', 'min.', '%.1f', '0', '240', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'halm_hum', 'HALM_HUM_1', 'High humidity', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}'),
('0000-00-00 00:00:00', 'lalm_hum', 'LALM_HUM_1', 'Low humidity', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}');



REPLACE INTO `iw_par_ibs03tp_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
('0000-00-00 00:00:00', 'default_link', 1, '', ''),
('0000-00-00 00:00:00', 'group_alias', 1, 'temp', 'Temperature'),
('0000-00-00 00:00:00', 'group_alias', 2, 'tempext', 'Temperature External'),
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
('0000-00-00 00:00:00', 'group', 2, 'event', 'event2'),
('0000-00-00 00:00:00', 'group', 3, 'event', 'event3'),
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
('0000-00-00 00:00:00', 'group', 13, 'device_status', 'res1'),
('0000-00-00 00:00:00', 'group', 14, 'device_status', 'res2'),
('0000-00-00 00:00:00', 'group', 15, 'device_status', 'user'),
('0000-00-00 00:00:00', 'group', 16, 'device_status', 'subtype');



REPLACE INTO `iw_par_ibs03tp_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
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
('0000-00-00 00:00:00', 'event2', '0_EVE_2', 'Event (moving)', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'event2', ''),
('0000-00-00 00:00:00', 'event3', '0_EVE_3', 'Event (hall sensor activated)', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'event3', ''),
('0000-00-00 00:00:00', 'temperature', '0_TEMP_1', 'Temperature', '', 'Analog value', 'float', '', '', 'r', '&deg;C', '%.1f', '', '', '', '', '', '', '', 'temperature', ''),
('0000-00-00 00:00:00', 'res1', '0_RES_1', 'Reserved (1)', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'res1', ''),
('0000-00-00 00:00:00', 'user', '0_USER_1', 'User', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'user', ''),
('0000-00-00 00:00:00', 'subtype', '0_SUB_1', 'Subtype', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'subtype', ''),
('0000-00-00 00:00:00', 'res2', '0_RES_2', 'Reserved (2)', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'res2', ''),
('0000-00-00 00:00:00', 'signal', '0_SS_1', 'Signal strength (RSSI)', '', 'Integer value', 'integer', '', '', 'r', 'dBm', '%.0f', '', '', '', '', '', '', '', 'signal', ''),
('0000-00-00 00:00:00', 'gateway', '0_GAT_1', 'Selected gateway id', '', 'String', 'string', '', '', 'r', '', '', '', '', '', '', '', '', '', 'gateway', ''),
('0000-00-00 00:00:00', 'hlimit', 'HLIMIT_AI_1', 'High temperature alarm limit', '', 'Analog values', 'float', '', '-1', 'vrw', '&deg;C', '%.1f', '-50', '150', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'llimit', 'LLIMIT_AI_1', 'Low temperature alarm limit', '', 'Analog values', 'float', '', '-1', 'vrw', '&deg;C', '%.1f', '-50', '150', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'delay', 'DELAY_AI_1', 'Alarm delay', '', 'Integral values', 'integer', '', '-1', 'vrw', 'min.', '%.0f', '0', '240', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'halm', 'HALM_AI_1', 'High temperature', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}'),
('0000-00-00 00:00:00', 'lalm', 'LALM_AI_1', 'Low temperature', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}'),
('0000-00-00 00:00:00', 'temperature_ext', '0_TEMP_EXT_1', 'Temperature (External)', '', 'Analog value', 'float', '', '', 'r', '&deg;C', '%.1f', '', '', '', '', '', '', '', 'temperature_ext', ''),
('0000-00-00 00:00:00', 'hlimit_ext', 'HLIMIT_EXT_AI_1', 'High external temperature alarm limit', '', 'Analog values', 'float', '', '-1', 'vrw', '&deg;C', '%.1f', '-50', '150', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'llimit_ext', 'LLIMIT_EXT_AI_1', 'Low external temperature alarm limit', '', 'Analog values', 'float', '', '-1', 'vrw', '&deg;C', '%.1f', '-50', '150', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'delay_ext', 'DELAY_EXT_AI_1', 'Alarm external delay', '', 'Integral values', 'integer', '', '-1', 'vrw', 'min.', '%.0f', '0', '240', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'halm_ext', 'HALM_EXT_AI_1', 'High external temperature', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}'),
('0000-00-00 00:00:00', 'lalm_ext', 'LALM_EXT_AI_1', 'Low external temperature', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}');



REPLACE INTO `iw_par_ing_gw_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
('0000-00-00 00:00:00', 'default_link', 1, '', ''),
('0000-00-00 00:00:00', 'group_alias', 1, 'status', 'Status'),
('0000-00-00 00:00:00', 'group', 1, 'status', 'online_status'),
('0000-00-00 00:00:00', 'group', 2, 'status', 'publish_date'),
('0000-00-00 00:00:00', 'group', 3, 'status', 'mac'),
('0000-00-00 00:00:00', 'group', 4, 'status', 'ntp_alarm');



REPLACE INTO `iw_par_ing_gw_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
('0000-00-00 00:00:00', 'online_status', '0_ONLINESTATUS_1', 'Online Status', '', 'Integer value', 'integer', '', '', 'r', '', '', '', '', '', '', '', '', '', 'online_status', ''),
('0000-00-00 00:00:00', 'publish_date', '0_PUBLISHDATE_1', 'Last Publish', '', 'String', 'string', '', '', 'r', '', '', '', '', '', '', '', '', '', 'publish_date', ''),
('0000-00-00 00:00:00', 'mac', '0_MAC_1', 'Mac Address', '', 'String', 'string', '', '', 'r', '', '', '', '', '', '', '', '', '', 'gateway', ''),
('0000-00-00 00:00:00', 'ntp_alarm', '0_NTP_1', 'NTP failure', '', 'Integer', 'integer', '', '', 'r', '', '', '', '', '', '', '', '', '', '', '');



REPLACE INTO `iw_par_ing_v3_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
('0000-00-00 00:00:00', 'default_link', 1, '', ''),
('0000-00-00 00:00:00', 'group_alias', 1, 'temp', 'Temperature'),
('0000-00-00 00:00:00', 'group_alias', 2, 'event', 'Event'),
('0000-00-00 00:00:00', 'group_alias', 3, 'device_status', 'Device status'),
('0000-00-00 00:00:00', 'group', 1, 'temp', 'temperature'),
('0000-00-00 00:00:00', 'group', 2, 'temp', 'hlimit'),
('0000-00-00 00:00:00', 'group', 3, 'temp', 'llimit'),
('0000-00-00 00:00:00', 'group', 4, 'temp', 'delay'),
('0000-00-00 00:00:00', 'group', 5, 'temp', 'halm'),
('0000-00-00 00:00:00', 'group', 6, 'temp', 'lalm'),
('0000-00-00 00:00:00', 'group', 1, 'event', 'event1'),
('0000-00-00 00:00:00', 'group', 2, 'event', 'event2'),
('0000-00-00 00:00:00', 'group', 3, 'event', 'event3'),
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
('0000-00-00 00:00:00', 'group', 13, 'device_status', 'res1'),
('0000-00-00 00:00:00', 'group', 14, 'device_status', 'res2'),
('0000-00-00 00:00:00', 'group', 15, 'device_status', 'user'),
('0000-00-00 00:00:00', 'group', 16, 'device_status', 'subtype');



REPLACE INTO `iw_par_ing_v3_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
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
('0000-00-00 00:00:00', 'event2', '0_EVE_2', 'Event (moving)', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'event2', ''),
('0000-00-00 00:00:00', 'event3', '0_EVE_3', 'Event (hall sensor activated)', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'event3', ''),
('0000-00-00 00:00:00', 'temperature', '0_TEMP_1', 'Temperature', '', 'Analog value', 'float', '', '', 'r', '&deg;C', '%.1f', '', '', '', '', '', '', '', 'temperature', ''),
('0000-00-00 00:00:00', 'res1', '0_RES_1', 'Reserved (1)', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'res1', ''),
('0000-00-00 00:00:00', 'user', '0_USER_1', 'User', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'user', ''),
('0000-00-00 00:00:00', 'subtype', '0_SUB_1', 'Subtype', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'subtype', ''),
('0000-00-00 00:00:00', 'res2', '0_RES_2', 'Reserved (2)', '', 'Integer value', 'integer', '', '', 'r', '', '%.0f', '', '', '', '', '', '', '', 'res2', ''),
('0000-00-00 00:00:00', 'signal', '0_SS_1', 'Signal strength (RSSI)', '', 'Integer value', 'integer', '', '', 'r', 'dBm', '%.0f', '', '', '', '', '', '', '', 'signal', ''),
('0000-00-00 00:00:00', 'gateway', '0_GAT_1', 'Selected gateway id', '', 'String', 'string', '', '', 'r', '', '', '', '', '', '', '', '', '', 'gateway', ''),
('0000-00-00 00:00:00', 'hlimit', 'HLIMIT_AI_1', 'High temperature alarm limit', '', 'Analog values', 'float', '', '-1', 'vrw', '&deg;C', '%.1f', '-50', '150', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'llimit', 'LLIMIT_AI_1', 'Low temperature alarm limit', '', 'Analog values', 'float', '', '-1', 'vrw', '&deg;C', '%.1f', '-50', '150', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'delay', 'DELAY_AI_1', 'Alarm delay', '', 'Integral values', 'integer', '', '-1', 'vrw', 'min.', '%.0f', '0', '240', '', '', '', '', '', '', ''),
('0000-00-00 00:00:00', 'halm', 'HALM_AI_1', 'High temperature', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}'),
('0000-00-00 00:00:00', 'lalm', 'LALM_AI_1', 'Low temperature', '', 'Digital IO', 'boolean', '', '-1', 'vr', '', '', '0', '1', '', '', '', '', '', '', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"Alarm"}}}');



REPLACE INTO `iw_set_ibs03th` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
('0000-00-00 00:00:00', 'temperature', '1', '1', 'norm', 'min', '1', '', '', 0),
('0000-00-00 00:00:00', 'humidity', '1', '1', 'norm', 'min', '1', '', '', 0),
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
('0000-00-00 00:00:00', 'res1', '0', '0', 'never', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'res2', '0', '0', 'never', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'user', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'subtype', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'hlimit', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'llimit', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'delay', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'halm', '1', '0', 'norm', 'change', '', 'A', '', 0),
('0000-00-00 00:00:00', 'lalm', '1', '0', 'norm', 'change', '', 'A', '', 0),
('0000-00-00 00:00:00', 'hlimit_hum', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'llimit_hum', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'delay_hum', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'halm_hum', '1', '0', 'norm', 'change', '', 'A', '', 0),
('0000-00-00 00:00:00', 'lalm_hum', '1', '0', 'norm', 'change', '', 'A', '', 0);



REPLACE INTO `iw_set_ibs03tp` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
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
('0000-00-00 00:00:00', 'res1', '0', '0', 'never', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'res2', '0', '0', 'never', 'change', '', '', '', 0),
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



REPLACE INTO `iw_set_ing_gw` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
('0000-00-00 00:00:00', 'online_status', '1', '0', 'norm', 'change', '1', '', '', 0),
('0000-00-00 00:00:00', 'publish_date', '1', '1', 'norm', 'change', '1', '', '', 0),
('0000-00-00 00:00:00', 'mac', '1', '0', 'norm', 'change', '1', '', '', 0),
('0000-00-00 00:00:00', 'ntp_alarm', '0', '0', 'never', 'change', '1', '', 'A', 0);



REPLACE INTO `iw_set_ing_temp_v3` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
('0000-00-00 00:00:00', 'temperature', '1', '1', 'norm', 'change', '1', '', '', 0),
('0000-00-00 00:00:00', 'signal', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'gateway', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'battery', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'blimit', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'balm', '1', '0', 'norm', 'change', '', 'C', '', 0),
('0000-00-00 00:00:00', 'adl1', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'adt1', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'adf1', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'adl2', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'adt2', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'mfg', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'beacon', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'res1', '0', '0', 'never', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'res2', '0', '0', 'never', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'user', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'subtype', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'hlimit', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'llimit', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'delay', '1', '0', 'norm', 'change', '', '', '', 0),
('0000-00-00 00:00:00', 'halm', '1', '0', 'norm', 'change', '', 'A', '', 0),
('0000-00-00 00:00:00', 'lalm', '1', '0', 'norm', 'change', '', 'A', '', 0);
