import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import crypto from "crypto";
import { storage } from "./storage";
import { sendEmail, welcomeEmail } from "./emails";
import { generateOrgSlug } from "./auth";

function generateReferralCode(email: string): string {
  const prefix = email.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, "X");
  const suffix = crypto.randomBytes(3).toString("hex").substring(0, 5).toUpperCase();
  return `${prefix}${suffix}`;
}

export function setupGoogleAuth() {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL || "http://localhost:3000";

  if (!clientID || !clientSecret) {
    console.log("Google OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing) — skipping");
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL: `${appUrl}/api/auth/google/callback`,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(new Error("No email from Google"), undefined);

          let user = await storage.getUserByEmail(email);

          if (!user) {
            // Signup creates the user's organization; they become its OWNER.
            const first = profile.name?.givenName || profile.displayName || email.split("@")[0];
            const org = await storage.createOrganization(`${first}'s Workspace`, generateOrgSlug(first));
            user = await storage.createUser({
              email,
              firstName: profile.name?.givenName || profile.displayName,
              lastName: profile.name?.familyName || null,
              profileImageUrl: profile.photos?.[0]?.value || null,
              role: "influencer",
              onboardingComplete: false,
              referralCode: generateReferralCode(email),
              organizationId: org.id,
              orgRole: "OWNER",
              memberStatus: "active",
              joinedAt: new Date(),
            } as any);

            // Welcome email for new Google sign-ups — best-effort
            const { subject, html } = welcomeEmail({ firstName: user.firstName || undefined });
            void sendEmail({ to: email, subject, html });
          }

          return done(null, user);
        } catch (err) {
          return done(err as Error, undefined);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        // User no longer exists (deleted, db reset, etc.) — clear the stale session
        // by signalling "no user" instead of throwing a deserialization failure.
        return done(null, false);
      }
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  });
}
