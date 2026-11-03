# GhostRepo Architecture & Agent Steering Guide

## Core Objective
Transform abandoned, legacy, or dead repositories into production-ready, modern codebases through automated agent-driven analysis and refactoring workflows.

## System Layers
1. **Repository Scanner & Dead Code Detector:**
   - Evaluates commit history velocity, dependency vulnerability age, and codebase entropy.
   - Identifies "zombie code blocks" (e.g., deprecated APIs, unmaintained COBOL/legacy modules, circular spaghetti dependencies).
2. **Kiro Multi-Agent Orchestrator:**
   - **Exorcist Agent:** Banish security vulnerabilities, buffer overflows, and critical syntax errors.
   - **Alchemist Agent:** Converts legacy patterns into modern paradigms (e.g., Python 2 to Modern Python 3, callback hell to async/await, class components to hooks).
3. **Automated Verification Pipeline:**
   - Runs sandboxed test generation and execution to ensure zero functional regression post-refactoring.

## Guardrails & Conventions
- **Zero Breaking Logic:** All automated refactors must preserve the core business domain logic of the original project.
- **Incremental Pull Requests:** Code transformations are structured into clean, reviewable, atomic pull requests with descriptive documentation of what was "resurrected".