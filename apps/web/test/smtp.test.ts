import { expect, it } from "vitest";
import { smtpConfiguration } from "@/lib/smtp";

const configuration = {
  SMTP_HOST: "smtp.example.test",
  SMTP_USERNAME: "sender",
  SMTP_PASSWORD: "test-only-password",
  SMTP_FROM: "notifications@example.test",
};

it("enables mail only for a complete configuration with authenticated TLS", () => {
  expect(smtpConfiguration({})).toBeNull();
  expect(smtpConfiguration({ ...configuration, SMTP_TLS: "starttls", SMTP_PASSWORD: "" })).toBeNull();
  expect(smtpConfiguration({ ...configuration, SMTP_TLS: "plain" })).toBeNull();
  expect(smtpConfiguration({ ...configuration, SMTP_TLS: "starttls", SMTP_PORT: "25" })).toBeNull();
  expect(smtpConfiguration({ ...configuration, SMTP_TLS: "starttls" })).toMatchObject({ port: 587, tls: "starttls" });
  expect(smtpConfiguration({ ...configuration, SMTP_TLS: "tls" })).toMatchObject({ port: 465, tls: "tls" });
});
