import { KB, rationalOutcomes, type SpecialtyKey } from "./kb.ts";
import { OUTCOME_ONTOLOGY, type OutcomeCandidate } from "./outcome-ontology.ts";
import { resolveKnownOutcome, type OutcomeDirection, type PicoSlots } from "./clinical-semantics.ts";

export type OutcomeTier = "critical" | "surrogate" | "safety" | "patient-reported";

export interface DerivedOutcome {
  outcome: string;
  canonical: string;
  direction: OutcomeDirection;
  tier: OutcomeTier;
  tierLabel: string;
  rationale: string;
  score: number;
  family: string;
  priority: number;
}

export interface OutcomeDerivationResult {
  outcomes: DerivedOutcome[];
  primaryOutcome: DerivedOutcome;
  secondaryOutcomes: DerivedOutcome[];
  safetyOutcome?: DerivedOutcome;
  patientReportedOutcome?: DerivedOutcome;
  advisories?: string[];
}

const TIER_ORDER: Record<OutcomeTier, number> = {
  critical: 1,
  surrogate: 2,
  safety: 3,
  "patient-reported": 4
};

const TIER_LABELS: Record<OutcomeTier, string> = {
  critical: "Primary Patient-Centered",
  surrogate: "Clinical / Surrogate Endpoint",
  safety: "Safety & Adverse Events",
  "patient-reported": "Patient-Reported & Quality of Life"
};

function assignOutcomeTier(candidate: OutcomeCandidate): OutcomeTier {
  const lower = `${candidate.label} ${candidate.shortLabel} ${candidate.category}`.toLowerCase();

  if (
    candidate.category === "safety" ||
    /\b(ohss|miscarriage|mortality|death|adverse|cancellation|bleeding|morbidity|loss|infection|rupture|hemorrhage)\b/i.test(lower)
  ) {
    return "safety";
  }

  if (
    candidate.category === "quality-of-life" ||
    /\b(quality of life|satisfaction|patient-reported|pain relief|burden|symptom relief)\b/i.test(lower)
  ) {
    return "patient-reported";
  }

  if (
    /\b(live birth|cumulative live birth|full-term birth|neonatal survival|perinatal survival)\b/i.test(lower) ||
    (candidate.preferredForPrimaryOutcome && /\b(birth|survival|delivery)\b/i.test(lower))
  ) {
    return "critical";
  }

  return "surrogate";
}

function resolveOutcomeDirection(candidate: OutcomeCandidate, tier: OutcomeTier): OutcomeDirection {
  if (tier === "safety") return "adverse";
  const lower = `${candidate.label} ${candidate.shortLabel}`.toLowerCase();
  if (/^time to\b/i.test(lower)) return "time" as OutcomeDirection;
  if (/\b(mortality|morbidity|loss|miscarriage|preterm|complication|recurrence|adverse|admission|failure|death|bleeding|pain|cesarean|nicu|ohss|hyperstimulation|cancellation)\b/i.test(lower)) {
    return "adverse";
  }
  return "desirable";
}

function computeJaccard(a: string, b: string): number {
  const aTokens = a.toLowerCase().split(/\s+/).filter(Boolean);
  const bTokens = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (!aTokens.length || !bTokens.length) return 0;
  const intersection = aTokens.filter(t => bTokens.includes(t));
  const union = new Set([...aTokens, ...bTokens]);
  return union.size > 0 ? intersection.length / union.size : 0;
}

export function dedupeDerivedOutcomes(outcomes: DerivedOutcome[]): DerivedOutcome[] {
  const result: DerivedOutcome[] = [];
  for (const item of outcomes) {
    let isDupe = false;
    for (let i = 0; i < result.length; i++) {
      const existing = result[i];
      const jaccard = computeJaccard(existing.outcome, item.outcome);
      if (jaccard > 0.7) {
        isDupe = true;
        // Keep the more specific phrase or higher-scoring outcome
        if (item.outcome.length > existing.outcome.length || item.score > existing.score) {
          result[i] = item;
        }
        break;
      }
    }
    if (!isDupe) {
      result.push(item);
    }
  }
  return result;
}

function buildOutcomeRationale(
  candidate: OutcomeCandidate,
  tier: OutcomeTier,
  condition: string,
  interventions: string[]
): string {
  const condText = condition ? `in ${condition}` : "in clinical practice";
  const ivText = interventions.length ? interventions.join(" and ") : "the evaluated intervention";

  switch (tier) {
    case "critical":
      return `Applicable to ${ivText} ${condText}; primary patient-centered endpoint evaluating definitive clinical efficacy.`;
    case "surrogate":
      return `Evaluates intermediate clinical efficacy and procedural response (${candidate.label}) for ${ivText} ${condText}.`;
    case "safety":
      return `Monitors treatment safety, risk balance, and procedural adverse events (${candidate.label}) with ${ivText}.`;
    case "patient-reported":
      return `Assesses patient-reported outcomes, treatment burden, and symptom satisfaction ${condText}.`;
  }
}

/**
 * Derives a logically ranked, justified outcome list parameterized by PICO slots.
 */
export function deriveOutcomes(
  slots: PicoSlots,
  preferredSpecialty?: SpecialtyKey | null
): OutcomeDerivationResult {
  const rawCondition = slots.population[0] || "";
  const cleanCond = rawCondition
    .trim()
    .replace(/^(?:(?:pregnant\s+)?women\s+with|(?:pregnant\s+)?woman\s+with|patients?\s+with)\s+/i, "")
    .trim();

  const interventions = slots.interventions || [];
  const comparators = slots.comparators || [];
  const statedOutcomes = slots.outcomes || [];
  const ivLowerList = [...interventions, ...comparators].map(i => i.toLowerCase().trim());

  // Determine specialty
  let specialty: SpecialtyKey = preferredSpecialty || "obstetrics";
  if (!preferredSpecialty) {
    const combined = `${cleanCond} ${interventions.join(" ")} ${comparators.join(" ")}`.toLowerCase();
    if (/ivf|icsi|infertility|infertile|poor responder|reserve|ovari|dor|pcos|polycystic|stimulation|letrozole|clomiphene|clomifene|gonadotropin|menopur|follitropin|oocyte|ovulation|embryo|blastocyst|implantation|iui|art\b/i.test(combined)) {
      specialty = "infertility";
    } else if (/fibroid|myoma|endometri|adenomyosis|bleeding|pelvic|hysterectomy|dysplasia|cin\b|prolapse|urogynecolog|menorrhagia/i.test(combined)) {
      specialty = "gynecology";
    } else if (/pregnan|gestat|labor|birth|cervix|cerclage|preeclampsia|fetal|maternal|trimester|delivery|cesarean|caesarean|postpartum|chorioamnionitis|placenta/i.test(combined)) {
      specialty = "obstetrics";
    }
  }

  // Gather condition guidance from rationalOutcomes
  const conditionGuidance = rationalOutcomes(cleanCond, specialty);
  const conditionGuidanceLower = [
    conditionGuidance.primary.toLowerCase(),
    ...conditionGuidance.alternatives.map(a => a.toLowerCase())
  ];

  const scoredList: DerivedOutcome[] = [];

  for (const candidate of OUTCOME_ONTOLOGY) {
    const candidateLower = candidate.label.toLowerCase();
    const shortLower = candidate.shortLabel.toLowerCase();

    // Cross-slot conflict rule: never offer an outcome that matches an intervention or comparator
    const matchesIvOrComp = ivLowerList.some(
      iv => iv && (candidateLower === iv || shortLower === iv || iv.includes(candidateLower) || candidateLower.includes(iv))
    );
    if (matchesIvOrComp) continue;

    // Specialty filter: if outcome has designated specialties, it must align
    if (candidate.applicableSpecialties.length > 0 && !candidate.applicableSpecialties.includes(specialty)) {
      continue;
    }

    const tier = assignOutcomeTier(candidate);
    const direction = resolveOutcomeDirection(candidate, tier);

    let score = 0;

    // Specialty alignment weight
    if (candidate.applicableSpecialties.includes(specialty)) {
      score += 30;
    }

    // Condition matching
    const matchesConditionDirectly = candidate.applicableConditions.some(
      c => cleanCond.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(cleanCond.toLowerCase())
    );
    if (matchesConditionDirectly) score += 45;
    else if (candidate.keywords.some(k => cleanCond.toLowerCase().includes(k.toLowerCase()))) score += 20;

    // Guidance matching from KB
    if (conditionGuidanceLower.includes(candidateLower) || conditionGuidanceLower.includes(shortLower)) {
      score += 35;
      if (candidateLower === conditionGuidance.primary.toLowerCase()) {
        score += 25;
      }
    }

    // Intervention applicability matching
    let ivMatches = 0;
    for (const iv of interventions) {
      const ivClean = iv.toLowerCase();
      const matched = candidate.applicableInterventions.some(ai => {
        const aiClean = ai.toLowerCase();
        return ivClean.includes(aiClean) || aiClean.includes(ivClean);
      });
      if (matched) ivMatches++;
    }
    score += ivMatches * 30;

    // Preferred primary endpoint bonus
    if (candidate.preferredForPrimaryOutcome) score += 15;

    // Clinician stated outcome bonus
    const isStated = statedOutcomes.some(so => {
      const soLower = so.toLowerCase();
      return candidateLower === soLower || shortLower === soLower || candidateLower.includes(soLower);
    });
    if (isStated) score += 100;

    // Subtract priority (priority 1 > priority 5)
    score -= (candidate.priority || 5);

    // Only admit candidates with positive relevance to the specialty, condition, or intervention
    if (score > 25) {
      const rationale = buildOutcomeRationale(candidate, tier, cleanCond, interventions);
      scoredList.push({
        outcome: candidate.label,
        canonical: candidate.label,
        direction,
        tier,
        tierLabel: TIER_LABELS[tier],
        rationale,
        score,
        family: candidate.family,
        priority: candidate.priority
      });
    }
  }

  // Handle any stated outcomes from PicoSlots
  for (const stated of statedOutcomes) {
    const resolved = resolveKnownOutcome(stated);
    if (resolved && resolved.valid) {
      const already = scoredList.find(s => s.canonical.toLowerCase() === resolved.canonical.toLowerCase());
      if (already) {
        already.score += 200;
        already.outcome = stated; // Preserve user's verbatim stated outcome string
      } else {
        const tier = /\b(miscarriage|ohss|mortality|loss|adverse)\b/i.test(resolved.canonical) ? "safety" : "critical";
        scoredList.unshift({
          outcome: stated,
          canonical: resolved.canonical,
          direction: resolved.direction,
          tier,
          tierLabel: TIER_LABELS[tier],
          rationale: `Directly stated clinical outcome for ${interventions.join(" and ") || "treatment"} in ${cleanCond || "the evaluated condition"}.`,
          score: 250,
          family: "stated",
          priority: 1
        });
      }
    }
  }

  // Sort: clinician stated outcomes first, then tier order, then score descending within tier
  scoredList.sort((a, b) => {
    const aStated = statedOutcomes.some(so => so.toLowerCase() === a.outcome.toLowerCase() || so.toLowerCase() === a.canonical.toLowerCase());
    const bStated = statedOutcomes.some(so => so.toLowerCase() === b.outcome.toLowerCase() || so.toLowerCase() === b.canonical.toLowerCase());
    if (aStated && !bStated) return -1;
    if (!aStated && bStated) return 1;

    const tierDiff = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.score - a.score;
  });

  // Deduplicate near-duplicate outcome labels
  const deduped = dedupeDerivedOutcomes(scoredList);

  // If no critical outcome emerged, inject KB specialty primary default
  if (!deduped.some(d => d.tier === "critical")) {
    const defaultPrimary = conditionGuidance.primary || KB[specialty].outcomesRanked[0] || "live birth rate";
    deduped.unshift({
      outcome: defaultPrimary,
      canonical: defaultPrimary,
      direction: "desirable",
      tier: "critical",
      tierLabel: TIER_LABELS.critical,
      rationale: `Recommended primary patient-centered endpoint for ${cleanCond || "clinical care"}.`,
      score: 50,
      family: "primary",
      priority: 1
    });
  }

  // Tier-balanced candidate selection: top 3 critical, top 3 surrogate, top 1 safety, top 1 patient-reported
  const selectedOutcomes: DerivedOutcome[] = [];
  const selectedKeys = new Set<string>();

  const addCandidate = (item: DerivedOutcome | undefined) => {
    if (!item) return;
    const key = item.canonical.toLowerCase();
    if (!selectedKeys.has(key) && selectedOutcomes.length < 8) {
      selectedKeys.add(key);
      selectedOutcomes.push(item);
    }
  };

  // Retain clinician stated outcomes first
  for (const d of deduped) {
    if (statedOutcomes.some(so => so.toLowerCase() === d.outcome.toLowerCase() || so.toLowerCase() === d.canonical.toLowerCase())) {
      addCandidate(d);
    }
  }

  // Top 3 critical candidates by score
  deduped.filter(d => d.tier === "critical").slice(0, 3).forEach(addCandidate);

  // Top 3 surrogate candidates by score
  deduped.filter(d => d.tier === "surrogate").slice(0, 3).forEach(addCandidate);

  // Top 1 safety candidate by score
  deduped.filter(d => d.tier === "safety").slice(0, 1).forEach(addCandidate);

  // Top 1 patient-reported candidate by score
  deduped.filter(d => d.tier === "patient-reported").slice(0, 1).forEach(addCandidate);

  // Fill remaining slots from remaining candidates by descending score until 8 total
  for (const candidate of deduped) {
    if (selectedOutcomes.length >= 8) break;
    addCandidate(candidate);
  }

  // Preserve the established tier and score ordering among the selected candidates
  const finalOutcomes = deduped.filter(d => selectedKeys.has(d.canonical.toLowerCase())).slice(0, 8);

  const primaryOutcome = finalOutcomes[0] || deduped[0];
  const secondaryOutcomes = finalOutcomes.slice(1, 6);
  const safetyOutcome = finalOutcomes.find(d => d.tier === "safety") || deduped.find(d => d.tier === "safety");
  const patientReportedOutcome = finalOutcomes.find(d => d.tier === "patient-reported") || deduped.find(d => d.tier === "patient-reported");

  return {
    outcomes: finalOutcomes,
    primaryOutcome,
    secondaryOutcomes,
    safetyOutcome,
    patientReportedOutcome
  };
}
