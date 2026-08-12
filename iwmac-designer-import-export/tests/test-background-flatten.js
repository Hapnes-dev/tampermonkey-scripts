'use strict';

const assert = require('node:assert/strict');
const api = require('../IWMAC-Designer-Import-Export.user.js');

function run() {
  assert.deepEqual(api.parseCssColor('rgb(204, 204, 204)'), [204, 204, 204]);
  assert.deepEqual(api.parseCssColor('rgba(204, 204, 204, 1)'), [204, 204, 204]);
  assert.deepEqual(api.parseCssColor('#cccccc'), [204, 204, 204]);
  assert.deepEqual(api.parseCssColor('#ccc'), [204, 204, 204]);
  assert.deepEqual(api.parseCssColor(''), [255, 255, 255]);

  const opaque = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
  assert.equal(api.imageHasTransparency(opaque), false);

  const hole = new Uint8ClampedArray([0, 0, 0, 0, 205, 210, 215, 255]);
  assert.equal(api.imageHasTransparency(hole), true);

  const flat = api.flattenRgbaOnto(hole, [204, 204, 204]);
  assert.deepEqual(Array.from(flat.slice(0, 4)), [204, 204, 204, 255]);
  assert.deepEqual(Array.from(flat.slice(4, 8)), [205, 210, 215, 255]);

  const semi = new Uint8ClampedArray([0, 0, 0, 128]);
  const semiFlat = api.flattenRgbaOnto(semi, [204, 204, 204]);
  assert.equal(semiFlat[3], 255);
  assert.equal(semiFlat[0] > 100 && semiFlat[0] < 110, true, 'semi-transparent black over #ccc is grey, not black');

  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'IWMAC-Designer-Import-Export.user.js'),
    'utf8'
  );
  assert.match(source, /grabBackgroundFillColor/);
  assert.match(source, /flattenBackgroundForSave/);
  assert.match(source, /ctx\.fillStyle = fillCss/);
  assert.equal(source.includes("ctx.fillStyle = '#ffffff'"), false,
    'raster export must not hard-code white under transparent pixels');

  console.log('IWMAC background flatten tests passed');
}

run();
