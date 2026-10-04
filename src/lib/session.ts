export function sset(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function sget<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export const KEYS = {
  // Stores the structured ClinicalInput payload (rawInput/keywords/normalizedKeywords).
  input: "cq_input",
  // Canonical comma-joined normalized keywords, the single string downstream stages read.
  inputText: "cq_input_text",
  mode: "cq_mode",
  gap: "cq_gap",
  question: "cq_question",
  formulation: "cq_formulation",
  commentary: "cq_commentary",
  outcomes: "cq_outcomes"
};