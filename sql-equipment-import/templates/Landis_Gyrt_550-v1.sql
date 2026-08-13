REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`) VALUES
(NOW(), '0', 'E01', 'Fjernvarme 1', 'landisgyrt550', 'LANDIS', '0_1', 'T550', 'LANDIS', '', ''),
(NOW(), '0', 'E02', 'Fjernvarme 2', 'landisgyrt550', 'LANDIS', '0_2', 'T550', 'LANDIS', '', ''),
(NOW(), '0', 'E03', 'Fjernvarme 3', 'landisgyrt550', 'LANDIS', '0_3', 'T550', 'LANDIS', '', '');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'comm_port', 'LANDIS', '7', '', '', ''),
(NOW(), 'mb_mode', 'LANDIS', '0', '', '0=RTU|1=ASCII|2=TCP', ''),
(NOW(), 'comm_baudrate', 'LANDIS', '9600', '', '', ''),
(NOW(), 'comm_stop_bits', 'LANDIS', '1', '', '', ''),
(NOW(), 'comm_data_bits', 'LANDIS', '8', '', '', ''),
(NOW(), 'comm_parity', 'LANDIS', '0', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'alarm_handler', 'LANDIS', '', '', '', ''),
(NOW(), 'idle_event_rate', 'LANDIS', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'LANDIS', '2000', 'msec.', '', ''),
(NOW(), 'value_quality_check_limit', 'LANDIS', '0', '', '0 = disabled', ''),
(NOW(), 'packet_timeout', 'LANDIS', '0', 'sec.', '', ''),
(NOW(), 'max_outstanding_packets', 'LANDIS', '-1', '', '', ''),
(NOW(), 'max_error_count', 'LANDIS', '2', '', '', ''),
(NOW(), 'max_group_count', 'LANDIS', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'LANDIS', '2', 'hours', '', ''),
(NOW(), 'speed_index_norm', 'LANDIS', '1', '', '', ''),
(NOW(), 'speed_index_slow', 'LANDIS', '1', '', '', ''),
(NOW(), 'speed_index_offline', 'LANDIS', '10', '', '', ''),
(NOW(), 'speed_index_block', 'LANDIS', '10', '', '', ''),
(NOW(), 'show_queue_info', 'LANDIS', '0', '', '', ''),
(NOW(), 'com_error_alarm_delay', 'LANDIS', '10', 'min.', '', ''),
(NOW(), 'mb_request_retries', 'LANDIS', '0', '', '', ''),
(NOW(), 'mb_request_timeout', 'LANDIS', '500', 'ms', '', ''),
(NOW(), 'mux_settle_time', 'LANDIS', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
(NOW(), 'startup_delay', 'LANDIS', '15', 'Sec.', '', ''),
(NOW(), 'check_rate', 'LANDIS', '1', 'ms', '', ''),
(NOW(), 'handshake', 'LANDIS', '0', '', '0|1|2', ''),
(NOW(), 'force_word_not_byte', 'LANDIS', '0', '', '0|1', '');

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
(NOW(), '0', 'iw_mb.exe', 'LANDIS', '', '');

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(NOW(), 'LANDIS', 'landisgyrt550_param', 'landisgyrt550_groups');

CREATE TABLE IF NOT EXISTS `iw_par_landisgyrt550_groups` (
  `date` datetime NOT NULL DEFAULT '2002-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) TYPE=MyISAM COMMENT='1.0.1';

REPLACE INTO `iw_par_landisgyrt550_groups` (`date`, `type`, `view_order`, `ref`, `value`) VALUES
(NOW(), 'default_link', 1, '', ''),
(NOW(), 'group_alias', 1, 'meter', 'Meter'),
(NOW(), 'group_alias', 2, 'add', 'Additional'),
(NOW(), 'group_alias', 3, 'temp', 'Temperatur'),
(NOW(), 'group_alias', 4, 'ext', 'External'),
(NOW(), 'group_alias', 5, 'heat', 'Heatpump'),
(NOW(), 'group', 1, 'meter', 'meter_0_3_1'),
(NOW(), 'group', 2, 'meter', 'meter_0_3_2'),
(NOW(), 'group', 3, 'meter', 'meter_0_3_3'),
(NOW(), 'group', 4, 'meter', 'meter_0_3_4'),
(NOW(), 'group', 5, 'meter', 'meter_0_3_6'),
(NOW(), 'group', 6, 'meter', 'meter_0_3_8'),
(NOW(), 'group', 7, 'meter', 'meter_0_3_12'),
(NOW(), 'group', 8, 'meter', 'meter_0_3_14'),
(NOW(), 'group', 9, 'meter', 'meter_0_3_16'),
(NOW(), 'group', 10, 'meter', 'meter_0_3_18'),
(NOW(), 'group', 11, 'meter', 'meter_0_3_32'),
(NOW(), 'group', 12, 'meter', 'meter_0_3_34'),
(NOW(), 'group', 13, 'meter', 'meter_0_3_36'),
(NOW(), 'group', 14, 'meter', 'meter_0_3_38'),
(NOW(), 'group', 15, 'meter', 'meter_0_3_40');

CREATE TABLE IF NOT EXISTS `iw_par_landisgyrt550_param` (
  `row_date` datetime NOT NULL DEFAULT '2002-01-10 00:00:00',
  `element_id` varchar(100) NOT NULL DEFAULT '',
  `driver_id` varchar(100) NOT NULL DEFAULT '',
  `alias_text` text NOT NULL,
  `menu` varchar(10) NOT NULL DEFAULT '',
  `application` text NOT NULL,
  `parameter_type` text NOT NULL,
  `factory_setting` text NOT NULL,
  `grp` text NOT NULL,
  `att` text NOT NULL,
  `eng_unit` varchar(20) NOT NULL DEFAULT '',
  `format` varchar(20) NOT NULL DEFAULT '',
  `range_min` text NOT NULL,
  `range_max` text NOT NULL,
  `scale` varchar(15) NOT NULL DEFAULT '',
  `raw_min` varchar(15) NOT NULL DEFAULT '',
  `raw_max` varchar(15) NOT NULL DEFAULT '',
  `eng_min` varchar(15) NOT NULL DEFAULT '',
  `eng_max` varchar(15) NOT NULL DEFAULT '',
  `driver_id_extra` varchar(255) NOT NULL DEFAULT '',
  `format_extra` text NOT NULL,
  UNIQUE KEY `element_id` (`element_id`)
) TYPE=MyISAM COMMENT='3.2.3';

REPLACE INTO `iw_par_landisgyrt550_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
(NOW(), 'meter_0_3_1', '0_3_1', 'Temperatur hot side', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_1_I16_N_-_-_-_-', ''),
(NOW(), 'meter_0_3_2', '0_3_2', 'Temperatur cold side', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_2_I16_N_-_-_-_-', ''),
(NOW(), 'meter_0_3_3', '0_3_3', 'Temperature difference', '', 'Analog values', 'float', '', '-1', 'r', 'K', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_3_I16_N_-_-_-_-', ''),
(NOW(), 'meter_0_3_4', '0_3_4', 'Actual flow', '', 'Analog values', 'float', '', '-1', 'r', 'm3/h', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_4_U32_W_-_-_-_-', ''),
(NOW(), 'meter_0_3_6', '0_3_6', 'Actual power', '', 'Analog values', 'float', '', '-1', 'r', 'kW', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_6_U32_W_-_-_-_-', ''),
(NOW(), 'meter_0_3_8', '0_3_8', 'Accumulated cold energy (eq. tariff register 1)', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_8_U32_W_-_-_-_-', ''),
(NOW(), 'meter_0_3_12', '0_3_12', 'Meter Error', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_12_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"No error"},"3":{"t":"Internal errors"},"5":{"t":"Flow rate error"},"6":{"t":"Interruption temperature sensor hot side"},"7":{"t":"Short Circuit temperature sensor hot side"},"8":{"t":"Interruption temperature sensor cold side"},"9":{"t":"Short Circuit temperature sensor cold side"}}}'),
(NOW(), 'meter_0_3_14', '0_3_14', 'Accumulated energy', '', 'Analog values', 'float', '', '-1', 'r', 'kWh', '%.0f', '', '', '2', '', '', '', '', '3_14_U32_W_-_-_-_-', ''),
(NOW(), 'meter_0_3_16', '0_3_16', 'Accumulated volume', '', 'Analog values', 'float', '', '-1', 'r', 'm3/h', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_16_U32_W_-_-_-_-', ''),
(NOW(), 'meter_0_3_18', '0_3_18', 'Serial number', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_18_U32_W_-_-_-_-', ''),
(NOW(), 'meter_0_3_32', '0_3_32', 'Serial number A1', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_32_U32_W_-_-_-_-', ''),
(NOW(), 'meter_0_3_34', '0_3_34', 'Serial number A2', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_34_U32_W_-_-_-_-', ''),
(NOW(), 'meter_0_3_36', '0_3_36', 'Tariff register 1', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_36_U32_W_-_-_-_-', ''),
(NOW(), 'meter_0_3_38', '0_3_38', 'Tariff register 2', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_38_U32_W_-_-_-_-', ''),
(NOW(), 'meter_0_3_40', '0_3_40', 'Tariff register 3', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_40_U32_W_-_-_-_-', '');

CREATE TABLE IF NOT EXISTS `iw_set_landisgyrt550` (
  `row_date` datetime NOT NULL DEFAULT '2010-01-10 00:00:00',
  `element_id` varchar(100) NOT NULL DEFAULT '',
  `active` enum('0','1') NOT NULL DEFAULT '0',
  `onl_ind` enum('0','1') NOT NULL DEFAULT '1',
  `update_freq` set('','fast','norm','slow','once','never') NOT NULL DEFAULT 'norm',
  `save_data` varchar(20) NOT NULL DEFAULT 'change',
  `save_freq` varchar(20) NOT NULL DEFAULT '',
  `plant_pri` char(1) NOT NULL DEFAULT '',
  `sys_pri` char(1) NOT NULL DEFAULT '',
  `alarm_type` tinyint(3) NOT NULL DEFAULT '0',
  PRIMARY KEY (`element_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='3.0.0';

REPLACE INTO `iw_set_landisgyrt550` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
(NOW(), 'meter_0_3_1', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'meter_0_3_2', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'meter_0_3_3', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'meter_0_3_4', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'meter_0_3_6', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'meter_0_3_8', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'meter_0_3_12', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'meter_0_3_14', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'meter_0_3_16', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'meter_0_3_18', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'meter_0_3_32', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'meter_0_3_34', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'meter_0_3_36', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'meter_0_3_38', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'meter_0_3_40', '1', '0', 'norm', 'min', '1', '', '', 0);





-- Changelog
--
-- v1 Orginal
--
--