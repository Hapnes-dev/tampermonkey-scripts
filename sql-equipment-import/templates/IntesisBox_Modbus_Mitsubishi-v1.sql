REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`) VALUES
(NOW(), '1', '0', 'VP01', 'Varmepumpe', 'intesis_mitsubishi', 'INTESIS', '0_1', 'INTESIS', 'INTESIS', 0, '');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'comm_port', 'INTESIS', '7', '', '', ''),
(NOW(), 'comm_baudrate', 'INTESIS', '9600', '', '', ''),
(NOW(), 'comm_stop_bits', 'INTESIS', '2', '', '', ''),
(NOW(), 'comm_data_bits', 'INTESIS', '8', '', '', ''),
(NOW(), 'comm_parity', 'INTESIS', '0', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'mb_mode', 'INTESIS', '0', '', '0=RTU|1=ASCII|2=TCP', ''),
(NOW(), 'alarm_handler', 'INTESIS', '', '', '', ''),
(NOW(), 'idle_event_rate', 'INTESIS', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'INTESIS', '2000', 'msec.', '', ''),
(NOW(), 'value_quality_check_limit', 'INTESIS', '0', '', '0 = disabled', ''),
(NOW(), 'packet_timeout', 'INTESIS', '0', 'sec.', '', ''),
(NOW(), 'max_outstanding_packets', 'INTESIS', '-1', '', '', ''),
(NOW(), 'max_error_count', 'INTESIS', '2', '', '', ''),
(NOW(), 'max_group_count', 'INTESIS', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'INTESIS', '2', 'hours', '', ''),
(NOW(), 'speed_index_norm', 'INTESIS', '1', '', '', ''),
(NOW(), 'speed_index_slow', 'INTESIS', '1', '', '', ''),
(NOW(), 'speed_index_offline', 'INTESIS', '10', '', '', ''),
(NOW(), 'speed_index_block', 'INTESIS', '10', '', '', ''),
(NOW(), 'show_queue_info', 'INTESIS', '0', '', '', ''),
(NOW(), 'com_error_alarm_delay', 'INTESIS', '10', 'min.', '', ''),
(NOW(), 'mb_request_retries', 'INTESIS', '0', '', '', ''),
(NOW(), 'mb_request_timeout', 'INTESIS', '500', 'ms', '', ''),
(NOW(), 'mux_settle_time', 'INTESIS', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
(NOW(), 'startup_delay', 'INTESIS', '15', 'Sec.', '', ''),
(NOW(), 'check_rate', 'INTESIS', '1', 'ms', '', ''),
(NOW(), 'handshake', 'INTESIS', '0', '', '0|1|2', ''),
(NOW(), 'force_word_not_byte', 'INTESIS', '0', '', '0|1', '');

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
(NOW(), '0', 'iw_mb.exe', 'INTESIS', '', '');

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(NOW(), 'INTESIS', 'intesis_mitsubishi_param', 'intesis_mitsubishi_groups');

CREATE TABLE IF NOT EXISTS `iw_par_intesis_mitsubishi_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

REPLACE INTO `iw_par_intesis_mitsubishi_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
(NOW(), 'default_link', 1, '', ''),
(NOW(), 'group_alias', 1, 'control', 'Control and status registers'),
(NOW(), 'group_alias', 2, 'config', 'Configuration Registers'),
(NOW(), 'group_alias', 3, 'aux', 'Auxiliary Registers'),
(NOW(), 'group', 1, 'control', 'control_0_3_0'),
(NOW(), 'group', 4, 'control', 'control_0_3_1'),
(NOW(), 'group', 7, 'control', 'control_0_3_2'),
(NOW(), 'group', 10, 'control', 'control_0_3_3'),
(NOW(), 'group', 13, 'control', 'control_0_3_4'),
(NOW(), 'group', 16, 'control', 'control_0_3_5'),
(NOW(), 'group', 19, 'control', 'control_0_3_6'),
(NOW(), 'group', 22, 'control', 'control_0_3_7'),
(NOW(), 'group', 25, 'control', 'control_0_3_8'),
(NOW(), 'group', 28, 'control', 'control_0_3_9'),
(NOW(), 'group', 31, 'control', 'control_0_3_10'),
(NOW(), 'group', 34, 'control', 'control_0_3_11'),
(NOW(), 'group', 37, 'control', 'control_0_3_22'),
(NOW(), 'group', 40, 'control', 'control_0_3_23'),
(NOW(), 'group', 1, 'config', 'config_0_3_12'),
(NOW(), 'group', 4, 'config', 'config_0_3_13'),
(NOW(), 'group', 7, 'config', 'config_0_3_14'),
(NOW(), 'group', 10, 'config', 'config_0_3_15'),
(NOW(), 'group', 13, 'config', 'config_0_3_50'),
(NOW(), 'group', 1, 'aux', 'aux_0_3_16'),
(NOW(), 'group', 4, 'aux', 'aux_0_3_17'),
(NOW(), 'group', 7, 'aux', 'aux_0_3_18'),
(NOW(), 'group', 45, 'control', 'control_0_3_43'),
(NOW(), 'group', 46, 'control', 'control_0_3_44'),
(NOW(), 'group', 47, 'control', 'control_0_3_45'),
(NOW(), 'group', 48, 'control', 'control_0_3_46'),
(NOW(), 'group', 49, 'control', 'control_0_3_55');

CREATE TABLE IF NOT EXISTS `iw_par_intesis_mitsubishi_param` (
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

REPLACE INTO `iw_par_intesis_mitsubishi_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
(NOW(), 'control_0_3_0', '0_3_0', 'AC unit On/Off', '', 'Digital IO', 'boolean', '', '-1', 'rw', '', '', '0', '1', '', '', '', '', '', '3_0_U16_N_6_0_U16_N', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}'),
(NOW(), 'control_0_3_1', '0_3_1', 'AC unit Mode ', '', 'Integral values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '3_1_U16_N_6_1_U16_N', '{"rev":"1","type":"num","v":{"0":{"t":"Auto"},"1":{"t":"Heat"},"2":{"t":"Dry"},"3":{"t":"Fan"},"4":{"t":"Cool","bc":"blue","tc":"white"}}}'),
(NOW(), 'control_0_3_2', '0_3_2', 'AC unit Fan Speed', '', 'Integral values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '3_2_U16_N_6_2_U16_N', '{"rev":"1","type":"num","v":{"0":{"t":"Auto"},"1":{"t":"Low"},"2":{"t":"Mid 1"},"3":{"t":"Mid 2"},"4":{"t":"High"}}}'),
(NOW(), 'control_0_3_3', '0_3_3', 'AC unit Vane Position', '', 'Integral values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '3_3_U16_N_6_3_U16_N', '{"rev":"1","type":"num","v":{"0":{"t":"Auto"},"1":{"t":"Horizontal"},"2":{"t":"Position 2"},"3":{"t":"Position 3"},"4":{"t":"Position 4"},"5":{"t":"Vertical"},"6":{"t":"Swing"}}}'),
(NOW(), 'control_0_3_4', '0_3_4', 'AC unit Temperature Setpoint', '', 'Analog values', 'float', '', '-1', 'rw', '&deg;C', '%.1f', '', '', '', '', '', '', '', '3_4_U16_N_6_4_U16_N', ''),
(NOW(), 'control_0_3_5', '0_3_5', 'AC unit Ambient Temperature', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '', '', '', '', '', '3_5_U16_N_-_-_-_-', ''),
(NOW(), 'control_0_3_6', '0_3_6', 'Window Contact', '', 'Digital IO', 'boolean', '', '-1', 'rw', '', '', '0', '1', '', '', '', '', '', '3_6_U16_N_6_6_U16_N', '{"rev":"1","type":"num","v":{"0":{"t":"Open"},"1":{"t":"Closed"}}}'),
(NOW(), 'control_0_3_7', '0_3_7', 'Device Disablement', '', 'Digital IO', 'boolean', '', '-1', 'rw', '', '', '0', '1', '', '', '', '', '', '3_7_U16_N_6_7_U16_N', '{"rev":"1","type":"num","v":{"0":{"t":"MH-RC-MBS-1 enabled"},"1":{"t":"MH-RC-MBS-1 disabled"}}}'),
(NOW(), 'control_0_3_8', '0_3_8', 'IR Remote Command Disablement', '', 'Digital IO', 'boolean', '', '-1', 'rw', '', '', '0', '1', '', '', '', '', '', '3_8_U16_N_6_8_U16_N', '{"rev":"1","type":"num","v":{"0":{"t":"Enabled"},"1":{"t":"Disabled"}}}'),
(NOW(), 'control_0_3_9', '0_3_9', 'AC unit Operation Time', '', 'Integral values', 'integer', '', '-1', 'rw', 'hours', '', '', '', '', '', '', '', '', '3_9_U16_N_6_9_U16_N', ''),
(NOW(), 'control_0_3_10', '0_3_10', 'AC unit Alarm Status', '', 'Digital IO', 'boolean', '', '-1', 'r', '', '', '0', '1', '', '', '', '', '', '3_10_U16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"No alarm"},"1":{"t":"ALARM","bc":"red","tc":"white"}}}'),
(NOW(), 'control_0_3_11', '0_3_11', 'Error Code', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_11_U16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"No active error"},"1":{"t":"E1 Remote controller communication error"},"2":{"t":"E2 Duplicated indoor unit address"},"3":{"t":"E3 Outdoor unit signal line error"},"5":{"t":"E5 Communication error during operation"},"6":{"t":"E6 Indoor heat exchanger temperature thermistor anomaly"},"7":{"t":"E7 Indoor return air temperature thermistor anomaly"},"8":{"t":"E8 Heating overload operation"},"9":{"t":"E9 Drain trouble"},"10":{"t":"E10 Excessive number of indoor units by controlling one remote controller"},"12":{"t":"E12 Address setting error by mixed setting method"},"14":{"t":"E14 Communication error between master and slave indoor units"},"16":{"t":"E16 Indoor fan motor anomaly"},"19":{"t":"E19 Indoor unit operation check, drain motor check setting error"},"28":{"t":"E28 Remote controller temperature thermistor anomaly"},"30":{"t":"E30 Unmatched connection of indoor and outdoor unit"},"31":{"t":"E31 Duplicated outdoor unit address No."},"32":{"t":"E32 Open L3 Phase on power supply at primary side"},"33":{"t":"E33 Inverter primary current error"},"35":{"t":"E35 Cooling overload operation"},"36":{"t":"E36 Discharge pipe temperature error"},"37":{"t":"E37 Outdoor heat exchanger temperature thermistor anomaly"},"38":{"t":"E38 Outdoor/Ambient air temperature thermistor anomaly"},"39":{"t":"E39 Discharge pipe temperature thermistor anomaly"},"40":{"t":"E40 High pressure error"},"41":{"t":"E41 Power transistor overheat"},"42":{"t":"E42 Current cut"},"43":{"t":"E43 Excessive number of indoor units connected, excessive total capacity of connection"},"45":{"t":"E45 Communication error inverter PCB and outdoor control PCB"},"46":{"t":"E46 Mixed address setting methods coexistent in same network"},"47":{"t":"E47 Inverter over-current error"},"48":{"t":"E48 Outdoor DC fan motor anomaly"},"49":{"t":"E49 Low pressure anomaly"},"51":{"t":"E51 Inverter anomaly"},"53":{"t":"E53 Suction pipe temperature thermistor anomaly"},"54":{"t":"E54 High/Low pressure sensor anomaly"},"55":{"t":"E55 Underneath temperature thermistor anomaly"},"56":{"t":"E56 Power transistor temperature thermistor anomaly"},"57":{"t":"E57 Insufficient in refrigerant amount or detection of service valve closure"},"58":{"t":"E58 Anomalous compressor by loss of synchronism"},"59":{"t":"E59 Compressor startup failure"},"60":{"t":"E60 Rotor position detection failure / Anomalous compressor rotor lock"},"61":{"t":"E61 Communication error between the master unit and slave units"},"63":{"t":"E63 Emergency stop"},"65532":{"t":"Initialization process"},"65535":{"t":"Communication error MH-RC-MBS-1 and AC unit"}}}'),
(NOW(), 'control_0_3_44', '0_3_44', 'Filter status', '', 'Analog values', 'float', '', '-1', 'r', '', '%.0f', '', '', '', '', '', '', '', '3_44_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"Ok"},"1":{"t":"Filter Cleaning"}}}'),
(NOW(), 'control_0_3_45', '0_3_45', 'Error reset', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.0f', '', '', '', '', '', '', '', '3_45_I16_N_6_45_I16_N', '{"rev":"1","type":"num","v":{"0":{"t":"-"},"1":{"t":"Error Reset"}}}'),
(NOW(), 'control_0_3_46', '0_3_46', 'Center/Remote', '', 'Analog values', 'float', '', '-1', 'r', '', '%.0f', '', '', '', '', '', '', '', '3_46_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"Remote Unlock"},"1":{"t":"Remote Lock On/Off"},"2":{"t":"Remote Lock All"},"3":{"t":"Remote"}}}'),
(NOW(), 'control_0_3_22', '0_3_22', 'External Sensor Temperature', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_22_U16_N_6_22_U16_N', ''),
(NOW(), 'control_0_3_23', '0_3_23', 'AC setpoint temperature', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '', '', '', '', '', '3_23_U16_N_-_-_-_-', ''),
(NOW(), 'config_0_3_12', '0_3_12', 'AC Model', '', 'Integral values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '3_12_U16_N_6_12_U16_N', ''),
(NOW(), 'config_0_3_13', '0_3_13', 'Open Window switch-off timeout', '', 'Integral values', 'integer', '', '-1', 'rw', 'min', '', '', '', '', '', '', '', '', '3_13_U16_N_6_13_U16_N', ''),
(NOW(), 'config_0_3_14', '0_3_14', 'Modbus RTU baud-rate', '', 'Integral values', 'integer', '', '-1', 'rw', 'bps', '', '', '', '', '', '', '', '', '3_14_U16_N_6_14_U16_N', ''),
(NOW(), 'control_0_3_43', '0_3_43', 'Filter reset', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.0f', '', '', '', '', '', '', '', '3_43_I16_N_6_43_I16_N', '{"rev":"1","type":"num","v":{"0":{"t":"-"},"1":{"t":"Filter Reset"}}}'),
(NOW(), 'config_0_3_15', '0_3_15', 'Devices Modbus slave address', '', 'Integral values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '3_15_U16_N_6_15_U16_N', ''),
(NOW(), 'config_0_3_50', '0_3_50', 'Software version', '', 'Integral values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_50_U16_N_-_-_-_-', ''),
(NOW(), 'aux_0_3_16', '0_3_16', 'Digital Input 1', '', 'Digital IO', 'boolean', '', '-1', 'r', '', '', '0', '1', '', '', '', '', '', '3_16_U16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"Open"},"1":{"t":"Closed"}}}'),
(NOW(), 'aux_0_3_17', '0_3_17', 'Digital Input 2', '', 'Digital IO', 'boolean', '', '-1', 'r', '', '', '0', '1', '', '', '', '', '', '3_17_U16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"Open"},"1":{"t":"Closed"}}}'),
(NOW(), 'aux_0_3_18', '0_3_18', 'Relay Output 1', '', 'Digital IO', 'boolean', '', '-1', 'rw', '', '', '0', '1', '', '', '', '', '', '3_18_U16_N_6_18_U16_N', '{"rev":"1","type":"num","v":{"0":{"t":"Open"},"1":{"t":"Closed"}}}'),
(NOW(), 'control_0_3_55', '0_3_49', 'Device Indentification', '', 'Integer value', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '3_49_U16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"3840":{"t":"MH-RC-MBS-1"},"2049":{"t":"DK-RC-MBS-1"},"3328":{"t":"FJ-RC-MBS-1"},"3072":{"t":"PA-AC-MBS-1"},"5376":{"t":"PA-RC2-MBS-1"}}}');

CREATE TABLE IF NOT EXISTS `iw_set_intesis_mitsubishi` (
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

REPLACE INTO `iw_set_intesis_mitsubishi` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
(NOW(), 'control_0_3_0', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'control_0_3_1', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'control_0_3_2', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'control_0_3_3', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'control_0_3_4', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'control_0_3_5', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'control_0_3_6', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'control_0_3_7', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'control_0_3_8', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'control_0_3_9', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'control_0_3_10', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'control_0_3_11', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'control_0_3_22', '1', '1', 'slow', 'change', '', '', '', 0),
(NOW(), 'control_0_3_23', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'config_0_3_12', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'config_0_3_13', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'config_0_3_14', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'config_0_3_15', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'config_0_3_50', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'aux_0_3_16', '0', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'aux_0_3_17', '0', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'aux_0_3_18', '0', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'control_0_3_43', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'control_0_3_44', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'control_0_3_45', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'control_0_3_46', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'control_0_3_55', '1', '0', 'norm', 'min', '1', '', '', 0);







-- Changelog
--
-- v1 Orginal
-- Denne versjonen inneholder Device Id for å gjenkjenne hvilken type enhet du logger data mot.
-- 
--