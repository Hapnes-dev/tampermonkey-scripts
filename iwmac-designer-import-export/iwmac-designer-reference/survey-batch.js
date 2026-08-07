// Survey a batch of plants: panel lists + per-panel stats. Read-only GETs.
// Usage: playwright-cli run-code --filename=survey-batch.js  (edit PLANTS per batch)
async page => {
  const PLANTS = __PLANTS__;
  return await page.evaluate(async (plants) => {
    const base = '/iwmac_designer_v4/';
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    async function getText(url) {
      const r = await fetch(base + url, { credentials: 'same-origin' });
      return await r.text();
    }
    async function getJson(url) {
      const t = await getText(url);
      try { return JSON.parse(t); } catch (e) { return null; }
    }
    const out = {};
    for (const pid of plants) {
      const plant = { panels: [], error: null };
      try {
        const list = await getJson('designer_site/V3_objectHandler.php?function=V3get_plant_designer_panels&plant_id=' + pid);
        if (!Array.isArray(list)) { plant.error = 'no panel list'; out[pid] = plant; continue; }
        for (const p of list) {
          const rec = { name: p.panel_name, id: p.id, visible: p.visible, image_name: p.image_name || '' };
          try {
            const doc = await getJson('iw_load_ctrls.php?cust_id=' + pid + '&format=json&name=' + encodeURIComponent(p.panel_name));
            if (doc && doc.panel_name !== undefined) {
              const so = doc.single_objects || [], co = doc.containers || [], gr = doc.graphics || [];
              rec.w = doc.panel_width; rec.h = doc.panel_height;
              rec.org_image = doc.org_image_name || '';
              rec.n_obj = so.length; rec.n_cont = co.length; rec.n_graph = gr.length;
              // linked = driver_id looks real (not placeholder)
              let linked = 0, v2 = 0, maxx = 0, maxy = 0;
              const census = {};
              const allItems = so.concat(co.flatMap(c => c.items || []));
              for (const o of allItems) {
                const d = o.driver_id || '';
                if (d && d !== 'driver_id' && !d.startsWith('#')) linked++;
                const t = o.obj_id || '';
                census[t] = (census[t] || 0) + 1;
                if (/^V2_|\.gif$|^number[0-9]|_small$/.test(t)) v2++;
                const x = (parseInt(o.posLeft) || 0) + (parseInt(o.posWidth) || 0);
                const y = (parseInt(o.posTop) || 0) + (parseInt(o.posHeight) || 0);
                if (x > maxx) maxx = x; if (y > maxy) maxy = y;
              }
              rec.n_items_total = allItems.length;
              rec.n_linked = linked; rec.n_v2 = v2;
              rec.max_x = maxx; rec.max_y = maxy;
              rec.census = census;
              // background present?
              const img = await getText('iw_load_ctrls.php?cust_id=' + pid + '&format=image_data&name=' + encodeURIComponent(p.panel_name));
              rec.has_bg = img.startsWith('data:image');
              rec.bg_kb = rec.has_bg ? Math.round(img.length * 3 / 4 / 1024) : 0;
            } else {
              // JSON store empty — probe XML store
              const xml = await getText('iw_load_ctrls.php?cust_id=' + pid + '&name=' + encodeURIComponent(p.panel_name));
              const n = (xml.match(/<data[\s>]/g) || []).length;
              rec.xml_only = true; rec.n_obj = n;
              rec.separator = n === 0;
            }
          } catch (e) { rec.fetch_error = String(e).slice(0, 120); }
          plant.panels.push(rec);
          await sleep(120);
        }
      } catch (e) { plant.error = String(e).slice(0, 200); }
      out[pid] = plant;
      await sleep(250);
    }
    return JSON.stringify(out);
  }, PLANTS);
}
