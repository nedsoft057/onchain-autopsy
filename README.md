# On-Chain Autopsy

**On-Chain Autopsy is an autonomous on-chain investigation agent built to reconstruct the behaviour of a token from blockchain evidence.**

Instead of asking an AI to simply classify a token as a rug or not, Autopsy investigates the token through a sequence of evidence-gathering operations.

It establishes the token, examines liquidity, maps holder distribution, traces wallet relationships, studies selling behaviour, investigates funding relationships, and compares independent signals before reaching an internal conclusion.

The interface then turns those findings into a visual forensic scene where the user can inspect the evidence themselves.

The goal is simple:

> **Don't just tell someone what happened. Show them how it happened.**

---

## What the agent does

A user provides a token contract address or Solana mint.

Autopsy then creates an investigation around that token.

The agent does not treat the language model as the source of truth. Instead, the LLM acts as the **investigation planner**, deciding what should be investigated next based on the evidence already collected.

Blockchain providers are responsible for the actual facts.

The general flow is:

```text
TOKEN ADDRESS
      ↓
Input validation
      ↓
Chain detection
      ↓
Provider layer
      ↓
Blockchain observations
      ↓
AI investigation planner
      ↓
Action Guard
      ↓
Investigation tool
      ↓
Verified observation
      ↓
Evidence generation
      ↓
Scene marker mapping
      ↓
Investigation result
```

This separation is intentional.

The AI can decide **what to investigate**, but it cannot simply invent the blockchain evidence.

---

# The investigation loop

Autopsy works as an iterative investigation rather than a single AI prompt.

At each stage, the agent has access to the evidence and observations already collected.

It asks:

```text
What do we know?

What is still unknown?

What investigation path is justified next?

What evidence would resolve that question?
```

The planner proposes an action.

Before that action reaches a provider, the **Action Guard** checks whether the investigation is allowed to perform it.

For example, the system can prevent wallet-relationship analysis from being treated as meaningful before holder distribution has been established.

This keeps the investigation ordered and prevents the planner from jumping to conclusions.

---

# AI planning

Autopsy supports multiple planning layers.

### Gemini

Gemini is the primary AI investigation planner.

It receives the current investigation state and proposes the next justified investigation action.

### Groq

Groq acts as a fallback planner when Gemini is unavailable or returns an invalid decision.

### Deterministic planner

If both AI planners are unavailable, Autopsy can continue using its deterministic investigation planner.

This means the investigation architecture does not completely depend on an LLM being available.

More importantly, **none of these models are treated as blockchain data providers.**

The models plan.

The provider layer observes.

---

# Action Guard

Every planner decision passes through an Action Guard before execution.

The Guard exists to enforce investigation rules and prevent invalid investigation sequences.

For example:

```text
inspect_token
      ↓
inspect_liquidity
      ↓
inspect_holders
      ↓
inspect_actor_behavior
      ↓
wallet relationships
      ↓
sell sequence
      ↓
post-sell liquidity
```

Not every investigation requires every path.

The agent determines which paths are justified by the evidence it has already collected.

This allows the investigation to remain evidence-driven instead of following a fixed checklist blindly.

---

# Blockchain data infrastructure

Autopsy uses a provider abstraction rather than embedding blockchain requests directly into the investigator.

The provider layer currently includes:

### GoldRush

GoldRush provides the primary structured blockchain data layer for supported chains.

It is used for things such as:

- token identity and metadata
- token balances
- holder distribution
- wallet activity
- transaction history
- liquidity and market enrichment
- pool activity
- transfer relationships
- selling activity
- other chain-specific observations

Provider capabilities are chain-aware.

If an endpoint does not support a particular chain or investigation capability, Autopsy does not pretend that the evidence exists.

---

### CoinMarketCap

CoinMarketCap is used where the current Solana investigation path requires holder or actor information that is not available through the same GoldRush Foundational endpoint.

The provider layer keeps this distinction explicit rather than pretending every chain has identical data capabilities.

---

### RPC

The RPC provider adds lower-level blockchain verification where configured.

This can provide additional information such as:

- earliest observed transactions
- deployer candidates
- token transfers
- possible deployer sales
- transaction-level history

RPC observations can supplement the structured provider layer without automatically turning a transfer into proof of malicious behaviour.

---

### Market discovery

Market/pool discovery can use public market information as enrichment.

Market discovery is secondary to the actual blockchain evidence.

---

# Evidence engine

Autopsy converts verified observations into structured evidence objects.

Each finding has an identifier:

```text
E01
E02
E03
...
```

and contains information such as:

```json
{
  "id": "E01",
  "type": "token_deployment",
  "title": "Token contract established",
  "details": "...",
  "confidence": "high"
}
```

Evidence is only emitted when the underlying provider data actually establishes the finding.

Autopsy does **not** create artificial evidence simply to reach a target number of findings.

A token may produce four findings.

Another investigation may produce ten.

The evidence count reflects what was actually established.

---

# Investigation paths

Depending on the token and available evidence, Autopsy can investigate areas including:

### Token identity

Establishes the token, chain, metadata, and earliest observed activity.

### Liquidity

Examines the initial market/liquidity position and later liquidity behaviour where available.

### Holder distribution

Examines concentration and meaningful holder distribution.

### Actor behaviour

Looks at deployer activity, holder selling, early-holder behaviour and other actor-level clues.

### Wallet relationships

Investigates whether relevant wallets appear economically connected through funding or transaction relationships.

### Selling behaviour

Examines whether selling appears isolated, concentrated, coordinated, or otherwise significant.

### Funding relationships

Looks for shared funding sources and funding-before-buy relationships.

### Liquidity removal

Where supported, examines whether significant liquidity was removed alongside other extraction signals.

These paths are not automatically interpreted as malicious.

A relationship is a clue.

A transfer is a clue.

A sale is a clue.

The system looks for **independent evidence that corroborates those clues**.

---

# Verdict model

Internally, Autopsy maintains a structured verdict model.

It distinguishes between:

```text
VERDICT-BEARING SIGNALS
SUSPICIOUS CAUTIONS
COUNTER-EVIDENCE
```

This prevents a single weak observation from automatically becoming a rug classification.

For example, shared funding by itself does not establish a rug.

Likewise, a single top-holder sale does not automatically establish malicious extraction.

Stronger conclusions require corroboration between independent investigation paths.

The model considers signals such as:

- deployer exits
- deployer-linked exits
- coordinated selling
- liquidity removal
- connected wallet clusters
- early-holder dumping
- top-holder exits
- shared-funded seller groups
- supply manipulation
- privileged token controls

The final interpretation is therefore based on the **relationship between evidence**, rather than simply counting suspicious-looking transactions.

---

# The forensic scene

The frontend represents investigation evidence as a visual crime scene.

Every evidence object can be mapped to a meaningful scene anchor.

For example:

```text
E01 → computer
E02 → spoon
E03 → table
E04 → cupboard
```

The backend sends the corresponding marker information:

```json
{
  "id": "E01",
  "scene": {
    "mode": "primary",
    "anchorId": "computer_deployment",
    "object": "computer",
    "x": 0.18,
    "y": 0.35
  }
}
```

This creates a direct relationship between:

```text
blockchain observation
        ↓
evidence
        ↓
scene marker
        ↓
visual object
```

The frontend therefore does not have to guess where evidence belongs.

The backend tells it.

---

# Evidence, Receipt and Trends

The verdict interface exposes the investigation through three expandable sections.

## Evidence

Evidence presents the actual findings produced during the investigation.

Users can move through:

```text
E01 → E02 → E03 → ... → final finding
```

Each finding contains its title, explanation and confidence.

The corresponding scene marker can be connected back to that finding.

The interface intentionally avoids simply telling the user:

> "This token is a rug."

Instead, the user is given the underlying evidence and can inspect the case themselves.

---

## Receipt

The Receipt represents the investigation trail.

It records what Autopsy actually did.

For example:

```text
inspect_token
inspect_liquidity
inspect_holders
inspect_actor_behavior
finish
```

along with the questions and reasoning associated with those investigation steps.

The Receipt is effectively the **chain of custody for the investigation process**.

It answers:

> What did Autopsy actually investigate?

---

## Trends

Trends presents structured observations in a more technical format.

Rather than inventing a generic "risk trend", it exposes measurable investigation patterns such as:

```text
holder concentration
selling activity
liquidity movement
wallet relationships
funding relationships
coordination signals
```

This section is intended to feel closer to a forensic data readout than a natural-language conclusion.

---

# Frontend architecture

The application is intentionally separated into investigation stages.

```text
Landing
   ↓
Tracing
   ↓
Verdict / Evidence Scene
```

### Landing

The user enters a token address and begins an investigation.

### Tracing

The interface shows the investigation happening in real time, including the current investigation question and investigation events.

### Verdict

The completed investigation is reconstructed visually.

The user can inspect:

- the scene
- evidence markers
- Evidence
- Receipt
- Trends

The frontend consumes the structured investigation response generated by the backend.

---

# Real-time investigation

The backend exposes the investigation as an HTTP service.

The frontend sends a token address to the Autopsy API.

The server runs the investigation and returns structured information containing:

```text
verdict
evidence
scene
investigation
debrief
```

The frontend uses the relevant portions of that response to construct the investigation experience.

The verdict itself remains an internal part of the backend model; the visual investigation interface is designed around the evidence rather than simply displaying the classification.

---

# Local development

Install dependencies:

```bash
npm install
```

Run the test suite:

```bash
npm test
```

Run a real investigation:

```bash
npm run dev -- <TOKEN_ADDRESS>
```

For Solana:

```bash
npm run dev -- <SOLANA_MINT> solana-mainnet
```

The local full-stack server can be started with:

```bash
node --env-file=.env server.js
```

The server exposes the frontend and API from the same application.

---

# Environment variables

Autopsy expects provider credentials to be supplied through the environment.

```text
SOLANA_RPC_URL
GOLDRUSH_API_KEY
GEMINI_API_KEY
GROQ_API_KEY
```

Optional provider configuration may also be supplied where supported.

**Never commit `.env` to GitHub.**

API credentials should remain server-side and should never be exposed through frontend JavaScript.

For deployment platforms such as Vercel, configure these values through the platform's environment-variable settings.

---

# Testing

The project includes an automated test suite covering the investigation architecture.

The tests cover areas including:

- verdict semantics
- evidence generation
- scene marker generation
- investigation ordering
- Action Guard behaviour
- provider capability handling
- Solana input handling
- EVM input handling
- RPC behaviour
- Gemini planner behaviour
- Groq planner behaviour
- deterministic fallback behaviour

The test suite is designed to keep provider calls out of offline unit tests.

A successful test run should therefore not require live blockchain API calls for the test cases.

---

# Design principle

On-Chain Autopsy is built around one principle:

> **Evidence first. Conclusion second.**

The agent can investigate.

It can identify patterns.

It can calculate a conclusion internally.

But the interface is designed to let the user inspect the trail that led there.

The objective isn't to replace the user's judgment with an AI label.

It's to make the underlying on-chain behaviour easier to investigate.

---

## Project structure

```text
onchain-autopsy-app/
│
├── public/
│   ├── index.html
│   ├── trace.html
│   └── verdict.html
│
├── src/
│   ├── agent.js
│   ├── investigation.js
│   ├── planner.js
│   ├── guard.js
│   ├── progress.js
│   │
│   ├── llm/
│   │   ├── llmPlanner.js
│   │   └── groqPlanner.js
│   │
│   ├── providers/
│   │   ├── goldrush.js
│   │   ├── coinmarketcap.js
│   │   ├── rpc.js
│   │   ├── evidenceProvider.js
│   │   └── capabilities.js
│   │
│   ├── tools/
│   │   └── autopsyTools.js
│   │
│   ├── scene/
│   │   └── sceneMapper.js
│   │
│   └── data/
│       └── cases.js
│
├── test/
├── prompts/
├── server.js
├── package.json
└── README.md
```
