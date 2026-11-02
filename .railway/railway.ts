import { defineRailway, github, project, service } from "railway/iac";

// Infrastructure as Code for the production `app` and `bot` services. It
// replaces railway.toml and railway.bot.toml, which Railway stops reading on
// 2026-12-01.
//
// This file is NOT read at deploy time. Changes reach Railway only through
// `railway config apply`, so merging an edit here does nothing until someone
// applies it. Needs Railway CLI 5.42.1 or newer.
//
// What is deliberately NOT here:
//  - environment variables and secrets: they stay in Railway and never enter
//    this public repository. `variables: { managed: false }` below is what
//    tells the CLI to leave them alone; without it `railway config plan`
//    refuses, listing every variable a service has. The option is read by the
//    CLI's IaC engine, but the SDK's types (railway 3.16.0) do not declare it
//    yet, hence the explicit type below. Re-check when the SDK is bumped.
//  - the *.up.railway.app domains: Railway provides them and they are not
//    managed here.
//
// Cutover, in this order:
//  1. Clear the bot service's "Config file path" in the Railway dashboard
//     (it still points at the deleted railway.bot.toml). IaC cannot manage a
//     service that config-as-code still manages.
//  2. Run `railway config plan`. It may only add the build and deploy
//     settings declared below. Stop if it removes or changes anything else.
//  3. Run `railway config apply`.
//
// `partial` scopes ownership so this file only touches the resources below.
export const partial = "answerloops-services";

// Both services build from the repo Dockerfile. The builder is pinned rather
// than left to auto-detection so a Railway default change cannot switch it.
const dockerfile = { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" } as const;

// project()'s own options plus the CLI-only `variables` switch (see above).
type ProjectConfig = Parameters<typeof project>[1] & { variables?: { managed: boolean } };

export default defineRailway(() => {
  const source = github("answerLoops/answerLoops", { branch: "main", checkSuites: true });

  const app = service("app", {
    source,
    build: dockerfile,
    // The Dockerfile CMD (`pnpm start`) is the start command.
    deploy: {
      healthcheckPath: "/api/health",
      healthcheckTimeout: 30,
      restartPolicyType: "ON_FAILURE",
    },
    replicas: { "us-east4-eqdc4a": 1 },
    domains: [
      { domain: "answerloops.com", port: 3000 },
      { domain: "app.answerloops.com", port: 3000 },
    ],
  });

  // Same image as the app, started as the bot: the Discord listener, sweeps,
  // KB sync worker and trial reminders. It serves no HTTP, so it has no
  // health check or domains.
  const bot = service("bot", {
    source,
    build: dockerfile,
    deploy: {
      startCommand: "pnpm bot:start",
      restartPolicyType: "ON_FAILURE",
    },
    replicas: { "us-east4-eqdc4a": 1 },
  });

  const config: ProjectConfig = { variables: { managed: false }, resources: [app, bot] };
  return project("AnswerLoops", config);
});
