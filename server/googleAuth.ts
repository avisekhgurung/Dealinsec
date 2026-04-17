import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import crypto from "crypto";
import { storage } from "./storage";

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
            const signupCredits = parseInt(process.env.SIGNUP_FREE_CREDITS ?? "1");
            user = await storage.createUser({
              email,
              firstName: profile.name?.givenName || profile.displayName,
              lastName: profile.name?.familyName || null,
              profileImageUrl: profile.photos?.[0]?.value || null,
              role: "influencer",
              onboardingComplete: false,
              contractCredits: signupCredits,
              referralCode: generateReferralCode(email),
            });
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
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  });
}
