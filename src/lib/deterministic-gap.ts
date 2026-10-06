import { type SpecialtyKey } from "./kb.ts";
import { parseClinicalScenario } from "./clinical-semantics.ts";

export interface DeterministicGapPoint {
  point: string;
  searchQuery?: string;
  references?: Array<Record<string, unknown>>;
}

export interface DeterministicGapPayload {
  topic: string;
  specialty: SpecialtyKey | null;
  known: DeterministicGapPoint[];
  uncertain: DeterministicGapPoint[];
  gaps: Array<{ gap: string; why: string }>;
  suggestedQuestions: Array<{ question: string; rationale: string }>;
}

/**
 * Deterministic evidence mapping engine for Obstetrics & Gynecology.
 * Generates calibrated 4-known, 4-uncertain, 4-gaps, and 4-PICO questions
 * without requiring an external AI provider or when the AI service is unreachable/rate-limited.
 */
export function generateDeterministicGapAnalysis(rawTopic: string): DeterministicGapPayload {
  const topic = (rawTopic || "").trim() || "obstetric and gynecologic clinical care";
  const scenario = parseClinicalScenario(topic);
  const specialty: SpecialtyKey = scenario.specialty;

  const condition = scenario.population;
  const intervention = scenario.intervention;
  const comparator = scenario.comparator;

  // Build 4 established knowledge points
  const known: DeterministicGapPoint[] = [
    {
      point: `Standardized clinical screening and risk-factor assessment in patients presenting with ${condition} improves timely identification of at-risk individuals.`,
      searchQuery: `${condition} screening risk assessment`
    },
    {
      point: `The therapeutic efficacy of ${intervention} for ${condition} depends critically on patient selection, gestational or clinical staging, and baseline risk.`,
      searchQuery: `${condition} ${intervention} efficacy clinical trial`
    },
    {
      point: `Clinical practice guidelines emphasize individualized multidisciplinary evaluation before initiating ${intervention} in patients with ${condition}.`,
      searchQuery: `${condition} ${intervention} guideline practice recommendation`
    },
    {
      point: `Implementation of structured monitoring protocols for ${condition} is associated with reduced diagnostic delay and improved patient surveillance.`,
      searchQuery: `${condition} surveillance outcomes prospective study`
    }
  ];

  // Build 4 conflicting / uncertain evidence points
  const uncertain: DeterministicGapPoint[] = [
    {
      point: `The comparative effectiveness of ${intervention} versus ${comparator} for ${condition} remains contested due to heterogeneous inclusion criteria across trials.`,
      searchQuery: `${condition} ${intervention} versus ${comparator} randomized trial`
    },
    {
      point: `Optimal intervention thresholds and timing for ${intervention} in ${condition} show conflicting findings across multicenter cohort studies.`,
      searchQuery: `${condition} ${intervention} threshold timing observational cohort`
    },
    {
      point: `The incremental clinical benefit of combining ${intervention} with adjuvant pharmacotherapy for ${condition} is uncertain due to limited powered trials.`,
      searchQuery: `${condition} ${intervention} combination therapy trial`
    },
    {
      point: `Long-term functional, reproductive, and pediatric outcomes associated with ${intervention} for ${condition} remain under-characterized relative to short-term endpoints.`,
      searchQuery: `${condition} ${intervention} long-term outcomes follow-up`
    }
  ];

  // Build 4 evidence gaps
  const gaps: Array<{ gap: string; why: string }> = [
    {
      gap: `Lack of adequately powered multicenter randomized trials directly comparing ${intervention} against active modern comparators in well-defined phenotypes of ${condition}.`,
      why: "Definitive comparative trials are required to establish evidence-based hierarchy of interventions and avoid suboptimal care."
    },
    {
      gap: `Absence of validated predictive biomarkers or molecular profiles to distinguish disease subtypes and predict therapeutic responsiveness to ${intervention}.`,
      why: "Biomarker-guided stratification would prevent unnecessary invasive procedures and enable targeted precision medicine."
    },
    {
      gap: `Scarcity of prospectively tracked long-term functional, patient-reported, and quality-of-life endpoints beyond immediate clinical outcomes.`,
      why: "Patients and clinicians require comprehensive health-span data to weigh lasting benefits against potential cumulative harms."
    },
    {
      gap: `Heterogeneity in outcome definitions, threshold cutoffs, and reporting standards across clinical studies investigating ${condition}.`,
      why: "Core outcome sets are urgently required to allow reliable meta-analytic evidence synthesis and clinical practice translation."
    }
  ];

  // Build 4 suggested PICO-format clinical questions
  const suggestedQuestions: Array<{ question: string; rationale: string }> = [
    {
      question: `In women with ${condition} (P), does ${intervention} (I) compared with ${comparator} (C) improve primary patient-centered clinical outcomes (O)?`,
      rationale: "Evaluates the fundamental efficacy of the primary intervention against standard control."
    },
    {
      question: `In high-risk subgroups of women with ${condition} (P), does early intervention with ${intervention} (I) compared with conservative management (C) reduce disease progression or acute complications (O)?`,
      rationale: "Addresses risk-stratified timing and threshold for proactive clinical intervention."
    },
    {
      question: `In women with ${condition} (P), does ${intervention} combined with adjuvant therapy (I) compared with ${intervention} monotherapy (C) improve cumulative therapeutic success (O)?`,
      rationale: "Tests potential synergistic or additive benefit of combination regimens."
    },
    {
      question: `In women undergoing ${intervention} for ${condition} (P), does structured protocolized follow-up (I) compared with routine clinical monitoring (C) decrease long-term morbidity and treatment-related complications (O)?`,
      rationale: "Focuses on surveillance safety, adverse event mitigation, and quality assurance."
    }
  ];

  return {
    topic,
    specialty,
    known,
    uncertain,
    gaps,
    suggestedQuestions: scenario.suggestedQuestions?.length ? scenario.suggestedQuestions : suggestedQuestions
  };
}
