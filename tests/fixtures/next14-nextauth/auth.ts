import NextAuth from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import GitHub from "next-auth/providers/github"

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter({} as never),
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id
      return session
    },
  },
})
