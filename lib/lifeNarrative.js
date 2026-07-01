// Plain-language wrapper around lifeSimulator.js output. Same rule as
// lib/narrative.js: never invent a number -- only narrate numbers the
// simulator already computed.

function gbp(n) {
  return `£${Math.round(n).toLocaleString()}`;
}

function buildLifeNarrative(sim) {
  const homeLine = sim.ageOfFirstHome
    ? `On this plan, a first home deposit in ${sim.locationLabel} (~${gbp(sim.depositTarget)}) is reachable around age ${sim.ageOfFirstHome}.`
    : `On this plan, the projected deposit for ${sim.locationLabel} (~${gbp(sim.depositTarget)}) isn't reached by age 75 -- lifestyle, location, or income would need to change.`;

  const retirementLine = sim.savingsAtRetirement === null
    ? `Retirement outcome not available for this retirement age target.`
    : `Cash savings peak at ~${gbp(sim.peakSavings)} on this plan, with ~${gbp(sim.savingsAtRetirement)} left at age ${sim.retirementAgeTarget} after retirement drawdown begins. This is a cash-only figure -- it excludes pension contributions, employer matching, the State Pension, and any investment growth, all of which would typically push the real number higher.`;

  const riskLines = sim.riskFlags.length
    ? sim.riskFlags
    : ["No major affordability or cashflow risk flags on this plan."];

  return {
    headline: `${sim.careerTitle} in ${sim.locationLabel}, ${sim.lifestyle} lifestyle${sim.hasPartner ? ", with a partner" : ""}${sim.kidsAt.length ? `, ${sim.kidsAt.length} child(ren)` : ""}.`,
    homeLine,
    retirementLine,
    riskLines,
    disclaimer: "Illustrative educational model only -- simplified UK averages, no real tax/pension/investment-growth modelling. Not financial advice.",
  };
}

module.exports = { buildLifeNarrative };
