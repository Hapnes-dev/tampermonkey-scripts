REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `driver_adr_extra`) VALUES
(NOW(), '1', '0', 'E01', 'Energi 1', 'cge_em23', 'EM23', '0_1', 'EM23', 'EM23', ''),
(NOW(), '1', '0', 'E02', 'Energi 2', 'cge_em23', 'EM23', '0_2', 'EM23', 'EM23', ''),
(NOW(), '1', '0', 'E03', 'Energi 3', 'cge_em23', 'EM23', '0_3', 'EM23', 'EM23', '');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'comm_port', 'EM23', '5', '', '', ''),
(NOW(), 'comm_parity', 'EM23', '0', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'comm_data_bits', 'EM23', '8', '', '', ''),
(NOW(), 'comm_stop_bits', 'EM23', '1', '', '', ''),
(NOW(), 'comm_baudrate', 'EM23', '9600', '', '', ''),
(NOW(), 'mb_mode', 'EM23', '0', '', '0=RTU|1=ASCII|3=TCP', ''),
(NOW(), 'force_word_not_byte', 'EM23', '0', '', '0|1', ''),
(NOW(), 'handshake', 'EM23', '0', '', '0|1|2', ''),
(NOW(), 'check_rate', 'EM23', '1', 'ms', '', ''),
(NOW(), 'max_outstanding_packets', 'EM23', '-1', '', '', ''),
(NOW(), 'packet_timeout', 'EM23', '1', 'sec.', '', ''),
(NOW(), 'idle_event_rate', 'EM23', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'EM23', '2000', 'msec.', '', ''),
(NOW(), 'max_error_count', 'EM23', '2', '', '', ''),
(NOW(), 'mb_request_timeout', 'EM23', '1000', 'ms', '', ''),
(NOW(), 'mb_request_retries', 'EM23', '2', '', '', ''),
(NOW(), 'com_error_alarm_delay', 'EM23', '10', 'min.', '', ''),
(NOW(), 'show_queue_info', 'EM23', '0', '', '', ''),
(NOW(), 'speed_index_block', 'EM23', '10', '', '', ''),
(NOW(), 'speed_index_offline', 'EM23', '10', '', '', ''),
(NOW(), 'speed_index_slow', 'EM23', '1', '', '', ''),
(NOW(), 'speed_index_norm', 'EM23', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'EM23', '2', 'hours', '', ''),
(NOW(), 'max_group_count', 'EM23', '1', '', '', ''),
(NOW(), 'value_quality_check_limit', 'EM23', '0', '', '0 = disabled', '');

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(NOW(), 'EM23', 'cge_em23_param', 'cge_em23_groups');

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
(NOW(), '0', 'iw_mb.exe', 'EM23', '', '');

CREATE TABLE IF NOT EXISTS `iw_par_cge_em23_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

REPLACE INTO `iw_par_cge_em23_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
(NOW(), 'default_link', 1, '', ''),
(NOW(), 'group_alias', 1, 'status', 'Measurements'),
(NOW(), 'group_alias', 3, 'settings', 'Settings'),
(NOW(), 'group', 1, 'status', 'V_L1_N'),
(NOW(), 'group', 2, 'status', 'V_L2_N'),
(NOW(), 'group', 3, 'status', 'V_L3_N'),
(NOW(), 'group', 7, 'status', 'A_L1'),
(NOW(), 'group', 8, 'status', 'A_L2'),
(NOW(), 'group', 9, 'status', 'A_L3'),
(NOW(), 'group', 10, 'status', 'W_SYS'),
(NOW(), 'group', 11, 'status', 'Var_SYS'),
(NOW(), 'group', 12, 'status', 'PF_seq'),
(NOW(), 'group', 13, 'status', 'kwh_tot'),
(NOW(), 'group', 14, 'status', 'kvarh_tot_p'),
(NOW(), 'group', 1, 'settings', 'version_code'),
(NOW(), 'group', 2, 'settings', 'revision_code'),
(NOW(), 'group', 4, 'settings', 'identification_code'),
(NOW(), 'group', 5, 'settings', 'password'),
(NOW(), 'group', 6, 'settings', 'RS485_instrument_address'),
(NOW(), 'group', 7, 'settings', 'RS485_baud_rate'),
(NOW(), 'group', 8, 'settings', 'Year');

CREATE TABLE IF NOT EXISTS `iw_par_cge_em23_param` (
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

REPLACE INTO `iw_par_cge_em23_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
(NOW(), 'V_L1_N', '0_I32_0', 'V L1-N', '', 'Analoge values', 'float', '', '1', 'r', 'V', '%.0f', '', '', '1', '0', '10000', '0', '1000', '3_0_I32_N_-_-_-_-', ''),
(NOW(), 'V_L2_N', '0_I32_2', 'V L2-N', '', 'Analoge values', 'float', '', '1', 'r', 'V', '%.0f', '', '', '1', '0', '10000', '0', '1000', '3_2_I32_N_-_-_-_-', ''),
(NOW(), 'V_L3_N', '0_I32_4', 'V L3-N', '', 'Analoge values', 'float', '', '1', 'r', 'V', '%.0f', '', '', '1', '0', '10000', '0', '1000', '3_4_I32_N_-_-_-_-', ''),
(NOW(), 'A_L1', '0_I32_6', 'A L1', '', 'Analoge values', 'float', '', '1', 'r', 'A', '%.1f', '', '', '1', '0', '10000', '0', '10', '3_6_I32_N_-_-_-_-', ''),
(NOW(), 'A_L2', '0_I32_8', 'A L2', '', 'Analoge values', 'float', '', '1', 'r', 'A', '%.1f', '', '', '1', '0', '10000', '0', '10', '3_8_I32_N_-_-_-_-', ''),
(NOW(), 'A_L3', '0_I32_A', 'A L3', '', 'Analoge values', 'float', '', '1', 'r', 'A', '%.1f', '', '', '1', '0', '10000', '0', '10', '3_10_I32_N_-_-_-_-', ''),
(NOW(), 'W_SYS', '0_I32_C', 'kW sys', '', 'Analoge values', 'float', '', '1', 'r', 'kW', '%.1f', '', '', '1', '0', '100000', '0', '10', '3_12_I32_N_-_-_-_-', ''),
(NOW(), 'PF_seq', '0_I16_10', 'Phase sequence', '', 'Analoge values', 'float', '', '1', 'r', '', '%.0f', '', '', '', '', '', '', '', '3_16_I16_N_-_-_-_-', ''),
(NOW(), 'kwh_tot', '0_I32_E', 'kWh (+) tot.', '', 'Integral values', 'integer', '', '1', 'r', 'kWh', '%.0f', '', '', '1', '0', '10000', '0', '1000', '3_14_I32_N_-_-_-_-', ''),
(NOW(), 'kvarh_tot_p', '0_I32_14', 'kVARh (+) tot.', '', 'Integral values', 'integer', '', '1', 'r', 'kVARh', '%.0f', '', '', '1', '0', '10000', '0', '1000', '3_20_I32_N_-_-_-_-', ''),
(NOW(), 'version_code', '0_U16_302', 'Version Code', '', 'Integral values', 'integer', '', '1', 'r', '', '%.0f', '', '', '', '', '', '', '', '3_770_U16_N_-_-_-_-', ''),
(NOW(), 'revision_code', '0_U16_303', 'Revision Code', '', 'Integral values', 'integer', '', '1', 'r', '', '%.0f', '', '', '', '', '', '', '', '3_771_U16_N_-_-_-_-', ''),
(NOW(), 'identification_code', '0_U16_B', 'Identification Code', '', 'Integral values', 'integer', '', '1', 'r', '', '%.0f', '', '', '', '', '', '', '', '3_11_U16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"12":{"t":"EM4 90A"},"13":{"t":"EM4 5A"},"14":{"t":"WM22 90A"},"15":{"t":"WM22 5A"},"16":{"t":"WM4"},"17":{"t":"WM23"},"18":{"t":"WM24"},"19":{"t":"WM12"},"20":{"t":"WM3"},"29":{"t":"WM14-AV5"},"30":{"t":"WM14-AV6"},"33":{"t":"CPT_DIN AV5 3 AX"},"34":{"t":"CPT_DIN AV6 3 AX"},"35":{"t":"CPT_DIN AV5 1 AX"},"36":{"t":"CPT_DIN AV6 1 AX"},"37":{"t":"CPT_DIN AV5 1 BX"},"38":{"t":"CPT_DIN AV6 1 BX"},"39":{"t":"WM14 advance AV5"},"40":{"t":"WM14 advance AV6"},"41":{"t":"WM5"},"42":{"t":"PQTH"},"43":{"t":"CPT_DIN AV5 3 BX"},"44":{"t":"CPT_DIN AV6 3 BX"},"45":{"t":"EM24DIN AV9"},"46":{"t":"EM24DIN AV0"},"47":{"t":"EM24DIN AV5"},"48":{"t":"EM24DINAV6"},"49":{"t":"EM26-96 AV5"},"50":{"t":"EM26-96-AV6"},"51":{"t":"EM25-96-AV5"},"52":{"t":"EM25-96-AV6"},"57":{"t":"EM21-AV5/6"},"64":{"t":"EM33DIN-AV3"},"65":{"t":"WM3096AVX"},"66":{"t":"WM4096AVX"},"70":{"t":"EM21 retrofit"},"71":{"t":"EM24DIN AV9/AV2 rev"},"72":{"t":"EM24DIN AV5 rev"},"73":{"t":"EM24DINAV6 rev"},"77":{"t":"EM21-AV5/AV6 rev"},"78":{"t":"EM26-96 AV5 rev"},"79":{"t":"EM26-96-AV6 rev"},"84":{"t":"EM23DINAV91XS1X07"},"87":{"t":"EM23DIN AV9/AV2"},"90":{"t":"EM24DIN M1"},"93":{"t":"EM24DIN M2"},"94":{"t":"EM24DINAV93XISX25"},"95":{"t":"CPA050"},"96":{"t":"CPA300"},"97":{"t":"CPA300V"},"98":{"t":"WM2096AVX"},"99":{"t":"WM50 base"},"100":{"t":"EM110-DIN AV7 1 x S1"},"101":{"t":"EM111-DIN AV7 1 x S1"},"102":{"t":"EM112-DIN AV1 1 x S1"},"110":{"t":"EM110-DIN AV8 1 x S1"},"111":{"t":"EM111-DIN AV8 1 x S1"},"112":{"t":"EM112-DIN AV0 1 x S1"},"120":{"t":"ET112-DIN AV0 1 x S1"},"121":{"t":"ET112-DIN AV1 1 x S1"},"196":{"t":"EM111-DIN M-Bus"},"197":{"t":"EM112-DIN M-Bus"},"198":{"t":"EM330-DIN M-Bus"},"199":{"t":"EM340-DIN M-Bus"},"210":{"t":"EM210D"},"211":{"t":"EM210V"},"270":{"t":"EM27072DMV53X2SX"},"271":{"t":"EM27072DMV53XOSX"},"272":{"t":"EM27072DMV63X2SX"},"273":{"t":"EM27072DMV63XOSX"},"274":{"t":"EM27172DMV53X2SX"},"275":{"t":"EM27172DMV53XOSX"},"276":{"t":"EM27172DMV63X2SX"},"277":{"t":"EM27172DMV63XOSX"},"280":{"t":"EM28072DMV53X2SX"},"281":{"t":"EM28072DMV53XOSX"},"282":{"t":"EM28072DMV63X2SX"},"283":{"t":"EM28072DMV63XOSX"},"331":{"t":"EM330-DIN AV6 3 S1"},"332":{"t":"EM330-DIN AV5 3 S1"},"333":{"t":"EM335-DIN AV5 3H OS"},"335":{"t":"ET330-DIN AV5 3 S1"},"336":{"t":"ET330-DIN AV6 3 S1"},"341":{"t":"EM340-DIN AV2 3 X S1"},"342":{"t":"EM345-DIN AV2 3X OS"},"345":{"t":"ET340-DIN AV2 3 X S1"},"346":{"t":"EM341-DIN AV2 3 X OS"},"355":{"t":"EM331-DIN.AV5.3.H.OS.X"},"378":{"t":"EM21072DAV53XOSX08"},"399":{"t":"ET340-DIN AV2 3 X S1"}}}'),
(NOW(), 'password', '0_U16_1100', 'PASSWORD', '', 'Integral values', 'integer', '', '1', 'rw', '', '%.0f', '', '', '', '', '', '', '', '3_4352_U16_N_6_4352_U16_N', ''),
(NOW(), 'RS485_instrument_address', '0_U16_1101', 'RS485 instrument address', '', 'Integral values', 'integer', '', '1', 'rw', '', '%.0f', '', '', '', '', '', '', '', '3_4353_U16_N_6_4353_U16_N', ''),
(NOW(), 'RS485_baud_rate', '0_U16_1102', 'RS485 baud rate', '', 'Integral values', 'integer', '', '1', 'rw', '', '%.0f', '', '', '', '', '', '', '', '3_4354_U16_N_6_4354_U16_N', ''),
(NOW(), 'Year', '0_U16_1103', 'Year', '', 'Integral values', 'integer', '', '1', 'rw', '', '%.0f', '', '', '', '', '', '', '', '3_4355_U16_N_-_-_-_-', ''),
(NOW(), 'Var_SYS', '0_I32_12', 'Var sys', '', 'Analoge values', 'float', '', '1', 'r', 'Var', '%.1f', '', '', '1', '0', '10000', '0', '1000', '3_18_I32_N_-_-_-_-', '');

CREATE TABLE IF NOT EXISTS `iw_set_cge_em23` (
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
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='3.0.0';

REPLACE INTO `iw_set_cge_em23` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
(NOW(), 'V_L1_N', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'V_L2_N', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'V_L3_N', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'A_L1', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'A_L2', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'A_L3', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'W_SYS', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Var_SYS', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'PF_seq', '1', '0', 'slow', 'min', '1', '', '', 0),
(NOW(), 'kwh_tot', '1', '0', 'slow', 'min', '1', '', '', 0),
(NOW(), 'kvarh_tot_p', '1', '0', 'slow', 'min', '1', '', '', 0),
(NOW(), 'version_code', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'revision_code', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'identification_code', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'password', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'RS485_instrument_address', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'RS485_baud_rate', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'Year', '1', '0', 'slow', 'change', '', '', '', 0);




-- Changelog
--
-- v1 Orginal
--
--