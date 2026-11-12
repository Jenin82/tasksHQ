"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function EmailSignIn({ destination }: { destination: string }) {
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [needsName, setNeedsName] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function sendCode() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" });
      if (result.error) {
        setError(result.error.message ?? "We couldn’t send a code. Try again.");
        return;
      }
      setOtp("");
      setCodeSent(true);
    } catch {
      setError("We couldn’t send a code. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!codeSent) return sendCode();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await authClient.signIn.emailOtp({ email: email.trim(), otp, name: name.trim() || undefined });
      if (result.error?.code === "NAME_REQUIRED") {
        setNeedsName(true);
      } else if (result.error) {
        setError(result.error.message ?? "That code could not be verified. Try again.");
      } else {
        window.location.assign(destination);
      }
    } catch {
      setError("Sign-in failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {codeSent ? (
        <>
          <p className="text-sm text-muted-foreground">
            If {email.trim()} can sign in, a six-digit code will arrive shortly.
          </p>
          <div className="space-y-2">
            <Label htmlFor="sign-in-code">Sign-in code</Label>
            <Input id="sign-in-code" required disabled={pending} autoFocus autoComplete="one-time-code"
              inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp}
              onChange={(event) => setOtp(event.target.value)} />
          </div>
          {needsName && (
            <div className="space-y-2">
              <Label htmlFor="sign-up-name">Your name</Label>
              <Input id="sign-up-name" required disabled={pending} autoFocus autoComplete="name"
                maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="sign-in-email">Email address</Label>
          <Input id="sign-in-email" required disabled={pending} autoFocus type="email" autoComplete="email"
            maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button className="w-full" size="lg" type="submit" disabled={pending}>
        {pending ? "Please wait…" : needsName ? "Create account" : codeSent ? "Continue" : "Send sign-in code"}
      </Button>
      {codeSent && (
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" disabled={pending} onClick={() => {
            setCodeSent(false);
            setNeedsName(false);
            setName("");
            setError("");
          }}>Change email</Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={sendCode}>Resend code</Button>
        </div>
      )}
    </form>
  );
}
