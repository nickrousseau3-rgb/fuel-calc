# Fuel Calc

A phone-first calculator for homemade high-carb cycling drink mixes and gels.

## Files

| File | What it is |
|---|---|
| `index.html` | The app (UI, CSS, UI code) |
| `calc.js` | All the math, as pure functions |
| `tests.js` | Tests for the math |
| `tests.html` | Runs the tests in a browser (works on iPhone) |
| `manifest.webmanifest`, `icon*.png`, `icon.svg` | Let you add it to your home screen |

## Use it

Live at **https://nickrousseau3-rgb.github.io/fuel-calc/** (once GitHub Pages is on).
Tests: **https://nickrousseau3-rgb.github.io/fuel-calc/tests.html**

Add to your iPhone home screen: open the link in **Safari** → Share button → **Add to Home Screen**.

Your settings and saved recipes are stored on that device only (in the browser's localStorage).
Clearing Safari website data deletes them.

## Deploy (GitHub Pages)

1. On github.com open the repo → **Settings** → **Pages**.
2. Source: **Deploy from a branch**. Branch: **main**, folder **/ (root)**. Save.
3. After about a minute the site is live at the URL above. Every push to `main` updates it.

GitHub Pages on a private repo needs a paid plan; on a free account make the repo public.

## Run the tests

```
node tests.js
```

Or open `tests.html` in any browser.

## Hand check of the worked example

The ride: 3 h at 90 g carbs/h, 700 mg sodium/h, 2 × 24 oz (709.8 mL) bottles, 3 g lemon powder per bottle, default settings.

**Carbs**

1. Total carbs = 3 × 90 = **270 g**, so 270 ÷ 2 = **135 g per bottle**.
2. Lemon carbs = 3 g × 85% = 2.55 g. That leaves 135 − 2.55 = 132.45 g to split.
3. The target is 90 g/h, which is ≥ 75, so the ratio is **1:0.8** (by carb grams):
   - Maltodextrin carbs = 132.45 × 1/1.8 = 73.58 g, so **73.58 ÷ 0.95 = 77.46 g of maltodextrin powder**
   - Fructose carbs = 132.45 × 0.8/1.8 = **58.87 g of fructose**

**Sodium**

4. Sodium per bottle = 3 × 700 ÷ 2 = 1050 mg.
   - Table salt share = 15% × 1050 = 157.5 mg (under the ⅛ tsp cap of 292.5 mg), so **157.5 ÷ 390 = 0.40 g of salt**
   - Sodium citrate = 1050 − 157.5 = 892.5 mg, so **892.5 ÷ 235 = 3.80 g of sodium citrate** (under the 4.5 g warning)

**Citric acid, water and drinking rate**

5. Citric acid = 135 × 0.015 = **2.03 g**.
6. Powder = 77.46 + 58.87 + 3.80 + 0.40 + 3 + 2.03 = 145.56 g. It takes up 145.56 × 0.62 = 90.25 mL.
   - Water = 709.76 − 90.25 = **619.5 mL** (about 21 fl oz)
7. Concentration = 135 ÷ 709.76 × 100 = **19.0 g per 100 mL**. That's over 12%, so the app shows a warning.
8. Drinking rate = 60 × 135 ÷ 90 = **1 bottle every 90 min**.

**Check:** the carbs add back up to 154.91 × 0.95 + 117.73 + 6 × 0.85 = 270 g. ✓

The test file checks every one of these numbers.
