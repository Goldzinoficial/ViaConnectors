import type { AuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import GitHub from "next-auth/providers/github";

// Extend the built-in types so `session.accessToken` is typed correctly.
declare module "next-auth" {
  interface Session {
    accessToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
  }
}

export const authOptions: AuthOptions = {
  providers: [
    GitHub({
      clientId: process.env.GITHUB_ID ?? "",
      clientSecret: process.env.GITHUB_SECRET ?? "",
    }),
  ],
  callbacks: {
    // Capture the OAuth access_token the first time the user signs in,
    // and persist it in the JWT so it survives page refreshes.
    async jwt({ token, account }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    // Expose the token to the client via `useSession().data.accessToken`.
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      return session;
    },
  },
};
