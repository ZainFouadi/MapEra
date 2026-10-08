// Decodes the game's TopoJSON (map.getMapData -> map) into SVG paths matched to regions.
const TopoMap = {
  info: '',
  build(topo, regions) {
    const [sx, sy] = topo.transform?.scale || [1, 1], [tx, ty] = topo.transform?.translate || [0, 0];
    // arcs are delta-encoded: accumulate, then apply the transform
    const arcs = topo.arcs.map((a) => { let x = 0, y = 0; return a.map((p) => { x += p[0]; y += p[1]; return [x * sx + tx, y * sy + ty]; }); });
    const ring = (idx) => {
      const pts = [];
      idx.forEach((i) => { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]); });
      return pts;
    };
    const geoms = [], walk = (o) => (o.type === 'GeometryCollection' ? o.geometries.forEach(walk) : geoms.push(o));
    Object.values(topo.objects || {}).forEach(walk);
    const byKey = {};
    Object.values(regions).forEach((r) => { byKey[r._id] = r._id; if (r.code) byKey[r.code] = r._id; });

    const items = geoms.map((g) => {
      const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
      const rings = polys.flatMap((p) => p.map(ring));
      const id = [g.id, ...Object.values(g.properties || {})].map((c) => byKey[c]).find(Boolean) || null;
      return { id, rings, g };
    });
    const matched = items.filter((i) => i.id);
    TopoMap.info = `objects: ${Object.keys(topo.objects || {}).join(',')} | geometries: ${geoms.length} | matched: ${matched.length}/${Object.keys(regions).length} | first geometry: ${JSON.stringify({ ...geoms[0], arcs: '...' })}`;
    if (matched.length < Object.keys(regions).length * 0.5) throw new Error('map shapes do not match regions (see Diagnose)');

    // detect vertical orientation by correlating polygon centers with region latitude
    const ext = (rs) => { let a = [Infinity, Infinity, -Infinity, -Infinity]; rs.forEach((r) => r.forEach(([x, y]) => { a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)]; })); return a; };
    let corr = 0, my = 0, ml = 0;
    matched.forEach((i) => { const b = ext(i.rings); i.cy0 = (b[1] + b[3]) / 2; my += i.cy0; ml += regions[i.id].position?.[1] || 0; });
    my /= matched.length; ml /= matched.length;
    matched.forEach((i) => (corr += (i.cy0 - my) * ((regions[i.id].position?.[1] || 0) - ml)));
    const f = corr > 0 ? -1 : 1; // north-up data needs flipping for SVG
    TopoMap.info += ` | flipY: ${f === -1}`;

    const all = [];
    const out = items.map((i) => {
      const rings = i.rings.map((r) => r.map(([x, y]) => [x, y * f]));
      all.push(...rings);
      const b = ext(rings);
      const d = rings.map((r) => 'M' + r.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z').join('');
      return { id: i.id, d, cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2 };
    });
    return { items: out, bbox: ext(all) };
  },
};
