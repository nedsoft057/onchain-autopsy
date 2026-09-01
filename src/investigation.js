const EXHAUSTED_HOLDER_REASONS = [
  undefined,
  "unsupported",
  "unsupported_by_provider",
  "unsupported_by_current_foundational_endpoint",
  "unsupported_by_current_endpoint",
  "capability_exhausted"
];

function count(group) {
  return Number(group?.walletCount || group?.wallets?.length || 0);
}

function n(value, fallback = 0) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}

function materialExit(holder = {}) {
  const buy = n(holder.buyVolume);
  const sell = n(holder.sellVolume);
  const sellRatio = buy > 0 ? sell / buy : 0;
  return Boolean(holder.sellCount > 0 && (sellRatio >= 0.75 || holder.sellCount >= 2));
}

function soldFraction(holder = {}) {
  const buy = n(holder.buyVolume);
  const sell = n(holder.sellVolume);
  return buy > 0 ? Math.max(0, Math.min(1, sell / buy)) : null;
}

export function assessSufficiency(observations = {}) {
  const blockers = [];
  const tokenEstablished = Boolean(observations.token?.established || observations.marketEstablished);
  const liquidityChecked = Boolean(observations.initialLiquidity);
  const holderChecked = Boolean(observations.holders);
  const holderUnavailable = holderChecked && observations.holders.supported === false;
  const holderCapabilityExhausted = holderUnavailable && EXHAUSTED_HOLDER_REASONS.includes(observations.holders.reason);

  if (!tokenEstablished) blockers.push("token_identity_unestablished");
  if (!liquidityChecked) blockers.push("liquidity_uninspected");
  if (!holderChecked) blockers.push("holder_distribution_uninspected");
  if (holderUnavailable && !holderCapabilityExhausted) blockers.push("holder_distribution_unavailable");

  const concentrationMeaningful = n(observations.holders?.concentratedShare) >= .30 || n(observations.holders?.top5Share) >= .50;
  const actorNeeded = Boolean(
    observations.holders?.sellerCount ||
    observations.holders?.sharedFundingSources?.length ||
    observations.holders?.deployerFundedWallets?.length ||
    observations.holders?.wallets?.some(materialExit)
  );
  const actorComplete = !actorNeeded || Boolean(observations.actorAnalysis);
  if (actorNeeded && !actorComplete) blockers.push("actor_behavior_uninspected");

  const coordinationClue = Boolean(
    observations.actorAnalysis?.coordinationClue ||
    observations.actorAnalysis?.coordinationSignal ||
    observations.actorAnalysis?.deployerLinkedExit ||
    observations.actorAnalysis?.sharedFundingDump ||
    observations.actorAnalysis?.topHolderExit ||
    n(observations.actorAnalysis?.earlySellerCount) >= 2 ||
    observations.actorAnalysis?.sharedFundingSellerGroups?.some(g => count(g) >= 2)
  );
  const relationshipRequired = Boolean(concentrationMeaningful || coordinationClue);
  const relationshipComplete = !relationshipRequired || Boolean(observations.walletCluster);
  if (relationshipRequired && !relationshipComplete) blockers.push("wallet_relationship_uninspected");

  const sellRequired = Boolean(
    observations.walletCluster ||
    observations.actorAnalysis?.coordinationClue ||
    observations.actorAnalysis?.coordinationSignal ||
    observations.actorAnalysis?.deployerLinkedExit ||
    observations.actorAnalysis?.sharedFundingSellerGroups?.length ||
    observations.actorAnalysis?.topHolderExit ||
    n(observations.actorAnalysis?.earlySellerCount) >= 2
  );
  const sellComplete = !sellRequired || Boolean(observations.sellSequence);
  if (sellRequired && !sellComplete) blockers.push("sell_sequence_uninspected");

  const recheckRequired = Boolean(observations.sellSequence?.coordinated);
  const recheckComplete = !recheckRequired || Boolean(observations.finalLiquidity);
  if (recheckRequired && !recheckComplete) blockers.push("post_sell_liquidity_uninspected");

  const complete = blockers.length === 0;
  return {
    status: complete ? "complete" : "blocked",
    complete,
    blockers,
    paths: {
      token_identity: tokenEstablished ? "resolved" : "missing",
      market_liquidity: liquidityChecked ? "resolved" : "missing",
      holder_distribution: holderCapabilityExhausted ? "exhausted" : holderUnavailable ? "unavailable" : holderChecked ? "resolved" : "missing",
      wallet_relationships: relationshipRequired ? (relationshipComplete ? "resolved" : "required") : "not_required",
      sell_sequence: sellRequired ? (sellComplete ? "resolved" : "required") : "not_required",
      post_sell_liquidity: recheckRequired ? (recheckComplete ? "resolved" : "required") : "not_required",
      actor_behavior: actorNeeded ? (actorComplete ? "resolved" : "required") : "not_required"
    }
  };
}

function signalModel(observations = {}) {
  const h = observations.holders || {};
  const actor = observations.actorAnalysis || {};
  const topHolderExit = actor.topHolderExit === true;
  const topHolderClusterExit = actor.topHolderClusterExit === true;
  const concentration = n(h.concentratedShare) >= .30 || n(h.top5Share) >= .50;
  const connectedCluster = observations.walletCluster?.strongCluster === true;
  const coordinatedSelling = observations.sellSequence?.coordinated === true;
  const liquidityExit = n(observations.finalLiquidity?.removalRatio ?? observations.initialLiquidity?.removalRatio) >= .75;
  const deployerExit = actor.deployerExit === true;
  const deployerLinkedExit = actor.deployerLinkedExit === true;
  const earlyHolderDump = actor.earlyHolderDump === true;
  const sharedFundingDump = actor.sharedFundingDump === true;
  const supplyManipulation = actor.supplyManipulation === true;
  const privilegedControlRisk = actor.privilegedControlRisk === true;

  const signals = {
    concentration,
    connectedCluster,
    coordinatedSelling,
    liquidityExit,
    deployerExit,
    deployerLinkedExit,
    topHolderExit,
    topHolderClusterExit,
    earlyHolderDump,
    sharedFundingDump,
    supplyManipulation,
    privilegedControlRisk
  };

  const positiveWeights = {
    concentration: 6,
    connectedCluster: 10,
    coordinatedSelling: 22,
    liquidityExit: 24,
    deployerExit: 32,
    deployerLinkedExit: 22,
    topHolderExit: 14,
    topHolderClusterExit: 20,
    earlyHolderDump: 16,
    sharedFundingDump: 20,
    supplyManipulation: 22,
    privilegedControlRisk: 8
  };

  const contributions = Object.entries(signals)
    .filter(([, value]) => value)
    .map(([signal, points]) => ({signal, points:positiveWeights[signal]}));

  const cautions = [];
  if (actor.deployerFundedWallets?.length && !deployerLinkedExit && !deployerExit) {
    cautions.push({signal:"deployer_distribution",points:0,reason:"Deployer-linked distribution was observed, but recipient selling has not been established; the transfer may represent an allocation or airdrop."});
  }
  if (actor.sharedFundingSellerGroups?.length && !sharedFundingDump) {
    cautions.push({signal:"shared_funding",points:0,reason:"Seller wallets share funding, but the evidence has not yet established that the shared-funded group collectively exited materially."});
  }
  if (actor.earlySellerCount && !earlyHolderDump) {
    cautions.push({signal:"early_selling",points:0,reason:"Early holders sold, but the available evidence has not established that the exits were coordinated or malicious."});
  }
  if (topHolderExit && !topHolderClusterExit && !deployerExit && !deployerLinkedExit) {
    cautions.push({signal:"top_holder_exit",points:0,reason:"A top holder materially exited, but a large-holder sale alone can be profit-taking and is not sufficient to establish a rug."});
  }

  const counterEvidence = [];
  if (!deployerExit) counterEvidence.push({type:"no_direct_deployer_exit",text:"No direct deployer selling was established."});
  if (!liquidityExit) counterEvidence.push({type:"no_confirmed_liquidity_exit",text:"No major liquidity removal was established."});
  if (!coordinatedSelling) counterEvidence.push({type:"no_confirmed_coordination",text:"No confirmed coordinated selling pattern was established."});
  if (!connectedCluster) counterEvidence.push({type:"no_strong_wallet_cluster",text:"No strong connected-wallet concentration was established."});

  let score = 5 + contributions.reduce((sum, x) => sum + x.points, 0);
  const exitFamilies = [
    deployerExit,
    deployerLinkedExit,
    topHolderClusterExit,
    sharedFundingDump,
    coordinatedSelling,
    liquidityExit,
    earlyHolderDump,
    supplyManipulation
  ].filter(Boolean).length;
  if (exitFamilies >= 2) score += 8;
  if (exitFamilies >= 3) score += 8;
  score = Math.max(1, Math.min(99, score));

  return {signals, contributions, cautions, counterEvidence, score, exitFamilies};
}

export function rugPatternScore(observations = {}) {
  return signalModel(observations).score;
}

export function verdictFromEvidence(observations = {}, sufficiency = assessSufficiency(observations)) {
  if (!sufficiency.complete) {
    return {label:"incomplete",score:null,confidence:0,independentSignals:0,signals:{},classification:"insufficient_evidence",explanation:"Autopsy has not gathered sufficient evidence to evaluate the rug pattern.",sufficiency};
  }

  const model = signalModel(observations);
  const {signals, contributions, cautions, counterEvidence, score, exitFamilies} = model;
  const actor = observations.actorAnalysis || {};
  const independentSignals = contributions.length;
  const directActorExit = signals.deployerExit || signals.deployerLinkedExit;
  const corroboratedExit = directActorExit && (signals.coordinatedSelling || signals.liquidityExit || signals.sharedFundingDump || signals.topHolderClusterExit);
  const strongGroupExit = signals.sharedFundingDump && (signals.coordinatedSelling || signals.liquidityExit || signals.topHolderClusterExit || signals.deployerLinkedExit);
  const multiHolderExit = signals.topHolderClusterExit || (signals.topHolderExit && signals.earlyHolderDump);

  // NOT_RUG is reserved for a clean investigation: no meaningful red flags or unresolved suspicious clues.
  // If suspicious evidence exists but the strict rug criteria are not met, classify it as SUSPICIOUS.
  let label = "not_rug";
  let classification = "organic_market_movement";
  let explanation = "No meaningful rug-pattern red flags were established; the available evidence is consistent with ordinary market movement.";

  if (signals.deployerExit) {
    label = "rug";
    classification = "direct_deployer_exit";
    explanation = "The deployer itself is associated with material selling activity, providing a direct extraction signal.";
  } else if (signals.deployerLinkedExit) {
    label = "rug";
    classification = "planned_insider_rug";
    explanation = "Wallets linked to the deployer recorded material exits, and the relationship is corroborated by additional holder, funding, timing, or liquidity evidence.";
  } else if (signals.liquidityExit && (signals.coordinatedSelling || signals.deployerLinkedExit || signals.sharedFundingDump || signals.topHolderClusterExit)) {
    label = "rug";
    classification = "coordinated_liquidity_exit";
    explanation = "A major liquidity exit coincides with an independently supported selling relationship, creating a corroborated extraction pattern.";
  } else if (strongGroupExit) {
    label = "rug";
    classification = "shared_funding_group_exit";
    explanation = `A shared-funded wallet group recorded material exits${actor.sharedFundingSellerGroups?.[0]?.walletCount ? ` across ${actor.sharedFundingSellerGroups[0].walletCount} sellers` : ""}, with additional evidence supporting the group as an economically connected actor.`;
  } else if (signals.coordinatedSelling) {
    label = "rug";
    classification = (signals.earlyHolderDump || signals.connectedCluster || actor.coordinationSignal === true) ? "coordinated_early_holder_dump" : "coordinated_seller_exit";
    explanation = "Related holders show corroborated coordinated selling behaviour consistent with an organized exit.";
  } else if (multiHolderExit && (signals.connectedCluster || signals.sharedFundingDump || signals.coordinatedSelling)) {
    label = "rug";
    classification = "large_holder_exit_pattern";
    explanation = "Multiple materially sized holders exited in a relationship-supported pattern, creating stronger evidence than a single large-holder sale alone.";
  } else if (signals.supplyManipulation && (signals.coordinatedSelling || signals.liquidityExit || signals.deployerLinkedExit)) {
    label = "rug";
    classification = "supply_manipulation";
    explanation = "Supply manipulation is corroborated by an observed extraction or exit signal.";
  } else if (signals.earlyHolderDump && signals.connectedCluster) {
    label = "rug";
    classification = "early_holder_dump";
    explanation = "Early holders disposed of unusually large positions within a relationship-supported group, consistent with a coordinated exit.";
  } else if (signals.deployerLinkedExit) {
    label = "suspicious";
    classification = "suspicious_deployer_distribution";
    explanation = "Deployer-funded wallets later sold materially, which is a strong insider-risk signal, but the available evidence does not yet establish a completed coordinated rug.";
  } else if (signals.topHolderClusterExit) {
    label = "suspicious";
    classification = "large_holder_exit_risk";
    explanation = "Multiple top holders materially exited, creating a significant distribution risk, but a coordinated or insider link is not established strongly enough for a rug verdict.";
  } else if (signals.privilegedControlRisk) {
    classification = "privileged_control_risk";
    explanation = "Privileged token controls create a material risk signal, but the available evidence does not by itself establish a completed rug.";
  } else if (signals.concentration) {
    classification = "concentration_risk";
    explanation = "Supply concentration creates measurable risk, but no stronger extraction pattern was established.";
  } else if (contributions.length || cautions.length) {
    // Evidence below the strict RUG threshold is not evidence of NOT_RUG.
    // Preserve the research findings while explicitly marking the case as unresolved/suspicious.
    label = "suspicious";
    classification = "suspicious_activity_unproven";
    explanation = "Autopsy established suspicious relationships or selling clues, but the available evidence does not establish a planned rug or a clean non-rug pattern.";
  }

  const confidence = independentSignals === 0
    ? .35
    : Math.min(.99, .50 + independentSignals * .055 + (corroboratedExit ? .10 : 0) + (exitFamilies >= 2 ? .08 : 0) + (exitFamilies >= 3 ? .05 : 0));

  return {label,score,confidence,independentSignals,signals,classification,explanation,contributions,cautions,counterEvidence,sufficiency};
}

export {materialExit, soldFraction};
