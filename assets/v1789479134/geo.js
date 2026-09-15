(function (global) {
  'use strict';

  /* 大圆弧（great-circle）插值：两机场坐标间生成弧线坐标点，
     供 Leaflet Polyline 画曲线。采用球面 slerp（球面线性插值），
     并加一个与航程成正比的高度偏移，让长航线在墨卡托图上呈现
     明显的弧形（视觉上的"曲线"），避免两点间生硬直线。 */

  var R2D = 180 / Math.PI;
  var D2R = Math.PI / 180;

  function toVec(latDeg, lonDeg) {
    var lat = latDeg * D2R, lon = lonDeg * D2R;
    return [
      Math.cos(lat) * Math.cos(lon),
      Math.cos(lat) * Math.sin(lon),
      Math.sin(lat)
    ];
  }

  function toLatLon(v) {
    var lat = Math.atan2(v[2], Math.sqrt(v[0] * v[0] + v[1] * v[1]));
    var lon = Math.atan2(v[1], v[0]);
    return [lat * R2D, lon * R2D];
  }

  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  function norm3(v) {
    var m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
    return [v[0] / m, v[1] / m, v[2] / m];
  }

  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  /* 角距离（弧度） */
  function angle(a, b) {
    var d = Math.min(1, Math.max(-1, dot(a, b)));
    return Math.acos(d);
  }

  /*
   * arcPoints(from, to, opts)
   *   from/to: {lat, lon}
   *   opts.points: 插值点数（默认 64）
   *   opts.arcFactor: 弧顶偏移系数（默认 0.18，相对航程的纬向抬升）
   * 返回 [[lat, lon], ...]（Leaflet Polyline 可直接使用）
   */
  function arcPoints(from, to, opts) {
    opts = opts || {};
    var n = opts.points || 64;
    var a = toVec(from.lat, from.lon);
    var b = toVec(to.lat, to.lon);
    var theta = angle(a, b);
    if (theta < 1e-6) return [[from.lat, from.lon], [to.lat, to.lon]];

    /* 弧顶法向量：垂直于航线的球面方向，用于抬高弧线 */
    var axis = norm3(cross(a, b));
    var lift = (opts.arcFactor === undefined ? 0.18 : opts.arcFactor) * theta;

    var pts = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      /* slerp */
      var sa = Math.sin((1 - t) * theta) / Math.sin(theta);
      var sb = Math.sin(t * theta) / Math.sin(theta);
      var v = [
        sa * a[0] + sb * b[0],
        sa * a[1] + sb * b[1],
        sa * a[2] + sb * b[2]
      ];
      /* 沿法向抬升：让弧线中段偏离大圆 */
      if (lift > 0) {
        var k = lift * Math.sin(Math.PI * t); /* 中段最大 */
        v = [
          v[0] + k * axis[0],
          v[1] + k * axis[1],
          v[2] + k * axis[2]
        ];
      }
      pts.push(toLatLon(v));
    }
    return pts;
  }

  global.geo = { arcPoints: arcPoints };
})(window);
