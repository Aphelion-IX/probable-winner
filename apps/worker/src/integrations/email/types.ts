// Transactional email provider adapter (blueprint §3.3 "Resend and React
// Email"), same shape as the PricingProvider adapter pattern
// (apps/worker/src/integrations/pricing/types.ts) -- callers depend only on
// this interface, never on a specific provider's request/response format.

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export interface EmailProvider {
  sendEmail(message: EmailMessage): Promise<void>;
}
