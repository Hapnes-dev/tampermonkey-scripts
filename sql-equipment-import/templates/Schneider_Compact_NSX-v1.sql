REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`) VALUES
(NOW(), '1', '0', 'E01', 'Energi 1', 'schneider_nsx_short', 'SCHNEIDER', '0_1', 'NSX', 'SCHNEIDER_SHORT', 0, ''),
(NOW(), '1', '0', 'E02', 'Energi 2', 'schneider_nsx_short', 'SCHNEIDER', '0_2', 'NSX', 'SCHNEIDER_SHORT', 0, ''),
(NOW(), '1', '0', 'E03', 'Energi 3', 'schneider_nsx_short', 'SCHNEIDER', '0_3', 'NSX', 'SCHNEIDER_SHORT', 0, '');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'comm_port', 'SCHNEIDER', '9', '', '', ''),
(NOW(), 'comm_baudrate', 'SCHNEIDER', '19200', '', '', ''),
(NOW(), 'comm_stop_bits', 'SCHNEIDER', '1', '', '', ''),
(NOW(), 'comm_data_bits', 'SCHNEIDER', '8', '', '', ''),
(NOW(), 'comm_parity', 'SCHNEIDER', '2', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'mb_mode', 'SCHNEIDER', '0', '', '0=RTU|1=ASCII|2=TCP', ''),
(NOW(), 'alarm_handler', 'SCHNEIDER', '', '', '', ''),
(NOW(), 'idle_event_rate', 'SCHNEIDER', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'SCHNEIDER', '2000', 'msec.', '', ''),
(NOW(), 'value_quality_check_limit', 'SCHNEIDER', '0', '', '0 = disabled', ''),
(NOW(), 'packet_timeout', 'SCHNEIDER', '0', 'sec.', '', ''),
(NOW(), 'max_outstanding_packets', 'SCHNEIDER', '-1', '', '', ''),
(NOW(), 'max_error_count', 'SCHNEIDER', '2', '', '', ''),
(NOW(), 'max_group_count', 'SCHNEIDER', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'SCHNEIDER', '2', 'hours', '', ''),
(NOW(), 'speed_index_norm', 'SCHNEIDER', '1', '', '', ''),
(NOW(), 'speed_index_slow', 'SCHNEIDER', '1', '', '', ''),
(NOW(), 'speed_index_offline', 'SCHNEIDER', '10', '', '', ''),
(NOW(), 'speed_index_block', 'SCHNEIDER', '10', '', '', ''),
(NOW(), 'show_queue_info', 'SCHNEIDER', '0', '', '', ''),
(NOW(), 'com_error_alarm_delay', 'SCHNEIDER', '10', 'min.', '', ''),
(NOW(), 'mb_request_retries', 'SCHNEIDER', '0', '', '', ''),
(NOW(), 'mb_request_timeout', 'SCHNEIDER', '500', 'ms', '', ''),
(NOW(), 'mux_settle_time', 'SCHNEIDER', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
(NOW(), 'startup_delay', 'SCHNEIDER', '15', 'Sec.', '', ''),
(NOW(), 'check_rate', 'SCHNEIDER', '1', 'ms', '', ''),
(NOW(), 'handshake', 'SCHNEIDER', '0', '', '0|1|2', ''),
(NOW(), 'force_word_not_byte', 'SCHNEIDER', '0', '', '0|1', '');

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(NOW(), 'SCHNEIDER_SHORT', 'schneider_nsx_short_param', 'schneider_nsx_short_groups');

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
(NOW(), '0', 'iw_mb.exe', 'SCHNEIDER', '', '');

CREATE TABLE IF NOT EXISTS `iw_par_schneider_nsx_short_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

REPLACE INTO `iw_par_schneider_nsx_short_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
(NOW(), 'default_link', 1, '', ''),
(NOW(), 'group_alias', 1, 'cur', 'Measured Values'),
(NOW(), 'group_alias', 2, 'max', 'Maximum Values'),
(NOW(), 'group', 1, 'cur', 'cur_0_3_12015'),
(NOW(), 'group', 2, 'cur', 'cur_0_3_12016'),
(NOW(), 'group', 3, 'cur', 'cur_0_3_12017'),
(NOW(), 'group', 4, 'cur', 'cur_0_3_12018'),
(NOW(), 'group', 5, 'cur', 'cur_0_3_12019'),
(NOW(), 'group', 6, 'cur', 'cur_0_3_12029'),
(NOW(), 'group', 7, 'cur', 'cur_0_3_12030'),
(NOW(), 'group', 8, 'cur', 'cur_0_3_12031'),
(NOW(), 'group', 9, 'cur', 'cur_0_3_12032'),
(NOW(), 'group', 10, 'cur', 'cur_0_3_12033'),
(NOW(), 'group', 11, 'cur', 'cur_0_3_12034'),
(NOW(), 'group', 12, 'cur', 'cur_0_3_12035'),
(NOW(), 'group', 13, 'max', 'max_0_3_12036'),
(NOW(), 'group', 14, 'cur', 'cur_0_3_12037'),
(NOW(), 'group', 15, 'cur', 'cur_0_3_12038'),
(NOW(), 'group', 16, 'cur', 'cur_0_3_12039'),
(NOW(), 'group', 17, 'cur', 'cur_0_3_12040'),
(NOW(), 'group', 18, 'cur', 'cur_0_3_12049'),
(NOW(), 'group', 19, 'cur', 'cur_0_3_12051'),
(NOW(), 'group', 20, 'cur', 'cur_0_3_12095'),
(NOW(), 'group', 21, 'cur', 'cur_0_3_12096'),
(NOW(), 'group', 22, 'cur', 'cur_0_3_12097'),
(NOW(), 'group', 23, 'cur', 'cur_0_3_12098'),
(NOW(), 'group', 1, 'max', 'max_0_3_12022'),
(NOW(), 'group', 2, 'max', 'max_0_3_12023'),
(NOW(), 'group', 3, 'max', 'max_0_3_12024'),
(NOW(), 'group', 4, 'max', 'max_0_3_12025'),
(NOW(), 'group', 5, 'max', 'max_0_3_12026'),
(NOW(), 'group', 6, 'max', 'max_0_3_12089'),
(NOW(), 'group', 7, 'max', 'max_0_3_12090'),
(NOW(), 'group', 8, 'max', 'max_0_3_12091'),
(NOW(), 'group', 9, 'max', 'max_0_3_12092'),
(NOW(), 'group', 10, 'max', 'max_0_3_12093'),
(NOW(), 'group', 11, 'max', 'max_0_3_12094');

CREATE TABLE IF NOT EXISTS `iw_par_schneider_nsx_short_param` (
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

REPLACE INTO `iw_par_schneider_nsx_short_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
(NOW(), 'cur_0_3_12015', '0_3_12015', 'Rms current on phase 1_ I1', '', 'Analog Value', 'float', '', '-1', 'r', 'A', '', '0', '20', '', '', '', '', '', '3_12015_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12016', '0_3_12016', 'Rms current on phase 2_ I2', '', 'Analog Value', 'float', '', '-1', 'r', 'A', '', '0', '20', '', '', '', '', '', '3_12016_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12017', '0_3_12017', 'Rms current on phase 3_ I3', '', 'Analog Value', 'float', '', '-1', 'r', 'A', '', '0', '20', '', '', '', '', '', '3_12017_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12018', '0_3_12018', 'Rms current on the neutral_ IN', '', 'Analog Value', 'float', '', '-1', 'r', 'A', '', '0', '20', '', '', '', '', '', '3_12018_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12019', '0_3_12019', 'Maximum of I1_ I2_ I3_ and IN', '', 'Analog Value', 'float', '', '-1', 'r', 'A', '', '0', '20', '', '', '', '', '', '3_12019_U16_N_-_-_-_-', ''),
(NOW(), 'max_0_3_12022', '0_3_12022', 'Maximum rms current on phase 1_ I1', '', 'Analog Value', 'float', '', '-1', 'r', 'A', '', '0', '20', '', '', '', '', '', '3_12022_U16_N_-_-_-_-', ''),
(NOW(), 'max_0_3_12023', '0_3_12023', 'Maximum rms current on phase 2_ I2', '', 'Analog Value', 'float', '', '-1', 'r', 'A', '', '0', '20', '', '', '', '', '', '3_12023_U16_N_-_-_-_-', ''),
(NOW(), 'max_0_3_12024', '0_3_12024', 'Maximum rms current on phase 3_ I3', '', 'Analog Value', 'float', '', '-1', 'r', 'A', '', '0', '20', '', '', '', '', '', '3_12024_U16_N_-_-_-_-', ''),
(NOW(), 'max_0_3_12025', '0_3_12025', 'Maximum rms current on the neutral_ IN', '', 'Analog Value', 'float', '', '-1', 'r', 'A', '', '0', '20', '', '', '', '', '', '3_12025_U16_N_-_-_-_-', ''),
(NOW(), 'max_0_3_12026', '0_3_12026', 'Maximum rms current out of the 4 previous registers', '', 'Analog Value', 'float', '', '-1', 'r', 'A', '', '0', '20', '', '', '', '', '', '3_12026_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12029', '0_3_12029', 'Rms phase-to-phase voltage V12', '', 'Analog Value', 'float', '', '-1', 'r', 'V', '', '0', '850', '', '', '', '', '', '3_12029_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12030', '0_3_12030', 'Rms phase-to-phase voltage V23', '', 'Analog Value', 'float', '', '-1', 'r', 'V', '', '0', '850', '', '', '', '', '', '3_12030_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12031', '0_3_12031', 'Rms phase-to-phase voltage V31', '', 'Analog Value', 'float', '', '-1', 'r', 'V', '', '0', '850', '', '', '', '', '', '3_12031_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12032', '0_3_12032', 'Rms phase-to-neutral voltage V1N', '', 'Analog Value', 'float', '', '-1', 'r', 'V', '', '0', '850', '', '', '', '', '', '3_12032_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12033', '0_3_12033', 'Rms phase-to-neutral voltage V2N', '', 'Analog Value', 'float', '', '-1', 'r', 'V', '', '0', '850', '', '', '', '', '', '3_12033_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12034', '0_3_12034', 'Rms phase-to-neutral voltage V3N', '', 'Analog Value', 'float', '', '-1', 'r', 'V', '', '0', '850', '', '', '', '', '', '3_12034_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12035', '0_3_12035', 'Network frequency_ F', '', 'Analog Value', 'float', '', '-1', 'r', 'Hz', '%.1f', '150', '4400', '1', '0', '1000', '0', '100', '3_12035_U16_N_-_-_-_-', ''),
(NOW(), 'max_0_3_12036', '0_3_12036', 'Network frequency maximum', '', 'Analog Value', 'float', '', '-1', 'r', 'Hz', '%.1f', '150', '4400', '1', '0', '1000', '0', '100', '3_12036_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12037', '0_3_12037', 'Active power on phase 1_ P1', '', 'Analog Value', 'float', '', '-1', 'r', 'kW', '%.1f', '-10000', '10000', '1', '0', '1000', '0', '100', '3_12037_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12038', '0_3_12038', 'Active power on phase 2_ P2', '', 'Analog Value', 'float', '', '-1', 'r', 'kW', '%.1f', '-10000', '10000', '1', '0', '1000', '0', '100', '3_12038_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12039', '0_3_12039', 'Active power on phase 3_ P3', '', 'Analog Value', 'float', '', '-1', 'r', 'kW', '%.1f', '-10000', '10000', '1', '0', '1000', '0', '100', '3_12039_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12040', '0_3_12040', 'Total active power_ Ptot', '', 'Analog Value', 'float', '', '-1', 'r', 'kW', '%.1f', '-30000', '30000', '1', '0', '1000', '0', '100', '3_12040_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12049', '0_3_12049', 'Active energy_ Ep', '', 'Integral Value', 'integer', '', '-1', 'r', 'kWh', '%.0f', '', '', '', '', '', '', '', '3_12049_I32_W_-_-_-_-', ''),
(NOW(), 'cur_0_3_12051', '0_3_12051', 'Reactive energy_ Eq', '', 'Integral Value', 'integer', '', '-1', 'r', 'kVARh', '%.0f', '', '', '', '', '', '', '', '3_12051_I32_W_-_-_-_-', ''),
(NOW(), 'max_0_3_12089', '0_3_12089', 'Maximum rms phase-to-phase voltage V12', '', 'Analog Value', 'float', '', '-1', 'r', 'V', '', '0', '850', '', '', '', '', '', '3_12089_U16_N_-_-_-_-', ''),
(NOW(), 'max_0_3_12090', '0_3_12090', 'Maximum rms phase-to-phase voltage V23', '', 'Analog Value', 'float', '', '-1', 'r', 'V', '', '0', '850', '', '', '', '', '', '3_12090_U16_N_-_-_-_-', ''),
(NOW(), 'max_0_3_12091', '0_3_12091', 'Maximum rms phase-to-phase voltage V31', '', 'Analog Value', 'float', '', '-1', 'r', 'V', '', '0', '850', '', '', '', '', '', '3_12091_U16_N_-_-_-_-', ''),
(NOW(), 'max_0_3_12092', '0_3_12092', 'Maximum rms phase-to-neutral voltage V1N', '', 'Analog Value', 'float', '', '-1', 'r', 'V', '', '0', '850', '', '', '', '', '', '3_12092_U16_N_-_-_-_-', ''),
(NOW(), 'max_0_3_12093', '0_3_12093', 'Maximum rms phase-to-neutral voltage V2N', '', 'Analog Value', 'float', '', '-1', 'r', 'V', '', '0', '850', '', '', '', '', '', '3_12093_U16_N_-_-_-_-', ''),
(NOW(), 'max_0_3_12094', '0_3_12094', 'Maximum rms phase-to-neutral voltage V3N', '', 'Analog Value', 'float', '', '-1', 'r', 'V', '', '0', '850', '', '', '', '', '', '3_12094_U16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12095', '0_3_12095', 'Power factor on phase 1_ PF1', '', 'Integral Value', 'integer', '', '-1', 'r', '', '%.2f', '0', '850', '1', '0', '1000', '0', '10', '3_12095_I16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12096', '0_3_12096', 'Power factor on phase 2_ PF2', '', 'Integral Value', 'integer', '', '-1', 'r', '', '%.2f', '0', '850', '1', '0', '1000', '0', '10', '3_12096_I16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12097', '0_3_12097', 'Power factor on phase 3_ PF3', '', 'Integral Value', 'integer', '', '-1', 'r', '', '%.2f', '0', '850', '1', '0', '1000', '0', '10', '3_12097_I16_N_-_-_-_-', ''),
(NOW(), 'cur_0_3_12098', '0_3_12098', 'Total power factor_ PF', '', 'Integral Value', 'integer', '', '-1', 'r', '', '%.2f', '0', '850', '1', '0', '1000', '0', '10', '3_12098_I16_N_-_-_-_-', '');

CREATE TABLE IF NOT EXISTS `iw_set_schneider_nsx_short` (
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

REPLACE INTO `iw_set_schneider_nsx_short` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
(NOW(), 'cur_0_3_12015', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12016', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12017', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12018', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12019', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'max_0_3_12022', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'max_0_3_12023', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'max_0_3_12024', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'max_0_3_12025', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'max_0_3_12026', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12029', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12030', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12031', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12032', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12033', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12034', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12035', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'max_0_3_12036', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12037', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12038', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12039', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12040', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12049', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'cur_0_3_12051', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'max_0_3_12089', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'max_0_3_12090', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'max_0_3_12091', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'max_0_3_12092', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'max_0_3_12093', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'max_0_3_12094', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'cur_0_3_12095', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'cur_0_3_12096', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'cur_0_3_12097', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'cur_0_3_12098', '1', '0', 'slow', 'change', '', '', '', 0);




-- Changelog
--
-- v1 Orginal
--
--
--
