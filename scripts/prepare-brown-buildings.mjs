import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {EPSG3031} from '../pipeline/rema/config.mjs';
const require=createRequire(new URL('../pipeline/rema/package.json',import.meta.url));
const proj4=require('proj4');
const project=proj4('EPSG:4326',EPSG3031);
const data=JSON.parse(await fs.readFile(new URL('../data/buildings/base_brown.geojson',import.meta.url),'utf8'));
if(data.type!=='FeatureCollection')throw Error('Invalid GeoJSON');
const buildings=[];
for(const [index,f] of data.features.entries()){
 const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
 for(const [part,rings] of polygons.entries())buildings.push({id:`brown-${index+1}-${part+1}`,properties:f.properties,rings:rings.map(r=>r.map(p=>project.forward(p.slice(0,2))))});
}
const meta=JSON.parse(await fs.readFile(new URL('../exploraciones/terreno-nitidez/public/terreno/brown/terreno.json',import.meta.url),'utf8'));
const control=project.forward([meta.base.lon,meta.base.lat]);
if(Math.hypot(control[0]-meta.base.projected[0],control[1]-meta.base.projected[1])>.02)throw Error('Projection differs from REMA control point');
await fs.writeFile(new URL('../exploraciones/terreno-nitidez/public/terreno/brown/buildings.json',import.meta.url),JSON.stringify({crs:'EPSG:3031',metadata:data.metadata,buildings}));
console.log({buildings:buildings.length,controlErrorM:Math.hypot(control[0]-meta.base.projected[0],control[1]-meta.base.projected[1])});
