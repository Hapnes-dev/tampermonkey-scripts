 Structure iw_sys_plant_config

 <dx_config>
  <dx_unit unit_id="V01">
    <ts_line name="TS1 Kjøl" offset="0" />
    <ts_line name="TS2 Kjøl med etterfølgende Frys" offset="1" />
    <rtc use="1"/>
 </dx_unit>
 </dx_config>


  <dx_config>
  <dx_unit unit_id="N20">
    <ts_line name="TS1 Avriming Kjol med etterfolgende Frys" offset="0" />
    <ts_line name="TS2 Avriming Kun kjol" offset="1" />
    <rtc use="1"/>
 </dx_unit>
 <dx_unit unit_id="N30">
    <ts_line name="TS3 Ur for lys i kjol og frys " offset="2" />
    <rtc use="1"/>
 </dx_unit>
 </dx_config>



 
REPLACE INTO `iw_sys_plant_config` (`row_date`, `setting`, `owner`, `value`, `help_text`, `help_link`) VALUES
('2012-04-12 11:58:09', 'dx_config', 'JC', '', '', '');
