/* ============================================================
 * nav.js · 网格寻路（A*）+ 走廊自动开门
 * ------------------------------------------------------------
 * 每层的可走区域是固定的（geom 里的 walk / connectors），
 * 这里把它切成 0.2 m 的格子，用 A* 找路，再做一次「拉直」
 * （直线可达就把中间点删掉），这样走起来不会一格一格地抖。
 * ============================================================ */
"use strict";

var Nav = (function () {
  var G = null;
  var grid = null;
  var CELL = 0.2;
  var CLEAR_R = 0.10;       // 格心离墙至少这么远才算可走

  function build(geom) {
    G = geom;
    var x0 = geom.minX, y0 = geom.viewMinY;
    var cols = Math.ceil((geom.maxX - x0) / CELL);
    var rows = Math.ceil((geom.maxY - y0) / CELL);
    var walk = new Uint8Array(cols * rows);
    var doors = [];           // 每格：属于哪扇门（-1 无）
    doors.length = cols * rows;
    for (var i = 0; i < doors.length; i++) doors[i] = -1;

    var doorRects = [geom.stairDoorA.rect, geom.stairDoorB.rect];

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var x = x0 + (c + 0.5) * CELL;
        var y = y0 + (r + 0.5) * CELL;
        var ok = false;
        for (var k = 0; k < geom.walk.length; k++) {
          if (Geom.inRect(geom.walk[k], x, y, 0)) { ok = true; break; }
        }
        /* 门洞很窄（0.3m），格子要往外放宽半格，否则连不上 */
        if (!ok) {
          for (var k2 = 0; k2 < geom.connectors.length; k2++) {
            if (Geom.inRect(geom.connectors[k2], x, y, -0.11)) { ok = true; break; }
          }
        }
        if (!ok) continue;
        /* 离墙太近就砍掉（门洞除外） */
        var hitWall = false;
        for (var w2 = 0; w2 < geom.walls.length; w2++) {
          if (Geom.circleRect(x, y, CLEAR_R, geom.walls[w2])) { hitWall = true; break; }
        }
        var doorId = -1;
        for (var d2 = 0; d2 < doorRects.length; d2++) {
          if (Geom.inRect(doorRects[d2], x, y, 0)) { doorId = d2; hitWall = false; break; }
        }
        if (hitWall) continue;
        var idx = r * cols + c;
        walk[idx] = 1;
        doors[idx] = doorId;
      }
    }

    grid = { x0: x0, y0: y0, cols: cols, rows: rows, walk: walk, doors: doors };
    return grid;
  }

  function idxOf(c, r) { return r * grid.cols + c; }
  function cellOf(x, y) {
    var c = Math.floor((x - grid.x0) / CELL);
    var r = Math.floor((y - grid.y0) / CELL);
    return { c: c, r: r };
  }
  function inGrid(c, r) { return c >= 0 && r >= 0 && c < grid.cols && r < grid.rows; }
  function walkAt(c, r) { return inGrid(c, r) && grid.walk[idxOf(c, r)] === 1; }
  function center(c, r) { return { x: grid.x0 + (c + 0.5) * CELL, y: grid.y0 + (r + 0.5) * CELL }; }
  function doorAt(c, r) { return inGrid(c, r) ? grid.doors[idxOf(c, r)] : -1; }

  /* 找一个离给定点最近的可走格 */
  function nearestCell(x, y) {
    var s = cellOf(x, y);
    if (walkAt(s.c, s.r)) return s;
    for (var rad = 1; rad <= 14; rad++) {
      for (var dx = -rad; dx <= rad; dx++) {
        for (var dy = -rad; dy <= rad; dy++) {
          if (Math.abs(dx) !== rad && Math.abs(dy) !== rad) continue;
          var c = s.c + dx, r = s.r + dy;
          if (walkAt(c, r)) return { c: c, r: r };
        }
      }
    }
    return null;
  }

  /* 两格之间的直线是否走得通（采样判断，忽略门开关） */
  function clearLine(ax, ay, bx, by) {
    var d = Math.hypot(bx - ax, by - ay);
    var n = Math.max(2, Math.ceil(d / (CELL * 0.6)));
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var p = cellOf(ax + (bx - ax) * t, ay + (by - ay) * t);
      if (!walkAt(p.c, p.r)) return false;
    }
    return true;
  }

  /* ---------- A* ---------- */

  function find(from, to) {
    if (!grid) return null;
    var s = nearestCell(from.x, from.y);
    var g = nearestCell(to.x, to.y);
    if (!s || !g) return null;

    var cols = grid.cols, rows = grid.rows;
    var total = cols * rows;
    var open = [];
    var gScore = new Float32Array(total).fill(Infinity);
    var fScore = new Float32Array(total).fill(Infinity);
    var came = new Int32Array(total).fill(-1);
    var closed = new Uint8Array(total);

    function h(c, r) {
      var dx = Math.abs(c - g.c), dy = Math.abs(r - g.r);
      return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
    }

    var startIdx = idxOf(s.c, s.r), goalIdx = idxOf(g.c, g.r);
    gScore[startIdx] = 0;
    fScore[startIdx] = h(s.c, s.r);
    open.push({ c: s.c, r: s.r, i: startIdx, f: fScore[startIdx] });

    var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    var guard = 0;
    while (open.length && guard++ < 20000) {
      /* 取 f 最小（格子数很少，线性扫足够快） */
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      var cur = open.splice(bi, 1)[0];
      if (cur.i === goalIdx) {
        var path = [];
        var ci = cur.i;
        while (ci !== -1) {
          var c = ci % cols, r = (ci - c) / cols;
          path.push(center(c, r));
          ci = came[ci];
        }
        path.reverse();
        return smooth(path, from, to);
      }
      if (closed[cur.i]) continue;
      closed[cur.i] = 1;
      for (var d = 0; d < DIRS.length; d++) {
        var nc = cur.c + DIRS[d][0], nr = cur.r + DIRS[d][1];
        if (!walkAt(nc, nr)) continue;
        /* 斜着走时不能切墙角 */
        if (DIRS[d][0] && DIRS[d][1]) {
          if (!walkAt(cur.c + DIRS[d][0], cur.r) || !walkAt(cur.c, cur.r + DIRS[d][1])) continue;
        }
        var ni = idxOf(nc, nr);
        if (closed[ni]) continue;
        var step = DIRS[d][0] && DIRS[d][1] ? 1.414 : 1;
        var ng = gScore[cur.i] + step;
        if (ng < gScore[ni]) {
          gScore[ni] = ng;
          came[ni] = cur.i;
          fScore[ni] = ng + h(nc, nr);
          open.push({ c: nc, r: nr, i: ni, f: fScore[ni] });
        }
      }
    }
    return null;
  }

  /* 拉直：能直连的点就删掉，避免一格一格拐 */
  function smooth(path, from, to) {
    if (!path.length) return path;
    path[0] = { x: from.x, y: from.y };
    path.push({ x: to.x, y: to.y });
    var out = [path[0]];
    var i = 0;
    while (i < path.length - 1) {
      var j = path.length - 1;
      for (; j > i + 1; j--) {
        if (clearLine(path[i].x, path[i].y, path[j].x, path[j].y)) break;
      }
      out.push(path[j]);
      i = j;
    }
    return out;
  }

  /* ---------- 沿路径走 ---------- */

  /**
   * 走一步。返回 true = 已到终点。
   * w: 世界接口（有 __move / dist / state / stairDoors / startStairs …）
   */
  function follow(w, a, dt, speed, opts) {
    opts = opts || {};
    if (!a.path || !a.path.length) return true;

    /* 自动开门：附近有扇关着的楼梯门就推开 */
    if (a.space === "floor") {
      for (var i = 0; i < 2; i++) {
        var L = i === 0 ? "A" : "B";
        var dr = L === "A" ? w.geom.stairDoorA.rect : w.geom.stairDoorB.rect;
        var cx = dr.x + dr.w / 2, cy = dr.y + dr.h / 2;
        if (Math.hypot(a.x - cx, a.y - cy) < 1.15) {
          var dd = w.state.stairDoors[a.floor][L];
          if (!dd.open) {
            dd.open = true; dd.closeTimer = 0;
            w.emitNoise(a.floor, cx, cy, w.cfg.DOOR.noise, "door");
          }
        }
      }
    }

    var t = a.path[0];
    var dx = t.x - a.x, dy = t.y - a.y;
    var d = Math.hypot(dx, dy);
    if (d < (opts.arrive || 0.2)) {
      a.path.shift();
      if (!a.path.length) return true;
      t = a.path[0];
      dx = t.x - a.x; dy = t.y - a.y; d = Math.hypot(dx, dy) || 1;
    }
    a.face = Math.atan2(dy, dx);
    w.__move(a, (dx / d) * speed * dt, (dy / d) * speed * dt, dt);
    return false;
  }

  /** 去某个点：需要时重算路径（0.8s 一次），然后沿路径走 */
  function goTo(w, a, tx, ty, dt, speed) {
    a.repathTimer = (a.repathTimer || 0) - dt;
    var stale = !a.dest || Math.hypot(a.dest.x - tx, a.dest.y - ty) > 0.55;
    if (stale || a.repathTimer <= 0 || !a.path) {
      a.dest = { x: tx, y: ty };
      a.path = find({ x: a.x, y: a.y }, { x: tx, y: ty });
      a.repathTimer = 0.8;
    }
    return follow(w, a, dt, speed, { arrive: 0.22 });
  }

  return {
    build: build, find: find, follow: follow, goTo: goTo,
    clearLine: clearLine, cellOf: cellOf, walkAt: walkAt,
    get grid() { return grid; },
    get cell() { return CELL; }
  };
})();
