REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`) VALUES
(NOW(), '1', '0', 'E01', 'Energi 1', 'circuitor_cbs8', 'CIRCUTOR', '0_1', 'CIRCUITOR', 'CBS8', '', ''),
(NOW(), '1', '0', 'E02', 'Energi 2', 'circuitor_cbs8', 'CIRCUTOR', '0_2', 'CIRCUITOR', 'CBS8', '', ''),
(NOW(), '1', '0', 'E03', 'Energi 3', 'circuitor_cbs8', 'CIRCUTOR', '0_3', 'CIRCUITOR', 'CBS8', '', '');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'comm_port', 'CIRCUTOR', '6', '', '', ''),
(NOW(), 'comm_baudrate', 'CIRCUTOR', '9600', '', '', ''),
(NOW(), 'comm_stop_bits', 'CIRCUTOR', '1', '', '', ''),
(NOW(), 'comm_data_bits', 'CIRCUTOR', '8', '', '', ''),
(NOW(), 'comm_parity', 'CIRCUTOR', '2', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'mb_mode', 'CIRCUTOR', '0', '', '0=RTU|1=ASCII|2=TCP', ''),
(NOW(), 'alarm_handler', 'CIRCUTOR', '', '', '', ''),
(NOW(), 'idle_event_rate', 'CIRCUTOR', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'CIRCUTOR', '2000', 'msec.', '', ''),
(NOW(), 'value_quality_check_limit', 'CIRCUTOR', '0', '', '0 = disabled', ''),
(NOW(), 'packet_timeout', 'CIRCUTOR', '0', 'sec.', '', ''),
(NOW(), 'max_outstanding_packets', 'CIRCUTOR', '-1', '', '', ''),
(NOW(), 'max_error_count', 'CIRCUTOR', '2', '', '', ''),
(NOW(), 'max_group_count', 'CIRCUTOR', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'CIRCUTOR', '2', 'hours', '', ''),
(NOW(), 'speed_index_norm', 'CIRCUTOR', '1', '', '', ''),
(NOW(), 'speed_index_slow', 'CIRCUTOR', '1', '', '', ''),
(NOW(), 'speed_index_offline', 'CIRCUTOR', '10', '', '', ''),
(NOW(), 'speed_index_block', 'CIRCUTOR', '10', '', '', ''),
(NOW(), 'show_queue_info', 'CIRCUTOR', '0', '', '', ''),
(NOW(), 'com_error_alarm_delay', 'CIRCUTOR', '10', 'min.', '', ''),
(NOW(), 'mb_request_retries', 'CIRCUTOR', '0', '', '', ''),
(NOW(), 'mb_request_timeout', 'CIRCUTOR', '500', 'ms', '', ''),
(NOW(), 'mux_settle_time', 'CIRCUTOR', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
(NOW(), 'startup_delay', 'CIRCUTOR', '15', 'Sec.', '', ''),
(NOW(), 'check_rate', 'CIRCUTOR', '1', 'ms', '', ''),
(NOW(), 'handshake', 'CIRCUTOR', '0', '', '0|1|2', ''),
(NOW(), 'force_word_not_byte', 'CIRCUTOR', '0', '', '0|1', '');

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
(NOW(), '0', 'iw_mb.exe', 'CIRCUTOR', '', '');

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(NOW(), 'CBS8', 'circuitor_cbs8_param', 'circuitor_cbs8_groups');

CREATE TABLE IF NOT EXISTS `iw_par_circuitor_cbs8_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

REPLACE INTO `iw_par_circuitor_cbs8_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
(NOW(), 'default_link', 1, '', ''),
(NOW(), 'group_alias', 1, 'param', 'Parameter'),
(NOW(), 'group', 1, 'param', 'param_0_4_2'),
(NOW(), 'group', 4, 'param', 'param_0_4_3'),
(NOW(), 'group', 7, 'param', 'param_0_4_4'),
(NOW(), 'group', 10, 'param', 'param_0_4_5'),
(NOW(), 'group', 13, 'param', 'param_0_4_6'),
(NOW(), 'group', 16, 'param', 'param_0_4_7'),
(NOW(), 'group', 19, 'param', 'param_0_4_8'),
(NOW(), 'group', 22, 'param', 'param_0_4_9'),
(NOW(), 'group', 25, 'param', 'param_0_4_10'),
(NOW(), 'group', 28, 'param', 'param_0_4_11'),
(NOW(), 'group', 31, 'param', 'param_0_4_12'),
(NOW(), 'group', 34, 'param', 'param_0_4_13'),
(NOW(), 'group', 37, 'param', 'param_0_4_14'),
(NOW(), 'group', 40, 'param', 'param_0_4_15'),
(NOW(), 'group', 43, 'param', 'param_0_4_16'),
(NOW(), 'group', 46, 'param', 'param_0_4_17'),
(NOW(), 'group', 49, 'param', 'param_0_4_18'),
(NOW(), 'group', 52, 'param', 'param_0_4_19'),
(NOW(), 'group', 55, 'param', 'param_0_4_20'),
(NOW(), 'group', 58, 'param', 'param_0_4_21'),
(NOW(), 'group', 61, 'param', 'param_0_4_22'),
(NOW(), 'group', 64, 'param', 'param_0_4_23'),
(NOW(), 'group', 67, 'param', 'param_0_4_24'),
(NOW(), 'group', 70, 'param', 'param_0_4_25'),
(NOW(), 'group', 73, 'param', 'param_0_4_26'),
(NOW(), 'group', 76, 'param', 'param_0_4_27'),
(NOW(), 'group', 79, 'param', 'param_0_4_28'),
(NOW(), 'group', 82, 'param', 'param_0_4_29'),
(NOW(), 'group', 85, 'param', 'param_0_4_30'),
(NOW(), 'group', 88, 'param', 'param_0_4_31'),
(NOW(), 'group', 91, 'param', 'param_0_4_32'),
(NOW(), 'group', 94, 'param', 'param_0_4_33'),
(NOW(), 'group', 97, 'param', 'param_0_4_34'),
(NOW(), 'group', 100, 'param', 'param_0_4_35'),
(NOW(), 'group', 103, 'param', 'param_0_4_36'),
(NOW(), 'group', 106, 'param', 'param_0_4_37'),
(NOW(), 'group', 109, 'param', 'param_0_4_38');

CREATE TABLE IF NOT EXISTS `iw_par_circuitor_cbs8_param` (
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

REPLACE INTO `iw_par_circuitor_cbs8_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
(NOW(), 'param_0_4_2', '0_4_2', 'Earth Current Ch 1', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_2_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_3', '0_4_3', 'Earth Current Ch 2', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_3_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_4', '0_4_4', 'Earth Current Ch 3', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_4_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_5', '0_4_5', 'Earth Current Ch 4', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_5_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_6', '0_4_6', 'Earth Current Ch 5', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_6_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_7', '0_4_7', 'Earth Current Ch 6', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_7_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_8', '0_4_8', 'Earth Current Ch 7', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_8_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_9', '0_4_9', 'Earth Current Ch 8', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_9_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_10', '0_4_10', 'Output Status Ch 1 (0=OK 1=Exceeded 2=- Tripped 3=Blocked)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_10_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"0-OK","bc":"white","tc":"black"},"1":{"t":"1-Exceeded","bc":"white","tc":"black"},"2":{"t":"2-- Tripped","bc":"white","tc":"black"},"3":{"t":"3-Blocked","bc":"white","tc":"black"}}}'),
(NOW(), 'param_0_4_11', '0_4_11', 'Output Status Ch 2 (0=OK 1=Exceeded 2=- Tripped 3=Blocked)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_11_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"0-OK","bc":"white","tc":"black"},"1":{"t":"1-Exceeded","bc":"white","tc":"black"},"2":{"t":"2-- Tripped","bc":"white","tc":"black"},"3":{"t":"3-Blocked","bc":"white","tc":"black"}}}'),
(NOW(), 'param_0_4_12', '0_4_12', 'Output Status Ch 3 (0=OK 1=Exceeded 2=- Tripped 3=Blocked)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_12_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"0-OK","bc":"white","tc":"black"},"1":{"t":"1-Exceeded","bc":"white","tc":"black"},"2":{"t":"2-- Tripped","bc":"white","tc":"black"},"3":{"t":"3-Blocked","bc":"white","tc":"black"}}}'),
(NOW(), 'param_0_4_13', '0_4_13', 'Output Status Ch 4 (0=OK 1=Exceeded 2=- Tripped 3=Blocked)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_13_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"0-OK","bc":"white","tc":"black"},"1":{"t":"1-Exceeded","bc":"white","tc":"black"},"2":{"t":"2-- Tripped","bc":"white","tc":"black"},"3":{"t":"3-Blocked","bc":"white","tc":"black"}}}'),
(NOW(), 'param_0_4_14', '0_4_14', 'Output Status Ch 5 (0=OK 1=Exceeded 2=- Tripped 3=Blocked)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_14_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"0-OK","bc":"white","tc":"black"},"1":{"t":"1-Exceeded","bc":"white","tc":"black"},"2":{"t":"2-- Tripped","bc":"white","tc":"black"},"3":{"t":"3-Blocked","bc":"white","tc":"black"}}}'),
(NOW(), 'param_0_4_15', '0_4_15', 'Output Status Ch 6 (0=OK 1=Exceeded 2=- Tripped 3=Blocked)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_15_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"0-OK","bc":"white","tc":"black"},"1":{"t":"1-Exceeded","bc":"white","tc":"black"},"2":{"t":"2-- Tripped","bc":"white","tc":"black"},"3":{"t":"3-Blocked","bc":"white","tc":"black"}}}'),
(NOW(), 'param_0_4_16', '0_4_16', 'Output Status Ch 7 (0=OK 1=Exceeded 2=- Tripped 3=Blocked)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_16_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"0-OK","bc":"white","tc":"black"},"1":{"t":"1-Exceeded","bc":"white","tc":"black"},"2":{"t":"2-- Tripped","bc":"white","tc":"black"},"3":{"t":"3-Blocked","bc":"white","tc":"black"}}}'),
(NOW(), 'param_0_4_17', '0_4_17', 'Output Status Ch 8 (0=OK 1=Exceeded 2=- Tripped 3=Blocked)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_17_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"0-OK","bc":"white","tc":"black"},"1":{"t":"1-Exceeded","bc":"white","tc":"black"},"2":{"t":"2-- Tripped","bc":"white","tc":"black"},"3":{"t":"3-Blocked","bc":"white","tc":"black"}}}'),
(NOW(), 'param_0_4_18', '0_4_18', 'Alarm Relay- Earth failure', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_18_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_19', '0_4_19', 'Trip Current Ch 1', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_19_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_20', '0_4_20', 'Trip Current Ch 2', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_20_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_21', '0_4_21', 'Trip Current Ch 3', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_21_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_22', '0_4_22', 'Trip Current Ch 4', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_22_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_23', '0_4_23', 'Trip Current Ch 5', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_23_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_24', '0_4_24', 'Trip Current Ch 6', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_24_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_25', '0_4_25', 'Trip Current Ch 7', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_25_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_26', '0_4_26', 'Trip Current Ch 8', '', 'Analog values', 'float', '', '-1', 'r', 'mA', '', '', '', '', '', '', '', '', '4_26_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_27', '0_4_27', 'Last Recorded - Trip', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_27_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_28', '0_4_28', 'Operating Mode', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_28_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_29', '0_4_29', 'Prog Switch (0=Up 1=Down)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_29_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_30', '0_4_30', 'SW Version', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_30_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_31', '0_4_31', 'Pre Alarm Activated Ch 1 (0=Not Activ. 1=Activated)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_31_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_32', '0_4_32', 'Pre Alarm Activated Ch 2 (0=Not Activ. 1=Activated)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_32_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_33', '0_4_33', 'Pre Alarm Activated Ch 3 (0=Not Activ. 1=Activated)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_33_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_34', '0_4_34', 'Pre Alarm Activated Ch 4 (0=Not Activ. 1=Activated)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_34_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_35', '0_4_35', 'Pre Alarm Activated Ch 5 (0=Not Activ. 1=Activated)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_35_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_36', '0_4_36', 'Pre Alarm Activated Ch 6 (0=Not Activ. 1=Activated)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_36_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_37', '0_4_37', 'Pre Alarm Activated Ch 7 (0=Not Activ. 1=Activated)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_37_I16_N_-_-_-_-', ''),
(NOW(), 'param_0_4_38', '0_4_38', 'Pre Alarm Activated Ch 8 (0=Not Activ. 1=Activated)', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_38_I16_N_-_-_-_-', '');

CREATE TABLE IF NOT EXISTS `iw_set_circuitor_cbs8` (
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

REPLACE INTO `iw_set_circuitor_cbs8` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
(NOW(), 'param_0_4_2', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_3', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_4', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_5', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_6', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_7', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_8', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_9', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_10', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_11', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_12', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_13', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_14', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_15', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_16', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_17', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_18', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'param_0_4_19', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_20', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_21', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_22', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_23', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_24', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_25', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_26', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'param_0_4_27', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_28', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_29', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_30', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_31', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_32', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_33', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_34', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_35', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_36', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_37', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'param_0_4_38', '1', '0', 'slow', 'change', '', '', '', 0);




-- Changelog
--
--
-- v1 orginal
--
--
--
--