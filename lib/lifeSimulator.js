// Life Simulator -- projects a full-life trajectory (financial + milestones)
// for a chosen career path, location, and set of life choices.
//
// Same architectural rule as the Future Path Generator: this is a
// deterministic, rules-based model. No LLM touches the numbers. Every figure
// is either pulled from data/careers.json, data/locations.json, or computed
// here from a small set of named, documented assumptions below. The
// narrative layer (buildLifeNarrative) only writes the sentences around it.
//
// IMPORTANT: This is an illustrative educational model with simplified UK
// averages, not financial advice. Real tax, pension, investment growth and
// inflation modelling are out of scope for this MVP -- see README.

const fs = require("fs");
const path = require("path");

const CAREERS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "careers.json"), "utf-8"));
const LOCATIONS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "locations.json"), "utf-8"));

// ---- Named assumptions (illustrative, UK-ish, 2026 prices, no inflation adjustment) ----
const ASSUMPTIONS = {
  startAge: 22,
  endAge: 75,
  incomeRampYears: 10, // years from earningsEarly -> earningsLate
  postRampAnnualGrowth: 0.02, // nominal growth after reaching "established" income
  takeHomeFraction: 0.72, // flat illustrative UK tax/NI/pension deduction approximation
  partnerIncomeAnnual: 30000, // illustrative UK median full-time salary for a partner
  baseLivingCostSingle: 14000, // annual essentials (food, transport, bills) excluding housing, cost-of-living-index 1.0
  partnerLivingCostExtra: 7000, // additional household essentials if a partner is present
  perChildAnnualCost: 9000, // illustrative UK average cost of raising a child per year
  depositFraction: 0.1, // deposit needed as fraction of avg house price
  mortgageTermYears: 25,
  mortgageRate: 0.045,
  rentAnnualFractionOfHousePrice: 0.045, // illustrative rent yield assumption
  lifestyleSavingsRate: { frugal: 0.35, balanced: 0.18, spender: 0.05 },
};
// NOTE: this model deliberately does NOT compound investment/pension growth on
// savings -- it's a cash-only floor estimate. Real outcomes with a pension,
// employer contributions, and invested savings would typically be higher.
// Don't compare the resulting pot against a "you should have Nx salary" rule
// of thumb -- that rule assumes investment growth this model excludes.

function mortgageAnnualPayment(principal, rate, years) {
  const r = rate;
  const n = years;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

function incomeAtAge(career, age, startAge) {
  const yearsIn = age - startAge;
  if (yearsIn <= 0) return career.earningsEarly;
  if (yearsIn >= ASSUMPTIONS.incomeRampYears) {
    const extraYears = yearsIn - ASSUMPTIONS.incomeRampYears;
    return career.earningsLate * Math.pow(1 + ASSUMPTIONS.postRampAnnualGrowth, extraYears);
  }
  const t = yearsIn / ASSUMPTIONS.incomeRampYears;
  return career.earningsEarly + (career.earningsLate - career.earningsEarly) * t;
}

function simulateLife(input) {
  const career = CAREERS.find((c) => c.id === input.careerId);
  const location = LOCATIONS.find((l) => l.id === input.locationId);
  if (!career) throw new Error(`Unknown careerId: ${input.careerId}`);
  if (!location) throw new Error(`Unknown locationId: ${input.locationId}`);

  const lifestyle = ASSUMPTIONS.lifestyleSavingsRate[input.lifestyle] ? input.lifestyle : "balanced";
  const savingsRate = ASSUMPTIONS.lifestyleSavingsRate[lifestyle];
  const hasPartner = !!input.hasPartner;
  const kidsAt = Array.isArray(input.kidsAt) ? input.kidsAt : [];
  const retirementAgeTarget = input.retirementAgeTarget || 67;

  const depositTarget = location.avgHousePrice * ASSUMPTIONS.depositFraction;
  const mortgagePrincipal = location.avgHousePrice - depositTarget;
  const annualMortgage = mortgageAnnualPayment(mortgagePrincipal, ASSUMPTIONS.mortgageRate, ASSUMPTIONS.mortgageTermYears);
  const annualRent = location.avgHousePrice * ASSUMPTIONS.rentAnnualFractionOfHousePrice;

  let savings = 0;
  let ownsHome = false;
  let mortgageYearsRemaining = 0;
  let ageOfFirstHome = null;
  const riskFlags = [];
  const timeline = [];
  let negativeCashflowStreak = 0;

  for (let age = ASSUMPTIONS.startAge; age <= ASSUMPTIONS.endAge; age++) {
    const working = age < retirementAgeTarget;
    const grossIncome = working ? incomeAtAge(career, age, ASSUMPTIONS.startAge) : 0;
    const takeHome = grossIncome * ASSUMPTIONS.takeHomeFraction;
    const partnerTakeHome = hasPartner && working ? ASSUMPTIONS.partnerIncomeAnnual * ASSUMPTIONS.takeHomeFraction : 0;

    const numKidsAlive = kidsAt.filter((kidBirthAge) => age >= kidBirthAge && age < kidBirthAge + 21).length;
    const essentials =
      (ASSUMPTIONS.baseLivingCostSingle + (hasPartner ? ASSUMPTIONS.partnerLivingCostExtra : 0)) * location.costOfLivingIndex +
      numKidsAlive * ASSUMPTIONS.perChildAnnualCost;

    let housingCost;
    if (ownsHome) {
      housingCost = mortgageYearsRemaining > 0 ? annualMortgage : 0;
      if (mortgageYearsRemaining > 0) mortgageYearsRemaining--;
    } else {
      // No extra cost-of-living multiplier here: avgHousePrice (and therefore
      // annualRent, derived from it) is already location-specific.
      housingCost = annualRent;
    }

    let netCashflow;
    if (working) {
      netCashflow = takeHome + partnerTakeHome - essentials - housingCost;
    } else {
      // Retired: drawing down savings, no employment income modelled (no pension-pot growth in this MVP).
      netCashflow = -(essentials + housingCost);
    }

    if (netCashflow >= 0) {
      savings += working ? netCashflow * savingsRate : 0;
      // unsaved portion of positive cashflow is treated as lifestyle spend, not tracked further
      negativeCashflowStreak = 0;
    } else {
      savings += netCashflow; // draw down savings to cover the shortfall
      negativeCashflowStreak++;
      // Retirement drawdown is expected (no income, living off savings) --
      // only flag sustained negative cashflow as a risk while still working.
      if (negativeCashflowStreak === 3 && working) {
        riskFlags.push(`Sustained negative cashflow starting around age ${age - 2} -- costs outpacing income for 3+ years.`);
      }
    }

    if (!ownsHome && savings >= depositTarget && working) {
      ownsHome = true;
      ageOfFirstHome = age;
      savings -= depositTarget;
      mortgageYearsRemaining = ASSUMPTIONS.mortgageTermYears;
    }

    if (age % 5 === 0 || age === ASSUMPTIONS.startAge || age === retirementAgeTarget) {
      timeline.push({
        age,
        grossIncome: Math.round(grossIncome),
        netCashflow: Math.round(netCashflow),
        savings: Math.round(savings),
        ownsHome,
        numKidsAtHome: numKidsAlive,
      });
    }
  }

  const finalSalary = incomeAtAge(career, retirementAgeTarget - 1, ASSUMPTIONS.startAge);
  const savingsAtRetirement = timeline.find((t) => t.age === retirementAgeTarget)?.savings ?? null;
  // peakSavings = the most this plan ever accumulates before retirement drawdown begins --
  // a more honest "did this plan ever get ahead" signal than the value exactly at retirement age.
  const peakSavings = Math.max(...timeline.filter((t) => t.age <= retirementAgeTarget).map((t) => t.savings));

  if (!ageOfFirstHome) {
    riskFlags.push(`Deposit of ~£${Math.round(depositTarget).toLocaleString()} for ${location.label} not reached by age ${ASSUMPTIONS.endAge} at this savings rate.`);
  }
  if (peakSavings < 0) {
    riskFlags.push(`Cash savings never go positive on this plan -- essentials and housing consistently outpace income.`);
  }

  return {
    careerId: career.id,
    careerTitle: career.title,
    locationId: location.id,
    locationLabel: location.label,
    lifestyle,
    hasPartner,
    kidsAt,
    retirementAgeTarget,
    depositTarget: Math.round(depositTarget),
    ageOfFirstHome,
    finalSalary: Math.round(finalSalary),
    peakSavings: Math.round(peakSavings),
    savingsAtRetirement: savingsAtRetirement !== null ? Math.round(savingsAtRetirement) : null,
    riskFlags,
    timeline,
  };
}

module.exports = { simulateLife, ASSUMPTIONS, CAREERS, LOCATIONS };
