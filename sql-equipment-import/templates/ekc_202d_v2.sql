-- iw_sys_plant_units
INSERT INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`) VALUES
(NOW() ,  '1',  '0',  'K01',  'Frukt og Grønt 01',  'ekc_202d',  'EKC202D1',  '0_1',  'EKC202',  'ekc_202d',  '0',  '');
--
-- iw_sys_plant_orderno
INSERT INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES (NOW(), 'ekc_202d', 'ekc_202d_param', 'ekc_202d_groups');
--
-- iw_sys_processes
INSERT INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES (NOW(), '0', 'iw_mb.exe', 'EKC202D1', '', '');
--
-- iw_sys_plant_settings
INSERT INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'comm_port', 'EKC202D1', '4', '', '', ''),
(NOW(), 'mb_tcp_servers', 'EKC202D1', '1;;502;1000;2;1000\r\n', '', 'ID;IPadr;IPport;ConnTout;ConnRetries;RequestTout', ''),
(NOW(), 'mb_mode', 'EKC202D1', '2', '', '0=RTU|1=ASCII|2=TCP', ''),
(NOW(), 'mb_request_retries', 'EKC202D1', '2', '', '', ''),
(NOW(), 'force_word_not_byte', 'EKC202D1', '0', '', '0|1', ''),
(NOW(), 'handshake', 'EKC202D1', '0', '', '0|1|2', ''),
(NOW(), 'check_rate', 'EKC202D1', '1', 'ms', '', ''),
(NOW(), 'comm_parity', 'EKC202D1', 'even', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'comm_data_bits', 'EKC202D1', '8', '', '', ''),
(NOW(), 'comm_stop_bits', 'EKC202D1', '1', '', '', ''),
(NOW(), 'comm_baudrate', 'EKC202D1', '9600', '', '', ''),
(NOW(), 'max_outstanding_packets', 'EKC202D1', '-1', '', '', ''),
(NOW(), 'packet_timeout', 'EKC202D1', '1', 'sec.', '', ''),
(NOW(), 'idle_event_rate', 'EKC202D1', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'EKC202D1', '2000', 'msec.', '', ''),
(NOW(), 'max_error_count', 'EKC202D1', '2', '', '', ''),
(NOW(), 'mb_request_timeout', 'EKC202D1', '1000', 'ms', '', ''),
(NOW(), 'com_error_alarm_delay', 'EKC202D1', '10', 'min.', '', ''),
(NOW(), 'show_queue_info', 'EKC202D1', '0', '', '', ''),
(NOW(), 'speed_index_block', 'EKC202D1', '10', '', '', ''),
(NOW(), 'speed_index_offline', 'EKC202D1', '10', '', '', ''),
(NOW(), 'speed_index_slow', 'EKC202D1', '1', '', '', ''),
(NOW(), 'speed_index_norm', 'EKC202D1', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'EKC202D1', '2', 'hours', '', ''),
(NOW(), 'max_group_count', 'EKC202D1', '1', '', '', ''),
(NOW(), 'value_quality_check_limit', 'EKC202D1', '0', '', '0 = disabled', ''),
(NOW(), 'mux_settle_time', 'EKC202D1', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
(NOW(), 'startup_delay', 'EKC202D1', '15', 'Sec.', '', ''),
(NOW(), 'alarm_handler', 'EKC202D1', '', '', '', ''),
(NOW(), 'mb_tcp_connect_retries_default', 'EKC202D1', '2', '', '', ''),
(NOW(), 'mb_tcp_connect_timeout_default', 'EKC202D1', '1000', 'ms', '', '');
--
-- Group
--
CREATE TABLE IF NOT EXISTS `iw_par_ekc_202d_groups` (`row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00', `type` varchar(50) NOT NULL DEFAULT '', `view_order` mediumint(6) NOT NULL DEFAULT '0', `ref` varchar(100) NOT NULL DEFAULT '', `value` varchar(200) NOT NULL DEFAULT '', UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';
--
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','default_link','1','','');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','1','aio','Analoge inn/ut');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','2','dio','Digitale inn/ut');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','3','alm','Alarmer');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','4','misc','Diverse');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','5','sch','Tidsskjema');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','6','Thermostat control','Thermostat control');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','7','Compressor control','Compressor control');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','8','Defrost control','Defrost control');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','9','Defrost schedules','Defrost schedules');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','10','Fan control','Fan control');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','11','Alarm settings','Alarm settings');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','12','Miscellaneous','Miscellaneous');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','13','Service','Service');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','14','Alarm destinations','Alarm destinations');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','15','For DANFOSS only','For DANFOSS only');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:30:03','group_alias','16','In All Groups','In All Groups');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','3','For DANFOSS only','For DANFOSS only_0_3_2085');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','3','Alarm destinations','Alarm destinations_0_3_20014');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','3','Thermostat control','Thermostat control_0_3_99');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','3','Defrost control','Defrost control_0_3_1012');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','6','Defrost control','Defrost control_0_3_1035');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','6','Alarm destinations','Alarm destinations_0_3_20010');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','9','Alarm destinations','Alarm destinations_0_3_20009');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','12','Alarm destinations','Alarm destinations_0_3_19999');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','3','Alarm settings','Alarm settings_0_3_2540');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','3','In All Groups','In All Groups_0_3_2006');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','6','Thermostat control','Thermostat control_0_3_3043');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','15','Alarm destinations','Alarm destinations_0_3_20005');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','9','Defrost control','Defrost control_0_3_2021');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','18','Alarm destinations','Alarm destinations_0_3_20006');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','21','Alarm destinations','Alarm destinations_0_3_20012');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','24','Alarm destinations','Alarm destinations_0_3_20013');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','9','Thermostat control','Thermostat control_0_3_125');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','6','Alarm settings','Alarm settings_0_3_2045');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','27','Alarm destinations','Alarm destinations_0_3_20000');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','30','Alarm destinations','Alarm destinations_0_3_20001');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','33','Alarm destinations','Alarm destinations_0_3_20007');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','36','Alarm destinations','Alarm destinations_0_3_20008');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','39','Alarm destinations','Alarm destinations_0_3_20015');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','42','Alarm destinations','Alarm destinations_0_3_20002');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','45','Alarm destinations','Alarm destinations_0_3_20003');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','48','Alarm destinations','Alarm destinations_0_3_20004');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','51','Alarm destinations','Alarm destinations_0_3_20016');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','3','Miscellaneous','Miscellaneous_0_3_2000');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','6','Miscellaneous','Miscellaneous_0_3_2055');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','9','Alarm settings','Alarm settings_0_3_10001');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','12','Alarm settings','Alarm settings_0_3_10002');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','15','Alarm settings','Alarm settings_0_3_10017');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','18','Alarm settings','Alarm settings_0_3_10018');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','21','Alarm settings','Alarm settings_0_3_10019');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','24','Alarm settings','Alarm settings_0_3_10027');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','27','Alarm settings','Alarm settings_0_3_10028');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','30','Alarm settings','Alarm settings_0_3_10033');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','33','Alarm settings','Alarm settings_0_3_10036');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','36','Alarm settings','Alarm settings_0_3_10056');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','39','Alarm settings','Alarm settings_0_3_10057');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','3','Compressor control','Compressor control_0_3_499');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','6','Compressor control','Compressor control_0_3_500');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','9','Compressor control','Compressor control_0_3_531');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','12','Defrost control','Defrost control_0_3_999');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','15','Defrost control','Defrost control_0_3_1000');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','18','Defrost control','Defrost control_0_3_1001');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','21','Defrost control','Defrost control_0_3_1002');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','24','Defrost control','Defrost control_0_3_1003');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','27','Defrost control','Defrost control_0_3_1004');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','30','Defrost control','Defrost control_0_3_1006');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','33','Defrost control','Defrost control_0_3_1005');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','36','Defrost control','Defrost control_0_3_1007');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','39','Defrost control','Defrost control_0_3_1008');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','42','Defrost control','Defrost control_0_3_1017');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','45','Defrost control','Defrost control_0_3_1019');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','48','Defrost control','Defrost control_0_3_1020');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','51','Defrost control','Defrost control_0_3_1039');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','54','Alarm destinations','Alarm destinations_0_3_20011');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','3','Fan control','Fan control_0_3_1499');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','6','Fan control','Fan control_0_3_1502');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','9','Fan control','Fan control_0_3_1504');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','3','For DANFOSS only','For DANFOSS only_0_3_60000');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','9','Miscellaneous','Miscellaneous_0_3_1999');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','12','Miscellaneous','Miscellaneous_0_3_2013');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','54','Defrost control','Defrost control_0_3_2019');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','12','Thermostat control','Thermostat control_0_4_2020');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','15','Miscellaneous','Miscellaneous_0_3_2054');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','15','Thermostat control','Thermostat control_0_3_100');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','18','Thermostat control','Thermostat control_0_3_101');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','21','Thermostat control','Thermostat control_0_3_102');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','24','Thermostat control','Thermostat control_0_3_103');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','27','Thermostat control','Thermostat control_0_4_104');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','30','Thermostat control','Thermostat control_0_3_112');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','33','Thermostat control','Thermostat control_0_3_113');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','6','In All Groups','In All Groups_0_3_116');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','36','Thermostat control','Thermostat control_0_3_124');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','39','Thermostat control','Thermostat control_0_4_122');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','42','Thermostat control','Thermostat control_0_3_149');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','45','Thermostat control','Thermostat control_0_3_150');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','48','Thermostat control','Thermostat control_0_4_181');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','51','Thermostat control','Thermostat control_0_3_197');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','3','Defrost schedules','Defrost schedules_0_3_1200');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','6','Defrost schedules','Defrost schedules_0_3_1201');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','9','Defrost schedules','Defrost schedules_0_3_1202');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','12','Defrost schedules','Defrost schedules_0_3_1203');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','15','Defrost schedules','Defrost schedules_0_3_1204');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','18','Defrost schedules','Defrost schedules_0_3_1205');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','21','Defrost schedules','Defrost schedules_0_3_1210');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','24','Defrost schedules','Defrost schedules_0_3_1211');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','27','Defrost schedules','Defrost schedules_0_3_1212');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','30','Defrost schedules','Defrost schedules_0_3_1213');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','33','Defrost schedules','Defrost schedules_0_3_1214');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','36','Defrost schedules','Defrost schedules_0_3_1215');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','6','For DANFOSS only','For DANFOSS only_0_3_60005');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','54','Thermostat control','Thermostat control_0_3_2641');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','9','In All Groups','In All Groups_0_3_1010');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','12','In All Groups','In All Groups_0_3_2001');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','15','In All Groups','In All Groups_0_3_2529');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','18','In All Groups','In All Groups_0_3_2532');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','21','In All Groups','In All Groups_0_3_2530');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','24','In All Groups','In All Groups_0_3_2531');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','57','Thermostat control','Thermostat control_0_3_2545');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','27','In All Groups','In All Groups_0_3_2555');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','30','In All Groups','In All Groups_0_3_2575');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','33','In All Groups','In All Groups_0_3_2577');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','3','Service','Service_0_4_2509');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','6','Service','Service_0_4_2510');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','9','Service','Service_0_4_2511');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','12','Service','Service_0_4_2582');
INSERT INTO `iw_par_ekc_202d_groups` VALUES ('2026-06-29 08:22:19','group','36','In All Groups','In All Groups_0_3_2594');
--
-- Param
--
CREATE TABLE IF NOT EXISTS `iw_par_ekc_202d_param` (`row_date` datetime NOT NULL DEFAULT '2002-01-10 00:00:00', `element_id` varchar(100) NOT NULL DEFAULT '', `driver_id` varchar(100) NOT NULL DEFAULT '', `alias_text` text NOT NULL, `menu` varchar(10) NOT NULL DEFAULT '', `application` text NOT NULL, `parameter_type` text NOT NULL, `factory_setting` text NOT NULL, `grp` text NOT NULL, `att` text NOT NULL, `eng_unit` varchar(20) NOT NULL DEFAULT '', `format` varchar(20) NOT NULL DEFAULT '', `range_min` text NOT NULL, `range_max` text NOT NULL, `scale` varchar(15) NOT NULL DEFAULT '', `raw_min` varchar(15) NOT NULL DEFAULT '', `raw_max` varchar(15) NOT NULL DEFAULT '', `eng_min` varchar(15) NOT NULL DEFAULT '', `eng_max` varchar(15) NOT NULL DEFAULT '', `driver_id_extra` varchar(255) NOT NULL DEFAULT '', `format_extra` text NOT NULL, UNIQUE KEY `element_id` (`element_id`)) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='3.2.3';
--
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','For DANFOSS only_0_3_2085','0_3_2085','--- Appl.mode','','Integral values','integer','','-1','r','','','1','3','3','','','','','3_2085_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20014','0_3_20014','--- Case clean','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20014_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_99','0_3_99','--- Cutout C','','Analog values','float','','-1','rw','','','-500','500','3','0','1000','0','100','3_99_I16_N_6_99_I16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1012','0_3_1012','--- Def. Start','','Analog values','float','','-1','rw','','','0','1','3','','','','','3_1012_U16_N_6_1012_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1035','0_3_1035','--- DefrostState','','Analog values','float','','-1','r','','','0','1','3','','','','','3_1035_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20010','0_3_20010','--- DI1 alarm','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20010_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20009','0_3_20009','--- Door alarm','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20009_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_19999','0_3_19999','--- EKC error','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_19999_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_2540','0_3_2540','--- EKC Error','','Analog values','float','','-1','r','','','0','1','3','','','','','3_2540_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2006','0_3_2006','--- EKC State','','Integral values','integer','','-1','r','','','0','100','3','','','','','3_2006_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_3043','0_3_3043','--- Forced cool.','','Analog values','float','','-1','rw','','','0','1','3','','','','','3_3043_U16_N_6_3043_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20005','0_3_20005','--- High t.alarm','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20005_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_2021','0_3_2021','-- HoldAfterDef','','Analog values','float','','-1','rw','','','0','1','3','','','','','3_2021_U16_N_6_2021_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20006','0_3_20006','--- Low t.alarm','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20006_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20012','0_3_20012','-- Max Def.Time','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20012_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20013','0_3_20013','-- Max HoldTime','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20013_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_125','0_3_125','--- Night setbck','','Analog values','float','','-1','rw','','','0','1','3','','','','','3_125_U16_N_6_125_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_2045','0_3_2045','-- Reset alarm','','Analog values','float','','-1','rw','','','0','1','3','','','','','3_2045_U16_N_6_2045_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20000','0_3_20000','-- RTC error','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20000_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20001','0_3_20001','--- S3 error','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20001_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20007','0_3_20007','--- S3 High temp','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20007_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20008','0_3_20008','-- S3 Low temp.','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20008_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20015','0_3_20015','-- S3S4switched','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20015_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20002','0_3_20002','--- S4 error','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20002_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20003','0_3_20003','--- S5 error','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20003_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20004','0_3_20004','-- S5B error','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20004_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20016','0_3_20016','--- Standby mode','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20016_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Miscellaneous_0_3_2000','0_3_2000','002 DI1 Config.','','Integral values','integer','','-1','rw','','','0','12','3','','','','','3_2000_U16_N_6_2000_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Miscellaneous_0_3_2055','0_3_2055','046 Case clean','','Integral values','integer','','-1','rw','','','0','2','3','','','','','3_2055_U16_N_6_2055_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10001','0_3_10001','A03 Alarm delay','','Integral values','integer','','-1','rw','','','0','240','3','','','','','3_10001_U16_N_6_10001_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10002','0_3_10002','A04 DoorOpen del','','Integral values','integer','','-1','rw','','','0','240','3','','','','','3_10002_U16_N_6_10002_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10017','0_3_10017','A12 Pulldown del','','Integral values','integer','','-1','rw','','','0','240','3','','','','','3_10017_U16_N_6_10017_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10018','0_3_10018','A13 HighLim Air','','Analog values','float','','-1','rw','','','-500','500','3','0','1000','0','100','3_10018_I16_N_6_10018_I16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10019','0_3_10019','A14 LowLim Air','','Analog values','float','','-1','rw','','','-500','500','3','0','1000','0','100','3_10019_I16_N_6_10019_I16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10027','0_3_10027','A27 Al.Delay DI1','','Integral values','integer','','-1','rw','','','0','240','3','','','','','3_10027_U16_N_6_10027_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10028','0_3_10028','A28 Al.Delay DI2','','Integral values','integer','','-1','rw','','','0','240','3','','','','','3_10028_U16_N_6_10028_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10033','0_3_10033','A33 AirAlarm Cfg','','Integral values','integer','','-1','rw','','','1','2','3','','','','','3_10033_U16_N_6_10033_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10036','0_3_10036','A36 Alarm S4 %','','Integral values','integer','','-1','rw','','','0','100','3','','','','','3_10036_U16_N_6_10036_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10056','0_3_10056','A56 HighLim S3','','Analog values','float','','-1','rw','','','-500','500','3','0','1000','0','100','3_10056_I16_N_6_10056_I16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10057','0_3_10057','A57 LowLim S3','','Analog values','float','','-1','rw','','','-500','500','3','0','1000','0','100','3_10057_I16_N_6_10057_I16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Compressor control_0_3_499','0_3_499','c01 Min. On time','','Integral values','integer','','-1','rw','','','0','30','3','','','','','3_499_U16_N_6_499_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Compressor control_0_3_500','0_3_500','c02 Min.Off time','','Integral values','integer','','-1','rw','','','0','30','3','','','','','3_500_U16_N_6_500_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Compressor control_0_3_531','0_3_531','c30 Cmp relay NC','','Analog values','float','','-1','rw','','','0','1','3','','','','','3_531_U16_N_6_531_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_999','0_3_999','d01 Def. method','','Integral values','integer','','-1','rw','','','0','3','3','','','','','3_999_U16_N_6_999_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1000','0_3_1000','d02 Def.StopTemp','','Analog values','float','','-1','rw','','','0','250','3','0','1000','0','100','3_1000_U16_N_6_1000_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1001','0_3_1001','d03 Def.Interval','','Integral values','integer','','-1','rw','','','0','240','3','','','','','3_1001_U16_N_6_1001_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1002','0_3_1002','d04 Max Def.time','','Integral values','integer','','-1','rw','','','0','180','3','','','','','3_1002_U16_N_6_1002_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1003','0_3_1003','d05 Time stagg.','','Integral values','integer','','-1','rw','','','0','240','3','','','','','3_1003_U16_N_6_1003_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1004','0_3_1004','d06 DripOff time','','Integral values','integer','','-1','rw','','','0','60','3','','','','','3_1004_U16_N_6_1004_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1006','0_3_1006','d07 FanStartDel','','Integral values','integer','','-1','rw','','','0','60','3','','','','','3_1006_U16_N_6_1006_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1005','0_3_1005','d08 FanStartTemp','','Analog values','float','','-1','rw','','','-500','0','3','0','1000','0','100','3_1005_I16_N_6_1005_I16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1007','0_3_1007','d09 FanDuringDef','','Integral values','integer','','-1','rw','','','0','2','3','','','','','3_1007_U16_N_6_1007_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1008','0_3_1008','d10 DefStopSens.','','Analog values','float','','-1','rw','','','0','2','3','','','','','3_1008_U16_N_6_1008_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1017','0_3_1017','d16 Pump dwn del','','Integral values','integer','','-1','rw','','','0','60','3','','','','','3_1017_U16_N_6_1017_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1019','0_3_1019','d18 MaxTherRunT.','','Integral values','integer','','-1','rw','','','0','48','3','','','','','3_1019_U16_N_6_1019_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1020','0_3_1020','d19 CutoutS5Dif.','','Analog values','float','','-1','rw','','','0','200','3','0','1000','0','100','3_1020_U16_N_6_1020_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1039','0_3_1039','d24 Min Def.time','','Integral values','integer','','-1','rw','','','0','180','3','','','','','3_1039_U16_N_6_1039_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20011','0_3_20011','DI2 alarm','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_20011_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Fan control_0_3_1499','0_3_1499','F01 Fan stop CO','','Analog values','float','','-1','rw','','','0','1','3','','','','','3_1499_U16_N_6_1499_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Fan control_0_3_1502','0_3_1502','F02 Fan del. CO','','Analog values','float','','-1','rw','','','0','30','3','','','','','3_1502_U16_N_6_1502_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Fan control_0_3_1504','0_3_1504','F04 FanStop temp','','Analog values','float','','-1','rw','','','-500','500','3','0','1000','0','100','3_1504_I16_N_6_1504_I16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','For DANFOSS only_0_3_60000','0_3_60000','Modul software','','Analog values','float','','-1','r','','','0','1000','3','0','1000','0','10','3_60000_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Miscellaneous_0_3_1999','0_3_1999','o01 DelayOfOutp.','','Integral values','integer','','-1','rw','','','0','600','3','','','','','3_1999_U16_N_6_1999_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Miscellaneous_0_3_2013','0_3_2013','o06 SensorConfig','','Integral values','integer','','-1','rw','','','0','2','3','','','','','3_2013_U16_N_6_2013_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_2019','0_3_2019','o16 MaxHoldTime','','Integral values','integer','','-1','rw','','','0','60','3','','','','','3_2019_U16_N_6_2019_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_4_2020','0_4_2020','o17 Disp. S4 %','','Integral values','integer','','-1','rw','&#037','','0','100','3','','','','','4_2020_U16_N_6_2020_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Miscellaneous_0_3_2054','0_3_2054','o37 DI2 Config.','','Integral values','integer','','-1','rw','','','0','12','3','','','','','3_2054_U16_N_6_2054_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_100','0_3_100','r01 Differential','','Analog values','float','','-1','rw','','','1','200','3','0','1000','0','100','3_100_U16_N_6_100_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_101','0_3_101','r02 Max cutoutC','','Analog values','float','','-1','rw','&deg;C','','-490','500','3','0','1000','0','100','3_101_I16_N_6_101_I16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_102','0_3_102','r03 Min cutout C','','Analog values','float','','-1','rw','&deg;C','','-500','490','3','0','1000','0','100','3_102_I16_N_6_102_I16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_103','0_3_103','r04 Disp. Adj. K','','Analog values','float','','-1','rw','','','-200','200','3','','','','','3_103_I16_N_6_103_I16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_4_104','0_4_104','r05 Temp.unit','','Integral values','integer','','-1','rw','&deg;C','','0','1','3','0','1000','0','100','4_104_U16_N_6_104_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_112','0_3_112','r09 Adjust S4','','Analog values','float','','-1','rw','','','-100','100','3','0','1000','0','100','3_112_I16_N_6_112_I16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_113','0_3_113','r10 Adjust S3','','Analog values','float','','-1','rw','','','-100','100','3','0','1000','0','100','3_113_I16_N_6_113_I16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_116','0_3_116','r12 Main switch','','Integral values','integer','','-1','rw','','','-1','1','3','','','','','3_116_U16_N_6_116_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_124','0_3_124','r13 Night offset','','Analog values','float','','-1','rw','','','-100','100','3','0','1000','0','100','3_124_I16_N_6_124_I16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_4_122','0_4_122','r15 Ther. S4 %','','Integral values','integer','','-1','rw','&#037','','0','100','3','','','','','4_122_U16_N_6_122_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_149','0_3_149','r39 Th. offset','','Analog values','float','','-1','rw','','','0','1','3','','','','','3_149_U16_N_6_149_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_150','0_3_150','r40 Th. offset K','','Analog values','float','','-1','rw','','','-500','500','3','0','1000','0','100','3_150_I16_N_6_150_I16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_4_181','0_4_181','r61 Ther.S4% Ngt','','Integral values','integer','','-1','rw','&#037','','0','100','3','','','','','4_181_U16_N_6_181_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_197','0_3_197','r75 Cover Diff.','','Analog values','float','','-1','rw','','','0','200','3','0','1000','0','100','3_197_U16_N_6_197_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1200','0_3_1200','t01 Def. 1 hr.','','Integral values','integer','','-1','rw','','','0','23','3','','','','','3_1200_U16_N_6_1200_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1201','0_3_1201','t02 Def. 2 hr.','','Integral values','integer','','-1','rw','','','0','23','3','','','','','3_1201_U16_N_6_1201_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1202','0_3_1202','t03 Def. 3 hr.','','Integral values','integer','','-1','rw','','','0','23','3','','','','','3_1202_U16_N_6_1202_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1203','0_3_1203','t04 Def. 4 hr.','','Integral values','integer','','-1','rw','','','0','23','3','','','','','3_1203_U16_N_6_1203_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1204','0_3_1204','t05 Def. 5 hr.','','Integral values','integer','','-1','rw','','','0','23','3','','','','','3_1204_U16_N_6_1204_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1205','0_3_1205','t06 Def. 6 hr.','','Integral values','integer','','-1','rw','','','0','23','3','','','','','3_1205_U16_N_6_1205_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1210','0_3_1210','t11 Def. 1 min.','','Integral values','integer','','-1','rw','','','0','59','3','','','','','3_1210_U16_N_6_1210_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1211','0_3_1211','t12 Def. 2 min.','','Integral values','integer','','-1','rw','','','0','59','3','','','','','3_1211_U16_N_6_1211_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1212','0_3_1212','t13 Def. 3 min.','','Integral values','integer','','-1','rw','','','0','59','3','','','','','3_1212_U16_N_6_1212_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1213','0_3_1213','t14 Def. 4 min.','','Integral values','integer','','-1','rw','','','0','59','3','','','','','3_1213_U16_N_6_1213_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1214','0_3_1214','t15 Def. 5 min.','','Integral values','integer','','-1','rw','','','0','59','3','','','','','3_1214_U16_N_6_1214_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1215','0_3_1215','t16 Def. 6 min.','','Integral values','integer','','-1','rw','','','0','59','3','','','','','3_1215_U16_N_6_1215_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','For DANFOSS only_0_3_60005','0_3_60005','Transceiver type','','Integral values','integer','','-1','r','','','0','10','3','','','','','3_60005_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_2641','0_3_2641','U08 CoverDetect.','','Analog values','float','','-1','r','','','0','1','3','','','','','3_2641_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_1010','0_3_1010','u09 S5 temp.','','Analog values','float','','-1','r','','','-2000','2000','3','0','1000','0','100','3_1010_I16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2001','0_3_2001','u10 DI1 status','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_2001_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2529','0_3_2529','u12 S3 air temp.','','Analog values','float','','-1','r','','','-2000','2000','3','0','1000','0','100','3_2529_I16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2532','0_3_2532','u13 Night Cond.','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_2532_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2530','0_3_2530','u16 S4 air temp.','','Analog values','float','','-1','r','','','-2000','2000','3','0','1000','0','100','3_2530_I16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2531','0_3_2531','u17 Ther. air','','Analog values','float','','-1','r','','','-2000','2000','3','0','1000','0','100','3_2531_I16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_2545','0_3_2545','u28 Temp. ref.','','Analog values','float','','-1','r','&deg;C','','2000','2000','3','0','1000','0','100','3_2545_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2555','0_3_2555','u37 D12 status','','Integral values','integer','','-1','r','','','0','1','3','','','','','3_2555_U16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2575','0_3_2575','u56 Display air','','Analog values','float','','-1','r','','','-2000','2000','3','0','1000','0','100','3_2575_I16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2577','0_3_2577','u57 Alarm air','','Analog values','float','','-1','r','','','-2000','2000','3','0','1000','0','100','3_2577_I16_N_-_-_-_-','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Service_0_4_2509','0_4_2509','u58 Comp1/LLSV','','Integral values','integer','','-1','rw','','','0','1','3','','','','','4_2509_U16_N_6_2509_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Service_0_4_2510','0_4_2510','u59 Fan relay','','Integral values','integer','','-1','rw','','','0','1','3','','','','','4_2510_U16_N_6_2510_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Service_0_4_2511','0_4_2511','u60 Def. relay','','Integral values','integer','','-1','rw','','','0','1','3','','','','','4_2511_U16_N_6_2511_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','Service_0_4_2582','0_4_2582','u62 Alarm relay','','Integral values','integer','','-1','rw','','','0','1','3','','','','','4_2582_U16_N_6_2582_U16_N','');
INSERT INTO `iw_par_ekc_202d_param` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2594','0_3_2594','u75 S5 temp. B','','Analog values','float','','-1','r','','','-2000','2000','3','0','1000','0','100','3_2594_F_N_-_-_-_-','');
--
-- Set
--
CREATE TABLE IF NOT EXISTS `iw_set_ekc_202d` (`row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00', `element_id` varchar(100) NOT NULL DEFAULT '', `active` enum('0','1') NOT NULL DEFAULT '0', `onl_ind` enum('0','1') NOT NULL DEFAULT '1', `update_freq` set('','fast','norm','slow','once','never') NOT NULL DEFAULT 'norm', `save_data` varchar(20) NOT NULL DEFAULT 'change', `save_freq` varchar(20) NOT NULL DEFAULT '', `plant_pri` char(1) NOT NULL DEFAULT '', `sys_pri` char(1) NOT NULL DEFAULT '', `alarm_type` tinyint(3) NOT NULL DEFAULT '0', PRIMARY KEY (`element_id`)) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='3.0.0';
--
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','For DANFOSS only_0_3_2085','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20014','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_99','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1012','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1035','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20010','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20009','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_19999','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_2540','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2006','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_3043','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20005','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_2021','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20006','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20012','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20013','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_125','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_2045','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20000','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20001','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20007','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20008','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20015','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20002','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20003','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20004','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20016','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Miscellaneous_0_3_2000','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Miscellaneous_0_3_2055','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10001','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10002','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10017','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10018','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10019','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10027','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10028','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10033','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10036','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10056','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm settings_0_3_10057','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Compressor control_0_3_499','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Compressor control_0_3_500','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Compressor control_0_3_531','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_999','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1000','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1001','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1002','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1003','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1004','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1006','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1005','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1007','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1008','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1017','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1019','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1020','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_1039','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Alarm destinations_0_3_20011','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Fan control_0_3_1499','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Fan control_0_3_1502','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Fan control_0_3_1504','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','For DANFOSS only_0_3_60000','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Miscellaneous_0_3_1999','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Miscellaneous_0_3_2013','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost control_0_3_2019','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_4_2020','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Miscellaneous_0_3_2054','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_100','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_101','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_102','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_103','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_4_104','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_112','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_113','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_116','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_124','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_4_122','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_149','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_150','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_4_181','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_197','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1200','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1201','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1202','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1203','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1204','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1205','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1210','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1211','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1212','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1213','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1214','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Defrost schedules_0_3_1215','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','For DANFOSS only_0_3_60005','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_2641','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_1010','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2001','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2529','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2532','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2530','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2531','1','1','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Thermostat control_0_3_2545','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2555','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2575','1','1','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2577','1','0','norm','min','1','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Service_0_4_2509','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Service_0_4_2510','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Service_0_4_2511','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','Service_0_4_2582','1','0','slow','change','','','','0');
INSERT INTO `iw_set_ekc_202d` VALUES ('2026-06-29 08:22:19','In All Groups_0_3_2594','1','0','norm','min','1','','','0');


-- Changelog
-- V2: Added range_min and range_max