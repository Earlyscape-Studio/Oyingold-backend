export type Bindings = {
    HYPERDRIVE: {connectionString: string};
    SUPABASE_URL: string;
    SUPABASE_SECRET_KEY: string;
    RESEND_API_KEY: string;
    SENTRY_DSN: string;
    NODE_ENV: string;

    // Checkout pricing (see src/utils/pricing.ts). All optional, plain-number strings.
    FLAT_SHIPPING_FEE?: string;  // naira, flat shipping per order until the client sets a plan
    CARD_FEE_PERCENT?: string;   // e.g. "1.5"; leave unset until the FCMB rate is known
    CARD_FEE_FLAT?: string;      // naira added on top of the percentage
    CARD_FEE_CAP?: string;       // naira, maximum card fee

    // FCMB Pay (see src/utils/fcmb.ts). The keys are secrets: set them with
    // `wrangler secret put` in production and in .dev.vars locally, never in wrangler.jsonc.
    FCMB_PUBLIC_KEY?: string;
    FCMB_SECRET_KEY?: string;
    FCMB_BASE_URL?: string;      // defaults to https://seerbitapi.com
    FCMB_WEBHOOK_TOKEN?: string; // secret: if set, the webhook URL in FCMB's dashboard must end in ?token=<this>
    FRONTEND_URL?: string;       // where customers return after paying, e.g. https://oyingold.com
}