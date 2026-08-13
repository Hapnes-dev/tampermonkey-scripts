REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`) VALUES
(NOW(), '0', '0', 'E01', 'Energi 1', 'siemens_uh50', 'UH50', '0_1', 'UH50', 'UH50', 0, ''),
(NOW(), '0', '0', 'E02', 'Energi 2', 'siemens_uh50', 'UH50', '0_2', 'UH50', 'UH50', 0, ''),
(NOW(), '0', '0', 'E03', 'Energi 3', 'siemens_uh50', 'UH50', '0_3', 'UH50', 'UH50', 0, '');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'comm_port', 'UH50', '4', '', '', ''),
(NOW(), 'comm_parity', 'UH50', '0', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'comm_data_bits', 'UH50', '8', '', '', ''),
(NOW(), 'comm_stop_bits', 'UH50', '1', '', '', ''),
(NOW(), 'comm_baudrate', 'UH50', '9600', '', '', ''),
(NOW(), 'mb_mode', 'UH50', '0', '', '0=RTU|1=ASCII|3=TCP', ''),
(NOW(), 'force_word_not_byte', 'UH50', '0', '', '0|1', ''),
(NOW(), 'handshake', 'UH50', '0', '', '0|1|2', ''),
(NOW(), 'check_rate', 'UH50', '1', 'ms', '', ''),
(NOW(), 'max_outstanding_packets', 'UH50', '-1', '', '', ''),
(NOW(), 'packet_timeout', 'UH50', '1', 'sec.', '', ''),
(NOW(), 'idle_event_rate', 'UH50', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'UH50', '2000', 'msec.', '', ''),
(NOW(), 'max_error_count', 'UH50', '2', '', '', ''),
(NOW(), 'mb_request_timeout', 'UH50', '1000', 'ms', '', ''),
(NOW(), 'mb_request_retries', 'UH50', '2', '', '', ''),
(NOW(), 'com_error_alarm_delay', 'UH50', '10', 'min.', '', ''),
(NOW(), 'show_queue_info', 'UH50', '0', '', '', ''),
(NOW(), 'speed_index_block', 'UH50', '10', '', '', ''),
(NOW(), 'speed_index_offline', 'UH50', '10', '', '', ''),
(NOW(), 'speed_index_slow', 'UH50', '1', '', '', ''),
(NOW(), 'speed_index_norm', 'UH50', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'UH50', '2', 'hours', '', ''),
(NOW(), 'max_group_count', 'UH50', '1', '', '', ''),
(NOW(), 'value_quality_check_limit', 'UH50', '0', '', '0 = disabled', ''),
(NOW(), 'mux_settle_time', 'UH50', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
(NOW(), 'startup_delay', 'UH50', '15', 'Sec.', '', ''),
(NOW(), 'alarm_handler', 'UH50', '', '', '', '');

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
(NOW(), '0', 'iw_mb.exe', 'UH50', '', '');

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(NOW(), 'UH50', 'siemens_uh50_param', 'siemens_uh50_groups');

CREATE TABLE IF NOT EXISTS `iw_par_siemens_uh50_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

REPLACE INTO `iw_par_siemens_uh50_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
(NOW(), 'default_link', 1, '', ''),
(NOW(), 'group_alias', 1, 'sys', 'System'),
(NOW(), 'group_alias', 2, 'temp', 'Temperatur'),
(NOW(), 'group_alias', 3, 'tr', 'Trykk'),
(NOW(), 'group_alias', 4, 'ana', 'Analog'),
(NOW(), 'group_alias', 5, 'dig', 'Digital'),
(NOW(), 'group_alias', 6, 'tid', 'Tider'),
(NOW(), 'group', 1, 'sys', 'sys_0_3_1'),
(NOW(), 'group', 2, 'sys', 'sys_0_3_2'),
(NOW(), 'group', 3, 'sys', 'sys_0_3_3'),
(NOW(), 'group', 4, 'sys', 'sys_0_3_4'),
(NOW(), 'group', 5, 'sys', 'sys_0_3_6'),
(NOW(), 'group', 6, 'sys', 'sys_0_3_8'),
(NOW(), 'group', 7, 'sys', 'sys_0_3_10'),
(NOW(), 'group', 8, 'sys', 'sys_0_3_12'),
(NOW(), 'group', 9, 'sys', 'sys_0_3_13'),
(NOW(), 'group', 10, 'sys', 'sys_0_3_14'),
(NOW(), 'group', 11, 'sys', 'sys_0_3_16'),
(NOW(), 'group', 12, 'sys', 'sys_0_3_18'),
(NOW(), 'group', 13, 'sys', 'sys_0_3_20'),
(NOW(), 'group', 14, 'sys', 'sys_0_3_22'),
(NOW(), 'group', 15, 'sys', 'sys_0_3_24'),
(NOW(), 'group', 16, 'sys', 'sys_0_3_26'),
(NOW(), 'group', 17, 'sys', 'sys_0_3_28'),
(NOW(), 'group', 18, 'sys', 'sys_0_3_30'),
(NOW(), 'group', 19, 'sys', 'sys_0_3_32'),
(NOW(), 'group', 20, 'sys', 'sys_0_3_34'),
(NOW(), 'group', 21, 'sys', 'sys_0_3_36'),
(NOW(), 'group', 22, 'sys', 'sys_0_3_38'),
(NOW(), 'group', 23, 'sys', 'sys_0_3_40');

CREATE TABLE IF NOT EXISTS `iw_par_siemens_uh50_param` (
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

REPLACE INTO `iw_par_siemens_uh50_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
(NOW(), 'sys_0_3_1', '0_3_1', 'Tp', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '', '', '', '', '', '', '', '', '3_1_I16_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_2', '0_3_2', 'Tv', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '', '', '', '', '', '', '', '', '3_2_I16_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_3', '0_3_3', 'dT', '', 'Analog values', 'float', '', '-1', 'r', 'kelvin', '', '', '', '', '', '', '', '', '3_3_I16_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_4', '0_3_4', 'Q', '', 'Analog values', 'float', '', '-1', 'r', 'm3/h', '', '', '', '', '', '', '', '', '3_4_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_6', '0_3_6', 'P', '', 'Analog values', 'float', '', '-1', 'r', 'kW', '', '', '', '', '', '', '', '', '3_6_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_8', '0_3_8', 'Echl', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_8_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_10', '0_3_10', 'Time', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_10_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_12', '0_3_12', 'F', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_12_I16_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_13', '0_3_13', 'header', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_13_I16_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_14', '0_3_14', 'E', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_14_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_16', '0_3_16', 'V', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_16_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_18', '0_3_18', 'N', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_18_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_20', '0_3_20', 'EM', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_20_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_22', '0_3_22', 'VM', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_22_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_24', '0_3_24', 'A1', '', 'Analog values', 'float', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '3_24_U32_N_6_24_U32_N', ''),
(NOW(), 'sys_0_3_26', '0_3_26', 'A2', '', 'Analog values', 'float', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '3_26_U32_N_6_26_U32_N', ''),
(NOW(), 'sys_0_3_28', '0_3_28', 'I1', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_28_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_30', '0_3_30', 'I2', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_30_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_32', '0_3_32', 'N1', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_32_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_34', '0_3_34', 'N2', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_34_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_36', '0_3_36', 'tariff register 1', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_36_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_38', '0_3_38', 'tariff register 2', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_38_U32_N_-_-_-_-', ''),
(NOW(), 'sys_0_3_40', '0_3_40', 'tariff register 3', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_40_U32_N_-_-_-_-', '');

CREATE TABLE IF NOT EXISTS `iw_set_siemens_uh50` (
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

REPLACE INTO `iw_set_siemens_uh50` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
(NOW(), 'sys_0_3_1', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_2', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_3', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_4', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_6', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_8', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_10', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_12', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_13', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_14', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_16', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_18', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_20', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_22', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_24', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'sys_0_3_26', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'sys_0_3_28', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_30', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_32', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_34', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_36', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_38', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'sys_0_3_40', '1', '0', 'norm', 'min', '1', '', '', 0);




-- Changelog
--
--
-- v1 orginal
--
--
--