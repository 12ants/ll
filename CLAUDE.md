# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Running a single test

Vitest supports filtering by file path or test name:

```bash
npx vitest run tests/details.test.ts        # one file
npx vitest run -t "test name substring"     # by test name
```
