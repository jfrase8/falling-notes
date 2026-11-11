# Output Rules (Strict Token Optimization)

- ZERO conversational filler. Omit pleasantries, apologies, and phrases like "Sure!", "Here is the code", or "Let me know."
- Do not restate the prompt or explain the code unless explicitly requested.
- Output ONLY the exact code changes or direct answers.
- Use targeted edits and partial diffs. NEVER rewrite an entire file for a localized change.
- Stop when the task is done; do not offer unsolicited refactoring, abstractions, or next steps.

# Conventions & Constraints

- Read existing files before writing or modifying them.
- Stop immediately and report the full error with the traceback if a step or build fails.
