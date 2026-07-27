import type { EmailMessage, EmailProvider } from "./types.js";

const RESEND_API_URL = "https://api.resend.com/emails";

export class ResendEmailError extends Error {}

// Thin fetch-based client -- same convention as the other provider
// integrations in this directory (scryfall/mtgjson/exchange-rates): no SDK
// dependency, just the provider's documented REST API.
export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
  ) {}

  async sendEmail(message: EmailMessage): Promise<void> {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ResendEmailError(`Resend send failed with HTTP ${response.status}: ${body}`);
    }
  }
}

export function createEmailProviderFromEnv(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !fromAddress) {
    throw new Error(
      "RESEND_API_KEY and RESEND_FROM_EMAIL are required to send alert notification emails",
    );
  }

  return new ResendEmailProvider(apiKey, fromAddress);
}
