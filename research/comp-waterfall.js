/**
 * R0.3 comp explainability waterfall.
 *
 * Converts existing resolveAlibabaComp output into a stable, UI-friendly
 * breakdown without changing comp-engine internals.
 */

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function supplierKey(row) {
  const section = row?.section || '';
  const lastHyphen = section.lastIndexOf(' - ');
  const lastEm = section.lastIndexOf(' — ');
  const lastDash = Math.max(lastHyphen, lastEm);
  const raw = lastDash >= 0 ? section.slice(lastDash + 3).trim() : section.split(',')[0].trim();
  const norm = raw.replace(/\s*\([^)]+\)\s*$/, '').trim().toLowerCase();
  if (norm.includes('messi') || norm.includes('wuzhou')) return 'messi';
  if (norm.includes('starsgem') || norm.includes('stargem')) return 'starsgem';
  if (norm.includes('mishang')) return 'mishang';
  if (norm.includes('goldleaf')) return 'goldleaf';
  return norm || '_unknown';
}

function parseMultiplier(part) {
  const text = String(part || '');
  const match = text.match(/×\s*([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : null;
}

function partLabel(part) {
  return String(part || '')
    .replace(/\s*×\s*[0-9]+(?:\.[0-9]+)?\s*$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    || 'Adjustment';
}

function buildSteps(primary) {
  const listingPrice = finitePositive(primary?.listingPrice);
  const parts = primary?.modifiers?.parts || primary?.parts || [];
  if (!listingPrice) return [];

  let running = listingPrice;
  const steps = [{
    kind: 'start',
    label: 'Supplier listing',
    multiplier: 1,
    delta: 0,
    value: Math.round(running),
  }];

  for (const part of parts) {
    const multiplier = parseMultiplier(part);
    if (!multiplier || multiplier <= 0) continue;
    const next = running * multiplier;
    steps.push({
      kind: multiplier >= 1 ? 'increase' : 'decrease',
      label: partLabel(part),
      multiplier: Number(multiplier.toFixed(4)),
      delta: Math.round(next - running),
      value: Math.round(next),
      raw: String(part),
    });
    running = next;
  }

  const finalValue = finitePositive(primary?.estimatedPrice);
  if (finalValue && Math.abs(finalValue - running) > Math.max(2, finalValue * 0.01)) {
    steps.push({
      kind: 'final',
      label: 'Adjusted comp price',
      multiplier: null,
      delta: Math.round(finalValue - running),
      value: Math.round(finalValue),
    });
  }

  return steps;
}

function appendBlendFinalStep(steps, estimate) {
  const finalEstimate = finitePositive(estimate);
  if (!steps.length || !finalEstimate) return steps;
  const last = steps.at(-1)?.value;
  const tolerance = Math.max(2, finalEstimate * 0.005);
  if (Number.isFinite(last) && Math.abs(last - finalEstimate) <= tolerance) return steps;
  return [
    ...steps,
    {
      kind: 'final',
      label: 'Blended comp estimate',
      multiplier: null,
      delta: Number.isFinite(last) ? Math.round(finalEstimate - last) : 0,
      value: Math.round(finalEstimate),
    },
  ];
}

function supportRows(ac) {
  const support = Array.isArray(ac?.supportComps) ? ac.supportComps : [];
  const rawWeights = support.map(comp => {
    const sigma = finitePositive(comp?.sigmaLog);
    return sigma ? 1 / (sigma * sigma + 1e-4) : 0;
  });
  let finalWeights = rawWeights;

  if (support.length > 1) {
    const rawTotal = rawWeights.reduce((sum, weight) => sum + weight, 0);
    const supplierWeightSum = {};
    support.forEach((comp, index) => {
      const sk = supplierKey(comp?.row);
      supplierWeightSum[sk] = (supplierWeightSum[sk] || 0) + rawWeights[index];
    });
    const dominant = Object.entries(supplierWeightSum)
      .sort((a, b) => b[1] - a[1])
      .find(([, weight]) => rawTotal > 0 && weight / rawTotal > 0.65);
    if (dominant) {
      const [dominantSk, dominantWeight] = dominant;
      const otherWeight = rawTotal - dominantWeight;
      if (otherWeight > 0) {
        const cappedWeight = (0.65 * otherWeight) / (1 - 0.65);
        const scale = Math.min(1, cappedWeight / dominantWeight);
        finalWeights = rawWeights.map((weight, index) =>
          supplierKey(support[index]?.row) === dominantSk ? weight * scale : weight
        );
      }
    }
  }

  const finalTotal = finalWeights.reduce((sum, weight) => sum + weight, 0);

  return support.map((comp, index) => {
    const sigma = finitePositive(comp?.sigmaLog);
    return {
      label: comp?.row?.section || comp?.row?.supplier || comp?.row?.shape || 'Comp row',
      estimatedPrice: finitePositive(comp?.estimatedPrice),
      sigmaLog: sigma,
      blendWeight: finalTotal > 0 ? finalWeights[index] / finalTotal : null,
      score: Number.isFinite(Number(comp?.score)) ? Number(comp.score) : null,
    };
  });
}

export function buildCompWaterfall(ac) {
  if (!ac || ac.matchType === 'none' || !ac.primary) return null;
  const baseSteps = buildSteps(ac.primary);
  const steps = appendBlendFinalStep(baseSteps, ac.estimate);
  const support = supportRows(ac);
  const rejected = (Array.isArray(ac.rejectedComps) ? ac.rejectedComps : []).map(comp => ({
    label: comp?.row?.section || comp?.row?.supplier || comp?.row?.shape || 'Rejected comp',
    estimatedPrice: finitePositive(comp?.estimatedPrice),
    reason: comp?.reason || 'Outlier rejected',
  }));

  return {
    schemaVersion: 'comp-waterfall-v1',
    scope: 'comp_market',
    matchType: ac.matchType,
    confidence: ac.confidence || null,
    estimate: finitePositive(ac.estimate),
    low: finitePositive(ac.low),
    high: finitePositive(ac.high),
    calibration: ac.calibration || null,
    calibrationNote: ac.calibrationNote || null,
    primary: {
      label: ac.primary?.label || ac.primary?.row?.section || 'Primary comp',
      listingPrice: finitePositive(ac.primary?.listingPrice),
      estimatedPrice: finitePositive(ac.primary?.estimatedPrice),
      supplierKey: ac.primary?.supplierKey || null,
      url: ac.primary?.url || null,
    },
    steps,
    support,
    rejected,
    warnings: Array.isArray(ac.warnings) ? ac.warnings : [],
  };
}

export default { buildCompWaterfall };
