import { env } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

type SmtpEnvironment = Partial<Record<
  "SMTP_HOST" | "SMTP_PORT" | "SMTP_TLS" | "SMTP_USERNAME" | "SMTP_PASSWORD" | "SMTP_FROM", string
>>;

const mailbox = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z0-9-]+$/i;

export function smtpConfiguration(env: SmtpEnvironment) {
  const value = (key: keyof SmtpEnvironment) => typeof env[key] === "string" ? env[key] : undefined;
  const host = value("SMTP_HOST")?.trim();
  const tls = value("SMTP_TLS")?.trim();
  const port = Number(value("SMTP_PORT")?.trim() || (tls === "tls" ? 465 : 587));
  const username = value("SMTP_USERNAME")?.trim();
  const password = value("SMTP_PASSWORD");
  const from = value("SMTP_FROM")?.trim();
  if (!host || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host)
      || (tls !== "tls" && tls !== "starttls")
      || !Number.isInteger(port) || port < 1 || port > 65535 || port === 25
      || !username || !password?.trim() || username.includes("\0") || password.includes("\0")
      || !from || !mailbox.test(from)) {
    return null;
  }
  return { host, port, tls, username, password, from };
}

const smtpEnv = env as Env & SmtpEnvironment;
const smtp = smtpConfiguration(smtpEnv);
export const emailEnabled = smtp !== null;

export type MailMessage = { to: string; subject: string; text: string; messageId?: string };

function smtpSession(socket: ReturnType<typeof connect>) {
  void socket.closed.catch(() => undefined);
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffered = "";

  async function reply(expected: number[]) {
    const lines: string[] = [];
    for (;;) {
      const newline = buffered.indexOf("\r\n");
      if (newline < 0) {
        const { done, value } = await reader.read();
        if (done) throw new Error("SMTP closed before replying.");
        buffered += decoder.decode(value, { stream: true });
        if (buffered.length > 16_384) throw new Error("SMTP reply exceeded the limit.");
        continue;
      }
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 2);
      const match = /^(\d{3})([ -]|$)(.*)$/.exec(line);
      if (!match || !expected.includes(Number(match[1])) || lines.length >= 100) {
        throw new Error("SMTP returned an unexpected reply.");
      }
      lines.push(match[3]);
      if (match[2] !== "-") return lines;
    }
  }

  return {
    reply,
    async command(command: string, ...codes: number[]) {
      await writer.write(encoder.encode(command + "\r\n"));
      return reply(codes);
    },
    release() {
      reader.releaseLock();
      writer.releaseLock();
    },
  };
}

function base64(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

function mimeMessage(from: string, message: MailMessage) {
  const domain = from.slice(from.indexOf("@") + 1);
  const id = createHash("sha256").update(message.messageId ?? crypto.randomUUID()).digest("hex");
  const body = base64(message.text).match(/.{1,76}/g)?.join("\r\n") ?? "";
  return [
    `From: TasksHQ <${from}>`,
    `To: <${message.to}>`,
    `Subject: =?UTF-8?B?${base64(message.subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${id}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
    ".",
  ].join("\r\n");
}

export async function sendMail(message: MailMessage) {
  if (!smtp) throw new Error("SMTP is disabled.");
  if (!mailbox.test(message.to)) throw new Error("Invalid SMTP recipient.");
  const config = smtp;
  const ehlo = `EHLO ${config.from.slice(config.from.indexOf("@") + 1)}`;
  let socket = connect({ hostname: config.host, port: config.port }, {
    secureTransport: config.tls === "tls" ? "on" : "starttls",
    allowHalfOpen: false,
  });
  let session = smtpSession(socket);

  async function submit() {
    await socket.opened;
    await session.reply([220]);
    let capabilities = await session.command(ehlo, 250);
    if (config.tls === "starttls") {
      await session.command("STARTTLS", 220);
      session.release();
      // The runtime verifies the hostname passed to connect().
      socket = socket.startTls();
      session = smtpSession(socket);
      await socket.opened;
      capabilities = await session.command(ehlo, 250);
    }

    const methods = capabilities
      .filter((line) => /^AUTH[ =]/i.test(line))
      .flatMap((line) => line.slice(5).toUpperCase().split(/\s+/));
    if (methods.includes("PLAIN")) {
      await session.command(`AUTH PLAIN ${base64(`\0${config.username}\0${config.password}`)}`, 235);
    } else if (methods.includes("LOGIN")) {
      await session.command("AUTH LOGIN", 334);
      await session.command(base64(config.username), 334);
      await session.command(base64(config.password), 235);
    } else {
      throw new Error("SMTP server must advertise AUTH PLAIN or LOGIN after TLS.");
    }

    await session.command(`MAIL FROM:<${config.from}>`, 250);
    await session.command(`RCPT TO:<${message.to}>`, 250, 251);
    await session.command("DATA", 354);
    await session.command(mimeMessage(config.from, message), 250);
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      submit(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("SMTP submission timed out.")), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    session.release();
    await socket.close().catch(() => undefined);
  }
}
