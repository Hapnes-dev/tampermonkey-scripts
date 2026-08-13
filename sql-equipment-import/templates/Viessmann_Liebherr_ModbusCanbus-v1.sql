-- Husk å be montør sjekke at MODBUS og Canbus er Aktivert på Canbus konverteren! Ellers vil det aldri fungere.

REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`) VALUES
(NOW(), '0', '0', 'P01', 'Plugin Chest 01', 'viessmann_modbus', 'VIESSMANN', '0_1', 'VIESSMANN', 'VIESSMANN', 0, ''),
(NOW(), '0', '0', 'P02', 'Plugin Chest 02', 'viessmann_modbus', 'VIESSMANN', '0_2', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P03', 'Plugin Chest 03', 'viessmann_modbus', 'VIESSMANN', '0_3', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P04', 'Plugin Chest 04', 'viessmann_modbus', 'VIESSMANN', '0_4', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P05', 'Plugin Chest 05', 'viessmann_modbus', 'VIESSMANN', '0_5', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P06', 'Plugin Chest 06', 'viessmann_modbus', 'VIESSMANN', '0_6', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P07', 'Plugin Chest 07', 'viessmann_modbus', 'VIESSMANN', '0_7', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P08', 'Plugin Chest 08', 'viessmann_modbus', 'VIESSMANN', '0_8', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P09', 'Plugin Chest 09', 'viessmann_modbus', 'VIESSMANN', '0_9', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P10', 'Plugin Chest 10', 'viessmann_modbus', 'VIESSMANN', '0_10', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P11', 'Plugin Chest 11', 'viessmann_modbus', 'VIESSMANN', '0_11', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P12', 'Plugin Chest 12', 'viessmann_modbus', 'VIESSMANN', '0_12', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P13', 'Plugin Chest 13', 'viessmann_modbus', 'VIESSMANN', '0_13', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P14', 'Plugin Chest 14', 'viessmann_modbus', 'VIESSMANN', '0_14', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P15', 'Plugin Chest 15', 'viessmann_modbus', 'VIESSMANN', '0_15', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P16', 'Plugin Chest 16', 'viessmann_modbus', 'VIESSMANN', '0_16', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P17', 'Plugin Chest 17', 'viessmann_modbus', 'VIESSMANN', '0_17', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P18', 'Plugin Chest 18', 'viessmann_modbus', 'VIESSMANN', '0_18', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P19', 'Plugin Chest 19', 'viessmann_modbus', 'VIESSMANN', '0_19', 'VIESSMANN', 'VIESSMANN', 0, '');
(NOW(), '0', '0', 'P20', 'Plugin Chest 20', 'viessmann_modbus', 'VIESSMANN', '0_20', 'VIESSMANN', 'VIESSMANN', 0, '');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'mb_mode', 'VIESSMANN', '0', '', '0=RTU|1=ASCII|2=TCP', ''),
(NOW(), 'comm_port', 'VIESSMANN', '5', '', '', ''),
(NOW(), 'comm_parity', 'VIESSMANN', '0', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'comm_data_bits', 'VIESSMANN', '8', '', '', ''),
(NOW(), 'comm_stop_bits', 'VIESSMANN', '1', '', '', ''),
(NOW(), 'comm_baudrate', 'VIESSMANN', '9600', '', '', ''),
(NOW(), 'mb_tcp_servers', 'VIESSMANN', '1;192.168.0.43;502;1000;2;1000\r\n', '', 'ID;IPadr;IPport;ConnTout;ConnRetries;RequestTout', ''),
(NOW(), 'mb_request_retries', 'VIESSMANN', '2', '', '', ''),
(NOW(), 'force_word_not_byte', 'VIESSMANN', '0', '', '0|1', ''),
(NOW(), 'handshake', 'VIESSMANN', '0', '', '0|1|2', ''),
(NOW(), 'check_rate', 'VIESSMANN', '1', 'ms', '', ''),
(NOW(), 'max_outstanding_packets', 'VIESSMANN', '-1', '', '', ''),
(NOW(), 'packet_timeout', 'VIESSMANN', '1', 'sec.', '', ''),
(NOW(), 'idle_event_rate', 'VIESSMANN', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'VIESSMANN', '2000', 'msec.', '', ''),
(NOW(), 'max_error_count', 'VIESSMANN', '2', '', '', ''),
(NOW(), 'mb_request_timeout', 'VIESSMANN', '1000', 'ms', '', ''),
(NOW(), 'com_error_alarm_delay', 'VIESSMANN', '10', 'min.', '', ''),
(NOW(), 'show_queue_info', 'VIESSMANN', '0', '', '', ''),
(NOW(), 'speed_index_block', 'VIESSMANN', '10', '', '', ''),
(NOW(), 'speed_index_offline', 'VIESSMANN', '10', '', '', ''),
(NOW(), 'speed_index_slow', 'VIESSMANN', '1', '', '', ''),
(NOW(), 'speed_index_norm', 'VIESSMANN', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'VIESSMANN', '2', 'hours', '', ''),
(NOW(), 'max_group_count', 'VIESSMANN', '1', '', '', ''),
(NOW(), 'value_quality_check_limit', 'VIESSMANN', '0', '', '0 = disabled', ''),
(NOW(), 'mux_settle_time', 'VIESSMANN', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
(NOW(), 'startup_delay', 'VIESSMANN', '15', 'Sec.', '', ''),
(NOW(), 'alarm_handler', 'VIESSMANN', '', '', '', ''),
(NOW(), 'mb_tcp_connect_retries_default', 'VIESSMANN', '2', '', '', ''),
(NOW(), 'mb_tcp_connect_timeout_default', 'VIESSMANN', '1000', 'ms', '', '');

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
(NOW(), '0', 'iw_mb.exe', 'VIESSMANN', '', '');

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(NOW(), 'VIESSMANN', 'viessmann_modbus_param', 'viessmann_modbus_groups');

CREATE TABLE IF NOT EXISTS `iw_par_viessmann_modbus_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

REPLACE INTO `iw_par_viessmann_modbus_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
(NOW(), 'default_link', 1, '', ''),
(NOW(), 'group_alias', 1, 'mes', 'Measurements'),
(NOW(), 'group', 1, 'mes', 'mes_0_3_1'),
(NOW(), 'group', 2, 'mes', 'mes_0_3_2'),
(NOW(), 'group', 3, 'mes', 'mes_0_3_3.1'),
(NOW(), 'group', 4, 'mes', 'mes_0_3_3.2'),
(NOW(), 'group', 5, 'mes', 'mes_0_3_3.14'),
(NOW(), 'group', 6, 'mes', 'mes_0_3_3.15');

CREATE TABLE IF NOT EXISTS `iw_par_viessmann_modbus_param` (
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
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='3.2.3';

REPLACE INTO `iw_par_viessmann_modbus_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
(NOW(), 'mes_0_3_1', '0_3_1', 'Actual temperature value', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_1_I16_N_-_-_-_-', ''),
(NOW(), 'mes_0_3_2', '0_3_2', 'Setpoint temperature', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_2_I16_N_-_-_-_-', ''),
(NOW(), 'mes_0_3_3', '0_3_3', 'Status register', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_3_I16_N_-_-_-_-', ''),
(NOW(), 'mes_0_3_3.0', '0_3_3.0', 'Cold location on', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.1', '0_3_3.1', 'Cooling status', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.2', '0_3_3.2', 'Defrost status', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.3', '0_3_3.3', 'Door open', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.4', '0_3_3.4', 'Reserved', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.5', '0_3_3.5', 'Reserved', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.6', '0_3_3.6', 'Reserved', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.7', '0_3_3.7', 'Reserved', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.8', '0_3_3.8', 'Reserved', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.9', '0_3_3.9', 'Reserved', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.10', '0_3_3.10', 'Reserved', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.11', '0_3_3.11', 'Reserved', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.12', '0_3_3.12', 'Reserved', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.13', '0_3_3.13', 'Reserved', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.14', '0_3_3.14', 'Overtemperature status alarm', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', ''),
(NOW(), 'mes_0_3_3.15', '0_3_3.15', 'General alarm', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3_I16_N_', '');

CREATE TABLE IF NOT EXISTS `iw_set_viessmann_modbus` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
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
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='4.0.0';

REPLACE INTO `iw_set_viessmann_modbus` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
(NOW(), 'mes_0_3_1', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'mes_0_3_2', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'mes_0_3_3', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.0', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.1', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.2', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.3', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.4', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.5', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.6', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.7', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.8', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.9', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.10', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.11', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.12', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.13', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'mes_0_3_3.14', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'mes_0_3_3.15', '1', '0', 'slow', 'change', '', 'A', '', 0);




-- Changelog
--
-- v1 Orginal
--
--