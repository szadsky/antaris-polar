# Edificios de las bases — integración GeoJSON

- Se extrajeron los 13 GeoJSON aportados por el usuario. Cada base carga exclusivamente sus propios contornos.
- Datos: Australian Antarctic Data Centre, Our Footprint on Antarctica, CC BY 4.0, https://doi.org/10.26179/5dc8db48eb58e. Datos históricos principalmente 2005–2017, actualización 2019. El campo status_code se conserva sin atribuirle un significado no documentado.
- `node scripts/prepare-base-buildings.mjs` proyecta WGS84 a EPSG:3031 con la definición y proj4 ya existentes en pipeline/rema. La comprobación contra el punto de control del terreno de Brown difiere 0,0043 m por redondeo de los metadatos. No es una comprobación independiente de exactitud de los contornos.
- En el navegador se reutiliza `projectedToTerrain` tanto en el marcador existente como en los edificios: col=(X-originX)/cell-0.5; row=(originY-Y)/cell-0.5; x=col*cell-widthM/2; z=row*cell-depthM/2. No se rota ni reescala el GeoJSON manualmente.
- Y se interpola en heightsM del terreno cargado, que ya está expresado respecto de heights.minM. No se vuelve a restar el geoide ni se usa el mar como altura del edificio. Se omiten polígonos con muestras NoData o fuera de cobertura. La diferencia histórica de los datos y la resolución REMA limitan la precisión de apoyo.
- Los volúmenes 3D son la vista inicial. Los contornos opcionales se remuestrean cada metro con un desplazamiento visual de 0,25 m para evitar z-fighting. Se regeneran al sustituir la grilla 8 m por 4 m; no cambia el generador ni los LOD.
- Volúmenes: ExtrudeGeometry, paredes por defecto 3 m (configurables 1–12 m), azotea estilizada biselada. Base horizontal superior según el máximo del perímetro y paredes extendidas hasta la muestra mínima; no se modifica el terreno. Alturas, cimientos y techos son aproximaciones gráficas. No representan arquitectura relevada.
- Datos de edificios se cargan únicamente para la base activa. Materiales compartidos; geometrías liberadas al cambiar modo o grilla. No hay trabajo de edificios por fotograma ni proj4 añadido al navegador.
- Validación: `node exploraciones/terreno-estilizado/scripts/check-brown-buildings.mjs`; compilación TypeScript/Vite; inspección local de contornos y volúmenes (12/12 con cobertura, sin errores de consola).
- Abrir http://127.0.0.1:3400/?base=brown y usar Edificios · Brown → Acercar a edificios. La confirmación visual no garantiza coincidencia histórica con edificaciones actuales.

## Extensión a las 13 bases

`node scripts/prepare-base-buildings.mjs` genera un archivo buildings.json separado por base. Se usan los 13 GeoJSON correspondientes por nombre (guiones del visor se corresponden con guiones bajos del ZIP). Son 449 polígonos en total; 18 tienen al menos un vértice fuera de los recortes REMA y se omiten cuando no hay cobertura completa. La carga valida baseId y obtiene únicamente el archivo de la base activa. El enfoque prioriza edificios a menos de 500 m del marcador para que refugios alejados no alejen la cámara. Las alturas y techos siguen siendo aproximados.
