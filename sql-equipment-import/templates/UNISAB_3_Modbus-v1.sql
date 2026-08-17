REPLACE INTO `iw_sys_plant_units` (`row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`, `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`) VALUES
(NOW(), '1', '0', 'U01', 'Kompressor 1', 'unisab3', 'UNISAB3', '1_1', 'UNISAB3', 'UNISAB3', 0, ''),
(NOW(), '1', '0', 'U02', 'Kompressor 2', 'unisab3', 'UNISAB3', '2_1', 'UNISAB3', 'UNISAB3', 0, ''),
(NOW(), '1', '0', 'U03', 'Kompressor 3', 'unisab3', 'UNISAB3', '3_1', 'UNISAB3', 'UNISAB3', 0, '');

REPLACE INTO `iw_sys_plant_settings` (`row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`) VALUES
(NOW(), 'mb_mode', 'UNISAB3', '2', '', '0=RTU|1=ASCII|2=TCP', ''),
(NOW(), 'comm_port', 'UNISAB3', '3', '', '', ''),
(NOW(), 'comm_parity', 'UNISAB3', '0', '', '0=N|1=O|2=E|3=M|4=S', ''),
(NOW(), 'comm_data_bits', 'UNISAB3', '8', '', '', ''),
(NOW(), 'comm_stop_bits', 'UNISAB3', '1', '', '', ''),
(NOW(), 'comm_baudrate', 'UNISAB3', '9600', '', '', ''),
(NOW(), 'mb_tcp_servers', 'UNISAB3', '1;192.168.10.50;502;1000;2;1000\r\n2;192.168.10.51;502;1000;2;1000\r\n3;192.168.10.52;502;1000;2;1000', '', 'ID;IPadr;IPport;ConnTout;ConnRetries;RequestTout', ''),
(NOW(), 'mb_request_retries', 'UNISAB3', '2', '', '', ''),
(NOW(), 'force_word_not_byte', 'UNISAB3', '0', '', '0|1', ''),
(NOW(), 'handshake', 'UNISAB3', '0', '', '0|1|2', ''),
(NOW(), 'check_rate', 'UNISAB3', '1', 'ms', '', ''),
(NOW(), 'max_outstanding_packets', 'UNISAB3', '-1', '', '', ''),
(NOW(), 'packet_timeout', 'UNISAB3', '1', 'sec.', '', ''),
(NOW(), 'idle_event_rate', 'UNISAB3', '250', 'msec.', '', ''),
(NOW(), 'sql_queue_poll_time', 'UNISAB3', '2000', 'msec.', '', ''),
(NOW(), 'max_error_count', 'UNISAB3', '2', '', '', ''),
(NOW(), 'mb_request_timeout', 'UNISAB3', '1000', 'ms', '', ''),
(NOW(), 'com_error_alarm_delay', 'UNISAB3', '10', 'min.', '', ''),
(NOW(), 'show_queue_info', 'UNISAB3', '0', '', '', ''),
(NOW(), 'speed_index_block', 'UNISAB3', '10', '', '', ''),
(NOW(), 'speed_index_offline', 'UNISAB3', '10', '', '', ''),
(NOW(), 'speed_index_slow', 'UNISAB3', '1', '', '', ''),
(NOW(), 'speed_index_norm', 'UNISAB3', '1', '', '', ''),
(NOW(), 'max_param_block_time', 'UNISAB3', '2', 'hours', '', ''),
(NOW(), 'max_group_count', 'UNISAB3', '1', '', '', ''),
(NOW(), 'value_quality_check_limit', 'UNISAB3', '0', '', '0 = disabled', ''),
(NOW(), 'mux_settle_time', 'UNISAB3', '1500', 'ms', 'Time for the muxed input to settle. The value shuld be a multiple off 100.', ''),
(NOW(), 'startup_delay', 'UNISAB3', '15', 'Sec.', '', ''),
(NOW(), 'alarm_handler', 'UNISAB3', '', '', '', ''),
(NOW(), 'mb_tcp_connect_retries_default', 'UNISAB3', '2', '', '', ''),
(NOW(), 'mb_tcp_connect_timeout_default', 'UNISAB3', '1000', 'ms', '', '');

REPLACE INTO `iw_sys_processes` (`row_date`, `man_start`, `path`, `process_name`, `process_id`, `process_status`) VALUES
(NOW(), '0', 'iw_mb.exe', 'UNISAB3', '', '');

REPLACE INTO `iw_sys_order_no` (`row_date`, `order_no`, `db_link`, `group_link`) VALUES
(NOW(), 'UNISAB3', 'unisab3_param', 'unisab3_groups');

CREATE TABLE IF NOT EXISTS `iw_par_unisab3_groups` (
  `row_date` datetime NOT NULL DEFAULT '2004-01-10 00:00:00',
  `type` varchar(50) NOT NULL DEFAULT '',
  `view_order` mediumint(6) NOT NULL DEFAULT '0',
  `ref` varchar(100) NOT NULL DEFAULT '',
  `value` varchar(200) NOT NULL DEFAULT '',
  UNIQUE KEY `type` (`type`,`view_order`,`ref`,`value`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='2.0.0';

REPLACE INTO `iw_par_unisab3_groups` (`row_date`, `type`, `view_order`, `ref`, `value`) VALUES
(NOW(), 'default_link', 1, '', ''),
(NOW(), 'group_alias', 1, 'main', 'Målinger'),
(NOW(), 'group', 1, 'main', 'main_0_3_4096'),
(NOW(), 'group', 2, 'main', 'main_0_3_4224'),
(NOW(), 'group', 3, 'main', 'main_0_3_4352'),
(NOW(), 'group', 4, 'main', 'main_0_3_6656'),
(NOW(), 'group', 5, 'main', 'main_0_3_4480'),
(NOW(), 'group', 6, 'main', 'main_0_3_4608'),
(NOW(), 'group', 7, 'main', 'main_0_3_6144'),
(NOW(), 'group', 8, 'main', 'main_0_3_6784'),
(NOW(), 'group', 9, 'main', 'main_0_3_4736'),
(NOW(), 'group', 10, 'main', 'main_0_3_4992'),
(NOW(), 'group', 11, 'main', 'main_0_3_5248'),
(NOW(), 'group', 12, 'main', 'main_0_3_5262'),
(NOW(), 'group', 13, 'main', 'main_0_3_5120'),
(NOW(), 'group', 14, 'main', 'main_0_3_5760'),
(NOW(), 'group', 15, 'main', 'main_0_3_2'),
(NOW(), 'group', 16, 'main', 'main_0_3_4'),
(NOW(), 'group', 17, 'main', 'main_0_3_141'),
(NOW(), 'group', 18, 'main', 'main_0_3_142'),
(NOW(), 'group', 19, 'main', 'main_0_3_153'),
(NOW(), 'group', 20, 'main', 'main_0_3_155'),
(NOW(), 'group', 21, 'main', 'main_0_3_20480'),
(NOW(), 'group', 22, 'main', 'main_0_3_20544'),
(NOW(), 'group', 23, 'main', 'main_0_3_20608');

CREATE TABLE IF NOT EXISTS `iw_par_unisab3_param` (
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

REPLACE INTO `iw_par_unisab3_param` (`row_date`, `element_id`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `factory_setting`, `grp`, `att`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `driver_id_extra`, `format_extra`) VALUES
(NOW(), 'main_0_3_4096', '0_3_4096', 'Sugetrykk', '', 'Analog values', 'float', '', '-1', 'r', '°C/R', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_4096_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_4224', '0_3_4224', 'Sugetemperatur', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_4224_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_4352', '0_3_4352', 'Sugegassoverhetning', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_4352_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_6656', '0_3_6656', 'Sugetrykk', '', 'Analog values', 'float', '', '-1', 'r', 'Bar', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_6656_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_4480', '0_3_4480', 'Avgangstrykk', '', 'Analog values', 'float', '', '-1', 'r', '°C/R', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_4480_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_4608', '0_3_4608', 'Avgangstemperatur', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_4608_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_6144', '0_3_6144', 'Avgangsoverhetning', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_6144_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_6784', '0_3_6784', 'Avgangstrykk', '', 'Analog values', 'float', '', '-1', 'r', 'Bar', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_6784_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_4736', '0_3_4736', 'Oljetrykk', '', 'Analog values', 'float', '', '-1', 'r', 'Bar', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_4736_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_4992', '0_3_4992', 'Oljetemperatur', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_4992_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_5248', '0_3_5248', 'Utgående vanntemperatur', '', 'Analog values', 'float', '', '-1', 'r', '&deg;C', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_5248_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_5262', '0_3_5262', 'Utgående vanntemperatur settpunkt', '', 'Analog values', 'float', '', '-1', 'rw', '&deg;C', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_5262_I16_N_6_5262_I16_N', ''),
(NOW(), 'main_0_3_5120', '0_3_5120', 'Motorstrøm', '', 'Analog values', 'float', '', '-1', 'r', 'A', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_5120_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_5760', '0_3_5760', 'Kapasitet', '', 'Analog values', 'float', '', '-1', 'r', '&#037', '%.1f', '', '', '1', '0', '1000', '0', '100', '3_5760_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_2', '0_3_2', 'Modus', '', 'Analog values', 'float', '', '-1', 'rw', '', '%.0f', '', '', '', '', '', '', '', '3_2_I16_N_6_2_I16_N', '{"rev":"1","type":"num","v":{"0":{"t":"Stoppet"},"1":{"t":"Manuell"},"2":{"t":"Auto"},"3":{"t":"Fjern"}}}'),
(NOW(), 'main_0_3_4', '0_3_4', 'Status', '', 'Analog values', 'float', '', '-1', 'r', '', '%.0f', '', '', '', '', '', '', '', '3_4_I16_N_-_-_-_-', '{\r\n	"rev": "1",\r\n	"type": "num",\r\n	"v": {\r\n		"0": {\r\n			"t": "Ingen kompressor"\r\n		},\r\n		"1": {\r\n			"t": "Klar"\r\n		},\r\n		"2": {\r\n			"t": "I drift"\r\n		},\r\n		"3": {\r\n			"t": "Starter"\r\n		},\r\n		"4": {\r\n			"t": "Shutdown"\r\n		},\r\n		"5": {\r\n			"t": "Forsinkelse"\r\n		},\r\n		"6": {\r\n			"t": "Forsmører"\r\n		},\r\n		"7": {\r\n			"t": "Kapasitetssleide ned"\r\n		},\r\n		"8": {\r\n			"t": "Kjører overbelastet"\r\n		},\r\n		"9": {\r\n			"t": "Kjører med avgangstrykkbegrenser"\r\n		},\r\n		"10": {\r\n			"t": "Kjører med sugetrykksbegrenser"\r\n		},\r\n		"11": {\r\n			"t": "Stoppet"\r\n		}\r\n	}\r\n}'),
(NOW(), 'main_0_3_141', '0_3_141', 'Timeteller', '', 'Analog values', 'float', '', '-1', 'r', 'hour', '%.0f', '', '', '', '', '', '', '', '3_141_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_142', '0_3_142', 'Timeteller', '', 'Analog values', 'float', '', '-1', 'r', 'hour', '%.0f', '', '', '', '', '', '', '', '3_142_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_153', '0_3_153', 'Shutdown', '', 'Integral values', 'integer', '', '-1', 'r', '', '%.0f', '', '', '', '', '', '', '', '3_153_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"-1":{"t":"-"}, "31":{"t":"Lavt sugetrykk"}, "32":{"t":"Høyt sugetrykk"}, "33":{"t":"Lav sugegassoverhetning"}, "34":{"t":"Høy sugegassoverhetning"}, "35":{"t":"Lavt avgangstrykk"}, "36":{"t":"Høyt avgangstrykk"}, "37":{"t":"Høy trykkrørstemperatur"}, "38":{"t":"Lavt oljetrykk"}, "39":{"t":"Lav vanntemperatur"}, "40":{"t":"Lav trykkrørstemperatur"}, "41":{"t":"Lav oljetemperatur"}, "42":{"t":"Høy oljetemperatur"}, "43":{"t":"Høy oljefilterdifferansetrykk"}, "46":{"t":"Kompressormotoroverbelastning"}, "47":{"t":"Kompressormotorfeil/Nødstopp/Høytrykkspressostat"}, "49":{"t":"Høy motortemperatur (termistor)"}, "55":{"t":"PMS-feil"}, "56":{"t":"Ingen starttillatelse"}, "57":{"t":"Høyt differansetrykk"}, "58":{"t":"Høy vanntemperatur"}, "59":{"t":"Høyt oljetrykk"}, "60":{"t":"Høyt mellomtrykk"}, "61":{"t":"Lavt mellomtrykk"}, "64":{"t":"Oljeutskillerfeil"}, "65":{"t":"Feil startnummer i sekvens"}, "66":{"t":"Feil EEPROM"}, "67":{"t":"Lavt AUX inngangssignal"}, "68":{"t":"Høyt AUX inngangssignal"}, "69":{"t":"Lav avgangsoverhetning"}, "70":{"t":"Trykkrørsgass overbelastning"}, "71":{"t":"Evolution, shutdown fra PLS"}, "72":{"t":"Evolution, ingen kommunikasjon med PLS"}, "73":{"t":"Begrenser sugetrykk"}, "74":{"t":"Begrenser avgangstrykk"}, "75":{"t":"Begrenser vanntemperatur"}, "76":{"t":"Begrenser varmtvannstemperatur"}, "78":{"t":"Begrenser trykkrørstemperatur"}, "80":{"t":"Ingen realtimeklokke"}, "93":{"t":"Ingen flow gjennom fordamper"}, "94":{"t":"Ingen flow gjennom kondensator"}, "95":{"t":"Høy inngående prosesstemperatur"}, "96":{"t":"Lav inngående prosesstemperatur"}, "97":{"t":"Nødstopp"}, "98":{"t":"Lav utgående prosesstemperatur"}, "99":{"t":"Høy utgående prosesstemperatur"}}}'),
(NOW(), 'main_0_3_155', '0_3_155', 'Antall aktive alarmer', '', 'Analog values', 'float', '', '-1', 'r', '', '%.0f', '', '', '', '', '', '', '', '3_155_I16_N_-_-_-_-', ''),
(NOW(), 'main_0_3_20480', '0_3_20480', 'Alarm 1', '', 'Integral values', 'integer', '', '-1', 'r', '', '%.0f', '', '', '', '', '', '', '', '3_20480_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"-1":{"t":"-"}, "31":{"t":"Lavt sugetrykk"}, "32":{"t":"Høyt sugetrykk"}, "33":{"t":"Lav sugegassoverhetning"}, "34":{"t":"Høy sugegassoverhetning"}, "35":{"t":"Lavt avgangstrykk"}, "36":{"t":"Høyt avgangstrykk"}, "37":{"t":"Høy trykkrørstemperatur"}, "38":{"t":"Lavt oljetrykk"}, "39":{"t":"Lav vanntemperatur"}, "40":{"t":"Lav trykkrørstemperatur"}, "41":{"t":"Lav oljetemperatur"}, "42":{"t":"Høy oljetemperatur"}, "43":{"t":"Høy oljefilterdifferansetrykk"}, "46":{"t":"Kompressormotoroverbelastning"}, "47":{"t":"Kompressormotorfeil/Nødstopp/Høytrykkspressostat"}, "49":{"t":"Høy motortemperatur (termistor)"}, "55":{"t":"PMS-feil"}, "56":{"t":"Ingen starttillatelse"}, "57":{"t":"Høyt differansetrykk"}, "58":{"t":"Høy vanntemperatur"}, "59":{"t":"Høyt oljetrykk"}, "60":{"t":"Høyt mellomtrykk"}, "61":{"t":"Lavt mellomtrykk"}, "64":{"t":"Oljeutskillerfeil"}, "65":{"t":"Feil startnummer i sekvens"}, "66":{"t":"Feil EEPROM"}, "67":{"t":"Lavt AUX inngangssignal"}, "68":{"t":"Høyt AUX inngangssignal"}, "69":{"t":"Lav avgangsoverhetning"}, "70":{"t":"Trykkrørsgass overbelastning"}, "71":{"t":"Evolution, shutdown fra PLS"}, "72":{"t":"Evolution, ingen kommunikasjon med PLS"}, "73":{"t":"Begrenser sugetrykk"}, "74":{"t":"Begrenser avgangstrykk"}, "75":{"t":"Begrenser vanntemperatur"}, "76":{"t":"Begrenser varmtvannstemperatur"}, "78":{"t":"Begrenser trykkrørstemperatur"}, "80":{"t":"Ingen realtimeklokke"}, "93":{"t":"Ingen flow gjennom fordamper"}, "94":{"t":"Ingen flow gjennom kondensator"}, "95":{"t":"Høy inngående prosesstemperatur"}, "96":{"t":"Lav inngående prosesstemperatur"}, "97":{"t":"Nødstopp"}, "98":{"t":"Lav utgående prosesstemperatur"}, "99":{"t":"Høy utgående prosesstemperatur"}}}'),
(NOW(), 'main_0_3_20544', '0_3_20544', 'Alarm 2', '', 'Integral values', 'integer', '', '-1', 'r', '', '%.0f', '', '', '', '', '', '', '', '3_20544_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"-1":{"t":"-"}, "31":{"t":"Lavt sugetrykk"}, "32":{"t":"Høyt sugetrykk"}, "33":{"t":"Lav sugegassoverhetning"}, "34":{"t":"Høy sugegassoverhetning"}, "35":{"t":"Lavt avgangstrykk"}, "36":{"t":"Høyt avgangstrykk"}, "37":{"t":"Høy trykkrørstemperatur"}, "38":{"t":"Lavt oljetrykk"}, "39":{"t":"Lav vanntemperatur"}, "40":{"t":"Lav trykkrørstemperatur"}, "41":{"t":"Lav oljetemperatur"}, "42":{"t":"Høy oljetemperatur"}, "43":{"t":"Høy oljefilterdifferansetrykk"}, "46":{"t":"Kompressormotoroverbelastning"}, "47":{"t":"Kompressormotorfeil/Nødstopp/Høytrykkspressostat"}, "49":{"t":"Høy motortemperatur (termistor)"}, "55":{"t":"PMS-feil"}, "56":{"t":"Ingen starttillatelse"}, "57":{"t":"Høyt differansetrykk"}, "58":{"t":"Høy vanntemperatur"}, "59":{"t":"Høyt oljetrykk"}, "60":{"t":"Høyt mellomtrykk"}, "61":{"t":"Lavt mellomtrykk"}, "64":{"t":"Oljeutskillerfeil"}, "65":{"t":"Feil startnummer i sekvens"}, "66":{"t":"Feil EEPROM"}, "67":{"t":"Lavt AUX inngangssignal"}, "68":{"t":"Høyt AUX inngangssignal"}, "69":{"t":"Lav avgangsoverhetning"}, "70":{"t":"Trykkrørsgass overbelastning"}, "71":{"t":"Evolution, shutdown fra PLS"}, "72":{"t":"Evolution, ingen kommunikasjon med PLS"}, "73":{"t":"Begrenser sugetrykk"}, "74":{"t":"Begrenser avgangstrykk"}, "75":{"t":"Begrenser vanntemperatur"}, "76":{"t":"Begrenser varmtvannstemperatur"}, "78":{"t":"Begrenser trykkrørstemperatur"}, "80":{"t":"Ingen realtimeklokke"}, "93":{"t":"Ingen flow gjennom fordamper"}, "94":{"t":"Ingen flow gjennom kondensator"}, "95":{"t":"Høy inngående prosesstemperatur"}, "96":{"t":"Lav inngående prosesstemperatur"}, "97":{"t":"Nødstopp"}, "98":{"t":"Lav utgående prosesstemperatur"}, "99":{"t":"Høy utgående prosesstemperatur"}}}'),
(NOW(), 'main_0_3_20608', '0_3_20608', 'Alarm 3', '', 'Integral values', 'integer', '', '-1', 'r', '', '%.0f', '', '', '', '', '', '', '', '3_20608_I16_N_-_-_-_-', '{"rev":"1","type":"num","v":{"-1":{"t":"-"}, "31":{"t":"Lavt sugetrykk"}, "32":{"t":"Høyt sugetrykk"}, "33":{"t":"Lav sugegassoverhetning"}, "34":{"t":"Høy sugegassoverhetning"}, "35":{"t":"Lavt avgangstrykk"}, "36":{"t":"Høyt avgangstrykk"}, "37":{"t":"Høy trykkrørstemperatur"}, "38":{"t":"Lavt oljetrykk"}, "39":{"t":"Lav vanntemperatur"}, "40":{"t":"Lav trykkrørstemperatur"}, "41":{"t":"Lav oljetemperatur"}, "42":{"t":"Høy oljetemperatur"}, "43":{"t":"Høy oljefilterdifferansetrykk"}, "46":{"t":"Kompressormotoroverbelastning"}, "47":{"t":"Kompressormotorfeil/Nødstopp/Høytrykkspressostat"}, "49":{"t":"Høy motortemperatur (termistor)"}, "55":{"t":"PMS-feil"}, "56":{"t":"Ingen starttillatelse"}, "57":{"t":"Høyt differansetrykk"}, "58":{"t":"Høy vanntemperatur"}, "59":{"t":"Høyt oljetrykk"}, "60":{"t":"Høyt mellomtrykk"}, "61":{"t":"Lavt mellomtrykk"}, "64":{"t":"Oljeutskillerfeil"}, "65":{"t":"Feil startnummer i sekvens"}, "66":{"t":"Feil EEPROM"}, "67":{"t":"Lavt AUX inngangssignal"}, "68":{"t":"Høyt AUX inngangssignal"}, "69":{"t":"Lav avgangsoverhetning"}, "70":{"t":"Trykkrørsgass overbelastning"}, "71":{"t":"Evolution, shutdown fra PLS"}, "72":{"t":"Evolution, ingen kommunikasjon med PLS"}, "73":{"t":"Begrenser sugetrykk"}, "74":{"t":"Begrenser avgangstrykk"}, "75":{"t":"Begrenser vanntemperatur"}, "76":{"t":"Begrenser varmtvannstemperatur"}, "78":{"t":"Begrenser trykkrørstemperatur"}, "80":{"t":"Ingen realtimeklokke"}, "93":{"t":"Ingen flow gjennom fordamper"}, "94":{"t":"Ingen flow gjennom kondensator"}, "95":{"t":"Høy inngående prosesstemperatur"}, "96":{"t":"Lav inngående prosesstemperatur"}, "97":{"t":"Nødstopp"}, "98":{"t":"Lav utgående prosesstemperatur"}, "99":{"t":"Høy utgående prosesstemperatur"}}}');

CREATE TABLE IF NOT EXISTS `iw_set_unisab3` (
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

REPLACE INTO `iw_set_unisab3` (`row_date`, `element_id`, `active`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_type`) VALUES
(NOW(), 'main_0_3_4096', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_4224', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_4352', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_6656', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_4480', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_4608', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_6144', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_6784', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_4736', '1', '1', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_4992', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_5248', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_5262', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_5120', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_5760', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_2', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_4', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_141', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_142', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_153', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_155', '1', '0', 'norm', 'min', '1', '', '', 0),
(NOW(), 'main_0_3_20480', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_20544', '1', '0', 'slow', 'change', '', '', '', 0),
(NOW(), 'main_0_3_20608', '1', '0', 'slow', 'change', '', '', '', 0);



-- Changelog
--
-- v1 Orginal
--
--
--
--
