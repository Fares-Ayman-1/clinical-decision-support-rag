<!-- Faqarati Project Guide v2.0 — generated 2026-08-20; source of the PDF handed to the team -->

# Faqarati · فقراتي — The Complete Project Guide for Technical Team Members

Everything you need to understand, explain and defend the project — in plain language, no coding knowledge required.

Evidence-Grounded AI Clinical Decision Support Lite — deployed as Faqarati. Version 2.0 · August 20, 2026 · Internal. Changes since v1.0: French added as a third language; the trilingual LLM-as-judge evaluation completed (results inside); the two-tier knowledge system documented; the doctor console, admin pipeline console and demo mode added; latency updated to measured reality.


# 1. What is Faqarati?

Faqarati (فقراتي, Arabic for "my vertebrae") is an AI assistant for people with back, neck, joint, muscle and rehabilitation problems. A patient describes their problem in their own words — in Arabic, English or French, by typing or by speaking — and Faqarati answers in the same language with guidance taken only from trusted medical guideline documents (mainly from the World Health Organization). Every important sentence in the answer points to the exact document, section and page it came from. The system also tells the patient how urgent their situation looks, and offers the right next step: self-care guidance, see a physiotherapist, call the health hotline, or call an ambulance.

> **The one sentence to remember**
> Faqarati answers patients' physiotherapy questions in three languages using only trusted medical guidelines, shows exactly where every answer came from, refuses to answer when it does not have real evidence, and guides the patient to the right next step.


## 1.1 Two tiers of knowledge (new in v2.0)

Faqarati deliberately runs two knowledge levels, and the interface labels them:

| Tier | Who it serves | What is inside |
|---|---|---|
| Tier 1 — Public | Patients (landing page, patient portal) | General, evidence-grounded guidance from 9 WHO/USPSTF guideline documents split into 8,542 evidence cards. Never a diagnosis, never a dose. |
| Tier 2 — Specialist | Physiotherapists (doctor portal) | The FitKG-CN knowledge graph: 8,043 nodes and 13,510 typed relations — 900 exercises, 1,826 anatomy nodes, 1,799 exercise-to-muscle "Trains" links, 1,157 muscle origin/insertion links, all labels bilingual. The doctor's exercise planner builds plans on it, and a graph explorer shows each node's muscle connections. |


## 1.2 Who it is for

| Audience | What they get |
|---|---|
| Patients (the main user) | Plain-language, trustworthy guidance about their musculoskeletal problem, in Arabic, English or French, with sources, an urgency level and a next step. |
| Physiotherapists and clinics | A professional console: full-screen assistant with an evidence inspector and dark mode, plus an exercise planner driven by the 8,043-node specialist graph, booking, consultation and follow-up. |
| Judges, investors, partners | A transparent system where every decision can be inspected — including a live admin Pipeline Console showing every step of every query with its retrieval scores. |


## 1.3 What Faqarati is NOT (very important)

> **Say these clearly whenever someone asks**
> Not a diagnosis tool — it never says "you have X disease". Not a doctor replacement — every answer says so. Not a prescriber — it never recommends a medicine, dose, frequency or duration; it refers to a professional. Not a medical device (yet) — a demonstrator built on public guidelines, tested on synthetic data, not clinically validated.


# 2. The big idea: a librarian, not an oracle

Imagine a medical library that contains only nine official guideline books (WHO and similar) and a very careful librarian. When a patient asks a question, the librarian does not answer from memory: they write down what the patient said, translate everyday words into medical terms, pull the five most relevant pages, decide honestly whether those pages are good enough, write a short answer using only those pages with a footnote on every sentence, have a second person verify every footnote, apply the safety rules (never diagnose, never prescribe), and use a fixed checklist to decide urgency and which buttons to show. In Faqarati the AI language model is only the person who writes the sentences — everything else is ordinary, predictable, tested software. The AI is a translator of evidence, not an oracle of knowledge.


# 3. What the patient and the doctor actually experience


## 3.1 Where they find it

Faqarati is a responsive website (phones and computers — the mobile layout was rebuilt in v2.0). The assistant appears in three places: the public landing page (no sign-in), the patient portal (with the saved profile), and the doctor portal — where v2.0 replaces the simple chat with a professional console: a two-pane view with the conversation on one side and a live Evidence & Pipeline Inspector on the other (every retrieved card with its four scores, and every pipeline stage with its time), a polished light theme and a true dark-mode toggle. Admins get a Pipeline Console at /admin/pipeline. The live version is hosted publicly on Hugging Face Spaces.


## 3.2 The journey, step by step

| Step | What the patient sees |
|---|---|
| 1. Ask | A chat box. Type in Arabic, English or French, or press the microphone and speak — words appear live on screen while speaking. |
| 2. Optional profile | Age, sex, known conditions, medicines, allergies — the system takes these into account. |
| 3. Answer | A short, calm answer in the same language, written as clear statements, each with small citation numbers [1] [2]. |
| 4. Evidence used | The sources: document name, section, page, and the exact excerpt. |
| 5. Urgency level | LOW / MODERATE / HIGH / CRITICAL, with a confidence word (strong / moderate / weak). |
| 6. Recommended next step | General guidance, see a professional, urgent evaluation, or emergency — in the question's language. |
| 7. Action buttons | Only the buttons that make sense: ambulance (123), health hotline (105), nearby hospitals, care directory. |
| 8. Safety block | A disclaimer: guideline-based information, not a diagnosis, does not replace a professional. |
| 9. Listen | A speaker button reads the answer aloud — an Arabic voice for Arabic answers. |


## 3.3 Demo mode — the presentation insurance (new in v2.0)

> **Why demo mode exists**
> The live pipeline takes 35–60 seconds on free hosting (measured; see Chapter 6). So the example chips in the doctor console and the admin Pipeline Console carry a lightning icon: clicking one instantly renders a REAL pre-captured pipeline answer — statements, citations, evidence scores, the full trace — labelled "cached demo answer". Nine such answers (four questions in Arabic and English, one in French) ship with the app. A LIVE/DEMO switch forces real calls when you want to prove it live. If the backend is slow or down, the demo still works end to end.


## 3.4 When it refuses — and why that is a feature

Faqarati deliberately gives no medical answer in four situations: out-of-scope questions, medical questions its nine documents cannot support (it says the approved knowledge base lacks sufficient evidence and recommends professional evaluation), prescribing requests ("how much ibuprofen?" is always referred to a professional), and partial evidence (it answers but states its limitations). Since v2.0 the refusal text comes back in the language of the question — Arabic, English or French. A refusal is the system doing exactly what a general chatbot cannot: saying "I don't have trustworthy evidence for this" instead of guessing. We demonstrate one on purpose.


# 4. How it works, step by step (no code)


## 4.1 Building the library (done once, offline)

- Nine trusted documents, all publicly available and legally usable: WHO guidelines on acute coronary syndrome and stroke, basic emergency care, severe respiratory infections, the WHO district clinician manual, the WHO antibiotic book, two USPSTF documents on diet and physical activity, and — for the physiotherapy focus — the WHO Rehabilitation Package for musculoskeletal conditions (2023) and the WHO chronic low back pain guideline (2023).
- Each PDF was read by software that keeps the page number of every line; tables are never split; repeated headers, footers, tables of contents, reference lists AND copyright/front-matter pages are removed (front-matter pages repeat the document title and used to pollute search results — v2.0 filters them before ranking).
- Each document was split into 8,542 section-respecting cards (1,161 of them physiotherapy/rehabilitation), each carrying document, organisation, year, section, page range and version labels.
- Each card was turned into a numerical "fingerprint" (embedding) by Qwen3-Embedding — a multilingual model that places Arabic, English and French in the same meaning-space, which is what lets a question in any of the three find English evidence. The older model was replaced because it silently ignored the second half of long cards (33,223 tokens were being lost).
- Cards and fingerprints live in a search database (Qdrant); a separate master list (the Chunk Store) is the single source of truth for citations.


## 4.2 Understanding the question

- Extract the facts: symptoms, severity, duration, plus what information is missing.
- Prescribing check: a request for medicine or dose stops here with a referral.
- Red-flag check: a fixed, human-reviewed list of danger signs sets a minimum urgency that later steps may raise but never lower; every rule is linked to the guideline page it came from.
- Rewrite into clinical language: "my back hurts a lot" becomes English clinical search phrases; for Arabic and French questions this step also translates. The original question is kept too.
- Guess the topic: gives matching cards a small ranking bonus — it never filters cards out, so a wrong guess can never hide the correct document.


## 4.3 Finding the best evidence

Two searches run at once — search by meaning (fingerprints) and search by exact words (BM25) — each returning 25 cards. The lists are merged fairly (Reciprocal Rank Fusion), duplicates and front-matter are removed, and an expert reader (a multilingual cross-encoder, mmarco) reads each card with the question and scores it. The best five become the Evidence Pack. For Arabic and French questions the reader scores the original question AND every English rewrite, and keeps the best — measured to rescue correct answers that a single scoring pass refused.


## 4.4 Is the evidence good enough? (the Sufficiency Gate)

| State | Meaning | What happens |
|---|---|---|
| SUFFICIENT | Strong, relevant evidence from at least two sources | Write a grounded answer |
| PARTIAL | Some relevant evidence, thin or single-source | Answer with stated limitations, or ask a follow-up |
| INSUFFICIENT | Evidence too weak | Refuse politely; recommend professional evaluation |
| OUT_OF_SCOPE | No topic match and weak evidence | Explain the question is outside what the system covers |

The thresholds were measured on labelled test questions, not guessed. For non-English questions a measured cross-language allowance (about 3 points) is applied, because cross-language scores run lower for the same quality of match — without it, correct Arabic retrievals were being refused (verified live, then fixed, then re-verified).


## 4.5 Writing and checking the answer

Only now does the language model (gpt-oss:20b via Ollama) get involved. It sees the question, the profile (kept in its own labelled box so an English profile cannot flip an Arabic answer into English — a real bug found and fixed in v2.0), and five cards labelled E1–E5 — never a document title, section or page. It writes statements tagged with the cards they came from. Deterministic code then checks every statement points to a real card, every quote is word-for-word, and refuses if nothing survives. The AI physically cannot invent "page 47" because it was never given a page to write; the real citation is attached afterwards by our own software.


## 4.6 Safety rules (enforced in code)

- Never a confirmed diagnosis (the field is permanently false).
- Never a medicine, dose, frequency or duration. The dose scanner distinguishes medication dosing from exercise instructions — "stretch twice daily for 8 weeks" is allowed (physiotherapy needs it), "ibuprofen twice daily" is blocked. This distinction was added in v2.0 after the original scanner blocked nearly every physiotherapy answer.
- A LOW urgency never reads as "you are healthy"; weak evidence plus LOW urgency produces a follow-up, never reassurance.
- A disclaimer on every response, in the patient's language (Arabic, English or French).
- Prompt-injection attempts are treated as data, ignored, and logged.
- The AI cannot trigger any action — its output format has no such field. Emergency numbers come from a configuration file (Egypt locale: 123 ambulance, 105 health hotline), never from the AI.


# 5. The technology on one page

| Name you will hear | What it is (plain) | Role in Faqarati |
|---|---|---|
| RAG | Search first, then let the AI write only from what was found | The whole architecture |
| LLM (gpt-oss:20b via Ollama) | The AI that writes text | Writes the answer sentences only |
| Qwen3-Embedding-0.6B | Turns text into 1,024-number meaning-fingerprints; multilingual | Search by meaning in Arabic, English and French |
| Qdrant | A database built for searching fingerprints | Stores all 8,542 cards and finds them fast |
| BM25 + RRF | Keyword search + a fair way to merge two ranked lists | Catches exact medical terms; combines both searches |
| Cross-encoder reranker (mmarco) | Reads question + card together and scores relevance; multilingual | Picks the final top 5; its score drives the Sufficiency Gate |
| FitKG-CN graph | A bilingual fitness/anatomy knowledge graph (8,043 nodes, 13,510 relations) | Tier 2: powers the doctor's exercise planner and graph explorer |
| Chunk Store | The master list of all cards with metadata | The only source of citations |
| FastAPI + Express | The two backend servers | The clinical pipeline; the graph/booking services |
| React / Tailwind | The frontend | The Faqarati interface — Arabic-first, responsive, dark-mode console for doctors |
| Whisper (via Groq) + browser TTS | Speech-to-text and text-to-speech | Voice in (with live preview) and voice out |
| Hugging Face Space + Docker | Hosting and packaging | Where the public version runs; one command runs it locally |
| LLM-as-judge | A second AI grading answers against a rubric and reference answers | Scored all 115 successful evaluation answers (Chapter 7) |


# 6. Key numbers and facts (cheat sheet)

| Fact | Value |
|---|---|
| Documents in the knowledge base | 9 (WHO and USPSTF), incl. WHO MSK rehabilitation and WHO chronic low back pain (2023) |
| Evidence cards (chunks) | 8,542 total · 1,161 physiotherapy/rehabilitation |
| Specialist graph (Tier 2) | FitKG-CN: 8,043 nodes · 13,510 relations · 900 exercises · 1,826 anatomy nodes · 1,799 exercise→muscle links · 1,157 origin/insertion links |
| Languages | Arabic, English and French — in and out; voice input and voice output |
| Evidence per answer | Top 5 cards from 25 meaning-search + 25 keyword-search candidates |
| Emergency numbers (Egypt) | 123 ambulance · 105 health hotline (122 police, 180 fire in the directory) |
| Automated safety tests | 67 passing (prescribing, dosing, red flags, injection, out-of-scope, multilingual) |
| Embedding model | Qwen3-Embedding-0.6B (1,024 dimensions, 32,768-token context, multilingual) |
| Truncated tokens eliminated by the new embedding model | 33,223 (content the old model silently ignored) |
| Language model / speech-to-text | gpt-oss:20b (open, via Ollama) / Whisper large-v3 (via Groq) |
| Measured live response time | ≈33 s typical, up to ~60 s under load on free hosting: generation ≈15 s + reranking ≈9 s + understanding ≈10 s. The demo cache renders pre-captured answers instantly for presentations. |
| Demo cache | 9 real pre-captured answers (4 questions × Arabic + English, 1 French) with evidence and traces |
| Evaluation (2026-08-20) | 147 live queries · 3 languages · LLM-as-judge on all 115 successful answers · all data & code released |
| Built in | 5 days, team of 5 (hackathon); then extended: Arabic+French, physio corpus, two tiers, voice, consoles, public deployment |
| Public deployment | Hugging Face Docker Space (also runnable locally with docker-compose) |


# 7. How we know it works — the trilingual evaluation (completed)

"It looks good in the demo" is not proof. In v1.0 this chapter ended with an honest note that the numbers were pending a re-run on the new stack. That re-run is now DONE — and it is bigger than the original: on 2026-08-20 the team ran all 49 labelled test questions in Arabic, English AND French (147 queries) against the LIVE deployed system.


## 7.1 How it was measured

- The 49 labelled questions (dev / golden / out-of-domain splits) were translated by an LLM and reviewed; every in-domain question also received a reference answer written strictly from the ground-truth guideline text.
- Every query ran against the public deployment; a retrieved card counts as correct only if its document matches the labelled section AND its pages overlap.
- An LLM judge (same model family — disclosed, not hidden) scored every successful answer against a fixed rubric: faithfulness to the cited excerpts, relevance to the question, agreement with the reference answer, and whether the answer is in the question's language.
- Everything is released: the trilingual dataset, per-query JSON results, judge verdicts, the aggregate summary, and the resumable evaluation harness — anyone can reproduce it.


## 7.2 The headline results

|  | n | Hit@5 | MRR | Correct refusal | False refusal | Faithfulness | Relevance | Right language |
|---|---|---|---|---|---|---|---|---|
| Overall | 147 | 0.72 | 0.51 | 92% | 6.5% | 0.75 | 0.93 | 92% |
| English | 49 | 0.73 | 0.51 | 100% | 12.2% | 0.65 | 0.91 | 100% |
| Arabic | 49 | 0.73 | 0.50 | 88% | 0% | 0.82 | 0.92 | 85% |
| French | 49 | 0.68 | 0.52 | 88% | 7.3% | 0.78 | 0.96 | 92% |
| dev split | 93 | 0.80 | 0.59 | — | 5.4% | 0.76 | 0.93 | 93% |
| golden split | 30 | 0.47 | 0.24 | — | 10% | 0.72 | 0.93 | 89% |
| out-of-domain | 24 | — | — | 92% | — | — | — | — |


## 7.3 What the numbers mean (say it this way)

- Language parity is real: Arabic and French retrieve within a few points of English. Before this work, every Arabic question was refused — and French did not exist.
- Refusals work in all three languages: 22 of 24 out-of-scope questions were refused, in the question's own language.
- Arabic answers scored HIGHEST on faithfulness (0.82) — grounded generation survives translation.
- The honest gap: the never-tuned-on golden split scores lower (0.47 vs 0.80 Hit@5) because tuning focused on the physiotherapy pivot while golden targets the original documents. We report both.
- The English false-refusal rate (12%) is now the strictest path — the cross-language allowance works, and a fuller threshold calibration is the known next fix.
- Judge caveat, stated openly: the judge is the same model family that wrote the answers; an independent judge is the obvious upgrade.


## 7.4 The ablation idea (unchanged)

For "do you really need all that complexity?": the pipeline is measured in stages — meaning-search only, plus keyword search, plus the reranker, plus query rewriting — and every component must improve the numbers or be removed.


# 8. What happens when something fails

| If this fails… | Faqarati does this | Never this |
|---|---|---|
| The search database is down | Returns a controlled error and no medical answer | Falls back to the AI's own memory |
| The language model is down | Shows the retrieved evidence with safe guidance, no prose | Invents an answer |
| The reranker is slow or fails | Uses the merged search order and flags it in the trace | Hides the degradation |
| Evidence is weak | Says PARTIAL or INSUFFICIENT and refuses or limits the answer | Forces an answer |
| The AI returns badly-formed output | Retries once, then refuses | Shows unvalidated text |
| Voice input fails | The patient types the same question; same pipeline | Loses the question |
| The backend is slow or unreachable during a demo | The lightning chips render pre-captured real answers instantly (demo cache) | A frozen presentation |
| First question after a server restart | May refuse spuriously while models warm up — the demo protocol always runs a warm-up question first | — |


# 9. How to explain Faqarati in 30 seconds

> **Say this**
> "Faqarati is an AI assistant for back, joint and rehabilitation problems. You ask in Arabic, English or French, by voice or text. It answers only from trusted WHO medical guidelines, shows you the exact page every sentence came from, refuses when it doesn't have real evidence, tells you how urgent your situation is, and connects you to the right next step — a physiotherapist, the health hotline, or an ambulance. We measured it in all three languages with an AI judge and released the data. In healthcare a fluent answer isn't enough; it has to be supported, traceable and safe. That's what we built."

For the 2-minute version: start with the problem (general chatbots can't show sources and never say "I don't know"), the librarian analogy, then four proof points — real citations resolved by our software, refusal as a demonstrated feature, urgency and actions decided by auditable rules not the AI, and the trilingual judged evaluation with released data. Close with what it is not: not a diagnosis, not a prescriber, not yet a medical device.


# 10. Questions you will be asked — and good answers

Q: Isn't this just ChatGPT with a medical prompt?  A: No. A general chatbot answers from memory and you cannot check it. Faqarati writes only from five evidence cards retrieved from approved guidelines, is structurally unable to invent a citation (it never sees page numbers), every statement is checked by code, urgency and actions are decided by rules, and it refuses when evidence is weak — ChatGPT never does.

Q: How do you know it works?  A: We ran all 49 labelled test questions in three languages — 147 live queries — against the deployed system, scored retrieval against page-level ground truth and every answer with an LLM judge, and released the dataset, per-query results and the harness. Hit@5 0.72 overall with language parity; 92% correct refusals; answer faithfulness 0.75.

Q: Why does a live answer take half a minute?  A: Free hosting and a shared open model: measured, ~15 s is the AI writing, ~9 s is the evidence reader on two free CPU cores, ~10 s is understanding the question. It is the cost of a zero-budget deployment, not the architecture — on paid hardware each piece shrinks. For presentations the demo cache renders real pre-captured answers instantly.

Q: How does Arabic or French work if the documents are in English?  A: The embedding model puts all three languages in one meaning-space, the question is also rewritten into English clinical phrases, a multilingual reranker scores both and keeps the best, thresholds get a measured cross-language allowance, and the answer, refusals and emergency text come back in the question's language. Verified live in all three languages.

Q: What is the doctor getting that the patient doesn't?  A: The specialist tier — an 8,043-node knowledge graph wiring every exercise to the muscles it targets (with muscle origin/insertion anatomy), an exercise planner built on it, a full-screen console with an evidence inspector and dark mode, plus booking and follow-up.

Q: What does "confidence" mean? / Does it diagnose? / Does it prescribe? / Is it approved?  A: unchanged from v1.0 — confidence is a documented formula, never a disease probability; it never diagnoses (the field is permanently false); it never prescribes (blocked in code, exercise instructions allowed); it is a demonstrator, not a regulated device.

Q: What is still unfinished?  A: A fuller threshold calibration (the current one is a quick fit and the evaluation exposed English as the strictest path); an independent-model judge; response streaming; one hosted GPU copy still has the older corpus; the care directory is demo data to verify; and the first query after a restart can refuse while models warm up.


# 11. How it was built and who did what

| Role | Owns (plain) |
|---|---|
| Ingestion Engineer | Reading the PDFs, cleaning, splitting into cards, metadata — "building the library" |
| Retrieval Engineer | Fingerprints, the search database, the two searches, merging, the expert reader — "finding the evidence" |
| Evaluation & Safety Engineer | The test questions and metrics, safety rules, red flags, urgency rules — "proving it works and keeping it safe" |
| Backend Engineer | Prompts, the AI call, citations, checking, the API — "writing and verifying the answer" |
| Frontend Engineer | The website, evidence inspector, trace panel, demo — "what people see" |


## 11.1 The story in phases

- Days 1–2: chose and legally checked the documents, built the library, set up the search, and wrote the test questions early so every tuning decision was measured, not guessed.
- Day 3: grounded answer writing, the citation mechanism, the checks; internal milestone review.
- Day 4: safety rules, red flags, urgency and decision engines, evaluation numbers.
- Day 5: testing, failure drills, live demo with a judge-supplied question, refusal demonstration.
- After the hackathon (shipped): the new embedding model (no silent truncation), the fully trilingual pipeline (Arabic, then French), the physiotherapy corpus and brand, the two-tier knowledge system with the FitKG graph, voice with live preview, working emergency/care buttons, public deployment, the trilingual judged evaluation with released data, the doctor Pro console with dark mode, the admin Pipeline Console, the demo cache, and the mobile layout rebuild.


## 11.2 Design principles the team repeats

- No medical claim without a resolvable chain to a document, section and page.
- The AI's own medical knowledge is not evidence.
- Boost, never filter: a wrong topic guess may rank worse, it can never hide the right document.
- Determinism where safety depends on it: refusals, urgency and actions are rules, not AI.
- Degrade visibly, never silently: every fallback is flagged in the trace.
- Measure, don't assume: thresholds are fitted, components earn their place, the golden set is never tuned on — and when the measurement is unflattering (33-second answers, a 0.47 golden Hit@5), it is published anyway.


# 12. Glossary (additions in v2.0)

| Term | Plain meaning |
|---|---|
| LLM-as-judge | A second AI that grades answers against a rubric and reference answers. Used for faithfulness, relevance, correctness and language checks; its same-family bias is disclosed. |
| Knowledge graph (FitKG-CN) | A network of 8,043 named things (exercises, muscles, goals, equipment) connected by 13,510 typed relations ("Trains", "Origin", "Insertion"…). Tier 2 of the knowledge system. |
| Two-tier knowledge system | Tier 1: public WHO evidence cards for patients. Tier 2: the specialist graph for physiotherapists. |
| Demo cache | Nine real pre-captured pipeline answers (with evidence and traces) rendered instantly by the lightning chips; the LIVE switch forces real calls. |
| Pipeline Console | The admin view showing every stage of a query — latencies, outputs, the retrieval table with all four scores, the sufficiency gate internals and the raw JSON. |
| Cross-lingual margin | The measured allowance applied to evidence thresholds for non-English questions, because cross-language scores run lower for equal quality. |
| Reference answer | A model answer written strictly from the ground-truth guideline text, used by the judge to check correctness. |
| Dark mode | The doctor console's second theme; toggled and remembered end to end. |

All v1.0 glossary entries (RAG, hallucination, chunk, embedding, Qdrant, BM25, hybrid retrieval, reranker, Evidence Pack, Sufficiency Gate, Citation Resolver, programmatic validation, faithfulness, red flag, Risk Engine, Decision Engine, prompt injection, disclaimer, Evidence Inspector, Trace Panel, Precision@5/Recall@5/MRR/nDCG, ablation table, dev/golden/out-of-domain, API, deployment, latency, patient profile, care directory) remain unchanged.


# 13. Honest limitations and open items

- A demonstrator on public guidelines and synthetic data — not clinically validated, not a regulated medical device.
- Only nine documents; questions outside them are (correctly) refused.
- UPDATED: the evaluation HAS been re-run on the current stack — trilingual, judged, released (Chapter 7). The remaining evaluation caveats: the judge is the same model family, and reference answers are LLM-written from ground-truth text, not clinician-reviewed.
- The evidence-threshold calibration is still the quick fit; the evaluation showed English is now the strictest path — a fuller calibration is the known next fix.
- Live latency is 33–60 seconds on free hosting; the demo cache is the presentation mitigation, paid hardware is the production one.
- Response streaming is not wired; answers arrive complete.
- One hosted GPU copy still has the older corpus; the care directory is demo data to verify before real use.
- The first query after a server restart may refuse while models warm up; the demo protocol runs a warm-up question first.
- No user accounts and no long-term storage of health data (by design in this phase); privacy, retention and a regulatory assessment are production work.

Having read this guide, you should be able to describe Faqarati accurately, answer most questions confidently, and know when to say "let me check with the engineering team". That combination — clear, honest, and grounded — is exactly what the product itself stands for.
