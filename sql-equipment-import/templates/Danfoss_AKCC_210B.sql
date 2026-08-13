-- phpMyAdmin SQL Dump
-- version 3.3.10.5
-- http://www.phpmyadmin.net
--
-- Host: 127.0.0.1
-- Generation Time: May 09, 2025 at 08:51 AM
-- Server version: 5.5.68
-- PHP Version: 5.6.29

SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";

--
-- Database: `iw_plant_server3`
----



REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`, `unit_extra`) VALUES
(NOW(), '1', '0', 'U01', 'K20', 'cc_210b_modbus', 'AKPC420', '0_11', 'CC210B', 'CC210B', 40, '', ''),
(NOW(),  '1', '0', 'U02', 'K21', 'cc_210b_modbus', 'AKPC420', '0_12', 'CC210B', 'CC210B', 50, '', ''),
(NOW(),  '1', '0', 'U03', 'K22', 'cc_210b_modbus', 'AKPC420', '0_13', 'CC210B', 'CC210B', 60, '', ''),
(NOW(),  '1', '0', 'U04', 'K23', 'cc_210b_modbus', 'AKPC420', '0_14', 'CC210B', 'CC210B', 70, '', ''),
(NOW(),  '1', '0', 'U05', 'K01', 'cc_210b_modbus', 'AKPC420', '0_15', 'CC210B', 'CC210B', 80, '', ''),
(NOW(),  '1', '0', 'U06', 'K05', 'cc_210b_modbus', 'AKPC420', '0_16', 'CC210B', 'CC210B', 80, '', ''),
(NOW(),  '1', '0', 'U07', 'K06', 'cc_210b_modbus', 'AKPC420', '0_17', 'CC210B', 'CC210B', 80, '', ''),
(NOW(),  '1', '0', 'U08', 'K11', 'cc_210b_modbus', 'AKPC420', '0_18', 'CC210B', 'CC210B', 80, '', ''),
(NOW(),  '1', '0', 'U09', 'K12', 'cc_210b_modbus', 'AKPC420', '0_19', 'CC210B', 'CC210B', 80, '', ''),
(NOW(), '1', '0', 'U10', 'K45 Meieri', 'cc_210b_modbus', 'AKPC420', '0_20', 'CC210B', 'CC210B', 80, '', ''),
(NOW(), '1', '0', 'U11', 'K51 Kjøtt', 'cc_210b_modbus', 'AKPC420', '0_21', 'CC210B', 'CC210B', 80, '', ''),
(NOW(), '1', '0', 'U12', 'K52 Frukt', 'cc_210b_modbus', 'AKPC420', '0_22', 'CC210B', 'CC210B', 80, '', '');


CREATE TABLE IF NOT EXISTS `iw_sys_plant_settings` (
  `row_date` datetime NOT NULL DEFAULT '2002-01-10 00:00:00',
  `setting` varchar(30) NOT NULL DEFAULT '',
  `owner` varchar(50) NOT NULL DEFAULT '',
  `value` text NOT NULL,
  `eng_unit` varchar(20) NOT NULL DEFAULT '',
  `help_text` text NOT NULL,
  `help_link` text NOT NULL,
  UNIQUE KEY `setting_owner` (`setting`,`owner`),
  KEY `date` (`row_date`),
  KEY `setting` (`setting`),
  KEY `owner` (`owner`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

--
-- Dumping data for table `iw_sys_plant_settings`
--

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'comm_port', 'AKPC420', '2', '', '', ''),
(NOW(), 'mb_tcp_servers', 'AKPC420', '1;192.168.10.100;502;1000;2;1000\r\n', '', 'ID;IPadr;IPport;ConnTout;ConnRetries;RequestTout', ''),
(NOW(), 'mb_mode', 'AKPC420', '0', '', '0=RTU|1=ASCII|2=TCP', ''),
(NOW(), 'comm_parity', 'AKPC420', '2', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'comm_data_bits', 'AKPC420', '8', '', '', ''),
(NOW(), 'comm_stop_bits', 'AKPC420', '1', '', '', ''),
(NOW(), 'comm_baudrate', 'AKPC420', '19200', '', '', ''),
(NOW(), 'mb_request_retries', 'AKPC420', '2', '', '', ''),
(NOW(), 'force_word_not_byte', 'AKPC420', '0', '', '0|1', ''),
(NOW(), 'handshake', 'AKPC420', '0', '', '0|1|2', ''),
(NOW(), 'check_rate', 'AKPC420', '1', 'ms', '', ''),
(NOW(), 'max_outstanding_packets', 'AKPC420', '-1', '', '', ''),
(NOW(), 'packet_timeout', 'AKPC420', '1', 'sec.', '', ''),
(NOW(), 'idle_event_rate', 'AKPC420', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'AKPC420', '2000', 'msec.', '', ''),
(NOW(), 'max_error_count', 'AKPC420', '2', '', '', ''),
(NOW(), 'mb_request_timeout', 'AKPC420', '1000', 'ms', '', ''),
(NOW(), 'com_error_alarm_delay', 'AKPC420', '10', 'min.', '', ''),
(NOW(), 'show_queue_info', 'AKPC420', '0', '', '', ''),
(NOW(), 'speed_index_block', 'AKPC420', '10', '', '', ''),
(NOW(), 'speed_index_offline', 'AKPC420', '10', '', '', ''),
(NOW(), 'speed_index_slow', 'AKPC420', '1', '', '', ''),
(NOW(), 'speed_index_norm', 'AKPC420', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'AKPC420', '2', 'hours', '', ''),
(NOW(), 'max_group_count', 'AKPC420', '1', '', '', ''),
(NOW(), 'value_quality_check_limit', 'AKPC420', '0', '', '0 = disabled', ''),
(NOW(), 'mux_settle_time', 'AKPC420', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
(NOW(), 'startup_delay', 'AKPC420', '15', 'Sec.', '', ''),
(NOW(), 'alarm_handler', 'AKPC420', '', '', '', ''),
(NOW(), 'allow_crc_swap', 'AKPC420', '0', '', 'Default 0', ''),
(NOW(), 'enablers485mode', 'AKPC420', '0', '', '0=OFF|0 < delay in ms and ON', '');

-- --------------------------------------------------------
--
-- Table structure for table `iw_sys_order_no`
--

CREATE TABLE IF NOT EXISTS `iw_sys_order_no` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `order_no` varchar(50) NOT NULL DEFAULT '',
  `db_link` varchar(50) NOT NULL DEFAULT '',
  `group_link` varchar(50) NOT NULL DEFAULT '',
  PRIMARY KEY (`order_no`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='3.0.0';

--
-- Dumping data for table `iw_sys_order_no`
--

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(NOW(), 'AKPC420', 'akpc420_modbus_param', 'akpc420_modbus_groups');


-- Table structure for table `iw_sys_processes`
--

CREATE TABLE IF NOT EXISTS `iw_sys_processes` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `man_start` enum('-1','0','1') NOT NULL DEFAULT '0',
  `path` varchar(255) NOT NULL DEFAULT '',
  `process_name` varchar(50) NOT NULL DEFAULT '',
  `process_id` varchar(20) NOT NULL DEFAULT '',
  `process_status` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `process_name` (`process_name`),
  KEY `process_name_2` (`process_name`),
  KEY `process_id` (`process_id`),
  KEY `process_status` (`process_status`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='4.0.0';

--
-- Dumping data for table `iw_sys_processes`
--

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
('2019-12-18 13:46:49', '0', 'iw_mb.exe', 'AKPC420', '', '');
-- --------------------------------------------------------

--
-- Table structure for table `iw_par_cc_210b_modbus_groups`
--

CREATE TABLE IF NOT EXISTS `iw_par_cc_210b_modbus_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

--
-- Dumping data for table `iw_par_cc_210b_modbus_groups`
--

REPLACE INTO `iw_par_cc_210b_modbus_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
(NOW(), 'default_link', 1, '', ''),
(NOW(), 'group_alias', 1, 'sys', 'System'),
(NOW(), 'group_alias', 2, 'add', 'Additional'),
(NOW(), 'group_alias', 5, 'alarm', 'Alarmer'),
(NOW(), 'group_alias', 3, 'most', 'Mest brukt'),
(NOW(), 'group_alias', 4, 'set', 'Konfigurasjon'),
(NOW(), 'group', 1, 'alarm', 'alarm_0_4_2540'),
(NOW(), 'group', 11, 'alarm', 'alarm_0_4_2767'),
(NOW(), 'group', 21, 'alarm', 'alarm_0_4_19999'),
(NOW(), 'group', 31, 'alarm', 'alarm_0_4_20000'),
(NOW(), 'group', 41, 'alarm', 'alarm_0_4_20001'),
(NOW(), 'group', 51, 'alarm', 'alarm_0_4_20002'),
(NOW(), 'group', 61, 'alarm', 'alarm_0_4_20003'),
(NOW(), 'group', 71, 'alarm', 'alarm_0_4_20004'),
(NOW(), 'group', 81, 'alarm', 'alarm_0_4_20005'),
(NOW(), 'group', 91, 'alarm', 'alarm_0_4_20006'),
(NOW(), 'group', 101, 'alarm', 'alarm_0_4_20007'),
(NOW(), 'group', 111, 'alarm', 'alarm_0_4_20008'),
(NOW(), 'group', 121, 'alarm', 'alarm_0_4_20009'),
(NOW(), 'group', 131, 'alarm', 'alarm_0_4_20010'),
(NOW(), 'group', 141, 'alarm', 'alarm_0_4_20011'),
(NOW(), 'group', 151, 'alarm', 'alarm_0_4_20012'),
(NOW(), 'group', 161, 'alarm', 'alarm_0_4_20013'),
(NOW(), 'group', 171, 'alarm', 'alarm_0_4_20014'),
(NOW(), 'group', 181, 'alarm', 'alarm_0_4_20015'),
(NOW(), 'group', 1, 'most', 'most_0_4_2006'),
(NOW(), 'group', 11, 'most', 'most_0_4_99'),
(NOW(), 'group', 21, 'most', 'most_0_4_100'),
(NOW(), 'group', 31, 'most', 'most_0_4_1035'),
(NOW(), 'group', 41, 'most', 'most_0_4_10001'),
(NOW(), 'group', 51, 'most', 'most_0_4_10018'),
(NOW(), 'group', 61, 'most', 'most_0_4_10019'),
(NOW(), 'group', 71, 'most', 'most_0_4_2001'),
(NOW(), 'group', 81, 'most', 'most_0_4_2555'),
(NOW(), 'group', 91, 'Most', 'Most_0_4_2575'),
(NOW(), 'group', 1, 'set', 'set_0_4_2545'),
(NOW(), 'group', 11, 'set', 'set_0_4_106'),
(NOW(), 'group', 21, 'set', 'set_0_4_1010'),
(NOW(), 'group', 31, 'set', 'set_0_4_2646'),
(NOW(), 'group', 41, 'set', 'set_0_4_101'),
(NOW(), 'group', 51, 'set', 'set_0_4_102'),
(NOW(), 'group', 61, 'set', 'set_0_4_103'),
(NOW(), 'group', 71, 'set', 'set_0_4_104'),
(NOW(), 'group', 81, 'set', 'set_0_4_124'),
(NOW(), 'group', 91, 'set', 'set_0_4_149'),
(NOW(), 'group', 101, 'set', 'set_0_4_150'),
(NOW(), 'group', 111, 'set', 'set_0_4_125'),
(NOW(), 'group', 121, 'set', 'set_0_4_499'),
(NOW(), 'group', 131, 'set', 'set_0_4_500'),
(NOW(), 'group', 141, 'set', 'set_0_4_504'),
(NOW(), 'group', 151, 'set', 'set_0_4_1012'),
(NOW(), 'group', 161, 'set', 'set_0_4_999'),
(NOW(), 'group', 171, 'set', 'set_0_4_1000'),
(NOW(), 'group', 181, 'set', 'set_0_4_1001'),
(NOW(), 'group', 191, 'set', 'set_0_4_1002'),
(NOW(), 'group', 201, 'set', 'set_0_4_1003'),
(NOW(), 'group', 211, 'set', 'set_0_4_1004'),
(NOW(), 'group', 221, 'set', 'set_0_4_1006'),
(NOW(), 'group', 231, 'set', 'set_0_4_1005'),
(NOW(), 'group', 241, 'set', 'set_0_4_1007'),
(NOW(), 'group', 251, 'set', 'set_0_4_1008'),
(NOW(), 'group', 261, 'set', 'set_0_4_1017'),
(NOW(), 'group', 271, 'set', 'set_0_4_1019'),
(NOW(), 'group', 281, 'set', 'set_0_4_1020'),
(NOW(), 'group', 291, 'set', 'set_0_4_1057'),
(NOW(), 'group', 301, 'set', 'set_0_4_2019'),
(NOW(), 'group', 311, 'set', 'set_0_4_2021'),
(NOW(), 'group', 321, 'set', 'set_0_4_1200'),
(NOW(), 'group', 331, 'set', 'set_0_4_1210'),
(NOW(), 'group', 341, 'set', 'set_0_4_1201'),
(NOW(), 'group', 351, 'set', 'set_0_4_1211'),
(NOW(), 'group', 361, 'set', 'set_0_4_1202'),
(NOW(), 'group', 371, 'set', 'set_0_4_1212'),
(NOW(), 'group', 381, 'set', 'set_0_4_1203'),
(NOW(), 'group', 391, 'set', 'set_0_4_1213'),
(NOW(), 'group', 401, 'set', 'set_0_4_1204'),
(NOW(), 'group', 411, 'set', 'set_0_4_1214'),
(NOW(), 'group', 421, 'set', 'set_0_4_1205'),
(NOW(), 'group', 431, 'set', 'set_0_4_1215'),
(NOW(), 'group', 441, 'set', 'set_0_4_1499'),
(NOW(), 'group', 451, 'set', 'set_0_4_1502'),
(NOW(), 'group', 461, 'set', 'set_0_4_1504'),
(NOW(), 'group', 471, 'set', 'set_0_4_10002'),
(NOW(), 'group', 481, 'set', 'set_0_4_10017'),
(NOW(), 'group', 491, 'set', 'set_0_4_10027'),
(NOW(), 'group', 501, 'set', 'set_0_4_10028'),
(NOW(), 'group', 511, 'set', 'set_0_4_10037'),
(NOW(), 'group', 521, 'set', 'set_0_4_10054'),
(NOW(), 'group', 531, 'set', 'set_0_4_10055'),
(NOW(), 'group', 541, 'set', 'set_0_4_10095'),
(NOW(), 'group', 551, 'set', 'set_0_4_2045'),
(NOW(), 'group', 561, 'set', 'set_0_4_2076'),
(NOW(), 'group', 571, 'set', 'set_0_4_2056'),
(NOW(), 'group', 581, 'set', 'set_0_4_2057'),
(NOW(), 'group', 591, 'set', 'set_0_4_2055'),
(NOW(), 'group', 601, 'set', 'set_0_4_2059'),
(NOW(), 'group', 611, 'set', 'set_0_4_2060'),
(NOW(), 'group', 621, 'set', 'set_0_4_2061'),
(NOW(), 'group', 631, 'set', 'set_0_4_2013'),
(NOW(), 'group', 641, 'set', 'set_0_4_112'),
(NOW(), 'group', 651, 'set', 'set_0_4_1999'),
(NOW(), 'group', 661, 'set', 'set_0_4_2000'),
(NOW(), 'group', 671, 'set', 'set_0_4_2054'),
(NOW(), 'group', 681, 'set', 'set_0_4_2163'),
(NOW(), 'group', 691, 'set', 'set_0_4_2260'),
(NOW(), 'group', 701, 'set', 'set_0_4_2261'),
(NOW(), 'group', 711, 'set', 'set_0_4_2262'),
(NOW(), 'group', 721, 'set', 'set_0_4_2263'),
(NOW(), 'group', 731, 'set', 'set_0_4_2532'),
(NOW(), 'group', 741, 'set', 'set_0_4_2509'),
(NOW(), 'group', 751, 'set', 'set_0_4_2587'),
(NOW(), 'group', 761, 'set', 'set_0_4_2511'),
(NOW(), 'group', 771, 'set', 'set_0_4_2578'),
(NOW(), 'group', 781, 'set', 'set_0_4_2510'),
(NOW(), 'group', 791, 'set', 'set_0_4_2582'),
(NOW(), 'group', 801, 'set', 'set_0_4_2583'),
(NOW(), 'group', 811, 'set', 'set_0_4_2590'),
(NOW(), 'group', 40, 'set', 'set_0_4_116');

-- --------------------------------------------------------

--
-- Table structure for table `iw_par_cc_210b_modbus_param`
--

CREATE TABLE IF NOT EXISTS `iw_par_cc_210b_modbus_param` (
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
-- Dumping data for table `iw_par_cc_210b_modbus_param`
--

REPLACE INTO `iw_par_cc_210b_modbus_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
(NOW(), 'most_0_4_2006', '0_4_2006', ' --- Ctrl State', '', 'Integral Values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_2006_I16_N_-_-_-_-', ''),
(NOW(), 'set_0_4_2545', '0_4_2545', 'u28 Temp Ref', '', 'Analog values', 'float', '', '-1', 'r', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_2545_I16_N_-_-_-_-', ''),
(NOW(), 'set_0_4_106', '0_4_106', 'u01 Sair Temp', '', 'Analog values', 'float', '', '-1', 'r', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_106_I16_N_-_-_-_-', ''),
(NOW(), 'set_0_4_1010', '0_4_1010', 'u09 S5 Temp', '', 'Analog values', 'float', '', '-1', 'r', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_1010_I16_N_-_-_-_-', ''),
(NOW(), 'set_0_4_2646', '0_4_2646', 'U09 Sc Temp', '', 'Analog values', 'float', '', '-1', 'r', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_2646_I16_N_-_-_-_-', ''),
(NOW(), 'most_0_4_99', '0_4_99', ' --- Cutout', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_99_I16_N_6_99_I16_N', ''),
(NOW(), 'most_0_4_100', '0_4_100', 'r01 Differential', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_100_I16_N_6_100_I16_N', ''),
(NOW(), 'set_0_4_101', '0_4_101', 'r02 Max Cutout', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_101_I16_N_6_101_I16_N', ''),
(NOW(), 'set_0_4_102', '0_4_102', 'r03 Min Cutout', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_102_I16_N_6_102_I16_N', ''),
(NOW(), 'set_0_4_103', '0_4_103', 'r04 Disp Adj K', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_103_I16_N_6_103_I16_N', ''),
(NOW(), 'set_0_4_104', '0_4_104', 'r05 Temp Unit', '', 'Analog values', 'float', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_104_I16_N_6_104_I16_N', ''),
(NOW(), 'set_0_4_124', '0_4_124', 'r13 Night Offset', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_124_I16_N_6_124_I16_N', ''),
(NOW(), 'set_0_4_149', '0_4_149', 'r39 Th Offset', '', 'Analog values', 'float', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_149_I16_N_6_149_I16_N', ''),
(NOW(), 'set_0_4_150', '0_4_150', 'r40 Th Offset K', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_150_I16_N_6_150_I16_N', ''),
(NOW(), 'set_0_4_125', '0_4_125', ' --- Night Setbck', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_125_I16_N_6_125_I16_N', ''),
(NOW(), 'set_0_4_499', '0_4_499', 'c01 Min On Time', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_499_I16_N_6_499_I16_N', ''),
(NOW(), 'set_0_4_500', '0_4_500', 'c02 Min Off Time', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_500_I16_N_6_500_I16_N', ''),
(NOW(), 'set_0_4_504', '0_4_504', 'c05 Step Delay', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_504_I16_N_6_504_I16_N', ''),
(NOW(), 'most_0_4_1035', '0_4_1035', ' --- Defrost State', '', 'Integral Values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_1035_I16_N_-_-_-_-', ''),
(NOW(), 'set_0_4_1012', '0_4_1012', ' --- Def Start', '', 'Digital IO', 'Boolean', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1012_I16_N_6_1012_I16_N', ''),
(NOW(), 'set_0_4_999', '0_4_999', 'd01 Def Method', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_999_I16_N_6_999_I16_N', ''),
(NOW(), 'set_0_4_1000', '0_4_1000', 'd02 Def Stop Temp', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_1000_I16_N_6_1000_I16_N', ''),
(NOW(), 'set_0_4_1001', '0_4_1001', 'd03 Def Interval', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1001_I16_N_6_1001_I16_N', ''),
(NOW(), 'set_0_4_1002', '0_4_1002', 'd04 Max Def Time', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1002_I16_N_6_1002_I16_N', ''),
(NOW(), 'set_0_4_1003', '0_4_1003', 'd05 Time Stagg', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1003_I16_N_6_1003_I16_N', ''),
(NOW(), 'set_0_4_1004', '0_4_1004', 'd06 Drip Off Time', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1004_I16_N_6_1004_I16_N', ''),
(NOW(), 'set_0_4_1006', '0_4_1006', 'd07 Fan Start Del', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1006_I16_N_6_1006_I16_N', ''),
(NOW(), 'set_0_4_1005', '0_4_1005', 'd08 Fan Start Temp', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_1005_I16_N_6_1005_I16_N', ''),
(NOW(), 'set_0_4_1007', '0_4_1007', 'd09 Fan During Def', '', 'Digital IO', 'Boolean', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1007_I16_N_6_1007_I16_N', ''),
(NOW(), 'set_0_4_1008', '0_4_1008', 'd10 Def Stop Sens', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1008_I16_N_6_1008_I16_N', ''),
(NOW(), 'set_0_4_1017', '0_4_1017', 'd16 Pump Dwn Del', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1017_I16_N_6_1017_I16_N', ''),
(NOW(), 'set_0_4_1019', '0_4_1019', 'd18 Max Ther Run T', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1019_I16_N_6_1019_I16_N', ''),
(NOW(), 'set_0_4_1020', '0_4_1020', 'd19 Cutout S5Dif', '', 'Analog values', 'float', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1020_I16_N_6_1020_I16_N', ''),
(NOW(), 'set_0_4_1057', '0_4_1057', 'd40 Disp D Del', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1057_I16_N_6_1057_I16_N', ''),
(NOW(), 'set_0_4_2019', '0_4_2019', 'o16 Max HoldTime', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2019_I16_N_6_2019_I16_N', ''),
(NOW(), 'set_0_4_2021', '0_4_2021', ' --- Hold After Def', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2021_I16_N_6_2021_I16_N', ''),
(NOW(), 'set_0_4_1200', '0_4_1200', 't01 Def 1 Hr', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1200_I16_N_6_1200_I16_N', ''),
(NOW(), 'set_0_4_1210', '0_4_1210', 't11 Def 1 Min', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1210_I16_N_6_1210_I16_N', ''),
(NOW(), 'set_0_4_1201', '0_4_1201', 't02 Def 2 Hr', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1201_I16_N_6_1201_I16_N', ''),
(NOW(), 'set_0_4_1211', '0_4_1211', 't12 Def 2 Min', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1211_I16_N_6_1211_I16_N', ''),
(NOW(), 'set_0_4_1202', '0_4_1202', 't03 Def 3 Hr', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1202_I16_N_6_1202_I16_N', ''),
(NOW(), 'set_0_4_1212', '0_4_1212', 't13 Def 3 Min', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1212_I16_N_6_1212_I16_N', ''),
(NOW(), 'set_0_4_1203', '0_4_1203', 't04 Def 4 Hr', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1203_I16_N_6_1203_I16_N', ''),
(NOW(), 'set_0_4_1213', '0_4_1213', 't14 Def 4 Min', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1213_I16_N_6_1213_I16_N', ''),
(NOW(), 'set_0_4_1204', '0_4_1204', 't05 Def 5 Hr', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1204_I16_N_6_1204_I16_N', ''),
(NOW(), 'set_0_4_1214', '0_4_1214', 't15 Def 5 Min', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1214_I16_N_6_1214_I16_N', ''),
(NOW(), 'set_0_4_1205', '0_4_1205', 't06 Def 6 Hr', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1205_I16_N_6_1205_I16_N', ''),
(NOW(), 'set_0_4_1215', '0_4_1215', 't16 Def 6 Min', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1215_I16_N_6_1215_I16_N', ''),
(NOW(), 'set_0_4_1499', '0_4_1499', 'F01 Fan Stop CO', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1499_I16_N_6_1499_I16_N', ''),
(NOW(), 'set_0_4_1502', '0_4_1502', 'F02 Fan Del CO', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1502_I16_N_6_1502_I16_N', ''),
(NOW(), 'set_0_4_1504', '0_4_1504', 'F04 Fan Stop Temp', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_1504_I16_N_6_1504_I16_N', ''),
(NOW(), 'alarm_0_4_2540', '0_4_2540', ' --- EKC Error', '', 'Integral Values', 'integer', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_2540_I16_N_-_-_-_-', ''),
(NOW(), 'most_0_4_10001', '0_4_10001', 'A03 Alarm Delay', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_10001_I16_N_6_10001_I16_N', ''),
(NOW(), 'set_0_4_10002', '0_4_10002', 'A04 Door Open Del', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_10002_I16_N_6_10002_I16_N', ''),
(NOW(), 'set_0_4_10017', '0_4_10017', 'A12 Pulldown Del', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_10017_I16_N_6_10017_I16_N', ''),
(NOW(), 'most_0_4_10018', '0_4_10018', 'A13 High Lim Air', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_10018_I16_N_6_10018_I16_N', ''),
(NOW(), 'most_0_4_10019', '0_4_10019', 'A14 Low Lim Air', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_10019_I16_N_6_10019_I16_N', ''),
(NOW(), 'set_0_4_10027', '0_4_10027', 'A27 Al Delay DI1', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_10027_I16_N_6_10027_I16_N', ''),
(NOW(), 'set_0_4_10028', '0_4_10028', 'A28 Al Delay DI2', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_10028_I16_N_6_10028_I16_N', ''),
(NOW(), 'set_0_4_10037', '0_4_10037', 'A37 CondTemp Al', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_10037_I16_N_6_10037_I16_N', ''),
(NOW(), 'set_0_4_10054', '0_4_10054', 'A54 Cond T Block', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_10054_I16_N_6_10054_I16_N', ''),
(NOW(), 'set_0_4_10055', '0_4_10055', 'A55 Al Del Cond', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_10055_I16_N_6_10055_I16_N', ''),
(NOW(), 'set_0_4_10095', '0_4_10095', 'A78 Cond Al Diff', '', 'Analog values', 'float', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_10095_I16_N_6_10095_I16_N', ''),
(NOW(), 'set_0_4_2045', '0_4_2045', ' --- Reset Alarm', '', 'Digital IO', 'Boolean', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2045_I16_N_6_2045_I16_N', ''),
(NOW(), 'set_0_4_2076', '0_4_2076', 'o61 Appl Mode', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2076_I16_N_6_2076_I16_N', ''),
(NOW(), 'set_0_4_2056', '0_4_2056', 'o38 Light Config', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2056_I16_N_6_2056_I16_N', ''),
(NOW(), 'set_0_4_2057', '0_4_2057', 'o39 Light Remote', '', 'Digital IO', 'Boolean', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2057_I16_N_6_2057_I16_N', ''),
(NOW(), 'set_0_4_2055', '0_4_2055', 'o46 Case Clean', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2055_I16_N_6_2055_I16_N', ''),
(NOW(), 'set_0_4_2059', '0_4_2059', 'o41 Railh ONday%', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2059_I16_N_6_2059_I16_N', ''),
(NOW(), 'set_0_4_2060', '0_4_2060', 'o42 Railh ONngt%', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2060_I16_N_6_2060_I16_N', ''),
(NOW(), 'set_0_4_2061', '0_4_2061', 'o43 Railh Cycle', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2061_I16_N_6_2061_I16_N', ''),
(NOW(), 'set_0_4_2013', '0_4_2013', 'o06 Sensor Config', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2013_I16_N_6_2013_I16_N', ''),
(NOW(), 'set_0_4_112', '0_4_112', 'r09 Adjust Sair', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_112_I16_N_6_112_I16_N', ''),
(NOW(), 'set_0_4_1999', '0_4_1999', 'o01 Delay Of Outp', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_1999_I16_N_6_1999_I16_N', ''),
(NOW(), 'set_0_4_2000', '0_4_2000', 'o02 DI1 Config', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2000_I16_N_6_2000_I16_N', ''),
(NOW(), 'set_0_4_2054', '0_4_2054', 'o37 DI2 Config', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2054_I16_N_6_2054_I16_N', ''),
(NOW(), 'set_0_4_2163', '0_4_2163', 'P48 Unit Runtime', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2163_I16_N_6_2163_I16_N', ''),
(NOW(), 'set_0_4_2260', '0_4_2260', 'P91 Cond Serv Req', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2260_I16_N_6_2260_I16_N', ''),
(NOW(), 'set_0_4_2261', '0_4_2261', 'P92 Cond Action', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2261_I16_N_6_2261_I16_N', ''),
(NOW(), 'set_0_4_2262', '0_4_2262', 'P93 Cond Period', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2262_I16_N_6_2262_I16_N', ''),
(NOW(), 'set_0_4_2263', '0_4_2263', 'P94 Cond Ev Cnt', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2263_I16_N_6_2263_I16_N', ''),
(NOW(), 'most_0_4_2001', '0_4_2001', 'u10 DI1 Status       ', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_2001_I16_N_-_-_-_-', ''),
(NOW(), 'most_0_4_2555', '0_4_2555', 'u37 DI2 Status', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_2555_I16_N_-_-_-_-', ''),
(NOW(), 'set_0_4_2532', '0_4_2532', 'u13 Night Cond', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_2532_I16_N_-_-_-_-', ''),
(NOW(), 'Most_0_4_2575', '0_4_2575', 'u56 Display Air', '', 'Analog values', 'float', '', '-1', 'r', '', '%.1f', '', '', '1', '0', '1000', '0', '100', '4_2575_I16_N_-_-_-_-', ''),
(NOW(), 'set_0_4_2509', '0_4_2509', 'u58 Comp1/LLSV', '', 'Digital IO', 'Boolean', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2509_I16_N_6_2509_I16_N', ''),
(NOW(), 'set_0_4_2587', '0_4_2587', 'u67 Comp2 Relay', '', 'Digital IO', 'Boolean', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2587_I16_N_6_2587_I16_N', ''),
(NOW(), 'set_0_4_2511', '0_4_2511', 'u60 Def Relay', '', 'Digital IO', 'Boolean', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2511_I16_N_6_2511_I16_N', ''),
(NOW(), 'set_0_4_2578', '0_4_2578', 'u61 Railh Relay', '', 'Digital IO', 'Boolean', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2578_I16_N_6_2578_I16_N', ''),
(NOW(), 'set_0_4_2510', '0_4_2510', 'u59 Fan Relay', '', 'Digital IO', 'Boolean', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2510_I16_N_6_2510_I16_N', ''),
(NOW(), 'set_0_4_2582', '0_4_2582', 'u62 Alarm Relay', '', 'Digital IO', 'Boolean', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2582_I16_N_6_2582_I16_N', ''),
(NOW(), 'set_0_4_2583', '0_4_2583', 'u63 Light Relay', '', 'Digital IO', 'Boolean', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2583_I16_N_6_2583_I16_N', ''),
(NOW(), 'set_0_4_2590', '0_4_2590', 'u71 DO4 Relay', '', 'Digital IO', 'Boolean', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2590_I16_N_6_2590_I16_N', ''),
(NOW(), 'alarm_0_4_2767', '0_4_2767', ' --- Total Runt', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_2767_I16_N_6_2767_I16_N', ''),
(NOW(), 'alarm_0_4_19999', '0_4_19999', ' --- Ctrl Error', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_19999_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20000', '0_4_20000', ' --- RTC Error', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20000_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20001', '0_4_20001', ' --- S5 Error', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20001_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20002', '0_4_20002', ' --- Sair Error', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20002_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20003', '0_4_20003', ' --- Sc Error', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20003_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20004', '0_4_20004', ' --- High T Alarm', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20004_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20005', '0_4_20005', ' --- Low T Alarm', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20005_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20006', '0_4_20006', ' --- Door Alarm', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20006_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20007', '0_4_20007', ' --- Max HoldTime', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20007_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20008', '0_4_20008', ' --- DI1 Alarm', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20008_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20009', '0_4_20009', ' --- DI2 Alarm', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20009_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20010', '0_4_20010', ' --- Standby Mode', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20010_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20011', '0_4_20011', ' --- Case Clean', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20011_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20012', '0_4_20012', ' --- Cond Alarm', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20012_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20013', '0_4_20013', ' --- Cond Blocked', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20013_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20014', '0_4_20014', ' --- Cond Serv Req', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20014_I16_N_-_-_-_-', ''),
(NOW(), 'alarm_0_4_20015', '0_4_20015', ' --- Max Def Time', '', 'Digital IO', 'Boolean', '', '-1', 'r', '', '', '', '', '', '', '', '', '', '4_20015_I16_N_-_-_-_-', ''),
(NOW(), 'set_0_4_116', '0_4_116', 'r12 Main Switch', '', 'Integral Values', 'integer', '', '-1', 'rw', '', '', '', '', '', '', '', '', '', '4_116_I16_N_6_116_I16_N', '');

-- --------------------------------------------------------

--
-- Table structure for table `iw_set_cc_210b_modbus`
--

CREATE TABLE IF NOT EXISTS `iw_set_cc_210b_modbus` (
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
-- Dumping data for table `iw_set_cc_210b_modbus`
--

REPLACE INTO `iw_set_cc_210b_modbus` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
(NOW(), 'most_0_4_2006', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2545', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'set_0_4_106', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'set_0_4_1010', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'set_0_4_2646', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'most_0_4_99', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'most_0_4_100', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_101', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_102', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_103', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_104', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_124', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_149', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_150', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_125', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_499', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_500', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_504', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'most_0_4_1035', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1012', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_999', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1000', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1001', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1002', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1003', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1004', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1006', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1005', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1007', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1008', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1017', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1019', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1020', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1057', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2019', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2021', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1200', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1210', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1201', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1211', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1202', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1212', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1203', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1213', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1204', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1214', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1205', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1215', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1499', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1502', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1504', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'alarm_0_4_2540', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'most_0_4_10001', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_10002', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_10017', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'most_0_4_10018', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'most_0_4_10019', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_10027', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_10028', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_10037', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_10054', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_10055', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_10095', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2045', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2076', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2056', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2057', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2055', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2059', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2060', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2061', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2013', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_112', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_1999', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2000', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2054', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2163', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2260', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2261', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2262', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2263', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'most_0_4_2001', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'most_0_4_2555', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2532', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'Most_0_4_2575', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'set_0_4_2509', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2587', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2511', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2578', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2510', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2582', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2583', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'set_0_4_2590', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'alarm_0_4_2767', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'alarm_0_4_19999', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'alarm_0_4_20000', '1', '0', 'slow', 'change', '', 'B', '', 0),
(NOW(), 'alarm_0_4_20001', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'alarm_0_4_20002', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'alarm_0_4_20003', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'alarm_0_4_20004', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'alarm_0_4_20005', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'alarm_0_4_20006', '1', '0', 'slow', 'change', '', 'B', '', 0),
(NOW(), 'alarm_0_4_20007', '1', '0', 'slow', 'change', '', 'B', '', 0),
(NOW(), 'alarm_0_4_20008', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'alarm_0_4_20009', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'alarm_0_4_20010', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'alarm_0_4_20011', '1', '0', 'slow', 'change', '', 'B', '', 0),
(NOW(), 'alarm_0_4_20012', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'alarm_0_4_20013', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'alarm_0_4_20014', '1', '0', 'slow', 'change', '', 'A', '', 0),
(NOW(), 'alarm_0_4_20015', '1', '0', 'slow', 'change', '', 'B', '', 0),
(NOW(), 'set_0_4_116', '1', '0', 'slow', 'change', '', '', '', 0);

-- --------------------------------------------------------



-- --------------------------------------------------------

--
-- Table structure for table `iw_sys_plant_settings`
--



--

