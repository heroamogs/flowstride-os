# Getting Started

Welcome to **Flowstride**, an open-source, flow-first test automation framework and domain-specific language (DSL) designed to unify Web and API testing under a single syntax engine. Flowstride is built on top of Playwright for secure browser manipulation and Undici for high-speed HTTP transport.

---

## Prerequisites

Before setting up your workspace, ensure you have the following software installed on your local system:

- **Node.js**: Version `18.0.0` or higher is strictly required by the execution engine.
- **Package Manager**: Either `npm` (comes bundled with Node) or `yarn`.

---

## Installation

Flowstride is designed to be installed as a unified package. You do not need to install browser drivers or HTTP clients separately—the framework handles all native bindings automatically.

To configure Flowstride inside your repository, execute the following commands in your system terminal using your preferred package manager:

### Using npm

```bash
# Initialize a new Node workspace if you are starting fresh
npm init -y

# Install the Flowstride engine
npm install flowstride

# Scaffold your testing directory and configuration files
npx flowstride init
```

### Using yarn

```bash
# Initialize a new Node workspace if you are starting fresh
yarn init -y

# Install the Flowstride engine
yarn add flowstride

# Scaffold your testing directory and configuration files
yarn flowstride init
```
