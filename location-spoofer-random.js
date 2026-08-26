/*
 * iOS Location Spoofer + Random Jitter wrapper for Shadowrocket
 *
 * Upstream:
 * https://raw.githubusercontent.com/mekos2772/ios-location-spoofer/main/location-spoofer.js
 *
 * Extra arguments:
 *   random=true|false
 *   randomMin=1
 *   randomMax=3
 *   randomInterval=300
 *
 * randomInterval:
 *   > 0 = giữ cùng một điểm random trong N giây
 *   = 0 = random lại mỗi response /clls/wloc
 */

(function () {
  "use strict";

  var UPSTREAM_URL =
    "https://raw.githubusercontent.com/mekos2772/ios-location-spoofer/main/location-spoofer.js";

  var SOURCE_CACHE_KEY = "ios_location_spoofer_upstream_source_v1";
  var RANDOM_STATE_KEY = "ios_location_spoofer_random_state_v1";
  var SOURCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  function parseBoolean(value, defaultValue) {
    if (value === true || value === false) {
      return value;
    }

    if (value == null) {
      return defaultValue;
    }

    var normalized = String(value).trim().toLowerCase();

    if (
      normalized === "true" ||
      normalized === "1" ||
      normalized === "yes" ||
      normalized === "on"
    ) {
      return true;
    }

    if (
      normalized === "false" ||
      normalized === "0" ||
      normalized === "no" ||
      normalized === "off"
    ) {
      return false;
    }

    return defaultValue;
  }

  function finiteNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function readStore(key) {
    if (
      typeof $persistentStore === "undefined" ||
      !$persistentStore ||
      !$persistentStore.read
    ) {
      return null;
    }

    try {
      return $persistentStore.read(key);
    } catch (e) {
      return null;
    }
  }

  function writeStore(value, key) {
    if (
      typeof $persistentStore === "undefined" ||
      !$persistentStore ||
      !$persistentStore.write
    ) {
      return false;
    }

    try {
      return $persistentStore.write(value, key);
    } catch (e) {
      return false;
    }
  }

  function readRandomState() {
    var raw = readStore(RANDOM_STATE_KEY);

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveRandomState(state) {
    try {
      writeStore(
        JSON.stringify(state),
        RANDOM_STATE_KEY
      );
    } catch (e) {
      // bỏ qua lỗi persistent store
    }
  }

  function sameNumber(a, b) {
    return Math.abs(Number(a) - Number(b)) < 1e-12;
  }

  function validCachedPoint(
    state,
    baseLat,
    baseLon,
    minMeters,
    maxMeters,
    intervalSeconds,
    now
  ) {
    if (!state || intervalSeconds <= 0) {
      return false;
    }

    if (
      !isFinite(Number(state.latitude)) ||
      !isFinite(Number(state.longitude))
    ) {
      return false;
    }

    if (
      !sameNumber(state.baseLatitude, baseLat) ||
      !sameNumber(state.baseLongitude, baseLon) ||
      !sameNumber(state.minMeters, minMeters) ||
      !sameNumber(state.maxMeters, maxMeters)
    ) {
      return false;
    }

    var ts = Number(state.ts);

    if (!isFinite(ts) || ts <= 0) {
      return false;
    }

    return now - ts < intervalSeconds * 1000;
  }

  function generateRandomPoint(
    baseLat,
    baseLon,
    minMeters,
    maxMeters
  ) {
    /*
     * Random đều theo diện tích trong vòng:
     * minMeters -> maxMeters
     */

    var u = Math.random();

    var radius = Math.sqrt(
      minMeters * minMeters +
      u * (
        maxMeters * maxMeters -
        minMeters * minMeters
      )
    );

    var angle =
      Math.random() *
      Math.PI *
      2;

    var north =
      radius *
      Math.cos(angle);

    var east =
      radius *
      Math.sin(angle);

    /*
     * Quy đổi mét -> latitude/longitude.
     * Với jitter 1-3m thì độ chính xác đủ cao.
     */

    var dLat =
      north /
      111320;

    var cosLat =
      Math.cos(
        baseLat *
        Math.PI /
        180
      );

    if (
      Math.abs(cosLat) <
      0.000001
    ) {
      cosLat =
        cosLat < 0
          ? -0.000001
          : 0.000001;
    }

    var dLon =
      east /
      (
        111320 *
        cosLat
      );

    var latitude =
      baseLat +
      dLat;

    var longitude =
      baseLon +
      dLon;

    if (latitude > 90) {
      latitude = 90;
    } else if (latitude < -90) {
      latitude = -90;
    }

    while (longitude > 180) {
      longitude -= 360;
    }

    while (longitude < -180) {
      longitude += 360;
    }

    return {
      latitude: latitude,
      longitude: longitude,
      radius: radius,
      angle: angle
    };
  }

  function __readRandomArgs() {
    var out = {};

    if (
      typeof $argument === "undefined" ||
      $argument == null
    ) {
      return out;
    }

    if (
      typeof $argument ===
      "object"
    ) {
      for (
        var key in $argument
      ) {
        if (
          Object.prototype
            .hasOwnProperty
            .call(
              $argument,
              key
            )
        ) {
          out[key] =
            $argument[key];
        }
      }

      return out;
    }

    var raw =
      String($argument);

    var pairs =
      raw.split(/[&;]/);

    for (
      var i = 0;
      i < pairs.length;
      i += 1
    ) {
      if (!pairs[i]) {
        continue;
      }

      var eq =
        pairs[i]
          .indexOf("=");

      var k =
        eq >= 0
          ? pairs[i]
              .slice(0, eq)
          : pairs[i];

      var v =
        eq >= 0
          ? pairs[i]
              .slice(eq + 1)
          : "true";

      try {
        k =
          decodeURIComponent(k);

        v =
          decodeURIComponent(v);
      } catch (e) {
        // giữ nguyên
      }

      out[k] = v;
    }

    return out;
  }

  /*
   * Hàm được inject vào source gốc.
   */

  function __applyRandomJitter(
    config,
    args
  ) {
    args =
      args ||
      {};

    if (
      !parseBoolean(
        args.random,
        false
      )
    ) {
      return config;
    }

    var baseLat =
      finiteNumber(
        config.latitude,
        NaN
      );

    var baseLon =
      finiteNumber(
        config.longitude,
        NaN
      );

    if (
      !isFinite(baseLat) ||
      !isFinite(baseLon) ||
      baseLat < -90 ||
      baseLat > 90 ||
      baseLon < -180 ||
      baseLon > 180
    ) {
      return config;
    }

    var minMeters =
      finiteNumber(
        args.randomMin,
        1
      );

    var maxMeters =
      finiteNumber(
        args.randomMax,
        3
      );

    var intervalSeconds =
      finiteNumber(
        args.randomInterval,
        300
      );

    if (
      minMeters <
      0
    ) {
      minMeters = 0;
    }

    if (
      maxMeters <
      0
    ) {
      maxMeters = 0;
    }

    if (
      maxMeters <
      minMeters
    ) {
      var tmp =
        minMeters;

      minMeters =
        maxMeters;

      maxMeters =
        tmp;
    }

    if (
      intervalSeconds <
      0
    ) {
      intervalSeconds =
        0;
    }

    var now =
      Date.now();

    var state =
      readRandomState();

    var point;

    if (
      validCachedPoint(
        state,
        baseLat,
        baseLon,
        minMeters,
        maxMeters,
        intervalSeconds,
        now
      )
    ) {
      point = {
        latitude:
          Number(
            state.latitude
          ),

        longitude:
          Number(
            state.longitude
          ),

        radius:
          Number(
            state.radius
          ),

        angle:
          Number(
            state.angle
          )
      };

      if (
        config.debug
      ) {
        console.log(
          "Location random cache hit: " +
          point.latitude
            .toFixed(8) +
          "," +
          point.longitude
            .toFixed(8) +
          " radius=" +
          (
            isFinite(
              point.radius
            )
              ? point.radius
                  .toFixed(2)
              : "?"
          ) +
          "m"
        );
      }
    } else {
      point =
        generateRandomPoint(
          baseLat,
          baseLon,
          minMeters,
          maxMeters
        );

      if (
        intervalSeconds >
        0
      ) {
        saveRandomState({
          ts: now,

          baseLatitude:
            baseLat,

          baseLongitude:
            baseLon,

          minMeters:
            minMeters,

          maxMeters:
            maxMeters,

          latitude:
            point.latitude,

          longitude:
            point.longitude,

          radius:
            point.radius,

          angle:
            point.angle
        });
      }

      if (
        config.debug
      ) {
        console.log(
          "Location random generated: base=" +
          baseLat
            .toFixed(8) +
          "," +
          baseLon
            .toFixed(8) +
          " -> " +
          point.latitude
            .toFixed(8) +
          "," +
          point.longitude
            .toFixed(8) +
          " radius=" +
          point.radius
            .toFixed(2) +
          "m interval=" +
          intervalSeconds +
          "s"
        );
      }
    }

    /*
     * Tất cả Wi-Fi/cell trong response này
     * dùng cùng một tọa độ random.
     */

    config.latitude =
      point.latitude;

    config.longitude =
      point.longitude;

    return config;
  }

  function patchUpstreamSource(
    source
  ) {
    /*
     * Tìm đoạn upstream:
     *
     * prepareResponseBody(config);
     * continueResponseRewrite(config);
     *
     * rồi inject random ngay trước đó.
     */

    var needle =
      "          prepareResponseBody(config);\n" +
      "          continueResponseRewrite(config);";

    var replacement =
      "          config = __applyRandomJitter(config, __readRandomArgs());\n" +
      "          prepareResponseBody(config);\n" +
      "          continueResponseRewrite(config);";

    if (
      source.indexOf(
        needle
      ) <
      0
    ) {
      throw new Error(
        "Upstream layout changed; random injection point was not found"
      );
    }

    return source.replace(
      needle,
      replacement
    );
  }

  function runUpstream(
    source
  ) {
    try {
      var patched =
        patchUpstreamSource(
          source
        );

      /*
       * eval source gốc sau khi inject.
       */

      eval(patched);
    } catch (e) {
      console.log(
        "Location random wrapper failed: " +
        e.message
      );

      $done({});
    }
  }

  function readCachedSource() {
    var raw =
      readStore(
        SOURCE_CACHE_KEY
      );

    if (!raw) {
      return null;
    }

    try {
      var entry =
        JSON.parse(raw);

      if (
        !entry ||
        !entry.source ||
        !entry.ts
      ) {
        return null;
      }

      if (
        Date.now() -
        Number(entry.ts) >
        SOURCE_CACHE_TTL_MS
      ) {
        return null;
      }

      return String(
        entry.source
      );
    } catch (e) {
      return null;
    }
  }

  function saveSource(
    source
  ) {
    try {
      writeStore(
        JSON.stringify({
          ts:
            Date.now(),

          source:
            String(source)
        }),

        SOURCE_CACHE_KEY
      );
    } catch (e) {
      // bỏ qua cache error
    }
  }

  function fetchUpstream(
    callback
  ) {
    if (
      typeof $httpClient ===
        "undefined" ||
      !$httpClient ||
      !$httpClient.get
    ) {
      callback(
        null,
        "Shadowrocket $httpClient is unavailable"
      );

      return;
    }

    $httpClient.get(
      {
        url:
          UPSTREAM_URL,

        timeout:
          10000,

        headers: {
          "User-Agent":
            "Shadowrocket iOS Location Spoofer Random Wrapper"
        }
      },

      function (
        error,
        response,
        body
      ) {
        if (
          error ||
          !body
        ) {
          callback(
            null,
            String(
              error ||
              "empty upstream body"
            )
          );

          return;
        }

        callback(
          String(body),
          null
        );
      }
    );
  }

  /*
   * Ưu tiên source upstream đã cache.
   * Cache tối đa 24 giờ.
   */

  var cached =
    readCachedSource();

  if (cached) {
    runUpstream(
      cached
    );

    return;
  }

  fetchUpstream(
    function (
      source,
      error
    ) {
      if (!source) {
        console.log(
          "Location random upstream fetch failed: " +
          error
        );

        $done({});
        return;
      }

      saveSource(
        source
      );

      runUpstream(
        source
      );
    }
  );
}());
