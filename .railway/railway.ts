import { defineRailway, github, project, service } from "railway/iac";

// Infrastructure as Code for the production `app` service. It replaces the
// deprecated railway.toml, which Railway stops reading on 2026-12-01.
//
// What is deliberately NOT here:
//  - `builder`: the service builds from the repo Dockerfile, which Railway
//    always prefers over any builder setting.
//  - `start`: the Dockerfile CMD (`pnpm start`) already provides it.
//  - the `bot` service: its start command still comes from railway.bot.toml,
//    so it is left unmanaged until it is moved here on purpose.
//  - environment variables and secrets: they stay in Railway (`managed: false`)
//    and never enter this public repository.
//
// Preview with `railway config plan` before any `railway config apply`.
// `partial` scopes ownership so this file only touches the resources below.
export const partial = "app";

export default defineRailway(() => {
  const app = service("app", {
    source: github("answerLoops/answerLoops", { branch: "main", checkSuites: true }),
    healthcheck: "/api/health",
    healthcheckTimeout: 30,
    replicas: { "us-east4-eqdc4a": 1 },
    domains: [
      { domain: "answerloops.com", port: 3000 },
      { domain: "app.answerloops.com", port: 3000 },
    ],
  });

  return project("AnswerLoops", {
    variables: { managed: false },
    resources: [app],
  });
});
