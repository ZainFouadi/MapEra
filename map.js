// Decodes the game's TopoJSON into SVG paths matched to regions (by id/code, or by position as fallback).
const TopoMap = {
  info: '',
  build(topo, regions) {
    const [sx, sy] = topo.transform?.scale || [1, 1], [tx, ty] = topo.transform?.translate || [0, 0];
    // arcs are delta-encoded: accumulate, then apply the transform
    const arcs = topo.arcs.map((a) => { let x = 0, y = 0; return a.map((p) => { x += p[0]; y += p[1]; return [x * sx + tx, y * sy + ty]; }); });
    const ring = (idx) => { const pts = []; idx.forEach((i) => { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]); }); return pts; };
    const ext = (rs) => { let a = [Infinity, Infinity, -Infinity, -Infinity]; rs.forEach((r) => r.forEach(([x, y]) => { a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)]; })); return a; };
    const inside = (rings, x, y) => { let c = false; rings.forEach((r) => { for (let a = 0, b = r.length - 1; a < r.length; b = a++) { const [xa, ya] = r[a], [xb, yb] = r[b]; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c; } }); return c; };

    const geoms = [], walk = (o) => (o.type === 'GeometryCollection' ? o.geometries.forEach(walk) : geoms.push(o));
    Object.values(topo.objects || {}).forEach(walk);
    const items = geoms.map((g) => {
      const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [], used = [];
      const rings = polys.flatMap((p) => p.map((r) => { r.forEach((i) => used.push(i < 0 ? ~i : i)); return ring(r); }));
      return { g, rings, used, bb: ext(rings), id: null };
    });
    const regs = Object.values(regions), n = regs.length;
    let how = 'id', f = 0;

    // 1) match by id / code stored in the geometry
    const byKey = {}; regs.forEach((r) => { byKey[r._id] = r._id; if (r.code) byKey[String(r.code).toLowerCase()] = r._id; });
    items.forEach((i) => { i.id = [i.g.id, ...Object.values(i.g.properties || {})].map((c) => byKey[String(c).toLowerCase()]).find(Boolean) || null; });
    let matched = items.filter((i) => i.id).length;

    // 2) fallback: region city position inside the polygon (tries a few y projections)
    if (matched < n * 0.5) {
      how = 'position';
      const merc = (l) => (Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360)) * 180) / Math.PI;
      const ys = [(l) => l, merc, (l) => -l, (l) => -merc(l)];
      const withPos = regs.filter((r) => r.position);
      const hit = (px, py) => items.find((i) => i.bb[0] <= px && px <= i.bb[2] && i.bb[1] <= py && py <= i.bb[3] && inside(i.rings, px, py));
      const sample = withPos.filter((_, k) => k % Math.max(1, Math.floor(withPos.length / 200)) === 0);
      let best = 0, bestN = -1;
      ys.forEach((fy, k) => { const c = sample.filter((r) => hit(r.position[0], fy(r.position[1]))).length; if (c > bestN) { bestN = c; best = k; } });
      items.forEach((i) => (i.id = null));
      withPos.forEach((r) => { const h = hit(r.position[0], ys[best](r.position[1])); if (h && !h.id) h.id = r._id; });
      matched = items.filter((i) => i.id).length;
      f = best < 2 ? -1 : 1; // data y is north-up (best<2) -> flip for SVG
      how += ` (y-variant ${best})`;
    }
    TopoMap.info += `[${how}] geometries: ${geoms.length}, matched: ${matched}/${n}, first geometry: ${JSON.stringify({ ...geoms[0], arcs: '...' })}; `;
    if (matched < n * 0.5) throw new Error(`only ${matched}/${n} regions matched`);

    if (!f) { // id mode: detect orientation by correlating polygon centers with latitude
      let my = 0, ml = 0, corr = 0; const m = items.filter((i) => i.id && regions[i.id].position);
      m.forEach((i) => { i.cy0 = (i.bb[1] + i.bb[3]) / 2; my += i.cy0; ml += regions[i.id].position[1]; });
      my /= m.length; ml /= m.length;
      m.forEach((i) => (corr += (i.cy0 - my) * (regions[i.id].position[1] - ml)));
      f = corr > 0 ? -1 : 1;
    }

    const line = (a) => 'M' + arcs[a].map((p) => p[0].toFixed(1) + ',' + (p[1] * f).toFixed(1)).join('L');
    const all = [], out = items.map((i) => {
      const rings = i.rings.map((r) => r.map(([x, y]) => [x, y * f]));
      all.push(...rings); const b = ext(rings);
      return { id: i.id, d: rings.map((r) => 'M' + r.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z').join(''), cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2 };
    });
    // country borders = arcs shared by two regions with different owners; coast = arcs used once
    const use = {}; items.forEach((i, k) => new Set(i.used).forEach((a) => (use[a] = use[a] || []).push(k)));
    let border = '', coast = '';
    Object.entries(use).forEach(([a, ks]) => {
      if (ks.length === 1) coast += line(a);
      else if (ks.length === 2) { const o1 = regions[items[ks[0]].id]?.country, o2 = regions[items[ks[1]].id]?.country; if (o1 && o2 && o1 !== o2) border += line(a); }
    });
    return { items: out, bbox: ext(all), border, coast };
  },
};
