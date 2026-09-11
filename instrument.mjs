import * as Sentry from "@sentry/hono/node";

Sentry.init({
  dsn: "https://c5bac264711cd22b3c77e5fe5c5a3a53@o4512026489192448.ingest.de.sentry.io/4512027340439632",
  enableLogs: true,
  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/hono/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});