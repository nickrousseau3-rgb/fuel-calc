/*
 * tests.js — checks the math in calc.js.
 *
 * Run on a computer:   node tests.js
 * Run on your phone:   open tests.html in the browser
 */
(function () {
  'use strict';
  var FC = typeof require !== 'undefined' ? require('./calc.js') : window.FuelCalc;
  var results = [];

  function test(name, fn) {
    try { fn(); results.push({ name: name, pass: true }); }
    catch (e) { results.push({ name: name, pass: false, msg: e.message }); }
  }
  function near(actual, expected, tol, label) {
    tol = tol == null ? 0.01 : tol;
    if (!(Math.abs(actual - expected) <= tol)) {
      throw new Error((label || 'value') + ': expected ' + expected + ' ± ' + tol + ', got ' + actual);
    }
  }
  function equal(actual, expected, label) {
    if (actual !== expected) throw new Error((label || 'value') + ': expected "' + expected + '", got "' + actual + '"');
  }
  function ok(cond, label) { if (!cond) throw new Error(label || 'expected true'); }

  // ------------------------------------------------------------------
  // WORKED EXAMPLE, checked by hand (see README.md for the arithmetic):
  // 3 h at 90 g/h, 700 mg sodium/h, 2 × 24 oz bottles, 3 g lemon each.
  // ------------------------------------------------------------------
  var example = {
    hours: 3, carbsPerHour: 90, sodiumPerHour: 700, ratio: 'auto',
    format: 'bottle', containerMl: FC.flOzToMl(24), containers: 2, lemonG: 3
  };
  var r = FC.calculate(example);

  test('worked example: inputs accepted', function () { ok(r.ok, 'calculation failed: ' + r.errors); });
  test('worked example: auto ratio picks 1:0.8 at 90 g/h', function () { equal(r.ratio.label, '1:0.8 (auto)'); });
  test('worked example: 135 g carbs per bottle', function () { near(r.perContainer.carbs, 135); });
  test('worked example: maltodextrin 77.46 g per bottle', function () { near(r.perContainer.maltoG, 77.46); });
  test('worked example: fructose 58.87 g per bottle', function () { near(r.perContainer.fructoseG, 58.87); });
  test('worked example: sodium citrate 3.81 g per bottle', function () { near(r.perContainer.citrateG, 3.814); });
  test('worked example: table salt 0.40 g per bottle', function () { near(r.perContainer.saltG, 0.404); });
  test('worked example: citric acid 2.03 g per bottle', function () { near(r.perContainer.citricG, 2.025); });
  test('worked example: water ≈ 619.5 mL per bottle', function () { near(r.perContainer.waterMl, 619.5, 0.1); });
  test('worked example: 19.0 g carbs per 100 mL', function () { near(r.carbsPer100Ml, 19.02); });
  test('worked example: 1 bottle every 90 min', function () { near(r.minutesPerContainer, 90); });
  test('worked example: whole ride maltodextrin 154.9 g', function () { near(r.total.maltoG, 154.91); });
  test('worked example: strong-mix warning shown', function () {
    ok(r.warnings.some(function (w) { return /Strong mix/.test(w); }), 'no concentration warning');
  });
  test('worked example: carbs add back up to 270 g', function () {
    var s = FC.DEFAULT_SETTINGS;
    var carbs = r.total.maltoG * s.maltoCarbPct / 100 + r.total.fructoseG + r.total.lemonG * s.lemonCarbPct / 100;
    near(carbs, 270);
  });
  test('worked example: sodium adds back up to 2100 mg', function () {
    var s = FC.DEFAULT_SETTINGS;
    var mg = (r.total.citrateG * s.citrateSodiumPct / 100 + r.total.saltG * s.saltSodiumPct / 100) * 1000;
    near(mg, 2100);
  });

  // ---------- ratio ----------
  test('auto ratio: 2:1 below 75 g/h', function () { equal(FC.resolveRatio('auto', 74).label, '2:1 (auto)'); });
  test('auto ratio: 1:0.8 at exactly 75 g/h', function () { equal(FC.resolveRatio('auto', 75).label, '1:0.8 (auto)'); });
  test('2:1 splits carbs two-thirds / one-third', function () {
    var x = FC.calculate({ hours: 1, carbsPerHour: 60, sodiumPerHour: 0, ratio: '2:1', format: 'bottle', containerMl: 750, containers: 1, lemonG: 0 });
    near(x.perContainer.maltoG * 0.95, 40);
    near(x.perContainer.fructoseG, 20);
  });
  test('custom ratio 1:1', function () {
    var x = FC.calculate({ hours: 1, carbsPerHour: 80, sodiumPerHour: 0, ratio: { malto: 1, fructose: 1 }, format: 'bottle', containerMl: 750, containers: 1, lemonG: 0 });
    near(x.perContainer.fructoseG, 40);
  });

  // ---------- sodium ----------
  test('salt is capped at 1/8 tsp (≈292 mg sodium)', function () {
    var na = FC.splitSodium(3000, FC.withDefaults());
    near(na.saltMg, 292.5);
    near(na.citrateMg, 2707.5);
  });
  test('too much sodium citrate gives a warning', function () {
    var x = FC.calculate({ hours: 2, carbsPerHour: 60, sodiumPerHour: 1000, ratio: '2:1', format: 'bottle', containerMl: 750, containers: 1, lemonG: 3 });
    ok(x.warnings.some(function (w) { return /soapy/.test(w); }));
  });

  // ---------- flask ----------
  test('flask: water = carbs × 0.65', function () {
    var x = FC.calculate({ hours: 1, carbsPerHour: 90, sodiumPerHour: 700, ratio: 'auto', format: 'flask', containerMl: 150, containers: 1, lemonG: 3 });
    near(x.perContainer.waterMl, 58.5);
    equal(x.warnings.length, 0, 'warnings');
  });
  test('flask: overfull flask gives a warning', function () {
    var x = FC.calculate({ hours: 1, carbsPerHour: 120, sodiumPerHour: 700, ratio: 'auto', format: 'flask', containerMl: 150, containers: 1, lemonG: 3 });
    ok(x.warnings.some(function (w) { return /Too much for the flask/.test(w); }));
  });

  // ---------- commercial drink ----------
  test('commercial: 20 g / 380 mg × 3 scoops per hour', function () {
    var t = FC.targetsFromProduct({ carbsPerScoop: 20, sodiumPerScoop: 380, scoopsPerHour: 3 });
    near(t.carbsPerHour, 60); near(t.sodiumPerHour, 1140);
  });

  // ---------- batch ----------
  test('batch: 10 servings = 10 × one bottle', function () {
    var b = FC.batch(r.perContainer, { servings: 10 });
    near(b.amounts.maltoG, 774.56, 0.1);
    near(b.totalG, r.perContainer.powderG * 10, 0.01);
  });
  test('batch: by weight gives fractional servings', function () {
    var b = FC.batch(r.perContainer, { batchG: r.perContainer.powderG * 4.5 });
    near(b.servings, 4.5);
  });
  test('batch: 1/4 cup scoop nutrition is a share of one serving', function () {
    var b = FC.batch(r.perContainer, { servings: 1 });
    near(b.quarterCup.carbs / 135, b.quarterCup.grams / b.servingG, 1e-9);
  });

  // ---------- kitchen measures ----------
  test('format: 1/16 tsp', function () { equal(FC.formatTsp(0.07), '1/16 tsp'); });
  test('format: ⅝ tsp', function () { equal(FC.formatTsp(0.636), '⅝ tsp'); });
  test('format: 1⅛ tsp', function () { equal(FC.formatTsp(1.154), '1⅛ tsp'); });
  test('format: 1 Tbsp + 1½ tsp', function () { equal(FC.formatTsp(4.5), '1 Tbsp + 1½ tsp'); });
  test('format: ¼ cup + 2½ tsp', function () { equal(FC.formatTsp(14.72), '¼ cup + 2½ tsp'); });
  test('format: ½ cup + 1 Tbsp + 2½ tsp', function () { equal(FC.formatTsp(29.41), '½ cup + 1 Tbsp + 2½ tsp'); });
  test('format: 4¾ cups', function () { equal(FC.formatTsp(228), '4¾ cups'); });
  test('format: 1 cup (singular)', function () { equal(FC.formatTsp(48), '1 cup'); });
  test('format: 90 min → 1 h 30 min', function () { equal(FC.formatMinutes(90), '1 h 30 min'); });
  test('format: 40 min', function () { equal(FC.formatMinutes(40), '40 min'); });

  // ---------- bad input ----------
  test('rejects 0 containers', function () {
    var x = FC.calculate({ hours: 2, carbsPerHour: 90, sodiumPerHour: 700, ratio: 'auto', format: 'bottle', containerMl: 750, containers: 0, lemonG: 3 });
    ok(!x.ok && x.errors.length > 0);
  });
  test('rejects empty duration', function () {
    var x = FC.calculate({ hours: NaN, carbsPerHour: 90, sodiumPerHour: 700, ratio: 'auto', format: 'bottle', containerMl: 750, containers: 1, lemonG: 3 });
    ok(!x.ok);
  });
  test('powder that cannot fit in a bottle gives a warning', function () {
    var x = FC.calculate({ hours: 8, carbsPerHour: 120, sodiumPerHour: 700, ratio: 'auto', format: 'bottle', containerMl: 500, containers: 1, lemonG: 3 });
    ok(x.warnings.some(function (w) { return /won’t fit/.test(w); }));
  });

  // ---------- report ----------
  var failed = results.filter(function (t) { return !t.pass; });
  if (typeof window === 'undefined') {
    results.forEach(function (t) { console.log((t.pass ? '  ✓ ' : '  ✗ ') + t.name + (t.pass ? '' : '\n      ' + t.msg)); });
    console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');
    if (failed.length) process.exitCode = 1;
  } else {
    window.TEST_RESULTS = results;
  }
})();
