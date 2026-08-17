REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`) VALUES
(NOW(), '1', '0', 'E01', 'Q00 Kurs 01', 'powertag_a9mem154x', 'POWERTAG', '1_150', 'A9MEM1540', 'A9MEM154X', 0, ''),
(NOW(), '1', '0', 'E02', 'Q00 Kurs 02', 'powertag_a9mem154x', 'POWERTAG', '1_151', 'A9MEM1540', 'A9MEM154X', 0, ''),
(NOW(), '1', '0', 'E03', 'Q00 Kurs 03', 'powertag_a9mem154x', 'POWERTAG', '1_152', 'A9MEM1540', 'A9MEM154X', 0, ''),
(NOW(), '1', '0', 'E04', 'Q00 Kurs 04', 'powertag_a9mem154x', 'POWERTAG', '1_153', 'A9MEM1540', 'A9MEM154X', 0, ''),
(NOW(), '1', '0', 'E05', 'Q00 Kurs 05', 'powertag_a9mem154x', 'POWERTAG', '1_154', 'A9MEM1540', 'A9MEM154X', 0, ''),
(NOW(), '1', '0', 'E06', 'Q00 Kurs 06', 'powertag_a9mem154x', 'POWERTAG', '1_155', 'A9MEM1540', 'A9MEM154X', 0, ''),
(NOW(), '1', '0', 'E07', 'Q00 Kurs 07', 'powertag_a9mem154x', 'POWERTAG', '1_156', 'A9MEM1540', 'A9MEM154X', 0, '');
(NOW(), '1', '0', 'E08', 'Q00 Kurs 08', 'powertag_a9mem154x', 'POWERTAG', '1_157', 'A9MEM1540', 'A9MEM154X', 0, ''),
(NOW(), '1', '0', 'E09', 'Q00 Kurs 09', 'powertag_a9mem154x', 'POWERTAG', '1_158', 'A9MEM1540', 'A9MEM154X', 0, ''),
(NOW(), '1', '0', 'E10', 'Q00 Kurs 10', 'powertag_a9mem154x', 'POWERTAG', '1_159', 'A9MEM1540', 'A9MEM154X', 0, '');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'mb_mode', 'POWERTAG', '2', '', '0=RTU|1=ASCII|2=TCP', ''),
(NOW(), 'mb_tcp_servers', 'POWERTAG', '1;192.168.10.100;502;1000;2;1500', '', 'ID;IPadr;IPport;ConnTout;ConnRetries;RequestTout', ''),
(NOW(), 'comm_port', 'POWERTAG', '2', '', '', ''),
(NOW(), 'comm_baudrate', 'POWERTAG', '9600', '', '', ''),
(NOW(), 'comm_stop_bits', 'POWERTAG', '1', '', '', ''),
(NOW(), 'comm_data_bits', 'POWERTAG', '8', '', '', ''),
(NOW(), 'comm_parity', 'POWERTAG', '0', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'idle_event_rate', 'POWERTAG', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'POWERTAG', '2000', 'msec.', '', ''),
(NOW(), 'value_quality_check_limit', 'POWERTAG', '0', '', '0 = disabled', ''),
(NOW(), 'packet_timeout', 'POWERTAG', '0', 'sec.', '', ''),
(NOW(), 'max_outstanding_packets', 'POWERTAG', '-1', '', '', ''),
(NOW(), 'max_error_count', 'POWERTAG', '4', '', '', ''),
(NOW(), 'max_group_count', 'POWERTAG', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'POWERTAG', '2', 'hours', '', ''),
(NOW(), 'speed_index_norm', 'POWERTAG', '1', '', '', ''),
(NOW(), 'speed_index_slow', 'POWERTAG', '1', '', '', ''),
(NOW(), 'speed_index_offline', 'POWERTAG', '10', '', '', ''),
(NOW(), 'speed_index_block', 'POWERTAG', '10', '', '', ''),
(NOW(), 'show_queue_info', 'POWERTAG', '0', '', '', ''),
(NOW(), 'com_error_alarm_delay', 'POWERTAG', '70', 'min.', '', ''),
(NOW(), 'mb_request_retries', 'POWERTAG', '0', '', '', ''),
(NOW(), 'mb_request_timeout', 'POWERTAG', '1500', 'ms', '', ''),
(NOW(), 'mux_settle_time', 'POWERTAG', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
(NOW(), 'startup_delay', 'POWERTAG', '15', 'Sec.', '', ''),
(NOW(), 'check_rate', 'POWERTAG', '1', 'ms', '', ''),
(NOW(), 'handshake', 'POWERTAG', '0', '', '0|1|2', ''),
(NOW(), 'force_word_not_byte', 'POWERTAG', '0', '', '0|1', ''),
(NOW(), 'mb_tcp_connect_timeout_default', 'POWERTAG', '2000', 'ms', '', ''),
(NOW(), 'mb_tcp_connect_retries_default', 'POWERTAG', '2', '', '', ''),
(NOW(), 'alarm_handler', 'POWERTAG', '', '', '', '');

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
(NOW(), '0', 'iw_mb.exe', 'POWERTAG', '', '');

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(NOW(), 'A9MEM154X', 'powertag_a9mem154x_param', 'powertag_a9mem154x_groups');

CREATE TABLE IF NOT EXISTS `iw_par_powertag_a9mem154x_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

REPLACE INTO `iw_par_powertag_a9mem154x_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
(NOW(), 'default_link', 1, '', ''),
(NOW(), 'group_alias', 1, 'Measurement', 'Measurement'),
(NOW(), 'group_alias', 2, 'Configuration', 'Configuration'),
(NOW(), 'group', 1, 'Measurement', 'Measurement_0_3_2999'),
(NOW(), 'group', 2, 'Measurement', 'Measurement_0_3_3001'),
(NOW(), 'group', 3, 'Measurement', 'Measurement_0_3_3003'),
(NOW(), 'group', 4, 'Measurement', 'Measurement_0_3_3019'),
(NOW(), 'group', 5, 'Measurement', 'Measurement_0_3_3021'),
(NOW(), 'group', 6, 'Measurement', 'Measurement_0_3_3023'),
(NOW(), 'group', 7, 'Measurement', 'Measurement_0_3_3027'),
(NOW(), 'group', 8, 'Measurement', 'Measurement_0_3_3029'),
(NOW(), 'group', 9, 'Measurement', 'Measurement_0_3_3031'),
(NOW(), 'group', 10, 'Measurement', 'Measurement_0_3_3053'),
(NOW(), 'group', 11, 'Measurement', 'Measurement_0_3_3055'),
(NOW(), 'group', 12, 'Measurement', 'Measurement_0_3_3057'),
(NOW(), 'group', 13, 'Measurement', 'Measurement_0_3_3059'),
(NOW(), 'group', 14, 'Measurement', 'Measurement_0_3_3083'),
(NOW(), 'group', 15, 'Measurement', 'Measurement_0_3_3203'),
(NOW(), 'group', 16, 'Measurement', 'Measurement_0_3_3255'),
(NOW(), 'group', 17, 'Measurement', 'Measurement_0_3_3259'),
(NOW(), 'group', 18, 'Measurement', 'Measurement_0_3_3299.0'),
(NOW(), 'group', 19, 'Measurement', 'Measurement_0_3_3299.1'),
(NOW(), 'group', 20, 'Measurement', 'Measurement_0_3_3301'),
(NOW(), 'group', 21, 'Measurement', 'Measurement_0_3_3303'),
(NOW(), 'group', 22, 'Measurement', 'Measurement_0_3_3305'),
(NOW(), 'group', 1, 'Configuration', 'Configuration_0_3_31024');

CREATE TABLE IF NOT EXISTS `iw_par_powertag_a9mem154x_param` (
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
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='3.2.3';

REPLACE INTO `iw_par_powertag_a9mem154x_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
(NOW(), 'Measurement_0_3_2999', '0_3_2999', 'Current on phase A', '', 'Analog values', 'float', '', '-1', 'r', 'A', '', '', '', '', '', '', '', '', '3_2999_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3001', '0_3_3001', 'Current on phase B', '', 'Analog values', 'float', '', '-1', 'r', 'A', '', '', '', '', '', '', '', '', '3_3001_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3003', '0_3_3003', 'Current on phase C', '', 'Analog values', 'float', '', '-1', 'r', 'A', '', '', '', '', '', '', '', '', '3_3003_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3019', '0_3_3019', 'Phase-to-phase voltage A-B', '', 'Analog values', 'float', '', '-1', 'r', 'V', '', '', '', '', '', '', '', '', '3_3019_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3021', '0_3_3021', 'Phase-to-phase voltage B-C', '', 'Analog values', 'float', '', '-1', 'r', 'V', '', '', '', '', '', '', '', '', '3_3021_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3023', '0_3_3023', 'Phase-to-phase voltage C-A', '', 'Analog values', 'float', '', '-1', 'r', 'V', '', '', '', '', '', '', '', '', '3_3023_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3027', '0_3_3027', 'Phase-to-neutral voltage A-N', '', 'Analog values', 'float', '', '-1', 'r', 'V', '', '', '', '', '', '', '', '', '3_3027_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3029', '0_3_3029', 'Phase-to-neutral voltage B-N', '', 'Analog values', 'float', '', '-1', 'r', 'V', '', '', '', '', '', '', '', '', '3_3029_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3031', '0_3_3031', 'Phase-to-neutral voltage C-N', '', 'Analog values', 'float', '', '-1', 'r', 'V', '', '', '', '', '', '', '', '', '3_3031_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3053', '0_3_3053', 'Active power on phase A', '', 'Analog values', 'float', '', '-1', 'r', 'kW', '%.2f', '', '', '1', '0', '1000', '0', '1', '3_3053_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3055', '0_3_3055', 'Active power on phase B', '', 'Analog values', 'float', '', '-1', 'r', 'kW', '%.2f', '', '', '1', '0', '1000', '0', '1', '3_3055_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3057', '0_3_3057', 'Active power on phase C', '', 'Analog values', 'float', '', '-1', 'r', 'kW', '%.2f', '', '', '1', '0', '1000', '0', '1', '3_3057_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3059', '0_3_3059', 'Total active power', '', 'Analog values', 'float', '', '-1', 'r', 'kW', '%.2f', '', '', '1', '0', '1000', '0', '1', '3_3059_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3083', '0_3_3083', 'Total power factor', '', 'Analog values', 'float', '', '-1', 'r', '', '%.2f', '', '', '', '', '', '', '', '3_3083_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3203', '0_3_3203', 'Total active energy sent and received', '', 'Integral values', 'integer', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_3203_U64U32_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3255', '0_3_3255', 'Partial active energy sent and received', '', 'Integral values', 'integer', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_3255_U64U32_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3259', '0_3_3259', 'Reset or preset the partial energy counter of the PowerTag', '', 'Integral values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '3_3259_U64U32_W_16_3259_U64U32_W', ''),
(NOW(), 'Measurement_0_3_3299', '0_3_3299', 'Status', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_3299_UI32_N_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3299.0', '0_3_3299.0', 'Voltage phase loss', '', 'Digital IO', 'boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '', ''),
(NOW(), 'Measurement_0_3_3299.1', '0_3_3299.1', 'Current overload', '', 'Digital IO', 'boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '', ''),
(NOW(), 'Measurement_0_3_3301', '0_3_3301', 'RMS Current on phase A at voltage loss', '', 'Analog values', 'float', '', '-1', 'r', 'A', '', '', '', '', '', '', '', '', '3_3301_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3303', '0_3_3303', 'RMS Current on phase B at voltage loss', '', 'Analog values', 'float', '', '-1', 'r', 'A', '', '', '', '', '', '', '', '', '3_3303_F_W_-_-_-_-', ''),
(NOW(), 'Measurement_0_3_3305', '0_3_3305', 'RMS Current on phase C at voltage loss', '', 'Analog values', 'float', '', '-1', 'r', 'A', '', '', '', '', '', '', '', '', '3_3305_F_W_-_-_-_-', ''),
(NOW(), 'Configuration_0_3_31024', '0_3_31024', 'Product type of wireless devices', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_31024_UI32_N_-_-_-_-', '{"rev":"1","type":"num","v":{"41":{"t":"1P"},"42":{"t":"1P+N Up"},"43":{"t":"1P+N Down"},"44":{"t":"3P"},"45":{"t":"3P+N Up"},"45":{"t":"3P+N Down"}}}');

CREATE TABLE IF NOT EXISTS `iw_set_powertag_a9mem154x` (
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

REPLACE INTO `iw_set_powertag_a9mem154x` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
(NOW(), 'Measurement_0_3_2999', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3001', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3003', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3019', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3021', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3023', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3027', '0', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3029', '0', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3031', '0', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3053', '0', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3055', '0', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3057', '0', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3059', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3083', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3203', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'Measurement_0_3_3255', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'Measurement_0_3_3259', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'Measurement_0_3_3299', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'Measurement_0_3_3299.0', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'Measurement_0_3_3299.1', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'Measurement_0_3_3301', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3303', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Measurement_0_3_3305', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'Configuration_0_3_31024', '1', '0', 'slow', 'change', '', '', '', 0);




-- Changelog
--
-- v1 Orginal
--
--