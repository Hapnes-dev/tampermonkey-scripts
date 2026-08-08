// Survey the initial MENY ventilation batch with paced, read-only requests.
// Usage: playwright-cli run-code --filename=ventilation-survey-20.js
async page => {
  const PLANTS = [
    {"id":"8001","name":"MENY Rona"},
    {"id":"8002","name":"MENY Bekkestua"},
    {"id":"8016","name":"MENY Støletorget"},
    {"id":"8045","name":"MENY Nanset"},
    {"id":"8049","name":"MENY Osloveien Hønefoss"},
    {"id":"8075","name":"Meny GS"},
    {"id":"8076","name":"MENY Slependen"},
    {"id":"8088","name":"MENY Romeriksenteret"},
    {"id":"8098","name":"MENY Stortorvet"},
    {"id":"8124","name":"MENY Alna"},
    {"id":"8132","name":"MENY Rasta"},
    {"id":"8146","name":"MENY Høvik"},
    {"id":"8150","name":"MENY Stovner"},
    {"id":"8158","name":"Meny Trekanten"},
    {"id":"8205","name":"MENY Brakerøya"},
    {"id":"8214","name":"MENY Langhus"},
    {"id":"8232","name":"MENY Askim"},
    {"id":"8239","name":"MENY Vollebekk"},
    {"id":"8272","name":"MENY Åssiden"},
    {"id":"8289","name":"MENY Fantoft"}
  ];

  return await page.evaluate(async plants => {
    const base = '/iwmac_designer_v4/';
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const unitIdKeys = ['unit_id', 'id', 'unit_ref'];
    const unitNameKeys = ['unit_name', 'name', 'alias_text', 'aliastext'];
    const legacyNameTypeKeys = [
      'name', 'obj_id', 'object_name', 'iw_name', 'type', 'obj_type'
    ];
    const v2Pattern = /^V2_|\.gif$|^number[0-9]|_small$/;

    function sanitizedError(error, limit = 200) {
      const value = error instanceof Error ? error.message : String(error);
      const compact = value
        .replace(/https?:\/\/\S+/gi, '[url]')
        .replace(
          /\b(authorization|cookie|token|session(?:id)?)\b\s*[:=]\s*[^\s,;]+/gi,
          '$1=[redacted]'
        )
        .replace(/\s+/g, ' ')
        .trim();
      return (compact || 'unknown error').slice(0, limit);
    }

    async function getText(relativeUrl) {
      const response = await fetch(base + relativeUrl, {
        credentials: 'same-origin'
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    }

    async function getJson(relativeUrl) {
      const payloadText = await getText(relativeUrl);
      try {
        return JSON.parse(payloadText);
      } catch (error) {
        return null;
      }
    }

    function scalarText(value) {
      if (
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) {
        return null;
      }
      const text = String(value).trim();
      return text ? text : null;
    }

    function objectScalar(object, candidates) {
      const entries = Object.entries(object);
      for (const candidate of candidates) {
        const entry = entries.find(
          ([key]) => key.toLocaleLowerCase('en-US') === candidate
        );
        if (!entry) continue;
        const value = scalarText(entry[1]);
        if (value !== null) return value;
      }
      return null;
    }

    function nodeName(element) {
      return String(element.localName || element.nodeName || '')
        .toLocaleLowerCase('en-US');
    }

    function descendantText(element, candidates) {
      const descendants = Array.from(element.getElementsByTagName('*'));
      for (const candidate of candidates) {
        const match = descendants.find(item => nodeName(item) === candidate);
        if (!match) continue;
        const value = scalarText(match.textContent);
        if (value !== null) return value;
      }
      return null;
    }

    function attributeText(element, candidates) {
      const attributes = Array.from(element.attributes || []);
      for (const candidate of candidates) {
        const match = attributes.find(
          attribute => attribute.name.toLocaleLowerCase('en-US') === candidate
        );
        if (!match) continue;
        const value = scalarText(match.value);
        if (value !== null) return value;
      }
      return null;
    }

    function parseMarkup(payloadText) {
      const parser = new DOMParser();
      const xmlDocument = parser.parseFromString(payloadText, 'application/xml');
      if (!xmlDocument.querySelector('parsererror')) return xmlDocument;
      return parser.parseFromString(payloadText, 'text/html');
    }

    function parseUnits(payloadText) {
      const rows = [];
      let sourceFormat = 'json';

      const addRow = (unitIdValue, unitNameValue) => {
        const unitId = scalarText(unitIdValue);
        const unitName = scalarText(unitNameValue);
        if (unitId === null || unitName === null) return;
        rows.push({unit_id: unitId, unit_name: unitName});
      };

      try {
        const parsed = JSON.parse(payloadText);
        const walk = value => {
          if (Array.isArray(value)) {
            value.forEach(walk);
            return;
          }
          if (!value || typeof value !== 'object') return;
          addRow(
            objectScalar(value, unitIdKeys),
            objectScalar(value, unitNameKeys)
          );
          Object.values(value).forEach(walk);
        };
        walk(parsed);
      } catch (error) {
        sourceFormat = 'xml';
        const documentNode = parseMarkup(payloadText);
        const candidates = Array.from(documentNode.getElementsByTagName('*'))
          .filter(element => ['unit', 'data', 'option'].includes(nodeName(element)));

        for (const element of candidates) {
          let unitId;
          let unitName;
          if (nodeName(element) === 'option') {
            unitId = attributeText(element, ['value']);
            unitName = scalarText(element.textContent);
          } else {
            unitId = descendantText(element, unitIdKeys);
            unitName = descendantText(element, unitNameKeys);
            if (unitId === null) unitId = attributeText(element, unitIdKeys);
            if (unitName === null) unitName = attributeText(element, unitNameKeys);
          }
          addRow(unitId, unitName);
        }
      }

      const uniqueRows = [];
      const seen = new Set();
      for (const row of rows) {
        const key = `${row.unit_id}\u0000${row.unit_name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueRows.push(row);
      }

      return {
        source_format: sourceFormat,
        rows: uniqueRows,
        error: payloadText.trim() && uniqueRows.length === 0
          ? 'unit payload parsed zero rows'
          : null
      };
    }

    function realDriverId(value) {
      const driverId = scalarText(value);
      return driverId !== null && driverId !== 'driver_id' && !driverId.startsWith('#');
    }

    function realUnitId(value) {
      const unitId = scalarText(value);
      if (unitId === null || unitId.startsWith('#')) return null;
      if (['unit_id', 'undefined', 'null'].includes(unitId.toLocaleLowerCase('en-US'))) {
        return null;
      }
      return unitId;
    }

    function joinedUnitNames(unitIds, unitRows) {
      const names = [];
      const seen = new Set();
      for (const unitId of unitIds) {
        for (const row of unitRows) {
          if (row.unit_id !== unitId || seen.has(row.unit_name)) continue;
          seen.add(row.unit_name);
          names.push(row.unit_name);
        }
      }
      return names;
    }

    function legacyValue(element, candidate) {
      const descendant = descendantText(element, [candidate]);
      return descendant === null ? attributeText(element, [candidate]) : descendant;
    }

    function parseLegacyPanel(payloadText) {
      const documentNode = parseMarkup(payloadText);
      const dataNodes = Array.from(documentNode.getElementsByTagName('*'))
        .filter(element => nodeName(element) === 'data');
      const unitIds = new Set();
      let v2Objects = 0;
      for (const dataNode of dataNodes) {
        const isV2 = legacyNameTypeKeys.some(candidate => {
          const value = legacyValue(dataNode, candidate);
          return value !== null && v2Pattern.test(value);
        });
        if (isV2) v2Objects += 1;
        const unitId = realUnitId(legacyValue(dataNode, 'unit_id'));
        if (unitId !== null) unitIds.add(unitId);
      }
      return {
        objects: dataNodes.length,
        v2_objects: v2Objects,
        unit_ids: Array.from(unitIds).sort()
      };
    }

    const result = {
      survey_date: '2026-08-08',
      fleet: 'MENY Norway — initial 20-plant batch',
      method: 'authenticated read-only GET panel list + unit XML + panel JSON/image/XML fallback',
      batch: {requested: 20, plant_ids: plants.map(plant => plant.id)},
      plants: {}
    };

    for (const plantSpec of plants) {
      const plant = {
        name: plantSpec.name,
        error: null,
        unit_error: null,
        units: [],
        panels: []
      };

      try {
        const unitPayload = await getText(
          'iw_load_units.php?cust_id=' + encodeURIComponent(plantSpec.id) + '&driverId='
        );
        const parsedUnits = parseUnits(unitPayload);
        plant.units = parsedUnits.rows;
        plant.unit_error = parsedUnits.error;
      } catch (error) {
        plant.unit_error = sanitizedError(error);
      }

      try {
        const panelList = await getJson(
          'designer_site/V3_objectHandler.php?function=V3get_plant_designer_panels&plant_id=' +
          encodeURIComponent(plantSpec.id)
        );
        if (!Array.isArray(panelList)) {
          plant.error = 'no panel list';
        } else {
          for (const panel of panelList) {
            const record = {
              name: panel.panel_name,
              id: panel.id,
              visible: panel.visible,
              image_name: panel.image_name || '',
              source_format: null,
              unit_ids: [],
              unit_names: [],
              fetch_error: null
            };

            try {
              const panelName = encodeURIComponent(panel.panel_name);
              const documentData = await getJson(
                'iw_load_ctrls.php?cust_id=' + encodeURIComponent(plantSpec.id) +
                '&format=json&name=' + panelName
              );

              if (documentData && documentData.panel_name !== undefined) {
                const singleObjects = Array.isArray(documentData.single_objects)
                  ? documentData.single_objects
                  : [];
                const containers = Array.isArray(documentData.containers)
                  ? documentData.containers
                  : [];
                const graphics = Array.isArray(documentData.graphics)
                  ? documentData.graphics
                  : [];
                const containerItems = containers.flatMap(container =>
                  Array.isArray(container.items) ? container.items : []
                );
                const allItems = singleObjects.concat(containerItems);
                const census = {};
                const unitIds = new Set();
                let linked = 0;
                let v2Objects = 0;
                let maxX = 0;
                let maxY = 0;

                for (const object of allItems) {
                  if (realDriverId(object.driver_id)) linked += 1;
                  const objectType = scalarText(object.obj_id) || '';
                  census[objectType] = (census[objectType] || 0) + 1;
                  if (v2Pattern.test(objectType)) v2Objects += 1;
                  const unitId = realUnitId(object.unit_id);
                  if (unitId !== null) unitIds.add(unitId);
                  const right = (parseInt(object.posLeft) || 0) +
                    (parseInt(object.posWidth) || 0);
                  const bottom = (parseInt(object.posTop) || 0) +
                    (parseInt(object.posHeight) || 0);
                  if (right > maxX) maxX = right;
                  if (bottom > maxY) maxY = bottom;
                }

                record.source_format = 'json';
                record.w = documentData.panel_width;
                record.h = documentData.panel_height;
                record.org_image = documentData.org_image_name || '';
                record.n_obj = singleObjects.length;
                record.n_cont = containers.length;
                record.n_graph = graphics.length;
                record.n_items_total = allItems.length;
                record.n_linked = linked;
                record.n_v2 = v2Objects;
                record.max_x = maxX;
                record.max_y = maxY;
                record.census = census;
                record.unit_ids = Array.from(unitIds).sort();
                record.unit_names = joinedUnitNames(record.unit_ids, plant.units);

                const background = await getText(
                  'iw_load_ctrls.php?cust_id=' + encodeURIComponent(plantSpec.id) +
                  '&format=image_data&name=' + panelName
                );
                record.has_bg = background.startsWith('data:image');
                record.bg_kb = record.has_bg
                  ? Math.round(background.length * 3 / 4 / 1024)
                  : 0;
              } else {
                const legacyPayload = await getText(
                  'iw_load_ctrls.php?cust_id=' + encodeURIComponent(plantSpec.id) +
                  '&name=' + panelName
                );
                const legacy = parseLegacyPanel(legacyPayload);
                record.source_format = 'xml_only';
                record.n_obj = legacy.objects;
                record.n_v2 = legacy.v2_objects;
                record.separator = legacy.objects === 0;
                record.unit_ids = legacy.unit_ids;
                record.unit_names = joinedUnitNames(record.unit_ids, plant.units);
              }
            } catch (error) {
              record.fetch_error = sanitizedError(error, 120);
            }

            plant.panels.push(record);
            await sleep(120);
          }
        }
      } catch (error) {
        plant.error = sanitizedError(error);
      }

      result.plants[plantSpec.id] = plant;
      await sleep(250);
    }

    return JSON.stringify(result);
  }, PLANTS);
}
