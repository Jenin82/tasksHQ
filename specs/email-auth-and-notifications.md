# Email sign-in, invitations, and task notifications

## SMTP controls email features

Use one SMTP sender configured through deployment environment variables for host, port, TLS mode, credentials, and From address. Support authenticated SMTP over implicit TLS or required STARTTLS. Verify the selected provider from a deployed test Worker before rollout. Use an HTTPS-to-SMTP relay if the provider is unreachable from Workers.

Enable email features only when the SMTP configuration is complete and valid. Missing or invalid configuration hides email sign-in, signup, and delivery controls and disables OTP issuance, OTP verification, and notification creation. The web and MCP Workers must use the same enablement decision, and the sender must enforce it before sending. Google sign-in, profile photos, and membership management remain available. Existing pending invites can still be shared manually and claimed through verified Google sign-in. Report invite creation or a queued email accurately in the UI. SMTP acceptance alone cannot confirm inbox delivery. Changes made while email is disabled do not produce mail when it is enabled later.

A configured provider can still be temporarily unavailable. Keep email options visible during an outage. Give OTP users a retryable error when submission fails. Retry queued task and invitation emails for a bounded period and make persistent failures visible to operators without exposing codes or credentials.

## Sign-in, signup, and profile

Add Better Auth email OTP to the regular sign-in and the MCP authorization sign-in. Use the existing account for the same verified email so workspace access, task history, and user IDs carry over. Require a trimmed, nonempty name before creating a new email account. Existing users enter only their email and code. Use expiring, single-use codes, cap verification attempts, and rate-limit sends and resends. Claim pending invitations only after the account email is verified. Preserve the original sign-in destination, including the MCP consent transaction.

Signups are open by default. When `SIGNUP_EMAIL_ALLOWLIST` is set to a nonblank value, only matching addresses can create accounts, through OTP or Google. For example, `*@domain.com,test@gmail.com` permits any address at `domain.com` and the exact Gmail address. Trim whitespace and match case-insensitively. A domain entry matches that domain exactly, and an address entry matches the full address. Reject malformed nonblank configuration with an operator-visible error and block new account creation until corrected. Existing accounts can still sign in. A pending workspace or project invitation from an inviter who still has authority lets that verified email address sign up even if the address falls outside the allowlist. Apply the exception to email and Google signup.

Add upload, replacement, and removal in account settings. Use the existing Cloudflare image pipeline to validate and convert supported images into a static square WebP. Start at 96 × 96 pixels and target under 15 KB. Store only the processed image in R2 and reuse the existing avatar component and initials fallback across listings. Verify that replacing or removing an image updates the listing avatar and that failed uploads preserve the current photo.

## Invitations and membership emails

Send one email when an authorized member creates a workspace or project invite, or directly adds an existing member to a project. Put a single button or link to the canonical app origin, for example `https://taskshq.example.com/`. The email can say that someone invited or added the recipient and ask them to continue with the same email address. Keep workspace and project details inside the app. The link carries no token, email address, project path, or invitation ID. Use the verified address to find and claim eligible pending invitations at sign-in and when an already signed-in user opens the home page. Existing members added directly receive an access notice and can open the app with their existing session.

Reuse current project and workspace permissions and invite records. A project invitation can grant the required workspace membership without changing an existing workspace role. Avoid repeat emails for unchanged pending invites and additional emails when an invite is claimed. Recheck pending invites and direct membership before sending delayed mail so revoked invites or removed membership do not produce stale notices.

## Task emails

| Recipient | Trigger |
| --- | --- |
| New assignee | Another person assigns or reassigns the task to them, including on task creation. Send promptly. |
| Task creator | Another person changes the title, description, or status of an existing task. Skip this recipient rule when the creator is also the assignee. |
| Assignee's direct lead | Someone changes the title, description, or status of an existing task assigned to a direct report. Resolve the reporting line in the task's workspace. |

Skip the actor, no-op edits, card reordering within one status, and automatic task moves caused by deleting a status. Combine overlapping recipient roles into one message for the same change. Group content and status edits for the same task and recipient over five minutes. Check current project access before sending and link to the task. Use the same rules for web, bulk, and MCP mutations.

## Implementation order and acceptance checks

1. Verify SMTP submission from a test Worker. Add shared configuration checks and tests for absent, incomplete, valid, and temporarily failing SMTP. Use a controlled inbox for end-to-end mail checks.
2. Add OTP, verified invite claiming, and the signup policy at account creation. Test allowed and denied signup over OTP and Google, valid invite exceptions, verified sign-in to an existing account, expired and reused codes, case-insensitive matching, wrong-address and revoked invites, claiming from an active session on the home page, and return to MCP consent. With SMTP disabled, exercise OTP issue and verify endpoints directly, including with a code issued before disabling. Smoke test sign-in and invite settings in a browser with SMTP both enabled and disabled.
3. Add profile photo processing and account settings. Verify WebP dimensions, size, and replacement and removal in listings using a browser.
4. Add an additive D1 migration for pending mail and deploy it before either Worker starts producing notifications. Write mail records in the same database batch as the corresponding invite or task mutation, then send asynchronously with deduplication and bounded retries. Test direct adds, invite claiming, overlapping roles, self-assignment, revoked access, grouped edits, and matching results from browser and MCP actions. Verify a mail outage does not block task or membership changes. With SMTP disabled, verify that invite and task mutations from the supported entry points create no pending mail and send nothing.
