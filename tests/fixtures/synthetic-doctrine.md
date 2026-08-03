<!--
  A synthetic stand-in for the institutional analyst doctrine — NOT the doctrine.

  The real doctrine is private: BWMACRO/docs/architecture/intelligence_runtime/
  chat_doctrine/ANALYST_SYSTEM_PROMPT_APPEND.md. It reaches production through
  ANALYST_SYSTEM_PROMPT_APPEND at deploy, and it is never committed here —
  this repository is public.

  Until 2026-08-03 a full copy of the doctrine sat at
  tests/fixtures/analyst-doctrine-append.md, committed by the very change that
  introduced the "thin public shell" (4901f91, 2026-05-17). It also went stale,
  which is what made it visible: it was missing rules the SSOT had gained.

  What this file is for: exercising the *mechanics* of buildSystemPrompt —
  that a doctrine is loaded at all, that the placeholder is substituted, that
  inline wins over path, that the sections land in order. Mechanics do not
  need real content, and using real content here is how the leak happened.

  Assertions about what the doctrine *says* live in BWMACRO, next to the SSOT,
  where they cannot go stale and cannot be published.
-->

## SYNTHETIC-DOCTRINE-MARKER-ALPHA

This is placeholder prose standing in for a doctrine section. It exists so a
test can assert that loaded doctrine reaches the assembled prompt.

- **SYNTHETIC-RULE-ONE:** a bullet, so list rendering is exercised.
- **SYNTHETIC-RULE-TWO:** a second bullet, so ordering is observable.

{{TOOLS_AND_PERFORMANCE}}

## SYNTHETIC-DOCTRINE-MARKER-OMEGA

Deliberately after the placeholder, so a test can prove the injected Tools and
Performance block lands between the two markers rather than being appended.
