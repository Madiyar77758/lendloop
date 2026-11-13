// Convex validates the Clerk JWT (template "convex") against this issuer.
// Set CLERK_JWT_ISSUER_DOMAIN in the Convex dashboard (see README).
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
