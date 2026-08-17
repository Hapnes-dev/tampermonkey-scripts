REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `driver_adr_extra`) VALUES
(NOW(), '1', '0', 'E01', 'Energi', 'piigab', 'PIIGAB', '1_1', 'PIIGAB', 'PIIGAB', '');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'mb_tcp_servers', 'PIIGAB', '1;xxxxxxxxxxxx;10002;2000;2;2000', '', 'ID;IPadr;IPport;ConnTout;ConnRetries;RequestTout', ''),
(NOW(), 'comm_port', 'PIIGAB', '2', '', '', ''),
(NOW(), 'mb_mode', 'PIIGAB', '2', '', '0=RTU|1=ASCII|2=TCP', ''),
(NOW(), 'idle_event_rate', 'PIIGAB', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'PIIGAB', '2000', 'msec.', '', ''),
(NOW(), 'value_quality_check_limit', 'PIIGAB', '0', '', '0 = disabled', ''),
(NOW(), 'packet_timeout', 'PIIGAB', '2', 'sec.', '', ''),
(NOW(), 'max_outstanding_packets', 'PIIGAB', '-1', '', '', ''),
(NOW(), 'max_error_count', 'PIIGAB', '2', '', '', ''),
(NOW(), 'max_group_count', 'PIIGAB', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'PIIGAB', '2', 'hours', '', ''),
(NOW(), 'speed_index_norm', 'PIIGAB', '2', '', '', ''),
(NOW(), 'speed_index_slow', 'PIIGAB', '2', '', '', ''),
(NOW(), 'speed_index_offline', 'PIIGAB', '10', '', '', ''),
(NOW(), 'speed_index_block', 'PIIGAB', '10', '', '', ''),
(NOW(), 'show_queue_info', 'PIIGAB', '0', '', '', ''),
(NOW(), 'com_error_alarm_delay', 'PIIGAB', '10', 'min.', '', ''),
(NOW(), 'mb_request_retries', 'PIIGAB', '0', '', '', ''),
(NOW(), 'mb_request_timeout', 'PIIGAB', '2000', 'ms', '', ''),
(NOW(), 'mux_settle_time', 'PIIGAB', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
(NOW(), 'startup_delay', 'PIIGAB', '15', 'Sec.', '', ''),
(NOW(), 'alarm_handler', 'PIIGAB', '', '', '', ''),
(NOW(), 'mb_tcp_connect_timeout_default', 'PIIGAB', '2000', 'ms', '', ''),
(NOW(), 'mb_tcp_connect_retries_default', 'PIIGAB', '4', '', '', ''),
(NOW(), 'force_word_not_byte', 'PIIGAB', '0', '', '0|1', ''),
(NOW(), 'comm_baudrate', 'PIIGAB', '9600', '', '', ''),
(NOW(), 'comm_stop_bits', 'PIIGAB', '1', '', '', ''),
(NOW(), 'comm_data_bits', 'PIIGAB', '8', '', '', ''),
(NOW(), 'comm_parity', 'PIIGAB', '0', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'check_rate', 'PIIGAB', '1', 'ms', '', '');

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(NOW(), 'PIIGAB', 'piigab_param', 'piigab_groups');

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
(NOW(), '0', 'iw_mb.exe', 'PIIGAB', '', '');

CREATE TABLE IF NOT EXISTS `iw_par_piigab_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

REPLACE INTO `iw_par_piigab_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
(NOW(), 'default_link', 1, '', ''),
(NOW(), 'group_alias', 1, 'm�ler_1', 'M�linger'),
(NOW(), 'group', 10, 'm�ler_1', 'm�ler_1_ener'),
(NOW(), 'group', 20, 'm�ler_1', 'm�ler_1_effe'),
(NOW(), 'group', 30, 'm�ler_1', 'm�ler_1_tmpt'),
(NOW(), 'group', 40, 'm�ler_1', 'm�ler_1_tmpr'),
(NOW(), 'group', 50, 'm�ler_1', 'm�ler_1_tmpd'),
(NOW(), 'group', 60, 'm�ler_1', 'm�ler_1_volu'),
(NOW(), 'group', 70, 'm�ler_1', 'm�ler_1_flow'),
(NOW(), 'group', 80, 'm�ler_1', 'm�ler_1_seri');

CREATE TABLE IF NOT EXISTS `iw_par_piigab_param` (
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

REPLACE INTO `iw_par_piigab_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
(NOW(), 'm�ler_1_ener', 'M_1_0', 'Energi', '', 'Integral value', 'integer', '', '-1', 'r', 'kWh', '%.0f', '', '', '2', '', '', '', '', '3_2_I32_W_-_-_-_-', ''),
(NOW(), 'm�ler_1_effe', 'M_1_1', 'Effekt', '', 'Analog values', 'float', '', '-1', 'r', 'kW', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_4_I32_W_-_-_-_-', ''),
(NOW(), 'm�ler_1_tmpt', 'M_1_2', 'Temp tur', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '', '', '', '', '', '3_6_I32_W_-_-_-_-', ''),
(NOW(), 'm�ler_1_tmpr', 'M_1_3', 'Temp retur', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '', '', '', '', '', '3_8_I32_W_-_-_-_-', ''),
(NOW(), 'm�ler_1_tmpd', 'M_1_4', 'Temp differanse', '', 'Analog values', 'float', '', '-1', 'r', '&deg;K', '%.2f', '', '', '1', '0', '1000', '0', '100', '3_10_I32_W_-_-_-_-', ''),
(NOW(), 'm�ler_1_seri', 'M_1_5', 'Serienummer', '', 'Integral value', 'integer', '', '-1', 'r', '', '%.0f', '', '', '2', '', '', '', '', '3_12_I32_W_-_-_-_-', ''),
(NOW(), 'm�ler_1_volu', 'M_1_6', 'Volum', '', 'Integral value', 'integer', '', '-1', 'r', 'm3', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_14_I32_W_-_-_-_-', ''),
(NOW(), 'm�ler_1_flow', 'M_1_7', 'Mengde', '', 'Analog values', 'float', '', '-1', 'r', 'm3/h', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_16_I32_W_-_-_-_-', '');

CREATE TABLE IF NOT EXISTS `iw_set_piigab` (
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

REPLACE INTO `iw_set_piigab` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
(NOW(), 'm�ler_1_ener', '1', '0', 'slow', 'min', '1', '', '', 0),
(NOW(), 'm�ler_1_effe', '1', '0', 'slow', 'min', '1', '', '', 0),
(NOW(), 'm�ler_1_tmpt', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'm�ler_1_tmpr', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'm�ler_1_tmpd', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'm�ler_1_seri', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'm�ler_1_volu', '1', '0', 'slow', 'min', '1', '', '', 0),
(NOW(), 'm�ler_1_flow', '1', '0', 'slow', 'min', '1', '', '', 0);


-- Changelog
--
-- v1 Orginal
--
--