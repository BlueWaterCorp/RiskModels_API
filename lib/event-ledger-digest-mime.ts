/**
 * RFC 5322 message for the Event Ledger edition: multipart/mixed holding a
 * multipart/alternative (plain text, then HTML) and the JSON Lines attachment.
 *
 * Why a hand-built message: `gws gmail +send --html` sends an HTML part only,
 * with no plain-text alternative. The edition needs both, so the script builds
 * the message here and sends it with `gws gmail users messages send --upload`,
 * which passes it to the Gmail API unchanged (links are not rewritten).
 */

import { randomBytes } from "node:crypto";

export interface MimeInput {
  from?: string | null;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachment: { filename: string; contentType: string; body: string };
  date?: Date;
}

/** RFC 2047 encoded-word for any header value that is not plain ASCII. */
export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function b64Lines(body: string): string {
  return (Buffer.from(body, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

export function buildMimeMessage(m: MimeInput): string {
  const mixed = `mixed_${randomBytes(12).toString("hex")}`;
  const alt = `alt_${randomBytes(12).toString("hex")}`;
  const headers = [
    ...(m.from ? [`From: ${m.from}`] : []),
    `To: ${m.to}`,
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${(m.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ];
  const lines = [
    ...headers,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(m.text),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(m.html),
    `--${alt}--`,
    `--${mixed}`,
    `Content-Type: ${m.attachment.contentType}; charset="UTF-8"; name="${m.attachment.filename}"`,
    `Content-Disposition: attachment; filename="${m.attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(m.attachment.body),
    `--${mixed}--`,
    "",
  ];
  return lines.join("\r\n");
}
