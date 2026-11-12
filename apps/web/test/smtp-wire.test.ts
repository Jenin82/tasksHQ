import { beforeEach, expect, it, vi } from "vitest";

const { connect, env } = vi.hoisted(() => ({
  connect: vi.fn(),
  env: {
    SMTP_HOST: "smtp.example.test",
    SMTP_TLS: "starttls",
    SMTP_USERNAME: "smtp-user",
    SMTP_PASSWORD: "smtp-password",
    SMTP_FROM: "sender@example.test",
  },
}));
vi.mock("cloudflare:workers", () => ({ env }));
vi.mock("cloudflare:sockets", () => ({ connect }));

const message = { to: "recipient@example.test", subject: "Test mail", text: "SMTP body" };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function peer(greeting: string, responses: string[], commands: string[]) {
  let readableController: ReadableStreamDefaultController<Uint8Array>;
  return {
    opened: Promise.resolve(),
    closed: Promise.resolve(),
    readable: new ReadableStream<Uint8Array>({
      start(controller) {
        readableController = controller;
        if (greeting) controller.enqueue(encoder.encode(greeting));
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(data) {
        commands.push(decoder.decode(data));
        const reply = responses.shift();
        if (!reply) throw new Error("Unexpected SMTP command");
        readableController.enqueue(encoder.encode(reply));
      },
    }),
    close: vi.fn(async () => {}),
    startTls: vi.fn(),
  };
}

beforeEach(() => {
  vi.resetModules();
  connect.mockReset();
  env.SMTP_TLS = "starttls";
});

it("authenticates with PLAIN only after the STARTTLS upgrade and the new EHLO", async () => {
  const insecureWrites: string[] = [];
  const secureWrites: string[] = [];
  const insecure = peer("220 service ready\r\n", ["250-localhost\r\n250 STARTTLS\r\n", "220 ready for TLS\r\n"], insecureWrites);
  const secure = peer("", [
    "250-localhost\r\n250 AUTH PLAIN\r\n", "235 authenticated\r\n", "250 ok\r\n",
    "251 forwarded\r\n", "354 send message\r\n", "250 queued\r\n",
  ], secureWrites);
  insecure.startTls.mockReturnValue(secure);
  connect.mockReturnValue(insecure);

  const { sendMail } = await import("@/lib/smtp");
  await sendMail(message);

  expect(connect).toHaveBeenCalledWith({ hostname: "smtp.example.test", port: 587 }, expect.objectContaining({ secureTransport: "starttls" }));
  expect(insecure.startTls).toHaveBeenCalledExactlyOnceWith();
  expect(insecureWrites).toEqual(["EHLO example.test\r\n", "STARTTLS\r\n"]);
  expect(secureWrites.slice(0, 5)).toEqual([
    "EHLO example.test\r\n", `AUTH PLAIN ${btoa("\0smtp-user\0smtp-password")}\r\n`,
    "MAIL FROM:<sender@example.test>\r\n", "RCPT TO:<recipient@example.test>\r\n", "DATA\r\n",
  ]);
  expect(secureWrites[5]).toContain(`\r\n\r\n${btoa(message.text)}\r\n.\r\n`);
  expect(secure.close).toHaveBeenCalledOnce();
});

it("uses implicit TLS and LOGIN when the peer only offers LOGIN", async () => {
  env.SMTP_TLS = "tls";
  const writes: string[] = [];
  const secure = peer("220 service ready\r\n", [
    "250 AUTH LOGIN\r\n", "334 username\r\n", "334 password\r\n", "235 authenticated\r\n",
    "250 ok\r\n", "250 ok\r\n", "354 send message\r\n", "250 queued\r\n",
  ], writes);
  connect.mockReturnValue(secure);

  const { sendMail } = await import("@/lib/smtp");
  await sendMail(message);

  expect(connect).toHaveBeenCalledWith({ hostname: "smtp.example.test", port: 465 }, expect.objectContaining({ secureTransport: "on" }));
  expect(secure.startTls).not.toHaveBeenCalled();
  expect(writes.slice(0, 4)).toEqual([
    "EHLO example.test\r\n", "AUTH LOGIN\r\n", `${btoa("smtp-user")}\r\n`, `${btoa("smtp-password")}\r\n`,
  ]);
});

it("closes a rejected STARTTLS connection without transmitting credentials", async () => {
  const writes: string[] = [];
  const insecure = peer("220 service ready\r\n", ["250 AUTH PLAIN\r\n", "454 TLS unavailable\r\n"], writes);
  connect.mockReturnValue(insecure);

  const { sendMail } = await import("@/lib/smtp");
  await expect(sendMail(message)).rejects.toThrow();

  expect(writes).toEqual(["EHLO example.test\r\n", "STARTTLS\r\n"]);
  expect(insecure.startTls).not.toHaveBeenCalled();
  expect(insecure.close).toHaveBeenCalledOnce();
});
