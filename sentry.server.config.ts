import * as Sentry from "@sentry/nextjs";
import { SENTRY_DATA_COLLECTION } from "./lib/sentry-data-collection";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  dataCollection: SENTRY_DATA_COLLECTION,
});
