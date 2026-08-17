-- phpMyAdmin SQL Dump
-- version 3.3.10.5
-- http://www.phpmyadmin.net
--
-- Host: 127.0.0.1
-- Generation Time: Jul 19, 2024 at 12:04 PM
-- Server version: 5.5.68
-- PHP Version: 5.6.29

SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";

--
-- Database: `iw_plant_server3`
--

-- --------------------------------------------------------

--
-- Table structure for table `iw_par_circutor_cvm_mini_groups`

CREATE TABLE IF NOT EXISTS `iw_sys_plant_units` (
  `row_date` datetime NOT NULL DEFAULT '2020-01-10 00:00:00',
  `active` enum('0','1') NOT NULL DEFAULT '1',
  `blockout` enum('1','0') NOT NULL DEFAULT '0',
  `unit_id` varchar(40) NOT NULL DEFAULT '',
  `unit_name` varchar(100) NOT NULL DEFAULT '',
  `grp_name` varchar(50) NOT NULL DEFAULT '',
  `driver_type` varchar(40) NOT NULL DEFAULT '',
  `driver_addr` varchar(50) NOT NULL DEFAULT '',
  `regulator_type` varchar(50) NOT NULL DEFAULT '',
  `order_no` varchar(50) NOT NULL DEFAULT '',
  `view_order` int(11) NOT NULL DEFAULT '0',
  `driver_adr_extra` varchar(255) NOT NULL DEFAULT '',
  `unit_extra` varchar(255) NOT NULL DEFAULT '',
  UNIQUE KEY `unit_id` (`unit_id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='4.5.6';

--
-- Dumping data for table `iw_sys_plant_units`
--


REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`, `unit_extra`) VALUES
('2014-08-11 13:41:05', '1', '0', 'E01', 'Energimåler', 'circutor_cvm_mini', 'MODBUS3', '0_1', 'CVM', 'CVM_MINI', 160, '', '');
--

--
-- Table structure for table `iw_sys_plant_settings`
--

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
('2015-10-20 14:26:05', 'idle_event_rate', 'MODBUS3', '250', 'msec.', '', ''),
('2015-10-20 14:26:05', 'sql_queue_poll_time', 'MODBUS3', '2000', 'msec.', '', ''),
('2015-10-20 14:26:13', 'value_quality_check_limit', 'MODBUS3', '0', '', '0 = disabled', ''),
('2015-10-20 14:26:13', 'packet_timeout', 'MODBUS3', '0', 'sec.', '', ''),
('2015-10-20 14:26:13', 'max_outstanding_packets', 'MODBUS3', '-1', '', '', ''),
('2015-10-20 14:26:13', 'max_error_count', 'MODBUS3', '2', '', '', ''),
('2015-10-20 14:26:13', 'max_group_count', 'MODBUS3', '1', '', '', ''),
('2015-10-20 14:26:13', 'max_param_block_time', 'MODBUS3', '2', 'hours', '', ''),
('2015-10-20 14:26:13', 'speed_index_norm', 'MODBUS3', '1', '', '', ''),
('2015-10-20 14:26:13', 'speed_index_slow', 'MODBUS3', '1', '', '', ''),
('2015-10-20 14:26:13', 'speed_index_offline', 'MODBUS3', '10', '', '', ''),
('2015-10-20 14:26:13', 'speed_index_block', 'MODBUS3', '10', '', '', ''),
('2015-10-20 14:26:13', 'show_queue_info', 'MODBUS3', '0', '', '', ''),
('2015-10-20 14:26:13', 'com_error_alarm_delay', 'MODBUS3', '10', 'min.', '', ''),
('2015-10-20 14:26:13', 'mb_request_retries', 'MODBUS3', '0', '', '', ''),
('2015-10-20 14:26:13', 'mb_request_timeout', 'MODBUS3', '500', 'ms', '', ''),
('2015-10-20 14:26:13', 'mb_mode', 'MODBUS3', '0', '', '0=RTU|1=ASCII|2=TCP', ''),
('2015-10-20 14:26:13', 'mux_settle_time', 'MODBUS3', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
('2015-10-20 14:26:13', 'startup_delay', 'MODBUS3', '15', 'Sec.', '', ''),
('2015-10-20 14:26:13', 'comm_port', 'MODBUS3', '1', '', '', ''),
('2015-10-20 14:26:13', 'comm_baudrate', 'MODBUS3', '19200', '', '', ''),
('2015-10-20 14:26:13', 'comm_stop_bits', 'MODBUS3', '1', '', '', ''),
('2015-10-20 14:26:13', 'comm_data_bits', 'MODBUS3', '8', '', '', ''),
('2015-10-20 14:26:13', 'comm_parity', 'MODBUS3', '0', '', '0=N|1=O|2=E|3=M|4=S', ''),
('2015-10-20 14:26:13', 'check_rate', 'MODBUS3', '1', 'ms', '', ''),
('2015-10-20 14:26:13', 'handshake', 'MODBUS3', '0', '', '0|1|2', ''),
('2015-10-20 14:26:13', 'force_word_not_byte', 'MODBUS3', '0', '', '0|1', ''),
('2016-01-18 13:16:18', 'alarm_handler', 'MODBUS3', '', '', '', ''),
('2020-03-17 10:06:09', 'allow_crc_swap', 'MODBUS3', '0', '', 'Default 0', ''),
('2021-07-15 10:26:35', 'enablers485mode', 'MODBUS3', '0', '', '0=OFF|0 < delay in ms and ON', '');

-- --------------------------------------------------------

--
-- Table structure for table `iw_sys_plant_units`
--



CREATE TABLE IF NOT EXISTS `iw_par_circutor_cvm_mini_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

--
-- Dumping data for table `iw_par_circutor_cvm_mini_groups`
--

REPLACE INTO `iw_par_circutor_cvm_mini_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
('2007-05-02 00:00:00', 'default_link', 1, '', ''),
('2007-05-02 00:00:00', 'group_alias', 1, 'status', 'Most used'),
('2007-05-02 00:00:00', 'group_alias', 2, 'counter', 'Power'),
('2007-05-02 00:00:00', 'group_alias', 3, 'ai', 'Voltage'),
('2007-05-02 00:00:00', 'group_alias', 4, 'oth', 'Other'),
('2007-05-02 00:00:00', 'group', 1, 'status', 'act_kw1'),
('2007-05-02 00:00:00', 'group', 2, 'status', 'act_kw2'),
('2007-05-02 00:00:00', 'group', 3, 'status', 'act_kw3'),
('2007-05-02 00:00:00', 'group', 4, 'status', 'act_kwh'),
('2007-05-02 00:00:00', 'group', 5, 'status', 'three_kw'),
('2007-05-02 00:00:00', 'group', 1, 'counter', 'act_kw1'),
('2007-05-02 00:00:00', 'group', 2, 'counter', 'act_kw2'),
('2007-05-02 00:00:00', 'group', 3, 'counter', 'act_kw3'),
('2007-05-02 00:00:00', 'group', 4, 'counter', 'three_kw'),
('2007-05-02 00:00:00', 'group', 5, 'counter', 'act_kwh'),
('2007-05-02 00:00:00', 'group', 6, 'counter', 'three_ind_kvar'),
('2007-05-02 00:00:00', 'group', 7, 'counter', 'three_cap_kvar'),
('2007-05-02 00:00:00', 'group', 8, 'counter', 'ind_kvarh'),
('2007-05-02 00:00:00', 'group', 9, 'counter', 'cap_kvar'),
('2007-05-02 00:00:00', 'group', 10, 'counter', 'three_app'),
('2007-05-02 00:00:00', 'group', 11, 'counter', 'react_kvar1'),
('2007-05-02 00:00:00', 'group', 12, 'counter', 'react_kvar2'),
('2007-05-02 00:00:00', 'group', 13, 'counter', 'react_kvar3'),
('2007-05-02 00:00:00', 'group', 1, 'ai', 'vol_v1'),
('2007-05-02 00:00:00', 'group', 2, 'ai', 'vol_v2'),
('2007-05-02 00:00:00', 'group', 3, 'ai', 'vol_v3'),
('2007-05-02 00:00:00', 'group', 4, 'ai', 'line_v12'),
('2007-05-02 00:00:00', 'group', 5, 'ai', 'line_v23'),
('2007-05-02 00:00:00', 'group', 6, 'ai', 'line_v24'),
('2007-05-02 00:00:00', 'group', 1, 'oth', 'cur_a1'),
('2007-05-02 00:00:00', 'group', 2, 'oth', 'cur_a2'),
('2007-05-02 00:00:00', 'group', 3, 'oth', 'cur_a3'),
('2007-05-02 00:00:00', 'group', 4, 'oth', 'pwr_pf1'),
('2007-05-02 00:00:00', 'group', 5, 'oth', 'pwr_pf2'),
('2007-05-02 00:00:00', 'group', 6, 'oth', 'pwr_pf3'),
('2007-05-02 00:00:00', 'group', 7, 'oth', 'three_pf3'),
('2007-05-02 00:00:00', 'group', 8, 'oth', 'thd_v1'),
('2007-05-02 00:00:00', 'group', 9, 'oth', 'thd_v2'),
('2007-05-02 00:00:00', 'group', 10, 'oth', 'thd_v3'),
('2007-05-02 00:00:00', 'group', 11, 'oth', 'thd_i1'),
('2007-05-02 00:00:00', 'group', 12, 'oth', 'thd_i2'),
('2007-05-02 00:00:00', 'group', 13, 'oth', 'thd_i3'),
('2007-05-02 00:00:00', 'group', 14, 'oth', 'cos_3'),
('2007-05-02 00:00:00', 'group', 15, 'oth', 'freq_hz'),
('2007-05-02 00:00:00', 'group', 16, 'oth', 'pwr_dem');

-- --------------------------------------------------------

--
-- Table structure for table `iw_par_circutor_cvm_mini_param`
--

CREATE TABLE IF NOT EXISTS `iw_par_circutor_cvm_mini_param` (
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

--
-- Dumping data for table `iw_par_circutor_cvm_mini_param`
--

REPLACE INTO `iw_par_circutor_cvm_mini_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
('2008-05-19 12:00:00', 'vol_v1', '3_0_U32', 'Phase voltage - V1', '', 'Analog values', 'float', '', '-1', 'r', 'V', '%.0f', '', '', '1', '0', '1000', '0', '100', '3_0_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'cur_a1', '3_2_U32', 'Current - A1', '', 'Analog values', 'float', '', '-1', 'r', 'A', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_2_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'act_kw1', '3_4_U32', 'Active power - kW1', '', 'Analog values', 'float', '', '-1', 'r', 'kW', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_4_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'react_kvar1', '3_6_U32', 'Reactive power - kvar 1', '', 'Analog values', 'float', '', '-1', 'r', 'kvar', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_6_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'pwr_pf1', '3_8_U32', 'Power factor - PF1', '', 'Analog values', 'float', '', '-1', 'r', 'P.F.', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_8_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'vol_v2', '3_10_U32', 'Phase voltage - V2', '', 'Analog values', 'float', '', '-1', 'r', 'V', '%.0f', '', '', '1', '0', '1000', '0', '100', '3_10_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'cur_a2', '3_12_U32', 'Current - A2', '', 'Analog values', 'float', '', '-1', 'r', 'A', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_12_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'act_kw2', '3_14_U32', 'Active power - kW2', '', 'Analog values', 'float', '', '-1', 'r', 'kW', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_14_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'react_kvar2', '3_16_U32', 'Reactive power - kvar 2', '', 'Analog values', 'float', '', '-1', 'r', 'kvar', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_16_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'pwr_pf2', '3_18_U32', 'Power factor - PF2', '', 'Analog values', 'float', '', '-1', 'r', 'P.F.', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_18_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'vol_v3', '3_20_U32', 'Phase voltage -V3', '', 'Analog values', 'float', '', '-1', 'r', 'V', '%.0f', '', '', '1', '0', '1000', '0', '100', '3_20_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'cur_a3', '3_22_U32', 'Current - A3', '', 'Analog values', 'float', '', '-1', 'r', 'A', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_22_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'act_kw3', '3_24_U32', 'Active power - kW3', '', 'Analog values', 'float', '', '-1', 'r', 'kW', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_24_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'react_kvar3', '3_26_U32', 'Reactive power - kvar 3', '', 'Analog values', 'float', '', '-1', 'r', 'kvar', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_26_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'pwr_pf3', '3_28_U32', 'Power factor -PF3', '', 'Analog values', 'float', '', '-1', 'r', 'P.F.', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_28_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'three_kw', '3_30_U32', 'Three-phase active pwr. -kWIII', '', 'Analog values', 'float', '', '-1', 'r', 'kW', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_30_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'three_ind_kvar', '3_32_U32', 'Three-phase inductive pwr. -kvarL III', '', 'Analog values', 'float', '', '-1', 'r', 'kvar', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_32_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'three_cap_kvar', '3_34_U32', 'Three-phase capacitive pwr. -kvarL III', '', 'Analog values', 'float', '', '-1', 'r', 'kvar', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_34_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'cos_3', '3_36_U32', 'Cos III', '', 'Analog values', 'float', '', '-1', 'r', 'Cos', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_36_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'three_pf3', '3_38_U32', 'Three-phase pwr. Factor -PFIII', '', 'Analog values', 'float', '', '-1', 'r', 'P.F.', '%.1f', '', '', '1', '0', '1000', '0', '10', '3_38_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'freq_hz', '3_40_U32', 'Frequency (L1) - Hz', '', 'Analog values', 'float', '', '-1', 'r', 'Hz', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_40_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'line_v12', '3_42_U32', 'Line voltage L1-L2 - V12', '', 'Analog values', 'float', '', '-1', 'r', 'V', '%.0f', '', '', '1', '0', '1000', '0', '100', '3_42_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'line_v23', '3_44_U32', 'Line voltage L2-L3 - V23', '', 'Analog values', 'float', '', '-1', 'r', 'V', '%.0f', '', '', '1', '0', '1000', '0', '100', '3_44_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'line_v24', '3_46_U32', 'Line voltage L3-L1 - V24', '', 'Analog values', 'float', '', '-1', 'r', 'V', '%.0f', '', '', '1', '0', '1000', '0', '100', '3_46_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'thd_v1', '3_48_U32', 'THD V1', '', 'Analog values', 'float', '', '-1', 'r', '&#037', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_48_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'thd_v2', '3_50_U32', 'THD V2', '', 'Analog values', 'float', '', '-1', 'r', '&#037', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_50_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'thd_v3', '3_52_U32', 'THD V3', '', 'Analog values', 'float', '', '-1', 'r', '&#037', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_52_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'thd_i1', '3_54_U32', 'THD I1', '', 'Analog values', 'float', '', '-1', 'r', '&#037', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_54_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'thd_i2', '3_56_U32', 'THD I2', '', 'Analog values', 'float', '', '-1', 'r', '&#037', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_56_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'thd_i3', '3_58_U32', 'THD I3', '', 'Analog values', 'float', '', '-1', 'r', '&#037', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_58_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'act_kwh', '3_60_U32', 'Active energy - kWh', '', 'Analog values', 'float', '', '-1', 'r', 'kWh', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_60_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'ind_kvarh', '3_62_U32', 'Inductive reactive energy - kvarh L', '', 'Analog values', 'float', '', '-1', 'r', 'kvarLh', '%.0f', '', '', '1', '0', '1000', '0', '1', '3_62_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'cap_kvar', '3_64_U32', 'Capacitive reactive energy - kvar C', '', 'Analog values', 'float', '', '-1', 'r', 'kvarCh', '%.0f', '', '', '1', '0', '1000', '0', '1', '3_64_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'three_app', '3_66_U32', 'Three phase apparent power', '', 'Analog values', 'float', '', '-1', 'r', 'kVA III', '%.1f', '', '', '1', '0', '1000', '0', '1', '3_66_U32_W_-_-_-_-', ''),
('2008-05-19 12:00:00', 'pwr_dem', '3_68_U32', 'Power demand', '', 'Analog values', 'float', '', '-1', 'r', 'Pd', '%.0f', '', '', '', '', '', '', '', '3_68_U32_W_-_-_-_-', '');

-- --------------------------------------------------------

--
-- Table structure for table `iw_set_circutor_cvm_mini`
--

CREATE TABLE IF NOT EXISTS `iw_set_circutor_cvm_mini` (
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
-- Dumping data for table `iw_set_circutor_cvm_mini`
--

REPLACE INTO `iw_set_circutor_cvm_mini` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
('2008-05-19 12:00:00', 'vol_v1', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'cur_a1', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'act_kw1', '1', '1', 'norm', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'react_kvar1', '1', '0', 'norm', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'pwr_pf1', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'vol_v2', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'cur_a2', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'act_kw2', '1', '1', 'norm', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'react_kvar2', '1', '0', 'norm', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'pwr_pf2', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'vol_v3', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'cur_a3', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'act_kw3', '1', '0', 'norm', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'react_kvar3', '1', '0', 'norm', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'pwr_pf3', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'three_kw', '1', '0', 'norm', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'three_ind_kvar', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'three_cap_kvar', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'cos_3', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'three_pf3', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'freq_hz', '1', '1', 'norm', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'line_v12', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'line_v23', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'line_v24', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'thd_v1', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'thd_v2', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'thd_v3', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'thd_i1', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'thd_i2', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'thd_i3', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'act_kwh', '1', '1', 'norm', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'ind_kvarh', '1', '0', 'norm', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'cap_kvar', '1', '0', 'norm', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'three_app', '1', '0', 'slow', 'min', '1', '', '', 0),
('2008-05-19 12:00:00', 'pwr_dem', '1', '0', 'slow', 'min', '1', '', '', 0);

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
('2008-05-18 16:13:01', 'CVM_MINI', 'circutor_cvm_mini_param', 'circutor_cvm_mini_groups');

-- --------------------------------------------------------



-- --------------------------------------------------------

--
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
('2013-06-03 09:14:10', '0', 'iw_mb.exe', 'MODBUS3', '', '');
