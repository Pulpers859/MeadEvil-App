(function(){
  "use strict";

  // Strict numeric coercion. Plain `Number()` turns "", "   ", null, [] and false
  // into 0, which is NOT the same as "the user left this blank" — and callers here
  // branch on `null` to mean unset. Treating a cleared input as a real 0 silently
  // zeroed whole nutrient plans (blank custom limits produced a 0 g schedule while
  // the panel still claimed it was hitting the YAN target), so blanks return null.
  function num(value){
    if (value === null || value === undefined || typeof value === "boolean") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    if (Array.isArray(value)) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function round(value, digits = 2){
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function clamp(value, min, max){
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function gallonsToLiters(gallons){
    const n = num(gallons);
    return n != null ? n * 3.78541 : null;
  }

  function sgToPoints(sg){
    const n = num(sg);
    return n && n > 1 ? (n - 1) * 1000 : null;
  }

  function pointsToSg(points){
    const n = num(points);
    return n != null && n >= 0 ? 1 + (n / 1000) : null;
  }

  function sgToBrix(sg){
    const n = num(sg);
    if (!(n > 1)) return null;
    return 182.4601 * n * n * n - 775.6821 * n * n + 1262.7794 * n - 669.5622;
  }

  function brixToSg(brix){
    const n = num(brix);
    if (!(n >= 0)) return null;
    return (n / (258.6 - ((n / 258.2) * 227.1))) + 1;
  }

  // ABV.
  //
  // The familiar (OG - FG) * 131.25 is calibrated for BEER gravities (OG <= ~1.070)
  // and understates alcohol badly in mead's normal range: at OG 1.130 / FG 1.000 it
  // reports 17.1% against a real ~19.3%, and at 1.160/1.010 it is ~4 points low.
  // Mead routinely starts at 1.100-1.150, so the beer factor is the wrong default
  // for this app. `calcABV` therefore uses the Cutaiar/Hall high-gravity formula,
  // which tracks the simple one closely at low gravity and diverges where it should.
  //
  // Both are exported: `calcABVSimple` is kept for reference and for anyone
  // reconciling MeadEvil's numbers against a beer calculator.
  function calcABVSimple(og, fg){
    const ogNum = num(og);
    const fgNum = num(fg);
    if (!(ogNum > 1 && fgNum > 0 && ogNum > fgNum)) return null;
    return (ogNum - fgNum) * 131.25;
  }

  const ABV_K = 76.08;
  const ABV_DIVISOR = 1.775;
  const ETHANOL_DENSITY = 0.794;
  function calcABV(og, fg){
    const ogNum = num(og);
    const fgNum = num(fg);
    if (!(ogNum > 1 && fgNum > 0 && ogNum > fgNum)) return null;
    if (!(ABV_DIVISOR - ogNum > 0)) return calcABVSimple(ogNum, fgNum);
    return (ABV_K * (ogNum - fgNum) / (ABV_DIVISOR - ogNum)) * (fgNum / ETHANOL_DENSITY);
  }

  // Inverse of calcABV: what OG lands a given ABV at a given finishing gravity.
  // Must invert the SAME formula calcABV uses, or the app plans a honey bill
  // against one model and then judges yeast tolerance against another — which is
  // exactly why an over-tolerance build used to sail past the warning.
  function ogForTargetAbv(targetAbv, fg){
    const abvNum = num(targetAbv);
    const fgNum = num(fg);
    if (!(abvNum > 0 && fgNum > 0)) return null;
    const k = (ABV_K * fgNum) / ETHANOL_DENSITY;
    const denom = k + abvNum;
    if (!(denom > 0)) return null;
    return ((ABV_DIVISOR * abvNum) + (k * fgNum)) / denom;
  }

  function sweetnessToFg(level){
    const normalized = String(level || "dry").toLowerCase();
    if (normalized === "off-dry") return 1.006;
    if (normalized === "semi-sweet") return 1.015;
    if (normalized === "sweet") return 1.025;
    return 0.998;
  }

  function estimateHoneyForTargetOG({ targetOg, batchGallons, honeyPPG = 35 } = {}){
    const ogNum = num(targetOg);
    const batchNum = num(batchGallons);
    const ppg = num(honeyPPG);
    if (!(ogNum > 1 && batchNum > 0 && ppg > 0)) return null;
    const totalPoints = sgToPoints(ogNum) * batchNum;
    const honeyLb = totalPoints / ppg;
    return {
      targetOg: ogNum,
      batchGallons: batchNum,
      honeyPPG: ppg,
      totalPoints,
      honeyLb,
      honeyOz: honeyLb * 16,
      honeyKg: honeyLb * 0.453592
    };
  }

  function estimateOGFromHoney({ honeyLb, batchGallons, honeyPPG = 35 } = {}){
    const honeyNum = num(honeyLb);
    const batchNum = num(batchGallons);
    const ppg = num(honeyPPG);
    if (!(honeyNum > 0 && batchNum > 0 && ppg > 0)) return null;
    const points = (honeyNum * ppg) / batchNum;
    return {
      honeyLb: honeyNum,
      batchGallons: batchNum,
      honeyPPG: ppg,
      gravityPoints: points,
      og: pointsToSg(points)
    };
  }

  function estimateRecipeTargets({ batchGallons, targetAbv, sweetness, yeastTolerance, honeyPPG = 35 } = {}){
    const batchNum = num(batchGallons);
    const abvNum = num(targetAbv);
    const toleranceNum = num(yeastTolerance);
    const resolvedFg = sweetnessToFg(sweetness);
    if (!(batchNum > 0 && abvNum > 0)) return null;
    const targetOg = ogForTargetAbv(abvNum, resolvedFg);
    if (!(targetOg > 1)) return null;
    const honey = estimateHoneyForTargetOG({ targetOg, batchGallons: batchNum, honeyPPG });
    // Judge tolerance against the ABV this OG will REALLY produce, not against the
    // number the user typed. Rounding and the sweetness assumption can push the
    // real figure past a yeast's ceiling while the requested value sits under it.
    const impliedAbv = calcABV(targetOg, resolvedFg) || abvNum;
    return {
      batchGallons: batchNum,
      targetAbv: abvNum,
      impliedAbv,
      targetFg: resolvedFg,
      targetOg,
      exceedsTolerance: toleranceNum > 0 ? Math.max(abvNum, impliedAbv) > toleranceNum : false,
      yeastTolerance: toleranceNum || null,
      honeyLb: honey ? honey.honeyLb : null,
      honeyKg: honey ? honey.honeyKg : null,
      totalPoints: honey ? honey.totalPoints : null
    };
  }

  function calcOneThirdBreak(og){
    const ogNum = num(og);
    if (!(ogNum > 1)) return null;
    const breakPoints = sgToPoints(ogNum) * (2 / 3);
    return pointsToSg(breakPoints);
  }

  function yeastRequirementFactor(level){
    const normalized = String(level || "medium").toLowerCase().replace(/[-_]/g, " ");
    if (normalized === "low") return 0.75;
    if (normalized === "high") return 1.25;
    if (normalized === "very high" || normalized === "veryhigh") return 1.8;
    return 0.90;
  }

  function calculateTosna({ batchGallons, og, brix, yeastRequirement = "medium" } = {}){
    const batchNum = num(batchGallons);
    const ogNum = num(og);
    const resolvedBrix = num(brix) || sgToBrix(ogNum);
    if (!(batchNum > 0 && resolvedBrix > 0)) return null;
    const factor = yeastRequirementFactor(yeastRequirement);
    const totalFermaidO = ((((resolvedBrix * 10) * factor) / 50) * batchNum);
    const addEach = totalFermaidO / 4;
    const breakGravity = calcOneThirdBreak(ogNum);
    return {
      batchGallons: batchNum,
      og: ogNum,
      brix: resolvedBrix,
      yeastRequirement,
      factor,
      totalFermaidO,
      addEach,
      breakGravity,
      schedule: [
        { label: "24 hours", grams: addEach },
        { label: "48 hours", grams: addEach },
        { label: "72 hours", grams: addEach },
        { label: "1/3 sugar break or day 7", grams: addEach }
      ]
    };
  }

  function suggestYanPpm({ og, yeastRequirement = "medium" } = {}){
    const ogNum = num(og);
    if (!(ogNum > 1)) return null;
    const brix = sgToBrix(ogNum);
    const factor = yeastRequirementFactor(yeastRequirement);
    const yan = factor * 10 * brix * ogNum * 0.9982;
    return Math.round(yan);
  }

  // Nutrient "effectiveness" = mg of YAN delivered per gram of product per liter
  // of must. DAP and Fermaid K use their measured YAN contribution (~210 and ~100
  // ppm per g/L) because their nitrogen is inorganic/high-efficiency and dosed 1:1.
  //
  // Fermaid O is different. Its *measured* YAN is only ~40 ppm per g/L (4% N), but
  // it is organic nitrogen that yeast assimilate far more efficiently, so every
  // real dosing model — including this app's own calculateTosna — doses on Fermaid
  // O's YAN *equivalence*, which Scott Labs documents at ~160-240 ppm per g/L. We
  // use 188.93 (= 50 * 3.78541 L/gal * 0.9982), the value that reconciles this
  // model's TOSNA mode with calculateTosna so both scale with gravity. Using the
  // raw measured 40 made Fermaid O demand so large that the 1.2 g/L cap always
  // bound, flattening the schedule into a fixed number regardless of OG.
  const FERMAID_O_YAN_PER_G_PER_L = 188.93;
  const FERMAID_K_YAN_PER_G_PER_L = 100;
  const DAP_YAN_PER_G_PER_L = 210;

  function calculateAdvancedNutrients({
    batchGallons,
    targetYanPpm,
    fruitOffsetPpm = 0,
    fermaidOEffectiveness = FERMAID_O_YAN_PER_G_PER_L,
    fermaidKEffectiveness = FERMAID_K_YAN_PER_G_PER_L,
    dapEffectiveness = DAP_YAN_PER_G_PER_L,
    protocol = "advanced",
    enforceLimits = true,
    limitO = 1.2,
    limitK = 0.5,
    limitD = 0.96,
    ratioO = 60,
    ratioK = 25,
    ratioD = 15,
    og = null
  } = {}){
    const gallons = num(batchGallons);
    const target = num(targetYanPpm);
    const offset = Math.max(0, num(fruitOffsetPpm) || 0);
    const liters = gallonsToLiters(gallons);
    const effO = num(fermaidOEffectiveness) || FERMAID_O_YAN_PER_G_PER_L;
    const effK = num(fermaidKEffectiveness) || FERMAID_K_YAN_PER_G_PER_L;
    const effD = num(dapEffectiveness) || DAP_YAN_PER_G_PER_L;
    const mode = String(protocol || "advanced");
    if (!(gallons > 0 && target > 0 && liters > 0)) return null;

    const effectiveYanPpm = Math.max(0, target - offset);
    const totalYanMg = effectiveYanPpm * liters;
    let gramsO = 0;
    let gramsK = 0;
    let gramsD = 0;
    // Respect an explicit 0 (custom mode: "none of this nutrient"); only fall
    // back to the default ceiling when the limit is genuinely unset/invalid.
    const limOverride = (value, fallback) => { const n = num(value); return n != null ? n : fallback; };
    const maxO = limOverride(limitO, 1.2) * liters;
    const maxK = limOverride(limitK, 0.5) * liters;
    const maxD = limOverride(limitD, 0.96) * liters;

    function cap(value, maxValue){
      return enforceLimits ? Math.min(maxValue, value) : value;
    }

    if (mode === "tosna"){
      gramsO = totalYanMg / effO;
      gramsO = cap(gramsO, maxO);
    } else if (mode === "k_dap_20_80"){
      const yanK = totalYanMg * 0.20;
      const yanD = totalYanMg * 0.80;
      gramsK = cap(yanK / effK, maxK);
      gramsD = cap(yanD / effD, maxD);
      if (!enforceLimits){
        const remainingMg = Math.max(0, totalYanMg - ((gramsK * effK) + (gramsD * effD)));
        if (remainingMg > 0) gramsD += remainingMg / effD;
      }
    } else if (mode === "custom"){
      const totalRatio = Math.max(1, (num(ratioO) || 0) + (num(ratioK) || 0) + (num(ratioD) || 0));
      const mgO = totalYanMg * ((num(ratioO) || 0) / totalRatio);
      const mgK = totalYanMg * ((num(ratioK) || 0) / totalRatio);
      const mgD = totalYanMg * ((num(ratioD) || 0) / totalRatio);
      gramsO = cap(mgO / effO, maxO);
      gramsK = cap(mgK / effK, maxK);
      gramsD = cap(mgD / effD, maxD);
    } else {
      let remainingMg = totalYanMg;
      gramsO = Math.min(maxO, remainingMg / effO);
      remainingMg -= gramsO * effO;
      gramsK = remainingMg > 0 ? Math.min(maxK, remainingMg / effK) : 0;
      remainingMg -= gramsK * effK;
      gramsD = remainingMg > 0 ? Math.min(maxD, remainingMg / effD) : 0;
      remainingMg -= gramsD * effD;
      // Only top Fermaid O back up past its cap when limits are intentionally
      // disabled; when enforceLimits is on, respect the ceiling and let the YAN
      // fall short rather than silently blowing through the limit the user set.
      if (remainingMg > 0 && !enforceLimits){
        gramsO += remainingMg / effO;
      }
    }

    const totalGrams = gramsO + gramsK + gramsD;
    // What the plan ACTUALLY delivers after the per-product ceilings bind. The UI
    // used to headline `effectiveYanPpm` (the target) regardless of capping, so a
    // high-gravity or high-nitrogen batch was told it was hitting e.g. 426 ppm
    // while the schedule really supplied ~227 ppm. Under-nutrition is the single
    // most common cause of a stalled, sulfury mead — so report both numbers and
    // let the caller say plainly when the plan falls short.
    const deliveredYanMg = (gramsO * effO) + (gramsK * effK) + (gramsD * effD);
    const deliveredYanPpm = liters > 0 ? deliveredYanMg / liters : 0;
    const yanShortfallPpm = Math.max(0, effectiveYanPpm - deliveredYanPpm);
    const capBound = enforceLimits && yanShortfallPpm > 1;
    const breakGravity = calcOneThirdBreak(og);
    const scheduleShares = [0.25, 0.25, 0.25, 0.25];
    const labels = ["24 hours", "48 hours", "72 hours", "1/3 sugar break or day 7"];
    const protocolLabelMap = {
      tosna: "Fermaid O (TOSNA 2.0)",
      k_dap_20_80: "Fermaid K / DAP (20%:80%)",
      advanced: "Fermaid O / Fermaid K / DAP (Advanced)",
      custom: "Custom"
    };

    return {
      batchGallons: gallons,
      liters,
      protocol: mode,
      protocolLabel: protocolLabelMap[mode] || "Advanced",
      targetYanPpm: target,
      fruitOffsetPpm: offset,
      effectiveYanPpm,
      totalYanMg,
      deliveredYanPpm,
      yanShortfallPpm,
      capBound,
      gramsO,
      gramsK,
      gramsD,
      totalGrams,
      breakGravity,
      schedule: labels.map((label, idx) => ({
        label,
        gramsO: gramsO * scheduleShares[idx],
        gramsK: gramsK * scheduleShares[idx],
        gramsD: gramsD * scheduleShares[idx],
        totalGrams: totalGrams * scheduleShares[idx]
      }))
    };
  }

  function calculateGoFerm(dryYeastGrams){
    const yeastNum = num(dryYeastGrams);
    if (!(yeastNum > 0)) return null;
    const goFermGrams = yeastNum * 1.25;
    return {
      dryYeastGrams: yeastNum,
      goFermGrams,
      rehydrationWaterMl: goFermGrams * 20
    };
  }

  function calculateBacksweetening({ volumeGallons, currentSg, targetSg, honeyPPG = 35 } = {}){
    const volume = num(volumeGallons);
    const current = num(currentSg);
    const target = num(targetSg);
    const ppg = num(honeyPPG);
    if (!(volume > 0 && current > 0 && target > current && ppg > 0)) return null;
    const pointIncrease = (target - current) * 1000;
    const honeyLb = (pointIncrease * volume) / ppg;
    return {
      volumeGallons: volume,
      currentSg: current,
      targetSg: target,
      pointIncrease,
      honeyPPG: ppg,
      honeyLb,
      honeyOz: honeyLb * 16,
      honeyKg: honeyLb * 0.453592
    };
  }

  function calculateBottleCount({ gallons, bottleOz = 12, lossPct = 5 } = {}){
    const gallonsNum = num(gallons);
    const bottleNum = num(bottleOz);
    // Clamp both ends: a loss above 100% used to yield negative bottle counts.
    const lossNum = clamp(num(lossPct) || 0, 0, 100);
    if (!(gallonsNum > 0 && bottleNum > 0)) return null;
    const packagedOz = gallonsNum * 128 * (1 - (lossNum / 100));
    const fullBottles = Math.floor(packagedOz / bottleNum);
    const leftoverOz = Math.max(0, packagedOz - (fullBottles * bottleNum));
    return { gallons: gallonsNum, bottleOz: bottleNum, lossPct: lossNum, packagedOz, fullBottles, leftoverOz };
  }

  function calculateBlend({ volume1, sg1, volume2, sg2 } = {}){
    const v1 = num(volume1);
    const s1 = num(sg1);
    const v2 = num(volume2);
    const s2 = num(sg2);
    if (!(v1 > 0 && s1 > 0 && v2 > 0 && s2 > 0)) return null;
    const totalVol = v1 + v2;
    // Use signed points so dry meads (SG < 1.000) blend correctly; the shared
    // sgToPoints/pointsToSg helpers clamp at 1.000 and would zero-out dry inputs.
    const signedPoints = (sg) => (sg - 1) * 1000;
    const weightedPoints = ((signedPoints(s1) * v1) + (signedPoints(s2) * v2)) / totalVol;
    return {
      totalVolume: totalVol,
      blendedSg: 1 + (weightedPoints / 1000),
      weightedPoints
    };
  }

  function calculateBenchTrial({ batchGallons, sampleMl, additionAmount } = {}){
    const gallons = num(batchGallons);
    const sample = num(sampleMl);
    const addition = num(additionAmount);
    if (!(gallons > 0 && sample > 0 && addition > 0)) return null;
    const batchMl = gallons * 3785.41;
    const scaleFactor = batchMl / sample;
    return {
      batchMl,
      scaleFactor,
      scaledAmount: addition * scaleFactor
    };
  }

  function calculateStepFeed({ volumeGallons, pointsPerFeed = 30, honeyPPG = 35, feedCount = 1 } = {}){
    const gallons = num(volumeGallons);
    const points = num(pointsPerFeed);
    const ppg = num(honeyPPG);
    const feeds = Math.max(1, num(feedCount) || 1);
    if (!(gallons > 0 && points > 0 && ppg > 0)) return null;
    const honeyLbPerFeed = (points * gallons) / ppg;
    return {
      volumeGallons: gallons,
      pointsPerFeed: points,
      honeyPPG: ppg,
      feedCount: feeds,
      honeyLbPerFeed,
      honeyOzPerFeed: honeyLbPerFeed * 16,
      honeyKgPerFeed: honeyLbPerFeed * 0.453592,
      totalHoneyLb: honeyLbPerFeed * feeds,
      totalHoneyKg: honeyLbPerFeed * feeds * 0.453592
    };
  }

  // Free SO2 needed to hold ~0.8 mg/L MOLECULAR SO2, the accepted protective
  // level for a still wine/mead. Molecular fraction follows the Henderson-
  // Hasselbalch relation for sulfurous acid (pKa1 = 1.81):
  //   free SO2 = molecular_target * (1 + 10^(pH - 1.81))
  // The previous hard-coded table was correct through pH 3.7 but had the last two
  // rows shifted down one step (pH 3.8 carried pH 3.9's value, pH 3.9 carried
  // pH 4.0's), a ~24% sulfite OVERDOSE at those pH values, and it flat-lined
  // above pH 4.0 where the real requirement keeps climbing steeply.
  const MOLECULAR_SO2_TARGET = 0.8;
  const SO2_PKA1 = 1.81;
  function freeSo2TargetPpm(ph){
    const phNum = num(ph);
    if (!(phNum > 0)) return 50;
    // Clamp to the range where this model is meaningful for mead/wine.
    const bounded = clamp(phNum, 2.8, 4.2);
    return Math.round(MOLECULAR_SO2_TARGET * (1 + Math.pow(10, bounded - SO2_PKA1)));
  }

  function calculateStabilizers({ volumeGallons, abv, ph } = {}){
    const gallons = num(volumeGallons);
    const abvNum = num(abv);
    if (!(gallons > 0 && abvNum > 0)) return null;
    const phAssumed = !(num(ph) > 0);
    const so2Ppm = freeSo2TargetPpm(phAssumed ? 3.6 : ph);
    const liters = gallonsToLiters(gallons);
    // Doses follow the MeadTools open-source stabilizer model (MIT):
    // sorbate need falls linearly with ABV and is unnecessary at 16%+.
    const sorbateGrams = Math.max(0, ((-abvNum * 25) + 400) / 0.75) * (liters / 1000);
    const kmetaGrams = (liters * so2Ppm) / 570;
    const campdenTablets = (so2Ppm / 75) * gallons;
    return {
      volumeGallons: gallons,
      abv: abvNum,
      ph: phAssumed ? 3.6 : num(ph),
      phAssumed,
      so2Ppm,
      sorbateGrams,
      sorbateUnnecessary: abvNum >= 16,
      kmetaGrams,
      campdenTablets
    };
  }

  function poundsFromAmount(amount, unit){
    const n = num(amount);
    if (!(n > 0)) return null;
    // CSV/backup import can carry any unit string. An unrecognised unit used to
    // return null, and calculateSourceBill silently DROPPED the whole row — an
    // all-ounce bill rendered as "no fermentables entered". Convert what we can.
    const normalized = String(unit || "lb").toLowerCase().trim();
    if (normalized === "lb" || normalized === "lbs" || normalized === "pound" || normalized === "pounds") return n;
    if (normalized === "kg" || normalized === "kgs" || normalized === "kilogram" || normalized === "kilograms") return n * 2.20462;
    if (normalized === "oz" || normalized === "ounce" || normalized === "ounces") return n / 16;
    if (normalized === "g" || normalized === "gram" || normalized === "grams") return n * 0.00220462;
    return null;
  }

  function calculateSourceBill({ batchGallons, rows = [] } = {}){
    const gallons = num(batchGallons);
    if (!(gallons > 0)) return null;
    let totalPoints = 0;
    const lineItems = [];
    rows.forEach((row) => {
      const pounds = poundsFromAmount(row.amount, row.unit);
      const ppg = num(row.ppg);
      if (!(pounds > 0 && ppg > 0)) return;
      const points = pounds * ppg;
      totalPoints += points;
      lineItems.push({
        id: row.id,
        description: row.description || row.sourceType || "Source",
        pounds,
        ppg,
        totalPoints: points,
        perGallonPoints: points / gallons
      });
    });
    // No valid fermentable rows means there is no source bill yet — return null
    // so the UI shows the "add fermentable rows" empty state instead of a phantom
    // OG 1.000 that triggers false "reality is low vs target" warnings.
    if (!lineItems.length) return null;
    return {
      batchGallons: gallons,
      totalPoints,
      gravityPointsPerGallon: totalPoints / gallons,
      estimatedOg: pointsToSg(totalPoints / gallons),
      lineItems
    };
  }

  function calculateFermenterVolumeEstimate({ bottomDiameter, topDiameter, totalHeight, liquidHeight, sedimentHeight = 0 } = {}){
    const bottomNum = num(bottomDiameter);
    const topNum = num(topDiameter);
    const heightNum = num(totalHeight);
    const liquidNum = num(liquidHeight);
    const sedimentNum = num(sedimentHeight) ?? 0;
    if (!(bottomNum > 0 && topNum > 0 && heightNum > 0 && liquidNum > 0)) return null;
    if (liquidNum > heightNum) return null;
    if (!(sedimentNum >= 0) || sedimentNum > liquidNum) return null;

    const bottomRadius = bottomNum / 2;
    const topRadius = topNum / 2;
    const slope = (topRadius - bottomRadius) / heightNum;
    const radiusAtHeight = (height) => bottomRadius + (slope * height);
    const segmentVolume = (height) => {
      if (!(height > 0)) return 0;
      const topSegmentRadius = radiusAtHeight(height);
      return (Math.PI * height / 3) * (
        (bottomRadius * bottomRadius) +
        (bottomRadius * topSegmentRadius) +
        (topSegmentRadius * topSegmentRadius)
      );
    };
    const toGallons = (cubicInches) => cubicInches / 231;
    const toLiters = (cubicInches) => cubicInches * 0.0163871;
    const toFluidOunces = (cubicInches) => cubicInches * 0.554113;

    const totalCubicInches = segmentVolume(liquidNum);
    const sedimentCubicInches = segmentVolume(sedimentNum);
    const netLiquidCubicInches = Math.max(0, totalCubicInches - sedimentCubicInches);
    const fillLineRadius = radiusAtHeight(liquidNum);

    return {
      bottomDiameter: bottomNum,
      topDiameter: topNum,
      totalHeight: heightNum,
      liquidHeight: liquidNum,
      sedimentHeight: sedimentNum,
      fillLineDiameter: fillLineRadius * 2,
      totalCubicInches,
      sedimentCubicInches,
      netLiquidCubicInches,
      totalGallons: toGallons(totalCubicInches),
      totalLiters: toLiters(totalCubicInches),
      totalFluidOunces: toFluidOunces(totalCubicInches),
      sedimentGallons: toGallons(sedimentCubicInches),
      sedimentLiters: toLiters(sedimentCubicInches),
      sedimentFluidOunces: toFluidOunces(sedimentCubicInches),
      netLiquidGallons: toGallons(netLiquidCubicInches),
      netLiquidLiters: toLiters(netLiquidCubicInches),
      netLiquidFluidOunces: toFluidOunces(netLiquidCubicInches)
    };
  }

  window.MeadLogic = {
    num,
    round,
    clamp,
    gallonsToLiters,
    sgToPoints,
    pointsToSg,
    sgToBrix,
    brixToSg,
    calcABV,
    calcABVSimple,
    ogForTargetAbv,
    sweetnessToFg,
    estimateHoneyForTargetOG,
    estimateOGFromHoney,
    estimateRecipeTargets,
    calcOneThirdBreak,
    yeastRequirementFactor,
    suggestYanPpm,
    calculateTosna,
    calculateAdvancedNutrients,
    calculateGoFerm,
    calculateBacksweetening,
    calculateBottleCount,
    calculateBlend,
    calculateBenchTrial,
    calculateStepFeed,
    calculateSourceBill,
    calculateFermenterVolumeEstimate,
    freeSo2TargetPpm,
    calculateStabilizers
  };
})();
