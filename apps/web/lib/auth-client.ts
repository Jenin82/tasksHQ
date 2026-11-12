"use client";

import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

/** Same origin as the app, so no baseURL is needed. */
export const authClient = createAuthClient({ plugins: [emailOTPClient()] });
