-- Lav og høytemp alarm samtidig betyr probe-error.

REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`) VALUES
(NOW(), '1', '0', 'U01', 'Plugin 1', 'dixell_xlr170', 'DIXELL', '0_1', 'DIXELL', 'DIXELL', 0, ''),
(NOW(), '1', '0', 'U02', 'Plugin 2', 'dixell_xlr170', 'DIXELL', '0_2', 'DIXELL', 'DIXELL', 0, ''),
(NOW(), '1', '0', 'U03', 'Plugin 3', 'dixell_xlr170', 'DIXELL', '0_3', 'DIXELL', 'DIXELL', 0, ''),
(NOW(), '1', '0', 'U04', 'Plugin 4', 'dixell_xlr170', 'DIXELL', '0_4', 'DIXELL', 'DIXELL', 0, ''),
(NOW(), '1', '0', 'U05', 'Plugin 5', 'dixell_xlr170', 'DIXELL', '0_5', 'DIXELL', 'DIXELL', 0, ''),
(NOW(), '1', '0', 'U06', 'Plugin 6', 'dixell_xlr170', 'DIXELL', '0_6', 'DIXELL', 'DIXELL', 0, ''),
(NOW(), '1', '0', 'U07', 'Plugin 7', 'dixell_xlr170', 'DIXELL', '0_7', 'DIXELL', 'DIXELL', 0, ''),
(NOW(), '1', '0', 'U08', 'Plugin 8', 'dixell_xlr170', 'DIXELL', '0_8', 'DIXELL', 'DIXELL', 0, ''),
(NOW(), '1', '0', 'U09', 'Plugin 9', 'dixell_xlr170', 'DIXELL', '0_9', 'DIXELL', 'DIXELL', 0, ''),
(NOW(), '1', '0', 'U10', 'Plugin 10', 'dixell_xlr170', 'DIXELL', '0_10', 'DIXELL', 'DIXELL', 0, '');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'comm_port', 'DIXELL', '2', '', '', ''),
(NOW(), 'mb_mode', 'DIXELL', '0', '', '0=RTU|1=ASCII|2=TCP', ''),
(NOW(), 'mb_tcp_servers', 'DIXELL', '1;xxxxxxxxx;502;1000;2;1000\r\n', '', 'ID;IPadr;IPport;ConnTout;ConnRetries;RequestTout', ''),
(NOW(), 'comm_parity', 'DIXELL', '0', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'comm_data_bits', 'DIXELL', '8', '', '', ''),
(NOW(), 'comm_stop_bits', 'DIXELL', '1', '', '', ''),
(NOW(), 'comm_baudrate', 'DIXELL', '9600', '', '', ''),
(NOW(), 'mb_request_retries', 'DIXELL', '1', '', '', ''),
(NOW(), 'force_word_not_byte', 'DIXELL', '0', '', '0|1', ''),
(NOW(), 'handshake', 'DIXELL', '0', '', '0|1|2', ''),
(NOW(), 'check_rate', 'DIXELL', '1', 'ms', '', ''),
(NOW(), 'max_outstanding_packets', 'DIXELL', '-1', '', '', ''),
(NOW(), 'packet_timeout', 'DIXELL', '1', 'sec.', '', ''),
(NOW(), 'idle_event_rate', 'DIXELL', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'DIXELL', '2000', 'msec.', '', ''),
(NOW(), 'max_error_count', 'DIXELL', '1', '', '', ''),
(NOW(), 'mb_request_timeout', 'DIXELL', '500', 'ms', '', ''),
(NOW(), 'com_error_alarm_delay', 'DIXELL', '10', 'min.', '', ''),
(NOW(), 'show_queue_info', 'DIXELL', '0', '', '', ''),
(NOW(), 'speed_index_block', 'DIXELL', '10', '', '', ''),
(NOW(), 'speed_index_offline', 'DIXELL', '10', '', '', ''),
(NOW(), 'speed_index_slow', 'DIXELL', '1', '', '', ''),
(NOW(), 'speed_index_norm', 'DIXELL', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'DIXELL', '2', 'hours', '', ''),
(NOW(), 'max_group_count', 'DIXELL', '1', '', '', ''),
(NOW(), 'value_quality_check_limit', 'DIXELL', '0', '', '0 = disabled', ''),
(NOW(), 'mux_settle_time', 'DIXELL', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
(NOW(), 'startup_delay', 'DIXELL', '15', 'Sec.', '', ''),
(NOW(), 'alarm_handler', 'DIXELL', '', '', '', ''),
(NOW(), 'mb_tcp_connect_retries_default', 'DIXELL', '2', '', '', ''),
(NOW(), 'mb_tcp_connect_timeout_default', 'DIXELL', '1000', 'ms', '', '');

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(NOW(), 'DIXELL', 'dixell_xlr170_param', 'dixell_xlr170_groups');

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
(NOW(), '0', 'iw_mb.exe', 'DIXELL', '', '');

CREATE TABLE IF NOT EXISTS `iw_par_dixell_xlr170_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

REPLACE INTO `iw_par_dixell_xlr170_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
(NOW(), 'default_link', 1, '', ''),
(NOW(), 'group_alias', 1, 'main', 'Dixell XLR'),
(NOW(), 'group', 1, 'main', 'main_0_3_256'),
(NOW(), 'group', 2, 'main', 'main_0_3_878'),
(NOW(), 'group', 3, 'main', 'main_0_3_32841.1'),
(NOW(), 'group', 4, 'main', 'main_0_3_257.0#1'),
(NOW(), 'group', 5, 'main', 'main_0_3_257.0'),
(NOW(), 'group', 6, 'main', 'main_0_3_257.1'),
(NOW(), 'group', 7, 'main', 'main_0_3_2048.14'),
(NOW(), 'group', 8, 'main', 'main_0_3_2048.8'),
(NOW(), 'group', 9, 'main', 'main_0_3_2048.9'),
(NOW(), 'group', 10, 'main', 'main_0_3_2048.10'),
(NOW(), 'group', 11, 'main', 'main_0_3_2048.11'),
(NOW(), 'group', 12, 'main', 'main_0_3_2048.12'),
(NOW(), 'group', 13, 'main', 'main_0_3_2048.13'),
(NOW(), 'group', 14, 'main', 'main_0_3_2049.14'),
(NOW(), 'group', 15, 'main', 'main_0_3_2049.8'),
(NOW(), 'group', 16, 'main', 'main_0_3_2049.9'),
(NOW(), 'group', 17, 'main', 'main_0_3_1280.8'),
(NOW(), 'group', 18, 'main', 'main_0_3_1280.9'),
(NOW(), 'group', 19, 'main', 'main_0_3_1280.11'),
(NOW(), 'group', 20, 'main', 'main_0_3_1280.14'),
(NOW(), 'group', 21, 'main', 'main_0_3_32841.0'),
(NOW(), 'group', 22, 'main', 'main_0_3_832'),
(NOW(), 'group', 23, 'main', 'main_0_3_3328.11'),
(NOW(), 'group', 24, 'main', 'main_0_3_3328.12'),
(NOW(), 'group', 25, 'main', 'main_0_3_3328.13'),
(NOW(), 'group', 26, 'main', 'main_0_3_3328.14');

CREATE TABLE IF NOT EXISTS `iw_par_dixell_xlr170_param` (
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

REPLACE INTO `iw_par_dixell_xlr170_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
(NOW(), 'main_0_3_256', '0_3_256', 'Room temperature (Pb1)', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_256_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_878', '0_3_878', 'Set Point', '', 'Analog values', 'float', '', '-1', 'rw', '&deg;C', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_878_I16_N_16_878_I16_N', ''),
(NOW(), 'main_0_3_32841', '0_3_32841', 'name', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_32841_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_2049', '0_3_2049', 'test', '', 'Integral values', 'integer', '', '-1', 'r', '', '%.0f', '', '', '', '', '', '', '', '3_2049_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_32841.1', '0_3_32841.1', 'Digital Input 2', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_32841_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_257', '0_3_257', 'name', '', 'Integral values', 'integer', '', '-1', 'r', '', '%.0f', '', '', '', '', '', '', '', '3_257_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_257.0#1', '0_3_257.0#1', 'Actual Alarm State', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_257_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"No active alarm"},"1":{"t":"Low temperature alarm"},"2":{"t":"High temperature alarm"},"3":{"t":"Probe Error"}}}'),
(NOW(), 'main_0_3_257.0', '0_3_257.0', 'Low temperature alarm', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_257_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Normal"},"1":{"t":"Alarm Active"}}}'),
(NOW(), 'main_0_3_257.1', '0_3_257.1', 'High temperature alarm', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_257_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Normal"},"1":{"t":"Alarm Active"}}}'),
(NOW(), 'main_0_3_2048', '0_3_2048', 'name 2', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_2048_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_2048.14', '0_3_2048.14', 'Anti Condensing', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_2048_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_2048.8', '0_3_2048.8', 'On/Off Out', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_2048_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_2048.9', '0_3_2048.9', 'Defrost', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_2048_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_2048.10', '0_3_2048.10', 'Defrost 2', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_2048_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_2048.11', '0_3_2048.11', 'Alarm', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_2048_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_2048.12', '0_3_2048.12', 'Light', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_2048_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_2048.13', '0_3_2048.13', 'Fan', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_2048_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_2049.14', '0_3_2049.14', 'Aux', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_2049_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_2049.8', '0_3_2049.8', 'Cooling', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_2049_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_2049.9', '0_3_2049.9', 'Cooling 2', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_2049_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_1280', '0_3_1280', 'name3', '', 'Integral values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '3_1280_I16_N_16_1280_I16_N', ''),
(NOW(), 'main_0_3_1280.8', '0_3_1280.8', 'On/Off', '', 'Integral values', 'integer', '', '-1', 'vrw', '', '%.0f', '', '', '', '', '', '', '', '3_1280_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_1280.9', '0_3_1280.9', 'Defrost', '', 'Integral values', 'integer', '', '-1', 'vrw', '', '%.0f', '', '', '', '', '', '', '', '3_1280_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_1280.11', '0_3_1280.11', 'Keyboard', '', 'Integral values', 'integer', '', '-1', 'vrw', '', '%.0f', '', '', '', '', '', '', '', '3_1280_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_1280.14', '0_3_1280.14', 'Energy Saving', '', 'Integral values', 'integer', '', '-1', 'vrw', '', '%.0f', '', '', '', '', '', '', '', '3_1280_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_32841.0', '0_3_32841.0', 'Door Switch', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_32841_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'main_0_3_832', '0_3_832', 'Digital Input 2 Configuration', '', 'Integral values', 'integer', '', '-1', 'rw', '', '%.0f', '', '', '', '', '', '', '', '3_832_I16_N_16_832_I16_N', '{"rev":"1","type":"num","v":{"0":{"t":"Generic Alarm"},"1":{"t":"Serious Alarm Mode"},"2":{"t":"Pressure Switch"},"3":{"t":"Start Defrost"},"4":{"t":"Relay Aux Actuation"},"5":{"t":"Energy Saving"},"6":{"t":"Remote ON/OFF"},"7":{"t":"Panic Alarm"}}}'),
(NOW(), 'main_0_3_3328', '0_3_3328', 'test', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_3328_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_3328.11', '0_3_3328.11', 'Open Door', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3328_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Closed"},"1":{"t":"Open"}}}'),
(NOW(), 'main_0_3_3328.12', '0_3_3328.12', 'Severe/External Alarm', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3328_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Normal"},"1":{"t":"Alarm Active"}}}'),
(NOW(), 'main_0_3_3328.13', '0_3_3328.13', 'RTC Failure', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3328_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Normal"},"1":{"t":"Alarm Active"}}}'),
(NOW(), 'main_0_3_3328.14', '0_3_3328.14', 'EEPROM Failure', '', 'Integral values', 'integer', '', '-1', 'vr', '', '%.0f', '', '', '', '', '', '', '', '3_3328_I16_N_', '{"rev":"1","type":"num","v":{"0":{"t":"Normal"},"1":{"t":"Alarm Active"}}}');

CREATE TABLE IF NOT EXISTS `iw_set_dixell_xlr170` (
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

REPLACE INTO `iw_set_dixell_xlr170` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
(NOW(), 'main_0_3_256', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_878', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_32841', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_2049', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_32841.1', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_257', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_257.0#1', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_257.0', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'main_0_3_257.1', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'main_0_3_2048', '1', '1', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_2048.14', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_2048.8', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_2048.9', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_2048.10', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_2048.11', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_2048.12', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_2048.13', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_2049.14', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_2049.8', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_2049.9', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_1280', '1', '1', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_1280.8', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_1280.9', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_1280.11', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_1280.14', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_32841.0', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_832', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_3328', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_3328.11', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_3328.12', '1', '0', 'slow', 'change', '', 'C', '', 0),
(NOW(), 'main_0_3_3328.13', '1', '0', 'slow', 'change', '', 'C', '', 0),
(NOW(), 'main_0_3_3328.14', '1', '0', 'slow', 'change', '', 'C', '', 0);




-- Changelog
--
--
-- v1 orginal