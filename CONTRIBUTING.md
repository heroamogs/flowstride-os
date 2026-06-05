# Contributing to Flowstride OS

First off, thank you for considering contributing to Flowstride OS! It is people like you that make open-source software such a powerful tool.

Whether you are helping us fix bugs, improve the documentation, or propose new features, we appreciate your time and effort. This document outlines the guidelines and steps for contributing to the framework.

---

## 1. Ways to Contribute

There are many ways you can contribute to Flowstride OS:

- **Report Bugs:** Find a bug? Open an issue to let us know.
- **Suggest Features:** Have an idea for a new `.flow` command or a dashboard enhancement? Open a feature request.
- **Improve Documentation:** Typos, unclear explanations, or missing examples in our `README.md`? We gladly accept documentation PRs.
- **Write Code:** Check our open issues for the `good first issue` or `help wanted` labels.

---

## 2. Reporting Bugs

A good bug report saves everyone time. If you find a bug, please check the existing issues first to ensure it has not already been reported.

If it is a new bug, please open an issue and include:

1. **Flowstride Version:** The exact version of Flowstride OS you are running.
2. **Environment:** Your Operating System and Node.js version.
3. **The `.flow` Script:** Provide a minimal, reproducible `.flow` file that triggers the bug.
4. **Expected vs. Actual Behavior:** What did you expect to happen, and what actually happened?
5. **Logs/Screenshots:** If the UI dashboard threw an error, please include a screenshot or terminal stack trace.

_Note: If your bug is a security vulnerability, please refer to our `SECURITY.md` and DO NOT open a public issue._

---

## 3. Local Development Setup

If you want to contribute code to Flowstride OS, you will need to set up the project locally. Flowstride consists of a Node.js backend (the CLI/Runner) and a React frontend (the Dashboard).

**Prerequisites:**

- Node.js (v18 or higher)
- npm or yarn

**Setup Instructions:**

1. Fork the repository on GitHub.
2. Clone your forked repository to your local machine:
   git clone https://github.com/YOUR-USERNAME/flowstride-os.git
   cd flowstride-os
3. Install dependencies for the core runner:
   npm install
4. Install dependencies for the React Dashboard:
   cd src/ui
   npm install
   cd ../../
5. Run the TypeScript compiler in watch mode:
   npm run build:watch

---

## 4. Understanding the Architecture

Before making changes, it is helpful to understand how Flowstride OS is structured:

- **`src/parser/`**: The Lexer and Parser. This reads the custom `.flow` syntax and converts it into an Abstract Syntax Tree (AST) of Scenarios and Steps.
- **`src/adapters/web/`**: The Playwright wrapper. This translates `.flow` UI commands (like `flow.click`) into actual browser automation instructions.
- **`src/adapters/api/`**: The Undici wrapper. Handles native REST and GraphQL network requests.
- **`src/runner/`**: The heart of the system. `flow_worker.ts` executes the steps sequentially, while `flow_orchestrator.ts` manages the WebSocket connection.
- **`src/ui/`**: The React Dashboard. It connects to the Orchestrator via WebSockets to display live execution data.

---

## 5. Pull Request Guidelines

To ensure a smooth review process, please adhere to the following rules when submitting a Pull Request (PR):

### Scope Your PRs

- Keep your PRs small and focused on a **single concern**. Do not mix a bug fix, a new feature, and a code refactor into one massive PR.
- If you notice an unrelated bug while working on a feature, open a separate issue and a separate PR for it.

### Branch Naming

Please use descriptive branch names based on the type of work you are doing:

- `feat/add-graphql-support`
- `fix/dropdown-selector-timeout`
- `docs/update-readme`

### Commit Message Format

We follow the Conventional Commits specification. This helps us automatically generate changelogs. Prefix your commit messages like so:

- `feat:` A new feature or `.flow` command.
- `fix:` A bug fix.
- `docs:` Documentation only changes.
- `refactor:` A code change that neither fixes a bug nor adds a feature.
- `chore:` Changes to the build process or auxiliary tools.

_Example: `fix: resolve ambiguity error on hidden checkboxes`_

### Code Style

- Do not leave commented-out dead code or `console.log()` debugging statements in your PR.
- Ensure your code passes all existing linting and formatting rules.

---

## 6. The Code Review Process

Once you submit a PR, a core maintainer will review your code.

- We may ask for clarification or request specific changes.
- Please be responsive to feedback. If a PR sits stale with requested changes for more than 14 days, it may be closed.
- Once approved, a maintainer will merge your code into the main branch.

Thank you for contributing to Flowstride OS!
