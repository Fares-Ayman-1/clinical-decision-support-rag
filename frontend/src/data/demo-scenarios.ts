import {
  evidenceDetailSchema,
  queryResultSchema,
  traceSchema,
  type EvidenceDetail,
  type EvidenceItem,
  type QueryResult,
  type RawEvidenceDetail,
  type RiskLevel,
  type Sufficiency,
  type Trace,
} from "../types/api";

export const DEMO_DISCLAIMER =
  "This system provides information from published medical guidelines. It is not a diagnosis and does not replace professional medical evaluation.";

export const demoScenarios = [
  {
    id: "critical",
    label: "Synthetic · Critical cardiac",
    description: "Chest pressure, sweating, and breathlessness trigger emergency guidance.",
    examplePrompt:
      "I have crushing chest pressure, I am sweating, and I cannot breathe normally.",
    riskLevel: "CRITICAL",
    synthetic: true,
  },
  {
    id: "moderate",
    label: "Synthetic · Moderate concern",
    description: "New exertional breathlessness prompts timely professional evaluation.",
    examplePrompt:
      "I have been getting more short of breath walking upstairs over the last week.",
    riskLevel: "MODERATE",
    synthetic: true,
  },
  {
    id: "low",
    label: "Synthetic · Low-risk guidance",
    description: "A stable wellness question receives evidence-grounded self-care guidance.",
    examplePrompt: "What everyday habits support heart health when I feel well?",
    riskLevel: "LOW",
    synthetic: true,
  },
  {
    id: "refusal",
    label: "Synthetic · Safe refusal",
    description: "An out-of-scope request is declined without fabricating clinical evidence.",
    examplePrompt: "Can you diagnose the rash in this photo and prescribe a cream?",
    riskLevel: null,
    synthetic: true,
  },
] as const;

export type DemoScenario = (typeof demoScenarios)[number];
export type DemoScenarioId = DemoScenario["id"];

const meta = {
  latency_ms: 1_284,
  kb_version: "synthetic-demo-1.0",
  embedding_version: "synthetic-embed-v1",
  prompt_version: "synthetic-rag-gen-v1",
  risk_policy_version: "synthetic-risk-v1",
} as const;

function makeTrace(
  riskLevel: RiskLevel | null,
  sufficiency: Sufficiency,
  statementCount: number,
  matchedRules: string[] = [],
): Trace {
  return traceSchema.parse({
    stages: [
      { name: "extraction", latency_ms: 126, output: { symptoms_extracted: true } },
      {
        name: "red_flag_check",
        latency_ms: 2,
        output: { matched: matchedRules, urgency_floor: riskLevel },
      },
      {
        name: "query_rewrite",
        latency_ms: 88,
        output: { variants: 2, synthetic: true },
      },
      {
        name: "domain_predict",
        latency_ms: 5,
        output: { domains_checked: ["cardiovascular", "emergency"] },
      },
      { name: "dense_search", latency_ms: 46, output: { candidates: 25 } },
      { name: "bm25_search", latency_ms: 22, output: { candidates: 25 } },
      { name: "fusion", latency_ms: 8, output: { merged: 31, after_dedup: 23 } },
      { name: "rerank", latency_ms: 391, output: { retained: 5 } },
      {
        name: "sufficiency",
        latency_ms: 1,
        output: { state: sufficiency, threshold_applied: true },
      },
      {
        name: "generation",
        latency_ms: 548,
        output: { statements: statementCount },
      },
      {
        name: "validation",
        latency_ms: 12,
        output: { dropped: 0, excerpts_verified: statementCount },
      },
      {
        name: "risk",
        latency_ms: 4,
        output: { level: riskLevel, deterministic_policy: true },
      },
      {
        name: "decision",
        latency_ms: 1,
        output: { action_flags_set: riskLevel !== null },
      },
    ],
  });
}

const criticalEvidence: EvidenceItem[] = [
  {
    index: 1,
    chunk_id: "demo_who_acs_p24_s3_c2",
    document_title: "WHO Framework for the Care of Acute Coronary Syndrome and Stroke",
    organization: "World Health Organization",
    section_path: "Acute Coronary Syndrome > Symptom recognition",
    page_start: 24,
    page_end: 24,
    evidence_grade: null,
    excerpt:
      "Synthetic demo excerpt — chest discomfort with sweating and difficulty breathing should be treated as a possible time-critical cardiovascular emergency.",
    source_url: "https://www.who.int/publications/i/item/9789240103665",
    scores: { dense: 0.91, bm25: 13.2, rrf: 0.034, rerank: 3.76 },
    selected: true,
  },
  {
    index: 2,
    chunk_id: "demo_bec_emergency_p31_s2_c1",
    document_title: "Basic Emergency Care: Approach to the Acutely Ill and Injured",
    organization: "World Health Organization and International Committee of the Red Cross",
    section_path: "Breathing > Emergency assessment",
    page_start: 31,
    page_end: 32,
    evidence_grade: null,
    excerpt:
      "Synthetic demo excerpt — severe breathing difficulty is an emergency sign that requires immediate assessment and escalation.",
    source_url:
      "https://www.who.int/publications/i/item/basic-emergency-care-approach-to-the-acutely-ill-and-injured",
    scores: { dense: 0.86, bm25: 10.8, rrf: 0.029, rerank: 3.41 },
    selected: true,
  },
];

const moderateEvidence: EvidenceItem[] = [
  {
    index: 1,
    chunk_id: "demo_who_cvd_p14_s4_c1",
    document_title: "Basic Emergency Care: Approach to the Acutely Ill and Injured",
    organization: "World Health Organization and International Committee of the Red Cross",
    section_path: "Breathing > History and reassessment",
    page_start: 14,
    page_end: 15,
    evidence_grade: null,
    excerpt:
      "Synthetic demo excerpt — new or worsening breathlessness with activity warrants clinical assessment to determine its cause and urgency.",
    source_url:
      "https://www.who.int/publications/i/item/basic-emergency-care-approach-to-the-acutely-ill-and-injured",
    scores: { dense: 0.82, bm25: 9.7, rrf: 0.027, rerank: 2.91 },
    selected: true,
  },
  {
    index: 2,
    chunk_id: "demo_bec_breathing_p35_s1_c3",
    document_title: "Basic Emergency Care: Approach to the Acutely Ill and Injured",
    organization: "World Health Organization and International Committee of the Red Cross",
    section_path: "Breathing > History and reassessment",
    page_start: 35,
    page_end: 35,
    evidence_grade: null,
    excerpt:
      "Synthetic demo excerpt — the timing, progression, associated symptoms, and functional impact of breathing difficulty help determine urgency.",
    source_url:
      "https://www.who.int/publications/i/item/basic-emergency-care-approach-to-the-acutely-ill-and-injured",
    scores: { dense: 0.73, bm25: 7.1, rrf: 0.021, rerank: 2.22 },
    selected: false,
  },
];

const lowEvidence: EvidenceItem[] = [
  {
    index: 1,
    chunk_id: "demo_who_hearts_lifestyle_p9_s2_c1",
    document_title: "HEARTS Technical Package: Healthy-lifestyle Counselling",
    organization: "World Health Organization",
    section_path: "Lifestyle counselling > Cardiovascular risk reduction",
    page_start: 9,
    page_end: 10,
    evidence_grade: null,
    excerpt:
      "Synthetic demo excerpt — regular physical activity, avoiding tobacco, a balanced diet, and appropriate follow-up support cardiovascular health.",
    source_url: "https://www.who.int/publications/i/item/WHO-NMH-NVI-18-1",
    scores: { dense: 0.88, bm25: 11.4, rrf: 0.032, rerank: 3.18 },
    selected: true,
  },
  {
    index: 2,
    chunk_id: "demo_uspstf_activity_p7_s1_c2",
    document_title: "Behavioral Counseling Interventions to Promote a Healthy Diet and Physical Activity",
    organization: "U.S. Preventive Services Task Force",
    section_path: "Recommendation > Adults without cardiovascular risk factors",
    page_start: 7,
    page_end: 8,
    evidence_grade: "C",
    excerpt:
      "Synthetic demo excerpt — clinicians may individualize decisions about offering behavioral counseling for diet and physical activity.",
    source_url:
      "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/healthy-lifestyle-and-physical-activity-for-cvd-prevention-adults-without-known-risk-factors-behavioral-counseling",
    scores: { dense: 0.76, bm25: 8.9, rrf: 0.024, rerank: 2.48 },
    selected: true,
  },
];

const refusalEvidence: EvidenceItem[] = [
  {
    index: 1,
    chunk_id: "demo_who_hearts_lifestyle_p9_s2_c1",
    document_title: "HEARTS Technical Package: Healthy-lifestyle Counselling",
    organization: "World Health Organization",
    section_path: "Lifestyle counselling > Cardiovascular risk reduction",
    page_start: 9,
    page_end: 10,
    evidence_grade: null,
    excerpt:
      "Synthetic demo excerpt — regular physical activity, avoiding tobacco, a balanced diet, and appropriate follow-up support cardiovascular health.",
    source_url: "https://www.who.int/publications/i/item/WHO-NMH-NVI-18-1",
    scores: { dense: 0.18, bm25: 0.7, rrf: 0.006, rerank: -0.81 },
    selected: false,
  },
];

const resultsByScenario: Record<DemoScenarioId, QueryResult> = {
  critical: queryResultSchema.parse({
    request_id: "00000000-0000-4000-8000-000000000001",
    status: "success",
    supported_domain: true,
    domains: ["cardiovascular", "emergency"],
    patient_state: {
      symptoms: ["chest pressure", "sweating", "shortness of breath"],
      severity: "severe",
      onset: null,
      duration: null,
      missing_information: ["onset", "duration"],
    },
    assessment: {
      statements: [
        {
          id: 1,
          text: "This combination of severe chest pressure, sweating, and breathlessness can signal a time-critical cardiovascular emergency.",
          citations: [1, 2],
        },
        {
          id: 2,
          text: "Immediate in-person emergency assessment is safer than waiting for symptoms to settle.",
          citations: [1, 2],
        },
      ],
      limitations: ["Symptom onset and duration were not provided."],
      conflicts: [],
      diagnosis_confirmed: false,
    },
    risk: {
      level: "CRITICAL",
      confidence_band: "strong",
      confidence_value: 0.93,
      reasoning_factors: ["severe chest pressure", "breathing difficulty", "sweating"],
      red_flag_rules: ["rf_cardiac_001"],
      evidence_ids: [1, 2],
    },
    recommended_action: {
      type: "emergency",
      message: "Seek emergency medical care immediately. Do not drive yourself if safer help is available.",
    },
    actions: {
      show_call_emergency: true,
      show_find_facility: true,
      show_alert_contacts: true,
      show_wellness: false,
    },
    evidence: criticalEvidence,
    safety: {
      sufficiency: "SUFFICIENT",
      retrieval_confidence_band: "strong",
      unsupported_statements_dropped: 0,
      injection_detected: false,
      disclaimer: DEMO_DISCLAIMER,
    },
    trace: makeTrace("CRITICAL", "SUFFICIENT", 2, ["rf_cardiac_001"]),
    meta,
  }),

  moderate: queryResultSchema.parse({
    request_id: "00000000-0000-4000-8000-000000000002",
    status: "success",
    supported_domain: true,
    domains: ["cardiovascular"],
    patient_state: {
      symptoms: ["exertional shortness of breath"],
      severity: "moderate",
      onset: "within the last week",
      duration: "one week",
      missing_information: ["associated chest discomfort", "known heart or lung conditions"],
    },
    assessment: {
      statements: [
        {
          id: 1,
          text: "New breathlessness that limits usual activity merits timely clinical evaluation to identify the cause.",
          citations: [1],
        },
      ],
      limitations: ["Associated symptoms and medical history were not provided."],
      conflicts: [],
      diagnosis_confirmed: false,
    },
    risk: {
      level: "MODERATE",
      confidence_band: "moderate",
      confidence_value: 0.72,
      reasoning_factors: ["new symptom", "worsening with exertion", "functional limitation"],
      red_flag_rules: [],
      evidence_ids: [1],
    },
    recommended_action: {
      type: "evaluation",
      message: "Arrange a professional medical evaluation soon. Escalate urgently if symptoms worsen or occur at rest.",
    },
    actions: {
      show_call_emergency: false,
      show_find_facility: true,
      show_alert_contacts: false,
      show_wellness: false,
    },
    evidence: moderateEvidence,
    safety: {
      sufficiency: "PARTIAL",
      retrieval_confidence_band: "moderate",
      unsupported_statements_dropped: 0,
      injection_detected: false,
      disclaimer: DEMO_DISCLAIMER,
    },
    trace: makeTrace("MODERATE", "PARTIAL", 1),
    meta,
  }),

  low: queryResultSchema.parse({
    request_id: "00000000-0000-4000-8000-000000000003",
    status: "success",
    supported_domain: true,
    domains: ["cardiovascular", "wellness"],
    patient_state: {
      symptoms: [],
      severity: "mild",
      onset: null,
      duration: null,
      missing_information: [],
    },
    assessment: {
      statements: [
        {
          id: 1,
          text: "Heart-healthy routines commonly include regular activity, avoiding tobacco, and a balanced dietary pattern.",
          citations: [1, 2],
        },
      ],
      limitations: ["Guidance is general and is not tailored to an individual medical history."],
      conflicts: [],
      diagnosis_confirmed: false,
    },
    risk: {
      level: "LOW",
      confidence_band: "strong",
      confidence_value: 0.88,
      reasoning_factors: ["no active symptoms reported", "general wellness request"],
      red_flag_rules: [],
      evidence_ids: [1, 2],
    },
    recommended_action: {
      type: "guidance",
      message: "Build sustainable activity, nutrition, sleep, and tobacco-free habits that fit your health needs.",
    },
    actions: {
      show_call_emergency: false,
      show_find_facility: false,
      show_alert_contacts: false,
      show_wellness: true,
    },
    evidence: lowEvidence,
    safety: {
      sufficiency: "SUFFICIENT",
      retrieval_confidence_band: "strong",
      unsupported_statements_dropped: 0,
      injection_detected: false,
      disclaimer: DEMO_DISCLAIMER,
    },
    trace: makeTrace("LOW", "SUFFICIENT", 1),
    meta,
  }),

  refusal: queryResultSchema.parse({
    request_id: "00000000-0000-4000-8000-000000000004",
    status: "refusal",
    supported_domain: false,
    domains: [],
    refusal: {
      reason: "PRESCRIBING_REQUEST",
      message:
        "I cannot diagnose a skin condition or prescribe treatment from the approved cardiovascular knowledge base. A qualified clinician can assess the rash and recommend safe care.",
      recommend_professional_evaluation: true,
    },
    evidence: refusalEvidence,
    safety: {
      sufficiency: "OUT_OF_SCOPE",
      retrieval_confidence_band: "weak",
      unsupported_statements_dropped: 0,
      injection_detected: false,
      disclaimer: DEMO_DISCLAIMER,
    },
    trace: makeTrace(null, "OUT_OF_SCOPE", 0),
    meta,
  }),
};

function detailFromEvidence(item: EvidenceItem): RawEvidenceDetail {
  const sectionParts = item.section_path.split(" > ");
  const hashSeed = [...item.chunk_id]
    .reduce((hash, character) => ((hash * 31 + character.charCodeAt(0)) >>> 0), 2_166_136_261)
    .toString(16)
    .padStart(8, "0");
  const canonicalText = `${item.excerpt} This synthetic demonstration record is provided only to exercise the evidence inspector and does not replace the live approved source.`;

  return {
    chunk_id: item.chunk_id,
    document_id: item.chunk_id.replace(/_p\d+.*$/, ""),
    document_title: item.document_title,
    organization: item.organization,
    publication_year: 2020,
    source_url: item.source_url,
    license: "Synthetic demonstration fixture",
    section: sectionParts[0] ?? "Clinical guidance",
    subsection: sectionParts[1] ?? null,
    section_path: item.section_path,
    section_confidence: "detected",
    page_start: item.page_start,
    page_end: item.page_end,
    domains: ["cardiovascular"],
    chunk_type: "guidance",
    evidence_grade: item.evidence_grade,
    recommendation_class: null,
    text: canonicalText,
    embedded_text: `${item.document_title}\n${item.section_path}\n\n${canonicalText}`,
    token_count: 74,
    content_hash: `sha256:${hashSeed.repeat(8)}`,
    kb_version: "synthetic-demo-1.0",
    chunking_version: "synthetic-section-v1",
    embedding_version: "synthetic-embed-v1",
  };
}

const everyEvidenceItem = [
  ...criticalEvidence,
  ...moderateEvidence,
  ...lowEvidence,
  ...refusalEvidence,
];

export const demoEvidenceByChunkId: ReadonlyMap<string, EvidenceDetail> = new Map(
  everyEvidenceItem.map((item) => [item.chunk_id, evidenceDetailSchema.parse(detailFromEvidence(item))]),
);

export function getDemoResult(scenarioId: DemoScenarioId): QueryResult {
  // Re-parse a clone so consumers cannot mutate the shared fixtures between assessments.
  return queryResultSchema.parse(JSON.parse(JSON.stringify(resultsByScenario[scenarioId])));
}

export function isDemoScenarioId(value: string): value is DemoScenarioId {
  return demoScenarios.some((scenario) => scenario.id === value);
}
