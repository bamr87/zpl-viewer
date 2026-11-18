<!-- kit: governance v0.1.0 -->
# 0002 — Missions

- **Status:** proposed
- **Date:** 2026-11-16
- **Proposed by:** Grok Bot (agent), at the maintainer's request
- **Ratified by:**
- **Affects:** constitution §1; PRD.md §1.1; ZPL-013
- **Supersedes:** none
- **Related:** [PRD.md](../../PRD.md) §1.1

## Context

Constitution §1 was a single mission sentence or short paragraph, not one direction statement with exactly three numbered missions. The fleet rule is that every repo's constitution §1 uses that form, adopted through a numbered amendment the maintainer ratifies by merging. Mission 1 is the maintainer's own wording, adapted to this repo: provide data, tools, resources and transparency for all stakeholders, practitioners in the domain, and the general public. The ambition is the direction, not a claim that the work is already finished.

The earlier §1 text was:

> Label Studio is an offline VS Code extension to read, preview, create, modify, analyze, import, merge and deploy ZPL II and EPL2 thermal labels. Everything except deployment runs locally — no HTTP calls, external services, Docker or binaries.

## Amendment

Retitle constitution §1 **Missions**. Replace the body of §1 with the following. Any invariants or other normative rules that already lived outside §1 are unchanged.

Label Studio's direction is to become the ultimate open home for all things thermal labels — data, tools, resources and transparency, gathered in one place that anyone can inspect and reuse.

1. **Provide data, tools, resources and transparency for all stakeholders, label practitioners and the general public.** Developers and integrators, warehouse and IT staff, and the general public are first-class audiences. The aim is a shared, open commons: the same sources, the same tools, and the same trail of evidence for everyone.
2. **Make every ZPL II and EPL2 label readable, previewable, authorable, analyzable and mergeable entirely offline.** Everything except explicit deployment runs locally — no HTTP calls, external services, Docker or binaries required to edit. A shared intermediate representation is the path to conversion between dialects; every preview and analysis stays inspectable.
3. **Put that studio in every operator's hands, and make deploying a label to a printer effortless and auditable.** Serve it as a VS Code extension that can merge data and deploy over raw TCP, a device path or a spool directory — an open toolkit for working with all things thermal labels.

These missions set the course; they do not claim the work is finished. They serve the PRD goals in §3: accurate preview and export, barcode validation, dialect conversion, and a fully offline editor except explicit deploy. The earlier mission paragraph is absorbed into these three. Every feature must trace to them.

_Source: [../PRD.md](../PRD.md) §1.1._

## Consequences

Agents and reviewers judge fit against these three missions before inventing scope, treating them as the direction of the repo rather than a description of what already ships. The same text is added as PRD.md §1.1 so the constitution's `_Source:` line stays accurate. The PRD purpose, goals, feature catalog and invariants outside this addition are unchanged except for a new catalog entry (ZPL-013) and a regenerated feature-catalog block where the repo already has one. This PR also aligns the README and AGENTS.md one-liners with the missions and links them to constitution §1.
