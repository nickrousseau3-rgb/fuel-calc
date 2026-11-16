/*
 * calc.js — the math for Fuel Calc.
 *
 * Every function here is "pure": it only uses its arguments and returns a
 * result. No page, no storage, no clock. That makes it easy to test
 * (see tests.js) and safe to change.
 *
 * Units used internally: grams (g), milligrams of sodium (mg),
 * millilitres (mL), teaspoons (tsp) for kitchen volumes.
 */
(function (root) {
  'use strict';

  var ML_PER_FL_OZ = 29.5735;
  var ML_PER_TSP = 4.92892;
  var TSP_PER_TBSP = 3;
  var TSP_PER_CUP = 48;

  // Default ingredient settings. All editable in the app.
  var DEFAULT_SETTINGS = {
    maltoCarbPct: 95,          // NOW Carbo Gain: 60 g carbs per 63 g
    maltoGPerTbsp: 7.9,        // 63 g per 1/2 cup = 7.9 g per level Tbsp
    fructoseCarbPct: 100,
    fructoseGPerTbsp: 12,
    citrateSodiumPct: 23.5,    // sodium citrate dihydrate
    citrateGPerTsp: 6,
    saltSodiumPct: 39,         // table salt (NaCl)
    saltGPerTsp: 6,
    lemonCarbPct: 85,          // counted toward total carbs
    lemonGPerTsp: 2.65,
    citricGPerTsp: 5,

    saltSodiumShare: 15,       // % of sodium from table salt (rest from citrate)
    saltCapTsp: 0.125,         // max table salt per container (1/8 tsp)
    citricGPerCarbG: 0.015,    // citric acid per gram of carbs
    displacementMlPerG: 0.62,  // volume taken up by 1 g of dissolved powder
    gelWaterMlPerCarbG: 0.65,  // flask water rule
    gelMinWaterMlPerCarbG: 0.55, // below this, gel won't flow
    flaskFillPct: 90,          // usable part of a flask (135 of 150 mL)
    concWarnPct: 12,           // warn above this many g carbs per 100 mL (bottle)
    citrateWarnG: 4.5,         // warn above this much sodium citrate per container
    autoRatioCutoff: 75,       // g/h at or above which "auto" picks 1:0.8

    // Single-serving flow (main screen)
    sodiumMgPerCarbG: 15,      // default sodium: 15 mg per g of carbs
    lemonGPerContainer: 3,     // lemon juice powder per bottle / flask / tub serving
    juiceMlPerContainer: 14.8, // fresh lemon/lime juice: 1 Tbsp
    juiceCarbsPerTbsp: 1,      // ~1 g carbs per Tbsp of juice
    flaskMl: 150,              // HydraPak soft flask
    flaskMaxCarbs: 100,        // more than this won't fit in 135 mL
    tubTargetG: 680,           // dry mix to fill the tub (~1.5 lb)
    carbTolPct: 10,            // rounding may move carbs ±10%
    sodiumTolPct: 20,          // ... sodium ±20%
    ratioTolPct: 15            // ... ratio ±15% (2:1 → 1.7–2.3)
  };

  var RATIO_PRESETS = {
    '2:1': { malto: 2, fructose: 1 },
    '1:0.8': { malto: 1, fructose: 0.8 }
  };

  // ---------- small helpers ----------

  function flOzToMl(oz) { return oz * ML_PER_FL_OZ; }
  function mlToFlOz(ml) { return ml / ML_PER_FL_OZ; }
  function mlToTsp(ml) { return ml / ML_PER_TSP; }

  function withDefaults(settings) {
    var s = {};
    for (var k in DEFAULT_SETTINGS) s[k] = DEFAULT_SETTINGS[k];
    if (settings) {
      for (var j in settings) {
        if (typeof settings[j] === 'number' && isFinite(settings[j])) s[j] = settings[j];
      }
    }
    return s;
  }

  /**
   * Pick the maltodextrin : fructose ratio.
   * choice: 'auto', '2:1', '1:0.8', or {malto, fructose} for custom.
   */
  function resolveRatio(choice, carbsPerHour, cutoff) {
    if (choice && typeof choice === 'object') return { malto: choice.malto, fructose: choice.fructose, label: 'custom' };
    if (RATIO_PRESETS[choice]) return { malto: RATIO_PRESETS[choice].malto, fructose: RATIO_PRESETS[choice].fructose, label: choice };
    var c = cutoff == null ? DEFAULT_SETTINGS.autoRatioCutoff : cutoff;
    var key = carbsPerHour >= c ? '1:0.8' : '2:1';
    return { malto: RATIO_PRESETS[key].malto, fructose: RATIO_PRESETS[key].fructose, label: key + ' (auto)' };
  }

  /** Turn a commercial drink ("20 g carbs, 380 mg sodium per scoop") into hourly targets. */
  function targetsFromProduct(p) {
    return {
      carbsPerHour: p.carbsPerScoop * p.scoopsPerHour,
      sodiumPerHour: p.sodiumPerScoop * p.scoopsPerHour
    };
  }

  /**
   * Split one container's sodium between table salt and sodium citrate.
   * Salt gets saltSodiumShare %, but never more than saltCapTsp of salt.
   */
  function splitSodium(sodiumMg, s) {
    var saltCapMg = s.saltCapTsp * s.saltGPerTsp * (s.saltSodiumPct / 100) * 1000;
    var saltMg = Math.min(sodiumMg * s.saltSodiumShare / 100, saltCapMg);
    var citrateMg = sodiumMg - saltMg;
    return {
      saltMg: saltMg,
      citrateMg: citrateMg,
      saltG: saltMg / (s.saltSodiumPct / 100) / 1000,
      citrateG: citrateMg / (s.citrateSodiumPct / 100) / 1000
    };
  }

  /** Check inputs; returns a list of messages (empty = all good). */
  function validateInputs(i) {
    var errors = [];
    function pos(v, name) { if (!(typeof v === 'number' && isFinite(v) && v > 0)) errors.push(name + ' must be more than 0.'); }
    function nonNeg(v, name) { if (!(typeof v === 'number' && isFinite(v) && v >= 0)) errors.push(name + ' can’t be negative.'); }
    pos(i.hours, 'Ride duration');
    pos(i.carbsPerHour, 'Carb target');
    nonNeg(i.sodiumPerHour, 'Sodium target');
    pos(i.containerMl, 'Container size');
    pos(i.containers, 'Number of containers');
    nonNeg(i.lemonG, 'Lemon powder');
    if (i.containers > 0 && Math.round(i.containers) !== i.containers) errors.push('Number of containers must be a whole number.');
    var r = i.ratio;
    if (r && typeof r === 'object' && !(r.malto >= 0 && r.fructose >= 0 && r.malto + r.fructose > 0)) {
      errors.push('Custom ratio needs two numbers, not both 0.');
    }
    return errors;
  }

  /**
   * The main calculation for a ride.
   *
   * inputs = {
   *   hours, carbsPerHour, sodiumPerHour,
   *   ratio: 'auto' | '2:1' | '1:0.8' | {malto, fructose},
   *   format: 'bottle' | 'flask',
   *   containerMl, containers, lemonG
   * }
   * Returns { ok, errors, warnings, ratio, perContainer, total, ... }.
   */
  function calculate(inputs, settings) {
    var s = withDefaults(settings);
    var errors = validateInputs(inputs);
    if (errors.length) return { ok: false, errors: errors, warnings: [] };

    var n = inputs.containers;
    var hours = inputs.hours;
    var ratio = resolveRatio(inputs.ratio, inputs.carbsPerHour, s.autoRatioCutoff);
    var warnings = [];

    // 1. Carbs for the whole ride
    var totalCarbs = hours * inputs.carbsPerHour;
    var carbsPerContainer = totalCarbs / n;

    // 2. Lemon powder adds some carbs; the rest comes from malto + fructose
    var lemonCarbs = inputs.lemonG * s.lemonCarbPct / 100;
    var splitCarbs = carbsPerContainer - lemonCarbs;
    if (splitCarbs < 0) {
      warnings.push('Lemon powder alone has more carbs than the target. Use less lemon.');
      splitCarbs = 0;
    }

    // 3. Ratio is by grams of carbs
    var maltoCarbs = splitCarbs * ratio.malto / (ratio.malto + ratio.fructose);
    var fructoseCarbs = splitCarbs * ratio.fructose / (ratio.malto + ratio.fructose);
    var maltoG = maltoCarbs / (s.maltoCarbPct / 100);
    var fructoseG = fructoseCarbs / (s.fructoseCarbPct / 100);

    // 4. Sodium
    var sodiumPerContainer = hours * inputs.sodiumPerHour / n;
    var na = splitSodium(sodiumPerContainer, s);
    if (na.citrateG > s.citrateWarnG) {
      warnings.push('Over ' + s.citrateWarnG + ' g sodium citrate per container can taste soapy and upset your gut. Consider more containers.');
    }

    // 5. Citric acid scales with carbs
    var citricG = carbsPerContainer * s.citricGPerCarbG;

    var powderG = maltoG + fructoseG + na.citrateG + na.saltG + inputs.lemonG + citricG;
    var powderMl = powderG * s.displacementMlPerG;

    // 6. Water
    var waterMl, finalMl;
    if (inputs.format === 'flask') {
      waterMl = carbsPerContainer * s.gelWaterMlPerCarbG;
      finalMl = waterMl + powderMl;
      var usable = inputs.containerMl * s.flaskFillPct / 100;
      if (waterMl < carbsPerContainer * s.gelMinWaterMlPerCarbG) {
        warnings.push('Too little water: the gel will be a paste that won’t flow.');
      }
      if (finalMl > usable) {
        warnings.push('Too much for the flask (' + Math.round(finalMl) + ' mL vs ' + Math.round(usable) + ' mL usable). Use more flasks.');
      }
    } else {
      waterMl = inputs.containerMl - powderMl;
      finalMl = inputs.containerMl;
      if (waterMl <= 0) {
        warnings.push('The powder won’t fit in the bottle. Use more bottles.');
        waterMl = 0;
      }
    }

    var carbsPer100Ml = carbsPerContainer / finalMl * 100;
    if (inputs.format !== 'flask' && carbsPer100Ml > s.concWarnPct) {
      warnings.push('Strong mix: ' + carbsPer100Ml.toFixed(1) + '% (over ' + s.concWarnPct + '%). It may sit heavy; consider more bottles.');
    }

    var minutesPerContainer = 60 * carbsPerContainer / inputs.carbsPerHour;

    var perContainer = {
      maltoG: maltoG,
      fructoseG: fructoseG,
      citrateG: na.citrateG,
      saltG: na.saltG,
      lemonG: inputs.lemonG,
      citricG: citricG,
      powderG: powderG,
      waterMl: waterMl,
      carbs: carbsPerContainer,
      sodiumMg: sodiumPerContainer
    };
    var total = {};
    for (var k in perContainer) total[k] = perContainer[k] * n;

    return {
      ok: true,
      errors: [],
      warnings: warnings,
      ratio: ratio,
      perContainer: perContainer,
      total: total,
      finalMl: finalMl,
      carbsPer100Ml: carbsPer100Ml,
      minutesPerContainer: minutesPerContainer,
      fluidMlPerHour: inputs.format === 'flask' ? null : inputs.containerMl * n / hours
    };
  }

  /**
   * Master batch of dry mix.
   * recipe: a calculate() result's perContainer (one serving).
   * opts: { servings } or { batchG }.
   */
  function batch(perServing, opts, settings) {
    var s = withDefaults(settings);
    var dryKeys = ['maltoG', 'fructoseG', 'citrateG', 'saltG', 'lemonG', 'citricG'];
    var servingG = 0;
    dryKeys.forEach(function (k) { servingG += perServing[k]; });
    if (!(servingG > 0)) return { ok: false, errors: ['Nothing to batch yet.'] };

    var servings = opts.servings != null ? opts.servings : opts.batchG / servingG;
    if (!(servings > 0)) return { ok: false, errors: ['Batch size must be more than 0.'] };

    var amounts = {};
    dryKeys.forEach(function (k) { amounts[k] = perServing[k] * servings; });

    // Volume of one serving of mix = sum of each ingredient's volume
    var servingTsp = tspFor('maltoG', perServing.maltoG, s) + tspFor('fructoseG', perServing.fructoseG, s) +
      tspFor('citrateG', perServing.citrateG, s) + tspFor('saltG', perServing.saltG, s) +
      tspFor('lemonG', perServing.lemonG, s) + tspFor('citricG', perServing.citricG, s);
    var gPerTsp = servingG / servingTsp;

    // Nutrition per 1/4 cup scoop (12 tsp)
    var scoopG = gPerTsp * 12;
    var share = scoopG / servingG;

    return {
      ok: true,
      servings: servings,
      amounts: amounts,
      totalG: servingG * servings,
      servingG: servingG,
      servingTsp: servingTsp,
      quarterCup: { grams: scoopG, carbs: perServing.carbs * share, sodiumMg: perServing.sodiumMg * share }
    };
  }

  // ---------- kitchen volumes ----------

  /** Grams of an ingredient → teaspoons, using that ingredient's density. */
  function tspFor(key, grams, settings) {
    var s = withDefaults(settings);
    switch (key) {
      case 'maltoG': return grams / s.maltoGPerTbsp * TSP_PER_TBSP;
      case 'fructoseG': return grams / s.fructoseGPerTbsp * TSP_PER_TBSP;
      case 'citrateG': return grams / s.citrateGPerTsp;
      case 'saltG': return grams / s.saltGPerTsp;
      case 'lemonG': return grams / s.lemonGPerTsp;
      case 'citricG': return grams / s.citricGPerTsp;
      default: throw new Error('Unknown ingredient: ' + key);
    }
  }

  /**
   * Round teaspoons to something you can measure. Bigger amounts get coarser
   * rounding, because scooping is only accurate to ~10% anyway.
   */
  function roundTsp(tsp) {
    var step;
    if (tsp < 0.25) step = 1 / 16;
    else if (tsp < 3) step = 1 / 8;      // under 1 Tbsp
    else if (tsp < 12) step = 1 / 4;     // under 1/4 cup
    else if (tsp < 48) step = 1 / 2;     // under 1 cup
    else step = 1;
    return Math.round(tsp / step) * step;
  }

  var EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];
  var QUARTERS = ['', '¼', '½', '¾'];

  function mixedNumber(whole, frac) {
    if (!whole) return frac || '0';
    return whole + (frac || '');
  }

  /** Teaspoons → "½ cup + 1 Tbsp + 2½ tsp". */
  function formatTsp(tspRaw) {
    if (!(tspRaw > 0)) return '0';
    var t = roundTsp(tspRaw);
    if (t === 0) return 'a pinch';
    if (t < 0.125) return '1/16 tsp';
    var parts = [];
    if (t >= 12) {
      var quarterCups = Math.floor(t / 12 + 1e-9);
      parts.push(mixedNumber(Math.floor(quarterCups / 4), QUARTERS[quarterCups % 4]) + (quarterCups > 4 ? ' cups' : ' cup'));
      t -= quarterCups * 12;
    }
    if (t >= 3 - 1e-9) {
      var tbsp = Math.floor(t / 3 + 1e-9);
      parts.push(tbsp + ' Tbsp');
      t -= tbsp * 3;
    }
    var eighths = Math.round(t * 8);
    if (eighths > 0) parts.push(mixedNumber(Math.floor(eighths / 8), EIGHTHS[eighths % 8]) + ' tsp');
    return parts.join(' + ');
  }

  /** Minutes → "40 min" or "1 h 30 min". */
  function formatMinutes(min) {
    var m = Math.round(min);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return h + ' h' + (r ? ' ' + r + ' min' : '');
  }

  // =====================================================================
  // Single-serving flow: every ingredient is ONE kitchen measure used a
  // whole number of times ("4 Tbsp", "3 × ½ tsp"), never a combination.
  // =====================================================================

  // The measures the user owns, in teaspoons. `whole` measures read
  // "3 Tbsp"; fractional ones read "3 × ½ tsp".
  var MEASURES = [
    { tsp: 48, label: 'cup', whole: true },
    { tsp: 24, label: '½ cup' },
    { tsp: 16, label: '⅓ cup' },
    { tsp: 12, label: '¼ cup' },
    { tsp: 3, label: 'Tbsp', whole: true },
    { tsp: 1, label: 'tsp', whole: true },
    { tsp: 0.5, label: '½ tsp' },
    { tsp: 0.25, label: '¼ tsp' },
    { tsp: 0.125, label: '⅛ tsp' }
  ];
  var PINCH = { tsp: 1 / 16, label: 'pinch', pinch: true };
  var MAX_SCOOPS = 24;
  var EPS = 1e-9;

  /** {measure, count} → "4 Tbsp", "1 cup", "2 cups", "3 × ½ tsp", "pinch". */
  function formatMeasure(m, count) {
    if (!m || !count) return '—';
    if (m.pinch) return 'pinch';
    if (m.whole) {
      if (m.label === 'cup') return count + (count === 1 ? ' cup' : ' cups');
      return count + ' ' + m.label;
    }
    return count === 1 ? m.label : count + ' × ' + m.label;
  }

  /** For each measure, the counts just below and above the target. */
  function measureOptions(targetTsp) {
    var out = [];
    if (!(targetTsp > 0)) return out;
    MEASURES.forEach(function (m) {
      var x = targetTsp / m.tsp;
      var lo = Math.floor(x + EPS), hi = Math.ceil(x - EPS);
      [lo, hi].forEach(function (c, i) {
        if (c < 1 || c > MAX_SCOOPS || (i === 1 && hi === lo)) return;
        out.push({ measure: m, count: c, tsp: c * m.tsp });
      });
    });
    return out;
  }

  /** Every measure × count up to maxTsp, around a target (for water). */
  function waterOptions(targetTsp, maxTsp) {
    var out = [];
    MEASURES.forEach(function (m) {
      for (var c = 1; c <= MAX_SCOOPS && c * m.tsp <= maxTsp + EPS; c++) out.push({ measure: m, count: c, tsp: c * m.tsp });
    });
    return out;
  }

  /** The single measure closest to a target (ties → fewer scoops). */
  function nearestMeasure(targetTsp) {
    var best = null;
    measureOptions(targetTsp).forEach(function (o) {
      var err = Math.abs(o.tsp - targetTsp);
      if (!best || err < best.err - EPS || (Math.abs(err - best.err) <= EPS && o.count < best.opt.count)) best = { opt: o, err: err };
    });
    return best && best.opt;
  }

  /**
   * Fewest scoops that land within ±tol of the target (ties → closest).
   * Falls back to the nearest measure if none is within tolerance.
   */
  function fewestScoops(targetTsp, tol) {
    var best = null;
    measureOptions(targetTsp).forEach(function (o) {
      var err = Math.abs(o.tsp / targetTsp - 1);
      if (err > tol + EPS) return;
      if (!best || o.count < best.o.count || (o.count === best.o.count && err < best.err)) best = { o: o, err: err };
    });
    return best ? best.o : nearestMeasure(targetTsp);
  }

  function densities(s) {
    return {
      malto: s.maltoGPerTbsp / TSP_PER_TBSP,
      fructose: s.fructoseGPerTbsp / TSP_PER_TBSP,
      citrate: s.citrateGPerTsp,
      salt: s.saltGPerTsp,
      lemon: s.lemonGPerTsp
    };
  }

  function item(key, name, opt, gPerTsp) {
    return { key: key, name: name, measure: opt.measure, count: opt.count, tsp: opt.tsp, grams: opt.tsp * gPerTsp, text: formatMeasure(opt.measure, opt.count) };
  }

  /**
   * Choose maltodextrin + fructose measures together.
   * Keeps combos with carbs within ±carbTol and ratio within ±ratioTol
   * (and anything `check` demands), then picks the fewest scoops, then the
   * smallest carb error. If nothing fits, returns the closest combo with
   * withinTolerance = false.
   */
  function pickCarbs(targetCarbs, fixedCarbs, ratio, s, check) {
    var d = densities(s);
    var split = targetCarbs - fixedCarbs;
    if (!(split > 0)) return null;
    var mTsp = split * ratio / (1 + ratio) / (s.maltoCarbPct / 100) / d.malto;
    var fTsp = split / (1 + ratio) / (s.fructoseCarbPct / 100) / d.fructose;
    var best = null, fallback = null;
    measureOptions(mTsp).forEach(function (m) {
      measureOptions(fTsp).forEach(function (f) {
        var mg = m.tsp * d.malto, fg = f.tsp * d.fructose;
        var mc = mg * s.maltoCarbPct / 100, fc = fg * s.fructoseCarbPct / 100;
        var carbs = mc + fc + fixedCarbs;
        var carbErr = carbs / targetCarbs - 1, ratioErr = (mc / fc) / ratio - 1;
        var extra = check ? check(mg, fg, carbs) : { ok: true };
        var c = { m: m, f: f, carbs: carbs, ratio: mc / fc, carbErr: carbErr, extra: extra, scoops: m.count + f.count };
        var dist = Math.abs(carbErr) + Math.abs(ratioErr);
        if (extra.ok && (!fallback || dist < fallback.dist)) { fallback = c; c.dist = dist; }
        if (!extra.ok || Math.abs(carbErr) > s.carbTolPct / 100 + EPS || Math.abs(ratioErr) > s.ratioTolPct / 100 + EPS) return;
        if (!best || c.scoops < best.scoops || (c.scoops === best.scoops && Math.abs(carbErr) < Math.abs(best.carbErr))) best = c;
      });
    });
    var pick = best || fallback;
    if (!pick) return null;
    return {
      malto: item('malto', 'Maltodextrin', pick.m, d.malto),
      fructose: item('fructose', 'Fructose', pick.f, d.fructose),
      extra: pick.extra,
      withinTolerance: !!best
    };
  }

  /**
   * Choose table salt + sodium citrate. Salt takes ~saltSodiumShare % of the
   * sodium (nearest measure; with a cap it's pinch or ⅛ tsp only), citrate
   * makes up the rest within ±sodiumTol, never above citrateCapG.
   */
  function pickSodium(targetMg, s, caps) {
    var d = densities(s);
    var mgPerTspSalt = d.salt * s.saltSodiumPct * 10;
    var mgPerTspCit = d.citrate * s.citrateSodiumPct * 10;
    if (!(targetMg > 0)) return { salt: null, citrate: null, sodiumMg: 0, withinTolerance: true, capped: false };

    var saltTsp = targetMg * s.saltSodiumShare / 100 / mgPerTspSalt;
    var salt = null;
    if (caps.saltCapTsp != null) {
      if (saltTsp > EPS) {
        var choices = [{ measure: PINCH, count: 1, tsp: PINCH.tsp }, { measure: MEASURES[8], count: 1, tsp: 0.125 }]
          .filter(function (o) { return o.tsp <= caps.saltCapTsp + EPS; });
        salt = choices.reduce(function (a, b) { return Math.abs(b.tsp - saltTsp) < Math.abs(a.tsp - saltTsp) ? b : a; });
      }
    } else if (saltTsp > EPS) {
      salt = saltTsp < 0.09375 ? { measure: PINCH, count: 1, tsp: PINCH.tsp } : fewestScoops(saltTsp, s.sodiumTolPct / 100);
    }
    var saltMg = salt ? salt.tsp * mgPerTspSalt : 0;

    var citTsp = (targetMg - saltMg) / mgPerTspCit;
    var capTsp = caps.citrateCapG != null ? caps.citrateCapG / d.citrate : Infinity;
    var opts = measureOptions(citTsp).filter(function (o) { return o.tsp <= capTsp + EPS; });
    var tol = s.sodiumTolPct / 100;
    var best = null, closest = null;
    opts.forEach(function (o) {
      var err = (saltMg + o.tsp * mgPerTspCit) / targetMg - 1;
      if (!closest || Math.abs(err) < Math.abs(closest.err)) closest = { o: o, err: err };
      if (Math.abs(err) > tol + EPS) return;
      if (!best || o.count < best.o.count || (o.count === best.o.count && Math.abs(err) < Math.abs(best.err))) best = { o: o, err: err };
    });
    // If the cap stops us reaching the target, use as much citrate as allowed.
    if (!best && citTsp > capTsp) {
      var capOpt = measureOptions(capTsp).filter(function (o) { return o.tsp <= capTsp + EPS; })
        .reduce(function (a, b) { return !a || b.tsp > a.tsp + EPS || (Math.abs(b.tsp - a.tsp) <= EPS && b.count < a.count) ? b : a; }, null);
      if (capOpt) closest = { o: capOpt, err: (saltMg + capOpt.tsp * mgPerTspCit) / targetMg - 1 };
    }
    var pick = best || closest;
    var cit = pick && citTsp > EPS ? item('citrate', 'Sodium citrate', pick.o, d.citrate) : null;
    var saltItem = salt ? item('salt', 'Table salt', salt, d.salt) : null;
    var total = saltMg + (cit ? cit.tsp * mgPerTspCit : 0);
    return {
      salt: saltItem, citrate: cit, sodiumMg: total,
      withinTolerance: Math.abs(total / targetMg - 1) <= tol + EPS,
      capped: citTsp > capTsp + EPS
    };
  }

  function sumCarbs(items, s) {
    var c = 0;
    items.forEach(function (it) {
      if (!it) return;
      if (it.key === 'malto') c += it.grams * s.maltoCarbPct / 100;
      if (it.key === 'fructose') c += it.grams * s.fructoseCarbPct / 100;
      if (it.key === 'lemon') c += it.grams * s.lemonCarbPct / 100;
    });
    return c;
  }
  function sumSodium(items, s) {
    var mg = 0;
    items.forEach(function (it) {
      if (!it) return;
      if (it.key === 'citrate') mg += it.grams * s.citrateSodiumPct * 10;
      if (it.key === 'salt') mg += it.grams * s.saltSodiumPct * 10;
    });
    return mg;
  }
  function sumGrams(items) { return items.reduce(function (a, it) { return a + (it ? it.grams : 0); }, 0); }
  function sumTsp(items) { return items.reduce(function (a, it) { return a + (it ? it.tsp : 0); }, 0); }

  /**
   * One bottle or one gel flask.
   * input = { container: 'bottle'|'flask', carbs, highCarb, bottleOz, sodiumMg (optional override) }
   */
  function planServing(input, settings) {
    var s = withDefaults(settings);
    var d = densities(s);
    var errors = [], warnings = [];
    var carbs = input.carbs;
    var isFlask = input.container === 'flask';
    if (!(carbs > 0)) errors.push('Carbs per serving must be more than 0.');
    if (isFlask && carbs > s.flaskMaxCarbs) errors.push('A ' + s.flaskMl + ' mL flask holds at most ' + s.flaskMaxCarbs + ' g carbs.');
    if (!isFlask && !(input.bottleOz > 0)) errors.push('Pick a bottle size.');
    if (input.sodiumMg != null && !(input.sodiumMg >= 0)) errors.push('Sodium can’t be negative.');
    if (errors.length) return { ok: false, errors: errors };

    var ratio = input.highCarb ? 1.25 : 2;
    var sodiumTarget = input.sodiumMg != null ? input.sodiumMg : carbs * s.sodiumMgPerCarbG;
    var juiceCarbs = s.juiceCarbsPerTbsp * s.juiceMlPerContainer / (ML_PER_TSP * TSP_PER_TBSP);

    var lemon = s.lemonGPerContainer > 0 ? item('lemon', 'Lemon powder', fewestScoops(s.lemonGPerContainer / d.lemon, s.sodiumTolPct / 100), d.lemon) : null;
    var na = pickSodium(sodiumTarget, s, { citrateCapG: s.citrateWarnG, saltCapTsp: s.saltCapTsp });
    var otherG = sumGrams([lemon, na.citrate, na.salt]);
    var fixedCarbs = sumCarbs([lemon], s) + juiceCarbs;
    var usableMl = s.flaskMl * s.flaskFillPct / 100;
    var containerMl = isFlask ? s.flaskMl : flOzToMl(input.bottleOz);

    // Flask: liquid = water + juice ≈ 0.65 mL per g carbs (min 0.55), and
    // liquid + powder must fit in the usable part of the flask.
    function flaskCheck(mg, fg, totalCarbs) {
      var powderMl = (mg + fg + otherG) * s.displacementMlPerG;
      var targetWater = totalCarbs * s.gelWaterMlPerCarbG - s.juiceMlPerContainer;
      var best = null;
      // Every measure, any count that fits; fewest scoops wins.
      waterOptions(targetWater / ML_PER_TSP, usableMl / ML_PER_TSP).forEach(function (o) {
        var liquid = o.tsp * ML_PER_TSP + s.juiceMlPerContainer;
        if (liquid < totalCarbs * s.gelMinWaterMlPerCarbG - EPS) return;
        if (liquid + powderMl > usableMl + EPS) return;
        var err = Math.abs(liquid - totalCarbs * s.gelWaterMlPerCarbG);
        if (!best || o.count < best.o.count || (o.count === best.o.count && err < best.err)) best = { o: o, err: err };
      });
      return best ? { ok: true, water: best.o } : { ok: false };
    }

    var c = pickCarbs(carbs, fixedCarbs, ratio, s, isFlask ? flaskCheck : null);
    if (!c) return { ok: false, errors: [isFlask ? 'This won’t fit in the flask. Try fewer carbs.' : 'Not enough carbs to make a mix.'] };

    var items = [c.malto, c.fructose, na.citrate, na.salt, lemon].filter(Boolean);
    var powderG = sumGrams(items);
    var actualCarbs = sumCarbs(items, s) + juiceCarbs;
    var actualSodium = sumSodium(items, s);
    var mc = c.malto.grams * s.maltoCarbPct / 100, fc = c.fructose.grams * s.fructoseCarbPct / 100;

    var water, finalMl;
    if (isFlask) {
      var wOpt = c.extra.water;
      water = { measure: wOpt.measure, count: wOpt.count, ml: wOpt.tsp * ML_PER_TSP, text: formatMeasure(wOpt.measure, wOpt.count) };
      finalMl = water.ml + s.juiceMlPerContainer + powderG * s.displacementMlPerG;
    } else {
      var waterMl = containerMl - s.juiceMlPerContainer - powderG * s.displacementMlPerG;
      if (waterMl <= 0) return { ok: false, errors: ['The powder won’t fit in this bottle. Try fewer carbs or a bigger bottle.'] };
      water = { ml: waterMl, text: 'Fill to the top' };
      finalMl = containerMl;
    }
    var conc = actualCarbs / finalMl * 100;

    if (!c.withinTolerance) warnings.push('Couldn’t round to within ±' + s.carbTolPct + '% carbs and the ratio limits; showing the closest.');
    if (na.capped && !na.withinTolerance) warnings.push('Sodium citrate is capped at ' + s.citrateWarnG + ' g per ' + (isFlask ? 'flask' : 'bottle') + ' (taste and gut comfort), so sodium is lower than the target.');
    else if (!na.capped && !na.withinTolerance) warnings.push('Sodium is more than ±' + s.sodiumTolPct + '% off target after rounding.');
    if (!isFlask && conc > s.concWarnPct) warnings.push('Strong mix: ' + conc.toFixed(1) + ' g/100 mL (over ' + s.concWarnPct + '). It may sit heavy; consider a bigger bottle or fewer carbs.');

    return {
      ok: true, errors: [], warnings: warnings,
      container: isFlask ? 'flask' : 'bottle',
      target: { carbs: carbs, sodiumMg: sodiumTarget, ratio: ratio },
      items: items,
      juice: { text: '1 Tbsp', ml: s.juiceMlPerContainer, carbs: juiceCarbs },
      water: water,
      actual: { carbs: actualCarbs, sodiumMg: actualSodium, ratio: mc / fc, gPer100Ml: conc, finalMl: finalMl, powderG: powderG }
    };
  }

  /**
   * Tub of dry mix (~680 g) plus how much to scoop per serving.
   * input = { carbs (per serving, juice included), highCarb, sodiumMg (optional, per serving) }
   */
  function planTub(input, settings) {
    var s = withDefaults(settings);
    var d = densities(s);
    var carbs = input.carbs;
    if (!(carbs > 0)) return { ok: false, errors: ['Carbs per serving must be more than 0.'] };
    if (input.sodiumMg != null && !(input.sodiumMg >= 0)) return { ok: false, errors: ['Sodium can’t be negative.'] };

    var ratio = input.highCarb ? 1.25 : 2;
    var sodiumTarget = input.sodiumMg != null ? input.sodiumMg : carbs * s.sodiumMgPerCarbG;
    var juiceCarbs = s.juiceCarbsPerTbsp * s.juiceMlPerContainer / (ML_PER_TSP * TSP_PER_TBSP);
    var powderCarbs = carbs - juiceCarbs;  // the juice is added when mixing each bottle

    // 1. Exact (unrounded) recipe for one serving
    var lemonG = s.lemonGPerContainer;
    var split = powderCarbs - lemonG * s.lemonCarbPct / 100;
    if (!(split > 0)) return { ok: false, errors: ['Not enough carbs to make a mix.'] };
    var maltoG = split * ratio / (1 + ratio) / (s.maltoCarbPct / 100);
    var fructoseG = split / (1 + ratio) / (s.fructoseCarbPct / 100);
    var na1 = splitSodium(sodiumTarget, s);
    var servingG = maltoG + fructoseG + na1.citrateG + na1.saltG + lemonG;

    // 2. Scale up to fill the tub, then round each ingredient
    var n = s.tubTargetG / servingG;
    var lemon = lemonG > 0 ? item('lemon', 'Lemon powder', fewestScoops(n * lemonG / d.lemon, s.sodiumTolPct / 100), d.lemon) : null;
    var na = pickSodium(n * sodiumTarget, s, { citrateCapG: null, saltCapTsp: null });
    var c = pickCarbs(n * powderCarbs, sumCarbs([lemon], s), ratio, s, null);
    if (!c) return { ok: false, errors: ['Not enough carbs to make a mix.'] };

    var items = [c.malto, c.fructose, na.citrate, na.salt, lemon].filter(Boolean);
    var batchG = sumGrams(items);
    var batchCarbs = sumCarbs(items, s);
    var batchSodium = sumSodium(items, s);
    var mc = c.malto.grams * s.maltoCarbPct / 100, fc = c.fructose.grams * s.fructoseCarbPct / 100;

    // 3. Mix density from the ingredient densities (approximate)
    var gPerTsp = batchG / sumTsp(items);
    var carbsPerG = batchCarbs / batchG, sodiumPerG = batchSodium / batchG;

    // 4. Serving scoop: one measure, within carb tolerance, fewest scoops
    var targetTsp = powderCarbs / carbsPerG / gPerTsp;
    var best = null, closest = null;
    measureOptions(targetTsp).forEach(function (o) {
      var g = o.tsp * gPerTsp;
      var err = (g * carbsPerG + juiceCarbs) / carbs - 1;
      if (!closest || Math.abs(err) < Math.abs(closest.err)) closest = { o: o, err: err };
      if (Math.abs(err) > s.carbTolPct / 100 + EPS) return;
      if (!best || o.count < best.o.count || (o.count === best.o.count && Math.abs(err) < Math.abs(best.err))) best = { o: o, err: err };
    });
    var pick = best || closest;
    var scoopG = pick.o.tsp * gPerTsp;
    var warnings = [];
    if (!c.withinTolerance) warnings.push('Couldn’t round the tub recipe within the carb and ratio limits; showing the closest.');
    if (!best) warnings.push('No single measure lands within ±' + s.carbTolPct + '% of your carb target; showing the closest.');
    var scoopSodium = scoopG * sodiumPerG;
    if (Math.abs(scoopSodium / sodiumTarget - 1) > s.sodiumTolPct / 100 + EPS && sodiumTarget > 0) {
      warnings.push('Sodium per scoop is more than ±' + s.sodiumTolPct + '% off target after rounding.');
    }

    return {
      ok: true, errors: [], warnings: warnings,
      container: 'tub',
      target: { carbs: carbs, sodiumMg: sodiumTarget, ratio: ratio },
      items: items,
      batch: { grams: batchG, carbs: batchCarbs, sodiumMg: batchSodium, ratio: mc / fc, gPerTsp: gPerTsp, servings: batchG / scoopG },
      scoop: {
        measure: pick.o.measure, count: pick.o.count, tsp: pick.o.tsp,
        text: formatMeasure(pick.o.measure, pick.o.count), grams: scoopG,
        carbs: scoopG * carbsPerG + juiceCarbs, sodiumMg: scoopSodium, ratio: mc / fc
      },
      juice: { text: '1 Tbsp', carbs: juiceCarbs }
    };
  }

  var api = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    RATIO_PRESETS: RATIO_PRESETS,
    flOzToMl: flOzToMl,
    mlToFlOz: mlToFlOz,
    mlToTsp: mlToTsp,
    withDefaults: withDefaults,
    resolveRatio: resolveRatio,
    targetsFromProduct: targetsFromProduct,
    splitSodium: splitSodium,
    validateInputs: validateInputs,
    calculate: calculate,
    batch: batch,
    tspFor: tspFor,
    roundTsp: roundTsp,
    formatTsp: formatTsp,
    formatMinutes: formatMinutes,
    MEASURES: MEASURES,
    formatMeasure: formatMeasure,
    measureOptions: measureOptions,
    nearestMeasure: nearestMeasure,
    pickCarbs: pickCarbs,
    pickSodium: pickSodium,
    planServing: planServing,
    planTub: planTub
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FuelCalc = api;
})(this);
