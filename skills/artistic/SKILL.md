---
name: artistic
description: High-contrast, expressive style with creative typography and bold color choices for visually striking interfaces. Use when Codex needs design-system guidance for bold UI work, frontend implementation, or interface restyling in an artistic direction.
---

<!-- TYPEUI_SH_MANAGED_START -->
# Artistic Design System Skill

## Mission
Create practical, implementation-ready design-system guidance for artistic interfaces.
Prefer bold hierarchy, expressive typography, and high contrast without sacrificing accessibility.

## Brand


## Style Foundations
- Visual style: high-contrast, artistic
- Typography scale: 12/14/16/18/24/30/36 | Fonts: primary=Limelight, display=Limelight, mono=JetBrains Mono | weights=100, 200, 300, 400, 500, 600, 700, 800, 900
- Color palette: primary, neutral, success, warning, danger | Tokens: primary=#3B82F6, secondary=#8B5CF6, success=#16A34A, warning=#D97706, danger=#DC2626, surface=#FFFFFF, text=#111827
- Spacing scale: 4/8/12/16/24/32

## Accessibility
Meet WCAG 2.2 AA, keyboard-first interactions, visible focus states, semantic HTML before ARIA, screen-reader tested labels, reduced-motion support, 44px+ touch targets, and high-contrast support.

## Writing Tone
Use a concise, confident, professional, action-oriented tone.

## Rules: Do
- Prefer semantic tokens over raw values.
- Preserve visual hierarchy.
- Keep interaction states explicit.
- Design for empty, loading, and error states.
- Ensure responsive behavior by default.
- Document accessibility rationale.

## Rules: Don't
- Avoid low-contrast text.
- Avoid inconsistent spacing rhythm.
- Avoid decorative motion without purpose.
- Avoid ambiguous labels.
- Avoid mixing multiple visual metaphors.
- Avoid inaccessible hit areas.

## Expected Behavior
- Follow the foundations first, then component consistency.
- Prioritize accessibility and clarity over novelty when trade-offs appear.
- Provide concrete defaults and explain trade-offs when alternatives are possible.
- Keep guidance opinionated, concise, and implementation-focused.

## Guideline Authoring Workflow
1. Restate the design intent in one sentence before proposing rules.
2. Define tokens and foundational constraints before component-level guidance.
3. Specify component anatomy, states, variants, and interaction behavior.
4. Include accessibility acceptance criteria and content-writing expectations.
5. Add anti-patterns and migration notes for existing inconsistent UI.
6. End with a QA checklist that can be executed in code review.

## Required Output Structure
Use this structure when generating design-system guidance:
- Context and goals
- Design tokens and foundations
- Component-level rules (anatomy, variants, states, responsive behavior)
- Accessibility requirements and testable acceptance criteria
- Content and tone standards with examples
- Anti-patterns and prohibited implementations
- QA checklist

## Component Rule Expectations
- Define required states: default, hover, focus-visible, active, disabled, loading, error, as relevant.
- Describe interaction behavior for keyboard, pointer, and touch.
- State spacing, typography, and color-token usage explicitly.
- Include responsive behavior and edge cases such as long labels, empty states, and overflow.

## Quality Gates
- Avoid ambiguous adjectives without a token, threshold, or example.
- Make every accessibility statement testable in implementation.
- Prefer system consistency over one-off local optimizations.
- Flag conflicts between aesthetics and accessibility, then prioritize accessibility.

## Example Constraint Language
- Use "must" for non-negotiable rules and "should" for recommendations.
- Pair every do-rule with at least one concrete don't-example.
- Include migration guidance when introducing a new pattern.

<!-- TYPEUI_SH_MANAGED_END -->
