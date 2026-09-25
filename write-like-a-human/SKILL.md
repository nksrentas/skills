---
name: write-like-a-human
description: "Check a draft for the narrative choices that make writing read as AI-generated, then revise it to read human. Built on StoryScope (arXiv 2604.03136v6): 61,608 human vs AI stories, 30 core features with measured rates, plus fingerprints for Claude, GPT, Gemini, DeepSeek and Kimi. Catches the structural tells that word-level edits miss: stated morals, emotion shown through the body instead of named, smell-heavy description, weather mirroring mood, tidy single-track plots, hero-choice and acceptance endings, vague allusions instead of named references, strict chronology, no reader address. Use whenever the user wants a story, chapter, scene, personal essay or other narrative to sound more human or less like AI, asks why a draft feels AI-written or generic, wants to humanize or de-AI their writing, or is planning fiction with an AI and wants to dodge its defaults. For word-level tells in LinkedIn posts, use linkedin-humanizer."
---

# Write like a human

Check a draft against the narrative choices that separate human from AI fiction, then fix the ones that give it away. Every number comes from StoryScope (Russell, Rajendhran, Pham, Iyyer & Wieting, "StoryScope: Investigating idiosyncrasies in AI fiction", arXiv 2604.03136v6, Aug 2026).

## Why structure, not word choice

The paper took 10,272 writing prompts, each written by a human author and five LLMs (Claude Sonnet 4.6, GPT-5.4, Gemini 3 Flash, DeepSeek V3.2, Kimi K2.5): 61,608 stories averaging 4,753 words, each scored on 304 narrative features. Four findings shape how to use this skill:

- **The tells live in the story, not the sentences.** With every style feature removed, narrative features alone separate human from AI at 93.2% macro-F1, and just 30 core features reach 84.8%. Surface cleanup barely moves this: after a span-level rewrite stripped clichés, purple prose and redundant exposition from 278 Gemini stories, detection fell only from 95.5% to 93.9%. Swapping words, cutting em-dashes and deleting "delve" leave these tells intact.
- **The tells travel together, so fix several.** No narrative dimension is enough on its own (best: characters/agents at 80.2%), and dropping any single one costs at most 1.2 points. Linear plots, tight causality, explicit themes and less varied casts co-occur.
- **Human means varied, not inverted.** The five models sit in one tight cluster; human stories are spread out and rarer (mean rarity percentile 0.71 vs 0.49; 24.7% of human stories land in the corpus's rarest 10% vs 7.1% of AI; for a given prompt the human version is the rarest of the six 57.8% of the time, against 16.7% by chance). Every gap below is a tendency: 52% of human stories still state their theme. Make deliberate, varied choices. Flipping every AI default just builds a new template.
- **Length and genre aren't the tell.** AI stories run shorter (test-set median 3,355 vs 4,973 words), but length alone classifies at only 55.9% and length-matched detection stays at 93.2%. Detection ranges from 90.0% (mystery) to 96.2% (historical) with no significant topic effect (p = 0.46). Padding or switching genre changes nothing.

## Reading the numbers

"AI" is the average across the five models. Percentages are the share of stories where that option applies. "(1–5)" marks a mean on a 1–5 scale; "(ordinal)" a mean of integer-coded bins. **AI #n** / **Human #n** is the feature's rank among the paper's 20 AI-leaning or 13 human-leaning core features by the paper's core score (SHAP importance × stability × size of the gap): fix low numbers first. **[NF]** marks rules that plausibly carry over to non-fiction; that is an extrapolation, since the paper measured fiction only.

## Modes

**Check** (default). Read the whole draft before judging; these are story-level features. Go rule by rule, quote the evidence (or note its absence), and mark each *AI default*, *human-leaning* or *n/a*. For a single scene or anything under ~1,500 words, mark story-shape rules (P1, P2, P4, C1–C3, D1) n/a unless they clearly apply. For non-fiction, run only [NF] rules. Report with the template at the end.

**Revise** (when asked). Make structural changes, not synonym swaps. Keep the author's voice, facts and intent. In non-fiction never invent events, references or feelings to satisfy a rule; ask the author for the real ones (which book, what they actually felt).

**Plan** (before drafting, especially with an AI drafter). Settle the choices that are expensive to retrofit, because changing narrative structure later means rewriting, not editing: where the story starts in time and where it jumps (C1–C2), the second thread (P4), who or what resolves it and how open it stays (P2–P3), the protagonist's moral mix (D3), the real things it names (W1), how the main characters walk on (P5), and whether the narrator knows it is being read (W2).

**Quick pass.** Short on time: check the ten highest-ranked rules, T1, B1, T2, B2, P5, B3, W1, W2, C3, D2.

## The rules

### T · Thematic over-determination: AI spells out what the story means

**T1. Don't state the moral.** [NF] Thematic explicitness and moralizing: AI 3.94 · human 3.28 (1–5, AI #1), about 20% higher. The narrator comments on the theme beyond any character's view: AI 77% · human 52% (AI #10).
- Check: Does the narrator (not a character) say what it all meant or what someone learned? Look hardest at the last paragraph: "She understood now that…", "Maybe that's what love is."
- Fix: Cut the lesson line. End on an action, image or line of dialogue and let the reader infer. If a thematic line must stay, give it to a character who could be wrong.

**T2. Let some details serve only the world.** Thematic unity, how far subplots and flourishes serve the central theme: AI 4.74 · human 4.41 (1–5, AI #3).
- Check: Could you tag every scene, object and aside with the theme?
- Fix: Keep texture that exists because life is like that: a running joke, an errand, a hobby that never pays off.

**T3. Keep the big question under the plot.** [NF] Moral/philosophical weighting: AI 3.68 · human 3.26 (1–5, AI #15).
- Check: Is the piece openly "about" a stated question: what makes us human, can we forgive, what do we owe each other?
- Fix: Let a concrete problem carry the question. Nobody announces it.

**T4. Don't use dialogue to debate ideas.** Dialogue serving philosophical debate: AI 59% · human 34% (AI #12).
- Check: Do characters trade articulate speeches about memory, fate, meaning or humanity?
- Fix: Make dialogue do work: argue about something concrete, dodge, joke, interrupt, misunderstand. People rarely say the theme out loud.

### B · Body and senses: AI performs emotion and atmosphere

**B1. Name feelings; stop narrating the body.** [NF] Emotion conveyed mainly through bodily sensation and metaphor: AI 81% · human 38% (AI #2, the widest percentage gap among the core features). Plain emotion labels as the main mode: AI 8% · human 29% (Human #12).
- Check: Tally the emotional beats as body (chest tightened, breath caught, stomach dropped), label ("he was ashamed") or behavior (what they do). Which dominates?
- Fix: Turn a good share of body beats into a plain label or an action. "She was afraid" is a human sentence. Keep physical reactions only where they are specific to this person. Humans mix modes; don't swing to all labels either.

**B2. Go easy on smell.** Smell among the story's dominant senses: AI 82% · human 57% (AI #4).
- Check: Petrichor, ozone, antiseptic, old paper, woodsmoke, the copper tang of blood.
- Fix: Keep a smell only if it does plot work or is genuinely unexpected; otherwise cut it or switch senses.

**B3. Don't make the weather do the emotional work.** [NF] Setting mirrors characters' inner states: AI 4.07 · human 3.58 (1–5, AI #6). Prominence of nature and ecology: AI 3.21 · human 2.83 (1–5, AI #17).
- Check: A storm during the fight, rain at the funeral, light breaking through at the resolution, a lamp dimming as fear arrives.
- Fix: Let the setting be indifferent, contrary (a bright funeral) or merely practical.

**B4. Thin the sensory layer.** [NF] Sensory density: AI 3.93 · human 3.66 (1–5, AI #8).
- Check: Does nearly every paragraph carry a sensory detail, or stack several senses in one sentence?
- Fix: One exact detail beats three atmospheric ones.

**B5. Leave some minds closed.** Depth of interior access: AI 3.93 · human 3.67 (1–5, AI #20).
- Check: Does the narration report each character's thoughts and motives as they happen?
- Fix: Leave some interiors to inference, especially secondary characters; let behavior and dialogue carry them.

### P · Plot streamlining: AI favors tidy, single-track stories

**P1. Break the single causal chain.** Continuity of the main causal chain: AI 4.20 · human 3.92 (1–5, AI #7).
- Check: Does each scene cleanly cause the next, from inciting incident to ending?
- Fix: Add a detour, an accident, a delay, a thread that goes nowhere. Leave a loose end loose.

**P2. Don't let the hero's choice settle everything.** Resolution driven by the protagonist's choice: AI 69% · human 46% (AI #9).
- Check: Is the climax resolved by the protagonist deciding something decisive?
- Fix: Let other people, outside events, luck or a mix settle it, or let the choice fail.

**P3. Don't end on acceptance.** [NF] Main conflict resolved through internal understanding or acceptance: AI 47% · human 27% (AI #18). Humans are more comfortable with ambiguous endings.
- Check: Is the last beat a realization, an acceptance, a making of peace?
- Fix: End on something external (an event, a consequence, an object) or leave it open.

**P4. Run a second thread that rhymes with the first.** No subplots at all: AI 79% · human 57% (AI #14). Subplots that parallel the main theme: AI 21% · human 42% (Human #7).
- Check: Is there only one storyline?
- Fix: Add a secondary thread that meets the main conflict from another angle (a sister's failing marriage beside the protagonist's failing business).

**P5. Bring characters on in motion, not in a portrait.** Central character introduced by external description: AI 52% · human 30% (AI #5). Character introduction is also the top human fingerprint (uniqueness 21.4), though the paper doesn't say which way it leans.
- Check: Is a character's first appearance a paragraph of eyes, hair, clothes and build?
- Fix: Introduce them talking, or acting, or through what others say. Drip appearance in later, if at all.

**P6. Don't open with a surveyed room.** Opening spatial grounding: AI 2.33 · human 2.12 (ordinal, AI #11). Spatial granularity: AI 2.53 · human 2.27 (ordinal, AI #13).
- Check: Does the opening pin down a precise place (and the wider world) before anything happens? Is space mapped in fine detail throughout?
- Fix: Open on a voice, a line of dialogue or an event. Sketch the place in a stroke and add only what the action needs.

**P7. Get to the trouble sooner.** Investment built before major jeopardy: AI 2.99 · human 2.76 (1–5, AI #19).
- Check: How much routine, setup and backstory comes before real danger?
- Fix: Compress the warm-up. Let us learn who the character is under pressure.

### W · The world and the reader: humans reach outside the story

**W1. Name real things.** [NF] Explicit, named references to specific works and authors: AI 24% · human 47% (Human #1, the top human feature). A balanced mix of named and unnamed references: AI 16% · human 37% (Human #3). Mostly vague allusions ("implicit echoes"): AI 72% · human 50% (AI #16). AI avoids naming real brands, places and works.
- Check: Are references generic ("an old song", "a famous poem", "the café on the corner")? Any real titles, authors, brands, streets?
- Fix: Name them: the actual record, the street, the brand of cigarettes. Mix named with unnamed.

**W2. Let the narrator know someone is reading.** [NF] Fourth-wall permeability: AI 0.39 · human 0.67 (ordinal, Human #6). Direct reader address: AI 0.07 · human 0.28 (ordinal, Human #2). The paper's prose reports these as 39% vs 67% and 7% vs 28%. AI narrators behave as if nobody is listening.
- Check: Does the narrator ever acknowledge a reader or the act of telling?
- Fix: Where the voice allows (first person, confessional, comic, essay), add an aside to the reader or a remark on the telling. Don't bolt one onto a close-third thriller.

### C · Chronology: humans subvert linearity

**C1. Break chronological order.** [NF] Chronological discontinuity: AI 2.12 · human 2.40 (1–5, Human #8). Flashbacks and flash-forwards (anachrony): AI 2.31 · human 2.58 (1–5, Human #10).
- Check: Is it told first event to last?
- Fix: Start late and loop back, or jump. The paper's illustration: a human mystery might open at the funeral and spiral back through decades, where AI tells it from first clue to grand reveal.

**C2. Use the timeline to hold back the key fact.** Nonlinear framing for delayed disclosure: AI 1.68 · human 1.96 (1–5, Human #13). Humans use nonlinear structure to delay key revelations; DeepSeek front-loads crucial context that other sources leave until later.
- Check: Is each crucial fact handed over as soon as it becomes relevant?
- Fix: Withhold it, and let a time jump or a late flashback deliver it.

**C3. Make the reveal rewrite the past.** Depth of recontextualization after a surprise: AI 2.95 · human 3.28 (1–5, Human #4).
- Check: Does the twist only add information, or does it force a re-reading of earlier scenes?
- Fix: Plant earlier moments that mean something different once the reveal lands.

### D · Diversity: humans draw on a wider repertoire

**D1. Move around.** Location variety: AI 1.08 · human 1.34 (ordinal, Human #9).
- Check: How many distinct places does the story visit?
- Fix: Stage scenes in more of them.

**D2. Let people talk.** Dialogue-to-narration proportion: AI 2.70 · human 2.95 (1–5, Human #5).
- Check: Are key exchanges summarized instead of dramatized?
- Fix: Put them on the page as scene.

**D3. Let the protagonist be morally mixed.** [NF] Protagonist's choices framed as ambivalent: AI 38% · human 59% (Human #11).
- Check: Is the protagonist clearly good, with the narration on their side?
- Fix: Give them a choice the story neither absolves nor condemns.

**D4. Crowd the world.** AI fiction has less varied characters and social structure (no figure reported); GPT's ensemble-heavy social networks match human levels.
- Check: Is the cast a protagonist plus one or two helpers?
- Fix: Add people with their own agendas, and a group scene or two.

## Fingerprints

Features on which one source stands apart from all the others in six-way attribution. "Uniqueness" is how many times more strongly the feature identifies that source than the next one. The paper's table names each feature but not always its direction; directions below come from the paper's text, and features without one are listed as "also distinctive on".

**Human** (32 fingerprints, the most of any source; none has a stated direction): character introduction (dialogue option, 21.4), breadth of focalization (single focal, 15.7), narrator address mode (no direct address, 12.6), overall revelation pacing (back-loaded, 7.7), literary ambition (crossover genre, 6.8), plus visibility of withholding, atmospheric techniques, subplot density, naming and twist placement.

If an AI drafted or edited the text, also check its fingerprint:

- **Claude** (26; the most distinctive model). Restraint: event intensity escalates less than in any other source (uniqueness 22.4), and its narrative voice is the most uniform. Takes a reverent approach to literary tradition, honoring storytelling conventions rather than challenging them, in 62% of stories vs 39–56% for the other sources. Favors epilogues, avoids dream sequences, prefers quiet endings to "avalanche" endings. Also distinctive on event-type diversity (10.7). Fix: make each complication bigger than the last, vary what kind of thing happens, let voices clash, cut the epilogue, end on impact, break one convention on purpose.
- **GPT** (11). Gossip and rumor drive the plot in 64% of stories vs 44–55% elsewhere (22.1). Likes a distant narrator looking back years or decades (6.8). Subverts expectations more than other models (41% vs 27–36%) and leaves reconciliations partial or ambiguous; its ensemble casts match human levels. Also distinctive on habitual narration. Fix: let events move the plot instead of talk about events, and tell it from closer in.
- **Gemini** (11). Tidiest endings, extended denouements, bleakest settings (88% tagged bleak and oppressive), external character description. Also distinctive on protagonist social trajectory (expands), balance of speech (primarily direct), narrative schema (siege/ordeal), naming practice (personal names) and chronological structure (frequent flashbacks). Fix: end sooner after the climax and question the default gloom.
- **DeepSeek** (7). Front-loads crucial context that other sources save for later. Also distinctive on narrator visibility, emotional expression (behavioral cues), plot-vs-atmosphere orientation, backstory placement (evenly interleaved) and embedded storytelling scenes. Fix: see C2.
- **Kimi** (3). Sits at the generic center of the AI cluster; the paper finds no distinctive narrative choices. Its three weak fingerprints: character introduction (in-action), narrative entry frame (in medias res), explicit trait labeling (no).

## Surface tells (cited by the paper, not measured in it)

The paper deliberately sets style aside but cites other work: AI text overuses em-dashes and words like "delve" and "tapestry". These markers are fading (GPT-5.4 cut its em-dash use), and fine-tuning on human style dropped AI detection of creative writing from 97% to 3%. Style still carries signal: the paper's 39 style features alone reach 85.8% macro-F1, and supervised raw-text classifiers hit 99.7–99.9% (the zero-shot Binoculars detector only 55.9%). So after the structural pass, do a word-level pass (linkedin-humanizer covers vocabulary, em-dashes and rhythm). Other cited findings: human stories carry more cultural nuance, emotional ambiguity and unexpected twists than GPT-written ones, while AI fiction has simpler social structures and repeats plot elements across generations.

## Limits

- Measured on short fiction (about 5,000 words). "Human" means 10,272 published stories from short-story anthologies in Books3, some of them old (Poe, Dickens, Doyle and Wilde turn up). Some human-leaning habits, such as addressing a "dear reader", may partly reflect older conventions.
- "AI" means five late-2025/early-2026 models; newer ones may drift.
- An LLM (Gemini 3 Flash) scored the features: repeat-run agreement α = 0.90, human–model κ = 0.84 on a 12-story check.
- Nothing here tests AI-detector evasion. Present this as making the writing less default, never as a detector score.

## Report template

```markdown
## Human-or-AI check: <title>
Scope: fiction | non-fiction ([NF] rules only) · ~<n> words
AI defaults: <n> of <applicable> rules · Fingerprints: <none | Claude: flat escalation, epilogue>

| Rule | Verdict | Evidence | Fix |
|---|---|---|---|
| T1 Moral stated | AI default | "…and she understood, finally, that…" (last line) | Cut; end on the coat |
| B1 Emotion via body | AI default | 9 body beats, 1 named feeling | Name three plainly |
| W1 Named references | human-leaning | names *Tinker Tailor Soldier Spy* | Keep |

### Fix first
1. <highest-ranked AI default → concrete change>
2. …
3. …
```

The paper gives no cutoff, so the AI-default count tracks a draft across revisions; it is not a pass/fail score.

## Example

Before (hits T1, B1, B2, B3, P3):

> Rain streaked the study window as if the sky itself were grieving. Mara's chest tightened as she breathed in old paper and pipe smoke. Holding his reading glasses, she finally understood: letting go wasn't forgetting. It was its own kind of love.

After:

> It was a bright, stupid Tuesday. Mara was angry, mostly, and ashamed of being angry. She boxed his le Carré paperbacks for the church sale, then took *Tinker Tailor* back out: a 1994 parking ticket was still marking page 212.
