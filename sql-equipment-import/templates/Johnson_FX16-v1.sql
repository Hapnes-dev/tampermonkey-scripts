REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `driver_adr_extra`) VALUES 
(NOW(), '1', '0', 'V01', '360.01 Ventilasjon', 'fx16', 'FX16', '1_1', 'FX16', 'FX16', '');

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES 
(NOW(), '0', 'iw_jc.exe', 'FX16', '', '');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES 
(NOW(), 'com_port', 'FX16', '8', '', '', ''),
(NOW(), 'idle_event_rate', 'FX16', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'FX16', '2000', 'msec.', '', ''),
(NOW(), 'packet_timeout', 'FX16', '1', 'sec.', '', ''),
(NOW(), 'max_outstanding_packets', 'FX16', '-1', '', '', ''),
(NOW(), 'max_error_count', 'FX16', '2', '', '', ''),
(NOW(), 'max_group_count', 'FX16', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'FX16', '2', 'hours', '', ''),
(NOW(), 'speed_index_norm', 'FX16', '1', '', '', ''),
(NOW(), 'speed_index_slow', 'FX16', '1', '', '', ''),
(NOW(), 'speed_index_offline', 'FX16', '10', '', '', ''),
(NOW(), 'speed_index_block', 'FX16', '10', '', '', ''),
(NOW(), 'show_queue_info', 'FX16', '0', '', '', ''),
(NOW(), 'com_error_alarm_delay', 'FX16', '10', 'min.', '', ''),
(NOW(), 'baud_rate', 'FX16', '9600', '', '', ''),
(NOW(), 'parity', 'FX16', '0', '', '0=N,1=O,2=E,3=M,4=S', ''),
(NOW(), 'data_bits', 'FX16', '8', '', '5..8', ''),
(NOW(), 'stop_bits', 'FX16', '1', '', '1,2', ''),
(NOW(), 'check_rate', 'FX16', '2', 'ms', '', ''),
(NOW(), 'timeout', 'FX16', '250', 'ms', '', ''),
(NOW(), 'dx_password', 'FX16', '0000', '', '2 byte unsigned integer', ''),
(NOW(), 'module_timeout', 'FX16', '500', 'ms', '', '');

REPLACE INTO `iw_sys_order_no` VALUES 
(NOW(), 'FX16', 'fx16_param', 'fx16_groups');

CREATE TABLE `iw_par_fx16_groups` (
  `row_date` datetime NOT NULL default '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL default '',
  `view_order` mediumint(6) NOT NULL default '0',
  `ref` varchar(100) NOT NULL default '',
  `value` varchar(200) NOT NULL default '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) TYPE=MyISAM COMMENT='2.0.0';

REPLACE INTO `iw_par_fx16_groups` VALUES (NOW(), 'default_link', 2, '', '');
REPLACE INTO `iw_par_fx16_groups` VALUES (NOW(), 'group_alias', 2, 'group1', 'Analoge inn/ut');
REPLACE INTO `iw_par_fx16_groups` VALUES (NOW(), 'group', 1, 'group1', 'adf1');
REPLACE INTO `iw_par_fx16_groups` VALUES (NOW(), 'group', 2, 'group1', 'adf2');
REPLACE INTO `iw_par_fx16_groups` VALUES (NOW(), 'group', 3, 'group1', 'adf3');
REPLACE INTO `iw_par_fx16_groups` VALUES (NOW(), 'group', 4, 'group1', 'adf4');
REPLACE INTO `iw_par_fx16_groups` VALUES (NOW(), 'group', 5, 'group1', 'adf5');
REPLACE INTO `iw_par_fx16_groups` VALUES (NOW(), 'group', 6, 'group1', 'adf6');

CREATE TABLE `iw_par_fx16_param` (
  `row_date` datetime NOT NULL default '2002-01-10 00:00:00',
  `element_id` varchar(100) NOT NULL default '',
  `driver_id` varchar(100) NOT NULL default '',
  `alias_text` text NOT NULL,
  `menu` varchar(10) NOT NULL default '',
  `application` text NOT NULL,
  `parameter_type` text NOT NULL,
  `factory_setting` text NOT NULL,
  `grp` text NOT NULL,
  `att` text NOT NULL,
  `eng_unit` varchar(20) NOT NULL default '',
  `format` varchar(20) NOT NULL default '',
  `range_min` text NOT NULL,
  `range_max` text NOT NULL,
  `scale` varchar(15) NOT NULL default '',
  `raw_min` varchar(15) NOT NULL default '',
  `raw_max` varchar(15) NOT NULL default '',
  `eng_min` varchar(15) NOT NULL default '',
  `eng_max` varchar(15) NOT NULL default '',
  `driver_id_extra` varchar(255) NOT NULL default '',
  UNIQUE KEY `element_id` (`element_id`)
) TYPE=MyISAM COMMENT='2.0.0';

REPLACE INTO `iw_par_fx16_param` VALUES (NOW(), 'adf1', '5_00_01', 'AI1', 'AI1', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '', '', '', '', '', '', '', '', '');
REPLACE INTO `iw_par_fx16_param` VALUES (NOW(), 'adf2', '5_01_01', 'AI2', 'AI2', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '', '', '', '', '', '', '', '', '');
REPLACE INTO `iw_par_fx16_param` VALUES (NOW(), 'adf3', '5_02_01', 'AI3', 'AI3', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '', '', '', '', '', '', '', '', '');
REPLACE INTO `iw_par_fx16_param` VALUES (NOW(), 'adf4', '5_03_01', 'AI4', 'AI4', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '', '', '', '', '', '', '', '', '');
REPLACE INTO `iw_par_fx16_param` VALUES (NOW(), 'adf5', '5_04_01', 'AI5', 'AI5', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '', '', '', '', '', '', '', '', '');
REPLACE INTO `iw_par_fx16_param` VALUES (NOW(), 'adf6', '5_05_01', 'AI6', 'AI6', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '', '', '', '', '', '', '', '', '');

CREATE TABLE `iw_set_fx16` (
  `row_date` datetime NOT NULL default '2004-01-10 00:00:00',
  `element_id` varchar(100) NOT NULL default '',
  `active` enum('0','1') NOT NULL default '0',
  `onl_ind` enum('0','1') NOT NULL default '1',
  `update_freq` set('','fast','norm','slow','once') NOT NULL default 'norm',
  `save_data` enum('0','1','2') NOT NULL default '0',
  `save_freq` set('','fast','norm','slow') NOT NULL default 'norm',
  `plant_pri` char(1) NOT NULL default '',
  `sys_pri` char(1) NOT NULL default '',
  `alarm_type` tinyint(3) NOT NULL default '0',
  PRIMARY KEY  (`element_id`)
) TYPE=MyISAM COMMENT='2.0.3';

REPLACE INTO `iw_set_fx16` VALUES (NOW(), 'adf1', '1', '1', 'norm', '1', 'norm', '', '', 0);
REPLACE INTO `iw_set_fx16` VALUES (NOW(), 'adf2', '1', '1', 'norm', '1', 'norm', '', '', 0);
REPLACE INTO `iw_set_fx16` VALUES (NOW(), 'adf3', '1', '0', 'norm', '1', 'norm', '', '', 0);
REPLACE INTO `iw_set_fx16` VALUES (NOW(), 'adf4', '1', '0', 'norm', '1', 'norm', '', '', 0);
REPLACE INTO `iw_set_fx16` VALUES (NOW(), 'adf5', '1', '0', 'norm', '1', 'norm', '', '', 0);
REPLACE INTO `iw_set_fx16` VALUES (NOW(), 'adf6', '1', '0', 'norm', '1', 'norm', '', '', 0);


-- Changelog
--
-- v1 Orginal
--
--
