REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`, `unit_extra`) VALUES
('2022-12-06 13:07:49', '1', '0', 'E1', 'Energi VGV supercal', 'supercal5', 'SUPERCAL5', '0_18', 'SUPERCAL5', 'supercal5', 0, '', '');


REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
('2022-12-06 13:07:49', '0', 'iw_mb.exe', 'SUPERCAL5', '', '');


REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
('2022-12-06 13:07:49', 'supercal5', 'supercal5_param', 'supercal5_groups');



REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
('2022-12-06 13:07:49', 'comm_port', 'SUPERCAL5', '5', '', '', ''),
('2022-12-06 13:07:49', 'mb_tcp_servers', 'SUPERCAL5', '1;192.168.10.110;502;1000;2;1000\r\n', '', 'ID;IPadr;IPport;ConnTout;ConnRetries;RequestTout', ''),
('2022-12-06 13:07:49', 'mb_mode', 'SUPERCAL5', '0', '', '0=RTU|1=ASCII|2=TCP', ''),
('2022-12-06 13:07:49', 'mb_request_retries', 'SUPERCAL5', '2', '', '', ''),
('2022-12-06 13:07:49', 'force_word_not_byte', 'SUPERCAL5', '0', '', '0|1', ''),
('2022-12-06 13:07:49', 'handshake', 'SUPERCAL5', '0', '', '0|1|2', ''),
('2022-12-06 13:07:49', 'check_rate', 'SUPERCAL5', '1', 'ms', '', ''),
('2022-12-06 13:07:49', 'comm_parity', 'SUPERCAL5', '2', '', '0=N|1=O|2=E|3=M|4=S', ''),
('2022-12-06 13:07:49', 'comm_data_bits', 'SUPERCAL5', '8', '', '', ''),
('2022-12-06 13:07:49', 'comm_stop_bits', 'SUPERCAL5', '1', '', '', ''),
('2022-12-06 13:07:49', 'comm_baudrate', 'SUPERCAL5', '19200', '', '', ''),
('2022-12-06 13:07:49', 'max_outstanding_packets', 'SUPERCAL5', '-1', '', '', ''),
('2022-12-06 13:07:49', 'packet_timeout', 'SUPERCAL5', '1', 'sec.', '', ''),
('2022-12-06 13:07:49', 'idle_event_rate', 'SUPERCAL5', '250', 'msec.', '', ''),
('2022-12-06 13:07:49', 'sql_queue_poll_time', 'SUPERCAL5', '2000', 'msec.', '', ''),
('2022-12-06 13:07:49', 'max_error_count', 'SUPERCAL5', '2', '', '', ''),
('2022-12-06 13:07:49', 'mb_request_timeout', 'SUPERCAL5', '1000', 'ms', '', ''),
('2022-12-06 13:07:49', 'com_error_alarm_delay', 'SUPERCAL5', '10', 'min.', '', ''),
('2022-12-06 13:07:49', 'show_queue_info', 'SUPERCAL5', '0', '', '', ''),
('2022-12-06 13:07:49', 'speed_index_block', 'SUPERCAL5', '10', '', '', ''),
('2022-12-06 13:07:49', 'speed_index_offline', 'SUPERCAL5', '10', '', '', ''),
('2022-12-06 13:07:49', 'speed_index_slow', 'SUPERCAL5', '1', '', '', ''),
('2022-12-06 13:07:49', 'speed_index_norm', 'SUPERCAL5', '1', '', '', ''),
('2022-12-06 13:07:49', 'max_param_block_time', 'SUPERCAL5', '2', 'hours', '', ''),
('2022-12-06 13:07:49', 'max_group_count', 'SUPERCAL5', '1', '', '', ''),
('2022-12-06 13:07:49', 'value_quality_check_limit', 'SUPERCAL5', '0', '', '0 = disabled', ''),
('2022-12-06 13:07:49', 'mux_settle_time', 'SUPERCAL5', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
('2022-12-06 13:07:49', 'startup_delay', 'SUPERCAL5', '15', 'Sec.', '', ''),
('2022-12-06 13:07:49', 'alarm_handler', 'SUPERCAL5', '', '', '', ''),
('2022-12-06 13:07:49', 'mb_tcp_connect_retries_default', 'SUPERCAL5', '2', '', '', ''),
('2022-12-06 13:07:49', 'mb_tcp_connect_timeout_default', 'SUPERCAL5', '1000', 'ms', '', ''),
('2022-12-06 13:09:12', 'allow_crc_swap', 'SUPERCAL5', '0', '', 'Default 0', ''),
('2022-12-06 13:09:12', 'mb_tcp_disconnect_if_offline', 'SUPERCAL5', '1', '', '0|1', ''),
('2022-12-06 13:11:22', 'enablers485mode', 'SUPERCAL5', '0', '', '0=OFF|0 < delay in ms and ON', '');




CREATE TABLE IF NOT EXISTS `iw_par_supercal5_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

--
-- Dumping data for table `iw_par_supercal5_groups`
--

REPLACE INTO `iw_par_supercal5_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
('2022-12-06 13:24:44', 'default_link', 1, '', ''),
('2022-12-06 13:24:44', 'group_alias', 1, 'values', 'values'),
('2022-12-06 13:24:44', 'group_alias', 2, 'units', 'units'),
('2022-12-06 13:24:44', 'group_alias', 3, 'info', 'info'),
('2022-12-06 13:24:44', 'group_alias', 4, 'misc', 'Diverse'),
('2022-12-06 13:24:44', 'group_alias', 5, 'sch', 'Tidsskjema'),
('2022-12-06 13:24:44', 'group_alias', 6, 'test', 'test'),
('2022-12-06 13:24:37', 'group', 3, 'values', 'values_0_4_102'),
('2022-12-06 13:24:37', 'group', 3, 'units', 'units_0_4_100'),
('2022-12-06 13:24:37', 'group', 3, 'values', 'values_0_4_802'),
('2022-12-06 13:24:37', 'group', 6, 'units', 'units_0_4_800'),
('2022-12-06 13:24:37', 'group', 6, 'values', 'values_0_4_302'),
('2022-12-06 13:24:37', 'group', 9, 'units', 'units_0_4_300'),
('2022-12-06 13:24:37', 'group', 9, 'values', 'values_0_4_722'),
('2022-12-06 13:24:37', 'group', 12, 'values', 'values_0_4_724'),
('2022-12-06 13:24:37', 'group', 12, 'units', 'units_0_4_720'),
('2022-12-06 13:24:37', 'group', 15, 'values', 'values_0_4_732'),
('2022-12-06 13:24:37', 'group', 15, 'units', 'units_0_4_730'),
('2022-12-06 13:24:37', 'group', 3, 'info', 'info_0_4_0'),
('2022-12-06 13:24:37', 'group', 6, 'info', 'info_0_4_2'),
('2022-12-06 13:24:37', 'group', 9, 'info', 'info_0_4_3'),
('2022-12-06 13:24:37', 'group', 12, 'info', 'info_0_4_5');

-- --------------------------------------------------------

--
-- Table structure for table `iw_par_supercal5_param`
--

CREATE TABLE IF NOT EXISTS `iw_par_supercal5_param` (
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

--
-- Dumping data for table `iw_par_supercal5_param`
--

REPLACE INTO `iw_par_supercal5_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
('2022-12-06 13:24:37', 'values_0_4_102', '0_4_102', 'Energy heating', '', 'Analog values', 'float', '', '-1', 'r', '', '%.0f', '', '', '', '', '', '', '', '4_102_F_N_-_-_-_-', ''),
('2022-12-06 13:24:37', 'units_0_4_100', '0_4_100', 'Energy unit', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_100_U16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"19":{"t":"Kwh"},"47":{"t":"W"},"62":{"t":"°C"},"63":{"t":"K"},"80":{"t":"M3"},"82":{"t":"Ltr"},"83":{"t":"Usgl"},"135":{"t":"M3/H"},"146":{"t":"Mj"},"147":{"t":"Kbtu"},"148":{"t":"Mbtu"},"223":{"t":"Kusgl"},"226":{"t":"Gj"},"227":{"t":"Mcal"},"228":{"t":"Gcal"}}}'),
('2022-12-06 13:24:37', 'values_0_4_802', '0_4_802', 'Power', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_802_F_N_-_-_-_-', ''),
('2022-12-06 13:24:37', 'units_0_4_800', '0_4_800', 'Power unit', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_800_U16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"19":{"t":"Kwh"},"47":{"t":"W"},"62":{"t":"°C"},"63":{"t":"K"},"80":{"t":"M3"},"82":{"t":"Ltr"},"83":{"t":"Usgl"},"135":{"t":"M3/H"},"146":{"t":"Mj"},"147":{"t":"Kbtu"},"148":{"t":"Mbtu"},"223":{"t":"Kusgl"},"226":{"t":"Gj"},"227":{"t":"Mcal"},"228":{"t":"Gcal"}}}'),
('2022-12-06 13:24:37', 'values_0_4_302', '0_4_302', 'Volume', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_302_F_N_-_-_-_-', ''),
('2022-12-06 13:24:37', 'units_0_4_300', '0_4_300', 'Volume unit', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_300_U16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"19":{"t":"Kwh"},"47":{"t":"W"},"62":{"t":"°C"},"63":{"t":"K"},"80":{"t":"M3"},"82":{"t":"Ltr"},"83":{"t":"Usgl"},"135":{"t":"M3/H"},"146":{"t":"Mj"},"147":{"t":"Kbtu"},"148":{"t":"Mbtu"},"223":{"t":"Kusgl"},"226":{"t":"Gj"},"227":{"t":"Mcal"},"228":{"t":"Gcal"}}}'),
('2022-12-06 13:24:37', 'values_0_4_722', '0_4_722', 'High temp', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_722_F_N_-_-_-_-', ''),
('2022-12-06 13:24:37', 'values_0_4_724', '0_4_724', 'Low temp', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_724_F_N_-_-_-_-', ''),
('2022-12-06 13:24:37', 'units_0_4_720', '0_4_720', 'Temp unit', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_720_U16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"19":{"t":"Kwh"},"47":{"t":"W"},"62":{"t":"°C"},"63":{"t":"K"},"80":{"t":"M3"},"82":{"t":"Ltr"},"83":{"t":"Usgl"},"135":{"t":"M3/H"},"146":{"t":"Mj"},"147":{"t":"Kbtu"},"148":{"t":"Mbtu"},"223":{"t":"Kusgl"},"226":{"t":"Gj"},"227":{"t":"Mcal"},"228":{"t":"Gcal"}}}'),
('2022-12-06 13:24:37', 'values_0_4_732', '0_4_732', 'Temp diference', '', 'Analog values', 'float', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_732_F_N_-_-_-_-', ''),
('2022-12-06 13:24:37', 'units_0_4_730', '0_4_730', 'Temp diference unit', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_730_U16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"19":{"t":"Kwh"},"47":{"t":"W"},"62":{"t":"°C"},"63":{"t":"K"},"80":{"t":"M3"},"82":{"t":"Ltr"},"83":{"t":"Usgl"},"135":{"t":"M3/H"},"146":{"t":"Mj"},"147":{"t":"Kbtu"},"148":{"t":"Mbtu"},"223":{"t":"Kusgl"},"226":{"t":"Gj"},"227":{"t":"Mcal"},"228":{"t":"Gcal"}}}'),
('2022-12-06 13:24:37', 'info_0_4_0', '0_4_0', 'Fabrication number MET', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_0_U32_N_-_-_-_-', ''),
('2022-12-06 13:24:37', 'info_0_4_2', '0_4_2', 'Firmware ver', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_2_U16_N_-_-_-_-', ''),
('2022-12-06 13:24:37', 'info_0_4_3', '0_4_3', 'Baudrate', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_3_U32_N_-_-_-_-', ''),
('2022-12-06 13:24:37', 'info_0_4_5', '0_4_5', 'Running hours', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_5_U32_N_-_-_-_-', '');

-- --------------------------------------------------------

--
-- Table structure for table `iw_set_supercal5`
--

CREATE TABLE IF NOT EXISTS `iw_set_supercal5` (
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

--
-- Dumping data for table `iw_set_supercal5`
--

REPLACE INTO `iw_set_supercal5` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
('2022-12-06 13:24:37', 'values_0_4_102', '1', '0', 'norm', 'min', '1', '', '', 0),
('2022-12-06 13:24:37', 'units_0_4_100', '1', '0', 'norm', 'min', '1', '', '', 0),
('2022-12-06 13:24:37', 'values_0_4_802', '1', '1', 'norm', 'min', '1', '', '', 0),
('2022-12-06 13:24:37', 'units_0_4_800', '1', '0', 'norm', 'min', '1', '', '', 0),
('2022-12-06 13:24:37', 'values_0_4_302', '1', '0', 'norm', 'min', '1', '', '', 0),
('2022-12-06 13:24:37', 'units_0_4_300', '1', '0', 'norm', 'min', '1', '', '', 0),
('2022-12-06 13:24:37', 'values_0_4_722', '1', '1', 'norm', 'min', '1', '', '', 0),
('2022-12-06 13:24:37', 'values_0_4_724', '1', '1', 'norm', 'min', '1', '', '', 0),
('2022-12-06 13:24:37', 'units_0_4_720', '1', '0', 'norm', 'min', '1', '', '', 0),
('2022-12-06 13:24:37', 'values_0_4_732', '1', '0', 'norm', 'min', '1', '', '', 0),
('2022-12-06 13:24:37', 'units_0_4_730', '1', '0', 'norm', 'min', '1', '', '', 0),
('2022-12-06 13:24:37', 'info_0_4_0', '1', '0', 'norm', 'min', '1', '', '', 0),
('2022-12-06 13:24:37', 'info_0_4_2', '1', '0', 'norm', 'min', '1', '', '', 0),
('2022-12-06 13:24:37', 'info_0_4_3', '1', '0', 'norm', 'min', '1', '', '', 0),
('2022-12-06 13:24:37', 'info_0_4_5', '1', '0', 'norm', 'min', '1', '', '', 0);

