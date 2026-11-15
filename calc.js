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
    citrateSodiumPct: 23.4,    // sodium citrate dihydrate
    citrateGPerTsp: 6,
    saltSodiumPct: 39,         // table salt (NaCl)
    saltGPerTsp: 6,
    lemonCarbPct: 85,          // counted toward total carbs
    lemonGPerTsp: 2.6,
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
    autoRatioCutoff: 75        // g/h at or above which "auto" picks 1:0.8
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
    formatMinutes: formatMinutes
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FuelCalc = api;
})(this);
