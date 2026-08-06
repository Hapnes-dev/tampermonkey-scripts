-- TRIMMED SAMPLE of a phpMyAdmin dump of `iw_gen_driver_parameters` (a plant's full
-- driver/parameter list; the real dump is ~4.5 MB / ~7000 rows). Plant id masked.
-- This is the file format the Copilot agent receives when asked to LINK a panel json:
-- the `driver_id` column IS the string that goes into a panel object's driver_id field;
-- `unit_id`/`unit_name` identify the unit (match unit_name to the panel's system name);
-- `alias_text` describes the parameter (match it to the object's signal);
-- `application` separates 'Analog values' (_4_ ids) from 'Digital IO' (_2_ ids);
-- `att` is r (read) / rw (setpoints); `eng_unit` is the engineering unit;
-- `format_extra` carries the enum value map for state params.

CREATE TABLE IF NOT EXISTS `iw_gen_driver_parameters` (
  `row_date` datetime NOT NULL DEFAULT '2020-01-01 00:00:00',
  `driver_type` varchar(40) NOT NULL DEFAULT '',
  `unit_id` varchar(40) NOT NULL DEFAULT '',
  `unit_name` varchar(100) NOT NULL DEFAULT '',
  `driver_group` int(11) NOT NULL DEFAULT '0',
  `onl_ind` tinyint(1) NOT NULL DEFAULT '0',
  `update_freq` varchar(10) NOT NULL DEFAULT '0',
  `save_data` varchar(20) NOT NULL DEFAULT 'all',
  `save_freq` varchar(20) NOT NULL DEFAULT '0',
  `plant_pri` char(1) NOT NULL DEFAULT '',
  `sys_pri` char(1) NOT NULL DEFAULT '',
  `alarm_block` tinyint(1) NOT NULL DEFAULT '0',
  `alarm_type` tinyint(3) NOT NULL DEFAULT '0',
  `element_id` varchar(100) NOT NULL DEFAULT '',
  `driver_id_no` mediumint(8) unsigned NOT NULL DEFAULT '0',
  `driver_id` varchar(100) NOT NULL DEFAULT '',
  `alias_text` varchar(255) NOT NULL DEFAULT '',
  `menu` varchar(10) NOT NULL DEFAULT '',
  `application` varchar(50) NOT NULL DEFAULT '',
  `parameter_type` varchar(30) NOT NULL DEFAULT '',
  `hardware_datatype` varchar(30) NOT NULL DEFAULT '',
  `relation` int(11) NOT NULL DEFAULT '0',
  `eng_unit` varchar(40) NOT NULL DEFAULT '',
  `format` varchar(20) NOT NULL DEFAULT '',
  `range_min` varchar(40) NOT NULL DEFAULT '',
  `range_max` varchar(40) NOT NULL DEFAULT '',
  `scale` varchar(15) NOT NULL DEFAULT '',
  `raw_min` varchar(15) NOT NULL DEFAULT '',
  `raw_max` varchar(15) NOT NULL DEFAULT '',
  `eng_min` varchar(15) NOT NULL DEFAULT '',
  `eng_max` varchar(15) NOT NULL DEFAULT '',
  `grp` varchar(10) NOT NULL DEFAULT '',
  `att` varchar(10) NOT NULL DEFAULT '',
  `grp_name` varchar(50) NOT NULL DEFAULT '',
  `regulator_type` varchar(50) NOT NULL DEFAULT '',
  `order_no` varchar(50) NOT NULL DEFAULT '',
  `user_attribs` varchar(255) NOT NULL DEFAULT '',
  `driver_adr_extra` varchar(100) NOT NULL DEFAULT '',
  `driver_id_extra` varchar(255) NOT NULL DEFAULT '',
  `format_extra` text NOT NULL,
  `category_id` smallint(5) unsigned DEFAULT NULL,
  UNIQUE KEY `driver_id` (`driver_id`),
  KEY `unit_id` (`unit_id`),
  KEY `element_id` (`element_id`),
  KEY `save_data` (`save_data`),
  KEY `driver_id_no` (`driver_id_no`),
  KEY `relation` (`relation`),
  KEY `driver_type` (`driver_type`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COMMENT='4.5.6';

INSERT INTO `iw_gen_driver_parameters` (`row_date`, `driver_type`, `unit_id`, `unit_name`, `driver_group`, `onl_ind`, `update_freq`, `save_data`, `save_freq`, `plant_pri`, `sys_pri`, `alarm_block`, `alarm_type`, `element_id`, `driver_id_no`, `driver_id`, `alias_text`, `menu`, `application`, `parameter_type`, `hardware_datatype`, `relation`, `eng_unit`, `format`, `range_min`, `range_max`, `scale`, `raw_min`, `raw_max`, `eng_min`, `eng_max`, `grp`, `att`, `grp_name`, `regulator_type`, `order_no`, `user_attribs`, `driver_adr_extra`, `driver_id_extra`, `format_extra`, `category_id`) VALUES
('2026-08-05 15:24:03', 'OJEXHAUST', 'V01', '360.001 Ventilasjon', 333, 0, 'norm', 'min', '1', '', '', 0, 0, '3x0020', 786, 'NNNNN_OJEXHAUST_OJ_1_1_0_4_19', 'Actual supply temperature [1/100°C]', '3x0020', 'Analog values', 'float', '', 0, '°C', '', '', '', '1', '0', '1000', '0', '10', '-1', 'r', 'exhausto_OJ_v610', 'OJ', 'exhausto_OJ_v610', '', '', '4_19_I16_N_-_-_-_-', '', NULL),
('2026-08-05 15:24:03', 'OJEXHAUST', 'V01', '360.001 Ventilasjon', 322, 1, 'norm', 'min', '1', '', '', 0, 0, '3x0007', 775, 'NNNNN_OJEXHAUST_OJ_1_1_0_4_6', 'Actual supply flow [l/s] or [m3/h] or [CFM] (Depending on the unit selection in the OJ-Air2Master)', '3x0007', 'Analog values', 'float', '', 0, 'l/s_m3/h', '%.0f', '', '', '', '', '', '', '', '-1', 'r', 'exhausto_OJ_v610', 'OJ', 'exhausto_OJ_v610', '', '', '4_6_U16_N_-_-_-_-', '', NULL),
('2026-08-05 15:24:03', 'OJEXHAUST', 'V01', '360.001 Ventilasjon', 324, 0, 'norm', 'min', '1', '', '', 0, 0, '3x0009', 777, 'NNNNN_OJEXHAUST_OJ_1_1_0_4_8', 'Actual extract flow [l/s] or [m3/h] or [CFM] (Depending on the unit selection in the OJ-Air2Master)', '3x0009', 'Analog values', 'float', '', 0, 'l/s_m3/h', '%.0f', '', '', '', '', '', '', '', '-1', 'r', 'exhausto_OJ_v610', 'OJ', 'exhausto_OJ_v610', '', '', '4_8_U16_N_-_-_-_-', '', NULL),
('2026-08-05 15:24:03', 'OJEXHAUST', 'V01', '360.001 Ventilasjon', 344, 0, 'norm', 'min', '1', '', '', 0, 0, '3x0031', 797, 'NNNNN_OJEXHAUST_OJ_1_1_0_4_30', 'supply filter pressure [1/100Pa]', '3x0031', 'Analog values', 'float', '', 0, 'Pa', '%.0f', '', '', '', '', '', '', '', '-1', 'r', 'exhausto_OJ_v610', 'OJ', 'exhausto_OJ_v610', '', '', '4_30_I16_N_-_-_-_-', '', NULL),
('2026-08-05 15:24:03', 'OJEXHAUST', 'V01', '360.001 Ventilasjon', 345, 0, 'norm', 'min', '1', '', '', 0, 0, '3x0032', 798, 'NNNNN_OJEXHAUST_OJ_1_1_0_4_31', 'Extract filter pressure [1/100Pa]', '3x0032', 'Analog values', 'float', '', 0, 'Pa', '%.0f', '', '', '', '', '', '', '', '-1', 'r', 'exhausto_OJ_v610', 'OJ', 'exhausto_OJ_v610', '', '', '4_31_I16_N_-_-_-_-', '', NULL),
('2026-08-05 15:24:03', 'OJEXHAUST', 'V01', '360.001 Ventilasjon', 387, 0, 'norm', 'min', '1', '', '', 0, 0, '3x0077', 840, 'NNNNN_OJEXHAUST_OJ_1_1_0_4_76', 'Supply motor setpoint [%]', '3x0077', 'Analog values', 'float', '', 0, '&#037', '', '', '', '1', '0', '1000', '0', '10', '-1', 'r', 'exhausto_OJ_v610', 'OJ', 'exhausto_OJ_v610', '', '', '4_76_U16_N_-_-_-_-', '', NULL),
('2026-08-05 15:24:03', 'OJEXHAUST', 'V01', '360.001 Ventilasjon', 407, 0, 'norm', 'min', '1', '', '', 0, 0, '3x0097', 860, 'NNNNN_OJEXHAUST_OJ_1_1_0_4_96', 'Rotary heat exchanger ? percentage setpoint [1/100%] (only with OJ RHX2M)', '3x0097', 'Analog values', 'float', '', 0, '&#037', '', '', '', '1', '0', '1000', '0', '10', '-1', 'r', 'exhausto_OJ_v610', 'OJ', 'exhausto_OJ_v610', '', '', '4_96_U16_N_-_-_-_-', '', NULL),
('2026-08-05 15:24:03', 'OJEXHAUST', 'V01', '360.001 Ventilasjon', 338, 0, 'norm', 'min', '1', '', '', 0, 0, '3x0025', 791, 'NNNNN_OJEXHAUST_OJ_1_1_0_4_24', 'Actual room temperature [1/100°C]', '3x0025', 'Analog values', 'float', '', 0, '°C', '', '', '', '1', '0', '1000', '0', '10', '-1', 'r', 'exhausto_OJ_v610', 'OJ', 'exhausto_OJ_v610', '', '', '4_24_I16_N_-_-_-_-', '', NULL),
('2026-08-05 15:24:03', 'OJEXHAUST', 'V01', '360.001 Ventilasjon', 82, 0, 'norm', 'change', '', '', '', 0, 0, '1x0070', 535, 'NNNNN_OJEXHAUST_OJ_1_1_0_2_69', 'Supply motor ON/OFF ', '1x0070', 'Digital IO', 'boolean', '', 0, '', '', '', '', '', '', '', '', '', '-1', 'r', 'exhausto_OJ_v610', 'OJ', 'exhausto_OJ_v610', '', '', '2_69_X_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}', NULL),
('2026-08-05 15:24:03', 'OJEXHAUST', 'V01', '360.001 Ventilasjon', 92, 0, 'norm', 'change', '', '', '', 0, 0, '1x0080', 545, 'NNNNN_OJEXHAUST_OJ_1_1_0_2_79', 'Extract motor ON/OFF (only with OJ-FC) ', '1x0080', 'Digital IO', 'boolean', '', 0, '', '', '', '', '', '', '', '', '', '-1', 'r', 'exhausto_OJ_v610', 'OJ', 'exhausto_OJ_v610', '', '', '2_79_X_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}', NULL),
('2026-08-05 15:24:03', 'OJEXHAUST', 'V01', '360.001 Ventilasjon', 63, 0, 'norm', 'change', '', 'B', '', 0, 0, '1x0041', 516, 'NNNNN_OJEXHAUST_OJ_1_1_0_2_40', 'Filter alarm for supply filter (pressure drop above set limit)', '1x0041', 'Digital IO', 'boolean', '', 0, '', '', '', '', '', '', '', '', '', '-1', 'r', 'exhausto_OJ_v610', 'OJ', 'exhausto_OJ_v610', '', '', '2_40_X_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"Normal"},"1":{"t":"Alarms Active"}}}', 1),
('2026-08-05 15:24:03', 'OJEXHAUST', 'V01', '360.001 Ventilasjon', 311, 0, 'norm', 'change', '', 'B', '', 0, 0, '1x0512', 764, 'NNNNN_OJEXHAUST_OJ_1_1_0_2_511', 'Common Alarm - cooling', '1x0512', 'Digital IO', 'boolean', '', 0, '', '', '', '', '', '', '', '', '', '-1', 'r', 'exhausto_OJ_v610', 'OJ', 'exhausto_OJ_v610', '', '', '2_511_X_N_-_-_-_-', '{"rev":"1","type":"num","v":{"0":{"t":"Normal"},"1":{"t":"Alarms Active"}}}', 1),
('2026-08-05 15:24:03', 'AK3', '000:011', 'K11 6-Plan', 80, 0, 'slow', 'change', '', '', '', 0, 0, '0_117_r12_main_switch', 1804, 'NNNNN_AK3_AKC_0_11_0_0_117', 'r12 Main switch', '', 'Overview', 'word', '', 0, '', '', '-1', '1', '', '', '', '', '', '1', 'rw', 'da3_084b4081_021x', 'AKC', '084B4081_021X', '', '{"node":"11","nodetype":"16"}', '', '{\n    "rev": "1",\n    "type": "num",\n    "v": {\n        "-1": {\n            "t": "Manual",\n            "bc": "transparent",\n            "tc": "black"\n        },\n        "0": {\n            "t": "Stop",\n            "bc": "transparent",\n            "tc": "black"\n        },\n        "1": {\n            "t": "Start",\n            "bc": "transparent",\n            "tc": "black"\n        }\n    }\n}', NULL),
('2026-08-05 15:24:03', 'EM270', 'E01', 'Energi kjøl/frys', 148, 0, 'norm', 'min', '1', '', '', 0, 0, 'norm_0_3_0', 1743, 'NNNNN_EM270_EM270_0_105_0_3_0', 'V L1-N', '', 'Analog values', 'float', '', 0, 'V', '%.1f', '', '', '1', '0', '1000', '0', '100', '-1', 'r', 'cge_em270', 'EM270', 'EM270', '', '', '3_0_I32_N_-_-_-_-', '', NULL);
