REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `driver_adr_extra`) VALUES
(NOW(), '1', '0', 'E01', 'Energi 1', 'edmk', 'EDMK', '0_1', 'EDMK', 'EDMK', ''),
(NOW(), '1', '0', 'E02', 'Energi 2', 'edmk', 'EDMK', '0_2', 'EDMK', 'EDMK', ''),
(NOW(), '1', '0', 'E03', 'Energi 3', 'edmk', 'EDMK', '0_3', 'EDMK', 'EDMK', '');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'comm_port', 'EDMK', '6', '', '', ''),
(NOW(), 'comm_parity', 'EDMK', '2', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'comm_data_bits', 'EDMK', '8', '', '', ''),
(NOW(), 'comm_stop_bits', 'EDMK', '1', '', '', ''),
(NOW(), 'comm_baudrate', 'EDMK', '19200', '', '', ''),
(NOW(), 'mb_mode', 'EDMK', '0', '', '0=RTU|1=ASCII|3=TCP', ''),
(NOW(), 'force_word_not_byte', 'EDMK', '0', '', '0|1', ''),
(NOW(), 'handshake', 'EDMK', '0', '', '0|1|2', ''),
(NOW(), 'check_rate', 'EDMK', '1', 'ms', '', ''),
(NOW(), 'max_outstanding_packets', 'EDMK', '-1', '', '', ''),
(NOW(), 'packet_timeout', 'EDMK', '1', 'sec.', '', ''),
(NOW(), 'idle_event_rate', 'EDMK', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'EDMK', '2000', 'msec.', '', ''),
(NOW(), 'max_error_count', 'EDMK', '2', '', '', ''),
(NOW(), 'mb_request_timeout', 'EDMK', '1000', 'ms', '', ''),
(NOW(), 'mb_request_retries', 'EDMK', '2', '', '', ''),
(NOW(), 'com_error_alarm_delay', 'EDMK', '10', 'min.', '', ''),
(NOW(), 'show_queue_info', 'EDMK', '0', '', '', ''),
(NOW(), 'speed_index_block', 'EDMK', '10', '', '', ''),
(NOW(), 'speed_index_offline', 'EDMK', '10', '', '', ''),
(NOW(), 'speed_index_slow', 'EDMK', '1', '', '', ''),
(NOW(), 'speed_index_norm', 'EDMK', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'EDMK', '2', 'hours', '', ''),
(NOW(), 'max_group_count', 'EDMK', '1', '', '', ''),
(NOW(), 'value_quality_check_limit', 'EDMK', '0', '', '0 = disabled', ''),
(NOW(), 'mux_settle_time', 'EDMK', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
(NOW(), 'startup_delay', 'EDMK', '15', 'Sec.', '', ''),
(NOW(), 'alarm_handler', 'EDMK', '', '', '', '');

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(NOW(), 'EDMK', 'edmk_param', 'edmk_groups');

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
(NOW(), '0', 'iw_mb.exe', 'EDMK', '', '');

CREATE TABLE IF NOT EXISTS `iw_par_edmk_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

REPLACE INTO `iw_par_edmk_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
(NOW(), 'default_link', 1, '', ''),
(NOW(), 'group_alias', 1, 'energi', 'Energi'),
(NOW(), 'group', 10, 'energi', 'Aktiv_energi_positiv'),
(NOW(), 'group', 20, 'energi', 'Aktiv_Energi_negativ'),
(NOW(), 'group', 30, 'energi', 'Induktiv_reaktiv_energi_positiv'),
(NOW(), 'group', 40, 'energi', 'Kapasitiv_reaktiv_energi_positiv'),
(NOW(), 'group', 50, 'energi', 'Induktiv_reaktiv_energi_negativ'),
(NOW(), 'group', 60, 'energi', 'Kapasitiv_reaktiv_energi_negativ'),
(NOW(), 'group', 70, 'energi', 'Delforbruk_aktiv_energi_positiv'),
(NOW(), 'group', 80, 'energi', 'Delforbruk_aktiv_energi_negativ'),
(NOW(), 'group', 90, 'energi', 'Delforbruk_induktiv_reaktiv_energi_positiv'),
(NOW(), 'group', 100, 'energi', 'Delforbruk_kapasitiv_reaktiv_energi_positiv'),
(NOW(), 'group', 110, 'energi', 'Delforbruk_induktiv_reaktiv_energi_negativ'),
(NOW(), 'group', 120, 'energi', 'Delforbruk_kapasitiv_reaktiv_energi_negativ');

CREATE TABLE IF NOT EXISTS `iw_par_edmk_param` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-01 00:00:00',
  `element_id` varchar(100) NOT NULL DEFAULT '',
  `driver_id` varchar(100) NOT NULL DEFAULT '',
  `alias_text` text NOT NULL,
  `menu` varchar(10) NOT NULL DEFAULT '',
  `application` text NOT NULL,
  `parameter_type` text NOT NULL,
  `factory_setting` text NOT NULL,
  `grp` text NOT NULL,
  `att` text NOT NULL,
  `eng_unit` varchar(50) NOT NULL DEFAULT '',
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
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='3.2.3';

REPLACE INTO `iw_par_edmk_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
(NOW(), 'Aktiv_energi_positiv', '0_3_0', 'Aktiv energi positiv', '', 'Analog values', 'float', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_0_I16_N_-_-_-_-', ''),
(NOW(), 'Aktiv_Energi_negativ', '0_3_2', 'Aktiv Energi negativ', '', 'Analog values', 'float', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_2_I16_N_-_-_-_-', ''),
(NOW(), 'Induktiv_reaktiv_energi_positiv', '0_3_4', 'Induktiv reaktiv energi, positiv', '', 'Analog values', 'float', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_4_I16_N_-_-_-_-', ''),
(NOW(), 'Kapasitiv_reaktiv_energi_positiv', '0_3_6', 'Kapasitiv reaktiv energi, positiv', '', 'Analog values', 'float', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_6_I16_N_-_-_-_-', ''),
(NOW(), 'Induktiv_reaktiv_energi_negativ', '0_3_8', 'Induktiv reaktiv energi, negativ', '', 'Analog values', 'float', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_8_I16_N_-_-_-_-', ''),
(NOW(), 'Kapasitiv_reaktiv_energi_negativ', '0_3_10', 'Kapasitiv reaktiv energi, negativ', '', 'Analog values', 'float', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_10_I16_N_-_-_-_-', ''),
(NOW(), 'Delforbruk_aktiv_energi_positiv', '0_3_48', 'Delforbruk aktiv energi, positiv', '', 'Analog values', 'float', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_48_I16_N_-_-_-_-', ''),
(NOW(), 'Delforbruk_aktiv_energi_negativ', '0_3_50', 'Delforbruk aktiv energi, negativ', '', 'Analog values', 'float', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_50_I16_N_-_-_-_-', ''),
(NOW(), 'Delforbruk_induktiv_reaktiv_energi_positiv', '0_3_52', 'Delforbruk induktiv reaktiv energi, positiv', '', 'Analog values', 'float', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_52_I16_N_-_-_-_-', ''),
(NOW(), 'Delforbruk_kapasitiv_reaktiv_energi_positiv', '0_3_54', 'Delforbruk kapasitiv reaktiv energi, positiv', '', 'Analog values', 'float', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_54_I16_N_-_-_-_-', ''),
(NOW(), 'Delforbruk_induktiv_reaktiv_energi_negativ', '0_3_56', 'Delforbruk induktiv reaktiv energi, negativ', '', 'Analog values', 'float', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_56_I16_N_-_-_-_-', ''),
(NOW(), 'Delforbruk_kapasitiv_reaktiv_energi_negativ', '0_3_58', 'Delforbruk kapasitiv reaktiv energi, negativ', '', 'Analog values', 'float', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_58_I16_N_-_-_-_-', '');

CREATE TABLE IF NOT EXISTS `iw_set_edmk` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `element_id` varchar(100) NOT NULL DEFAULT '',
  `active` enum('0','1') NOT NULL DEFAULT '0',
  `onl_ind` enum('0','1') NOT NULL DEFAULT '1',
  `update_freq` set('','fast','norm','slow','once','never') NOT NULL DEFAULT 'norm',
  `save_data` enum('0','1','2') NOT NULL DEFAULT '0',
  `save_freq` set('','fast','norm','slow') NOT NULL DEFAULT 'norm',
  `plant_pri` char(1) NOT NULL DEFAULT '',
  `sys_pri` char(1) NOT NULL DEFAULT '',
  `alarm_type` tinyint(3) NOT NULL DEFAULT '0',
  PRIMARY KEY (`element_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.4';

REPLACE INTO `iw_set_edmk` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
(NOW(), 'Aktiv_energi_positiv', '1', '0', 'norm', '', '', '', '', 0),
(NOW(), 'Aktiv_Energi_negativ', '1', '1', 'norm', '', '', '', '', 0),
(NOW(), 'Induktiv_reaktiv_energi_positiv', '1', '0', 'norm', '', '', '', '', 0),
(NOW(), 'Kapasitiv_reaktiv_energi_positiv', '1', '1', 'norm', '', '', '', '', 0),
(NOW(), 'Induktiv_reaktiv_energi_negativ', '1', '0', 'norm', '', '', '', '', 0),
(NOW(), 'Kapasitiv_reaktiv_energi_negativ', '1', '1', 'norm', '', '', '', '', 0),
(NOW(), 'Delforbruk_aktiv_energi_positiv', '1', '0', 'norm', '', '', '', '', 0),
(NOW(), 'Delforbruk_aktiv_energi_negativ', '1', '1', 'norm', '', '', '', '', 0),
(NOW(), 'Delforbruk_induktiv_reaktiv_energi_positiv', '1', '0', 'norm', '', '', '', '', 0),
(NOW(), 'Delforbruk_kapasitiv_reaktiv_energi_positiv', '1', '1', 'norm', '', '', '', '', 0),
(NOW(), 'Delforbruk_induktiv_reaktiv_energi_negativ', '1', '0', 'norm', '', '', '', '', 0),
(NOW(), 'Delforbruk_kapasitiv_reaktiv_energi_negativ', '1', '1', 'norm', '', '', '', '', 0);






-- Changelog
--
-- v1 Orginal
--
--