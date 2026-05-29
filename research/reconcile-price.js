/**
 * R0.1 rules reconciler.
 *
 * Produces one fair-wholesale point estimate from baseline, comp-engine, and ML
 * source estimates. V1 ranges are heuristic by default; R0.2 can wrap the
 * point estimate with a conformal artifact via applyReconciledCalibration().
 */

import defaultConfig from './data/reconciler-config-v1.json' with { type: 'json' };

const SOURCE_KEYS = ['baseline', 'comp', 'ml'];

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function roundMoney(value) {
  return Math.max(1, Math.round(value));
}

function segmentOf(input) {
  return input?.query?.segment === 'fancy' ? 'fancy' : 'white';
}

function baseSigma(config, source, segment) {
  return Number(config.sourceSigmaLog?.[source]?.[segment])
    || Number(config.sourceSigmaLog?.[source]?.white)
    || 0.35;
}

function sourceAvailable(sourceInput) {
  return sourceInput?.available === true && finitePositive(sourceInput.total) !== null;
}

function normalizeSource(source, sourceInput, input, config) {
  const segment = segmentOf(input);
  const total = finitePositive(sourceInput?.total);
  if (!sourceAvailable(sourceInput) || total === null) return null;

  let sigma = finitePositive(sourceInput.sigmaLog) ?? baseSigma(config, source, segment);
  let cap = Number(config.sourceWeightCaps?.[source]?.[segment] ?? 1);
  const warnings = Array.isArray(sourceInput.warnings) ? [...sourceInput.warnings] : [];

  if (source === 'comp') {
    const matchType = sourceInput.matchType || 'none';
    const adj = config.compSupportAdjustments?.[matchType] || {};
    sigma *= Number(adj.sigmaMultiplier ?? 1);
    cap += Number(adj.capBonus ?? 0);
    const supportCount = Number(sourceInput.supportCount ?? 0);
    if (supportCount <= 0) {
      sigma *= 1.4;
      cap -= 0.2;
      warnings.push('Comp source has no support rows.');
    } else if (supportCount < 3) {
      sigma *= 1.18;
      cap -= 0.08;
      warnings.push('Comp source is thin.');
    }
    if (sourceInput.confidence === 'low') {
      sigma *= 1.18;
      cap -= 0.08;
    }
  }

  if (source === 'ml') {
    const mlAdj = config.mlAnchorAdjustments || {};
    if (sourceInput.anchorHit === false) {
      sigma *= Number(mlAdj.missSigmaMultiplier ?? 1.35);
      cap -= Number(mlAdj.missCapPenalty ?? 0.18);
      warnings.push('ML source has no direct anchor hit.');
    } else if (sourceInput.anchorHit === true) {
      sigma *= Number(mlAdj.hitSigmaMultiplier ?? 0.92);
    }
    const comp = input?.comp;
    const carat = Number(input?.query?.carat);
    const liquidRound = segment === 'white'
      && normalizeRoundShape(input?.query?.shape) === 'round'
      && Number.isFinite(carat)
      && carat >= 1
      && carat <= 2;
    if (
      liquidRound
      && compSourceUsable(comp)
      && (
        comp.matchType === 'exact'
        || (comp.matchType === 'nearest' && Number(comp.supportCount) >= 3)
      )
    ) {
      const mlCap = Number(config.mlLiquidRoundCap?.[segment] ?? 0.18);
      if (cap > mlCap) {
        cap = mlCap;
        warnings.push('ML weight capped for liquid 1–2ct round with strong comp support.');
      }
    }
  }

  if (input?.flags?.specialtyCut) {
    sigma *= source === 'comp' ? 1.12 : 1.2;
  }

  sigma = Math.max(0.08, Math.min(1.25, sigma));
  cap = Math.max(0.05, Math.min(1, cap));
  return {
    source,
    total,
    perCt: finitePositive(sourceInput.perCt),
    sigma,
    cap,
    rawWeight: 1 / (sigma * sigma),
    warnings,
  };
}

function applyCaps(items) {
  let weights = items.map(item => item.rawWeight);
  for (let pass = 0; pass < 8; pass++) {
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) break;
    let changed = false;
    for (let i = 0; i < items.length; i++) {
      const frac = weights[i] / total;
      if (frac > items[i].cap + 1e-9) {
        const others = total - weights[i];
        weights[i] = others > 0 ? (items[i].cap * others) / (1 - items[i].cap) : weights[i];
        changed = true;
      }
    }
    if (!changed) break;
  }
  const cappedTotal = weights.reduce((sum, w) => sum + w, 0);
  if (cappedTotal <= 0) return items.map(() => 1 / items.length);
  return weights.map(w => w / cappedTotal);
}

function disagreementRatioFor(items) {
  const totals = items.map(item => item.total).filter(v => Number.isFinite(v) && v > 0);
  if (totals.length < 2) return null;
  return Math.max(...totals) / Math.min(...totals);
}

function confidenceFor(sigmaLog, disagreementRatio, items, config) {
  const c = config.confidence || {};
  const availableSources = items.length;
  if (
    availableSources >= 2
    && sigmaLog <= Number(c.highMaxSigmaLog ?? 0.22)
    && (!disagreementRatio || disagreementRatio <= Number(c.highMaxDisagreement ?? 1.15))
  ) return 'high';
  if (
    availableSources >= 2
    && sigmaLog <= Number(c.mediumMaxSigmaLog ?? 0.34)
    && (!disagreementRatio || disagreementRatio <= Number(c.mediumMaxDisagreement ?? 1.32))
  ) return 'medium';
  return 'low';
}

function disagreementBandMultiplier(disagreementRatio, config) {
  if (!disagreementRatio) return 1;
  const d = config.disagreement || {};
  if (disagreementRatio >= Number(d.criticalRatio ?? 1.55)) return Number(d.bandWidenCritical ?? 1.65);
  if (disagreementRatio >= Number(d.highRatio ?? 1.32)) return Number(d.bandWidenHigh ?? 1.35);
  if (disagreementRatio >= Number(d.mediumRatio ?? 1.18)) return Number(d.bandWidenMedium ?? 1.12);
  return 1;
}

export function reconcileWholesale(input, config = defaultConfig) {
  const carat = finitePositive(input?.query?.carat) ?? 1;
  const items = SOURCE_KEYS
    .map(source => normalizeSource(source, input?.[source], input, config))
    .filter(Boolean);

  if (!items.length) {
    throw new Error('reconcileWholesale requires at least one available source estimate');
  }

  const normalizedWeights = applyCaps(items);
  const logEstimate = items.reduce((sum, item, i) => sum + Math.log(item.total) * normalizedWeights[i], 0);
  const estimate = Math.exp(logEstimate);
  const pooledVariance = items.reduce((sum, item, i) => sum + (normalizedWeights[i] * item.sigma) ** 2, 0);
  const disagreementRatio = input?.flags?.disagreementRatio || disagreementRatioFor(items);
  const band = config.band || {};
  const halfWidthLog = Math.max(
    Number(band.minimumHalfWidthLog ?? 0.12),
    Math.min(
      Number(band.maximumHalfWidthLog ?? 0.82),
      Number(band.z ?? 1.28) * Math.sqrt(pooledVariance) * disagreementBandMultiplier(disagreementRatio, config)
    )
  );

  const weights = { baseline: 0, comp: 0, ml: 0 };
  const sourceWarnings = [];
  items.forEach((item, i) => {
    weights[item.source] = Number(normalizedWeights[i].toFixed(4));
    sourceWarnings.push(...item.warnings);
  });

  const inputs = {
    baseline: sourceAvailable(input?.baseline) ? roundMoney(input.baseline.total) : null,
    comp: sourceAvailable(input?.comp) ? roundMoney(input.comp.total) : null,
    ml: sourceAvailable(input?.ml) ? roundMoney(input.ml.total) : null,
  };

  const warnings = [...new Set([
    ...sourceWarnings,
    ...(SOURCE_KEYS.filter(source => !sourceAvailable(input?.[source])).map(source => `${source} source unavailable.`)),
    ...(disagreementRatio && disagreementRatio >= Number(config.disagreement?.highRatio ?? 1.32)
      ? [`Source disagreement is high (${disagreementRatio.toFixed(2)}x).`]
      : []),
  ])];

  const roundedEstimate = roundMoney(estimate);
  const sigmaLog = halfWidthLog / Number(band.z ?? 1.28);

  return {
    schemaVersion: 'reconcile-result-v1',
    reconcilerVersion: config.reconcilerVersion || 'rules-v1',
    method: 'rules_v1',
    estimate: roundedEstimate,
    perCt: roundMoney(roundedEstimate / carat),
    low: roundMoney(Math.exp(logEstimate - halfWidthLog)),
    high: roundMoney(Math.exp(logEstimate + halfWidthLog)),
    confidence: confidenceFor(sigmaLog, disagreementRatio, items, config),
    weights,
    inputs,
    disagreementRatio: disagreementRatio ? Number(disagreementRatio.toFixed(4)) : null,
    bandKind: 'heuristic',
    warnings,
    calibration: null,
  };
}

function normalizeRoundShape(shape) {
  const key = String(shape || '').toLowerCase().replace(/\s+/g, '_');
  return key === 'round' || key === 'round_brilliant' ? 'round' : key;
}

/** Prefer tighter sub-segments when holdout support exists. */
export function resolveConformalSegment(input, artifact) {
  const q = input?.query;
  const segment = segmentOf(input);
  if (
    q?.segment === 'white'
    && normalizeRoundShape(q.shape) === 'round'
    && Number(q.carat) >= 1
    && Number(q.carat) <= 2
    && finitePositive(artifact?.segments?.white_round_1_2?.qLog)
  ) {
    return 'white_round_1_2';
  }
  if (artifact?.segments?.[segment]) return segment;
  return 'fallback';
}

function effectiveConformalQLog(selected, input, result, artifact) {
  let qLog = finitePositive(selected?.qLog);
  if (!qLog) return null;
  const tighten = artifact?.supportTightening;
  if (tighten) {
    const disagreement = Number(result?.disagreementRatio ?? input?.flags?.disagreementRatio);
    if (
      result?.confidence === 'high'
      && (!disagreement || disagreement <= Number(tighten.highSupportMaxDisagreement ?? 1.18))
    ) {
      qLog *= Number(tighten.highSupportFactor ?? 0.72);
    }
    if (input?.comp?.matchType === 'exact') {
      qLog *= Number(tighten.exactCompFactor ?? 0.88);
    }
    if (input?.comp?.matchType === 'nearest' && result?.confidence !== 'low') {
      qLog *= Number(tighten.nearestCompFactor ?? 0.92);
    }
  }
  const floor = Number(artifact?.band?.minimumQLog ?? 0.11);
  const ceiling = Number(artifact?.band?.maximumQLog ?? 0.42);
  return Math.min(ceiling, Math.max(floor, qLog));
}

export function applyReconciledCalibration(result, input, artifact) {
  if (!result || !artifact || artifact.status === 'disabled') return result;
  const segmentKey = resolveConformalSegment(input, artifact);
  const selected = artifact.segments?.[segmentKey] || artifact.fallback;
  const qLog = effectiveConformalQLog(selected, input, result, artifact);
  if (!qLog) return result;
  const calibration = {
    targetCoverage: artifact.targetCoverage || 0.8,
    segment: segmentKey,
    qLog,
    reportingCoverage: Number(selected.reportingCoverage),
    nReport: Number(selected.nReport),
    reportingSupport: Number(selected.nReport) >= 20 ? 'standard' : 'low',
    method: artifact.method || 'split_conformal_log_residual',
    runId: artifact.runId || artifact.version || 'reconciled-conformal-v1',
    calibratedAt: artifact.createdAt || null,
  };
  return {
    ...result,
    low: roundMoney(result.estimate * Math.exp(-qLog)),
    high: roundMoney(result.estimate * Math.exp(qLog)),
    bandKind: 'conformal',
    calibration,
  };
}

/** Comp path is usable for reconciliation (listing-backed, not matchType none). */
export function compSourceUsable(comp) {
  const total = finitePositive(comp?.total);
  if (total === null) return false;
  const matchType = comp?.matchType ?? 'none';
  return matchType !== 'none';
}

/** ML path is usable for reconciliation. */
export function mlSourceUsable(ml) {
  return finitePositive(ml?.total) !== null;
}

/** At least one market source (comp and/or ML) is available. */
export function marketSourcesUsable(comp, ml) {
  return compSourceUsable(comp) || mlSourceUsable(ml);
}

/**
 * Drop baseline from the blend when comp and/or ML are available.
 * Baseline remains a last-resort fallback only when both market sources fail.
 */
export function applyBaselineFallbackPolicy(input) {
  if (!input || !marketSourcesUsable(input.comp, input.ml)) return input;
  const warnings = Array.isArray(input.baseline?.warnings) ? [...input.baseline.warnings] : [];
  warnings.push('Baseline curve omitted from blend — comp and/or ML are in use.');
  return {
    ...input,
    baseline: {
      ...input.baseline,
      total: null,
      perCt: null,
      available: false,
      warnings,
    },
  };
}

export function buildReconcileInput({
  query,
  baseline,
  comp,
  ml,
  flags = {},
  baselineFallbackOnly = true,
}) {
  const carat = finitePositive(query?.carat) ?? 1;
  const segment = query?.segment === 'fancy' ? 'fancy' : 'white';
  const makeSource = (source, fallbackSigma) => {
    const total = finitePositive(source?.total);
    return {
      total,
      perCt: finitePositive(source?.perCt) ?? (total ? total / carat : null),
      sigmaLog: finitePositive(source?.sigmaLog) ?? fallbackSigma,
      available: total !== null,
      warnings: Array.isArray(source?.warnings) ? source.warnings : [],
      ...source,
      total,
    };
  };
  let base = {
    schemaVersion: 'reconcile-input-v1',
    query: {
      carat,
      segment,
      shape: query?.shape || 'unknown',
      whiteGrade: query?.whiteGrade ?? null,
      colorFamily: query?.colorFamily ?? null,
      colorFamilyKey: query?.colorFamilyKey ?? null,
      clarity: query?.clarity || 'VS1',
      inferenceMode: query?.inferenceMode || 'standard',
    },
    baseline: makeSource(baseline, null),
    comp: {
      ...makeSource(comp, null),
      supportCount: Number(comp?.supportCount ?? 0),
      matchType: comp?.matchType ?? null,
      confidence: comp?.confidence ?? null,
    },
    ml: {
      ...makeSource(ml, null),
      anchorHit: typeof ml?.anchorHit === 'boolean' ? ml.anchorHit : null,
      modelName: ml?.modelName ?? null,
    },
    flags: {
      disagreementRatio: flags.disagreementRatio ?? null,
      chinaFactory: !!flags.chinaFactory,
      specialtyCut: !!flags.specialtyCut,
    },
  };

  if (baselineFallbackOnly) {
    base = applyBaselineFallbackPolicy(base);
  }

  const totals = SOURCE_KEYS
    .map(source => finitePositive(base[source].total))
    .filter(v => v !== null);
  if (!base.flags.disagreementRatio && totals.length >= 2) {
    base.flags.disagreementRatio = Number((Math.max(...totals) / Math.min(...totals)).toFixed(4));
  }
  return base;
}

export default {
  applyBaselineFallbackPolicy,
  buildReconcileInput,
  applyReconciledCalibration,
  reconcileWholesale,
  compSourceUsable,
  marketSourcesUsable,
  mlSourceUsable,
  resolveConformalSegment,
};
