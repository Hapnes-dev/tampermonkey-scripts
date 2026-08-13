REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`) VALUES
(NOW(), '1', '0', 'A1', 'Adam', 'adam_6015', 'ADAM', '1_1', 'ADAM', 'ADAM6015', 0, '');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'mb_tcp_servers', 'ADAM', '1;192.168.10.90;502;1000;2;1000', '', 'ID;IPadr;IPport;ConnTout;ConnRetries;RequestTout', ''),
(NOW(), 'mb_mode', 'ADAM', '2', '', '0=RTU|1=ASCII|2=TCP', ''),
(NOW(), 'comm_port', 'ADAM', '2', '', '', ''),
(NOW(), 'mux_settle_time', 'ADAM', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
(NOW(), 'mb_request_timeout', 'ADAM', '500', 'ms', '', ''),
(NOW(), 'mb_request_retries', 'ADAM', '0', '', '', ''),
(NOW(), 'com_error_alarm_delay', 'ADAM', '10', 'min.', '', ''),
(NOW(), 'show_queue_info', 'ADAM', '0', '', '', ''),
(NOW(), 'speed_index_block', 'ADAM', '10', '', '', ''),
(NOW(), 'speed_index_offline', 'ADAM', '10', '', '', ''),
(NOW(), 'speed_index_slow', 'ADAM', '1', '', '', ''),
(NOW(), 'speed_index_norm', 'ADAM', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'ADAM', '2', 'hours', '', ''),
(NOW(), 'max_group_count', 'ADAM', '1', '', '', ''),
(NOW(), 'max_outstanding_packets', 'ADAM', '-1', '', '', ''),
(NOW(), 'max_error_count', 'ADAM', '2', '', '', ''),
(NOW(), 'packet_timeout', 'ADAM', '0', 'sec.', '', ''),
(NOW(), 'value_quality_check_limit', 'ADAM', '0', '', '0 = disabled', ''),
(NOW(), 'sql_queue_poll_time', 'ADAM', '2000', 'msec.', '', ''),
(NOW(), 'idle_event_rate', 'ADAM', '250', 'msec.', '', ''),
(NOW(), 'startup_delay', 'ADAM', '15', 'Sec.', '', ''),
(NOW(), 'comm_baudrate', 'ADAM', '9600', '', '', ''),
(NOW(), 'comm_stop_bits', 'ADAM', '1', '', '', ''),
(NOW(), 'comm_data_bits', 'ADAM', '8', '', '', ''),
(NOW(), 'comm_parity', 'ADAM', '0', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'check_rate', 'ADAM', '1', 'ms', '', ''),
(NOW(), 'handshake', 'ADAM', '0', '', '0|1|2', ''),
(NOW(), 'force_word_not_byte', 'ADAM', '0', '', '0|1', ''),
(NOW(), 'alarm_handler', 'ADAM', '', '', '', ''),
(NOW(), 'mb_tcp_connect_timeout_default', 'ADAM', '2000', 'ms', '', ''),
(NOW(), 'mb_tcp_connect_retries_default', 'ADAM', '2', '', '', '');

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
(NOW(), '0', 'iw_mb.exe', 'ADAM', '', '');

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(NOW(), 'ADAM6015', 'adam_6015_param', 'adam_6015_groups');

CREATE TABLE IF NOT EXISTS `iw_par_adam_6015_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

REPLACE INTO `iw_par_adam_6015_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
(NOW(), 'default_link', 1, '', ''),
(NOW(), 'group_alias', 1, 'unit_status', 'Unit Status'),
(NOW(), 'group', 1, 'unit_status', 'current_val_ch_0'),
(NOW(), 'group', 2, 'unit_status', 'current_val_ch_1'),
(NOW(), 'group', 3, 'unit_status', 'current_val_ch_2'),
(NOW(), 'group', 4, 'unit_status', 'current_val_ch_3'),
(NOW(), 'group', 5, 'unit_status', 'current_val_ch_4'),
(NOW(), 'group', 6, 'unit_status', 'current_val_ch_5'),
(NOW(), 'group', 7, 'unit_status', 'current_val_ch_6');

CREATE TABLE IF NOT EXISTS `iw_par_adam_6015_param` (
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

REPLACE INTO `iw_par_adam_6015_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
(NOW(), 'current_val_ch_0', '0_4_0', 'Current Val ch 0', '', 'Analog values', 'float', '', '', 'r', '', '%.1f', '', '', '1', '0', '65536', '-40', '160', '4_0_I16_N_-_-_-_-', ''),
(NOW(), 'current_val_ch_1', '0_4_1', 'Current Val ch 1', '', 'Analog values', 'float', '', '', 'r', '', '%.1f', '', '', '1', '0', '65536', '-40', '160', '4_1_I16_N_-_-_-_-', ''),
(NOW(), 'current_val_ch_2', '0_4_2', 'Current Val ch 2', '', 'Analog values', 'float', '', '', 'r', '', '%.1f', '', '', '1', '0', '65536', '-40', '160', '4_2_I16_N_-_-_-_-', ''),
(NOW(), 'current_val_ch_3', '0_4_3', 'Current Val ch 3', '', 'Analog values', 'float', '', '', 'r', '', '%.1f', '', '', '1', '0', '65536', '-40', '160', '4_3_I16_N_-_-_-_-', ''),
(NOW(), 'current_val_ch_4', '0_4_4', 'Current Val ch 4', '', 'Analog values', 'float', '', '', 'r', '', '%.1f', '', '', '1', '0', '65536', '-40', '160', '4_4_I16_N_-_-_-_-', ''),
(NOW(), 'current_val_ch_5', '0_4_5', 'Current Val ch 5', '', 'Analog values', 'float', '', '', 'r', '', '%.1f', '', '', '1', '0', '65536', '-40', '160', '4_5_I16_N_-_-_-_-', ''),
(NOW(), 'current_val_ch_6', '0_4_6', 'Current Val ch 6', '', 'Analog values', 'float', '', '', 'r', '', '%.1f', '', '', '1', '0', '65536', '-40', '160', '4_6_I16_N_-_-_-_-', '');

CREATE TABLE IF NOT EXISTS `iw_set_adam_6015` (
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

REPLACE INTO `iw_set_adam_6015` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
(NOW(), 'current_val_ch_0', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'current_val_ch_1', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'current_val_ch_2', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'current_val_ch_3', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'current_val_ch_4', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'current_val_ch_5', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'current_val_ch_6', '1', '0', 'norm', 'min', '1', '', '', 0);




-- Changelog
--
-- v1 Orginal
--
-- Test change