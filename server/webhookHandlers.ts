import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string, uuid: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature, uuid);

    const stripe = await getUncachableStripeClient();
    const event = JSON.parse(payload.toString());

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      
      if (session.payment_status === 'paid' && session.metadata?.invoiceId) {
        const invoiceId = parseInt(session.metadata.invoiceId);
        const invoice = await storage.getInvoice(invoiceId);
        
        if (invoice && invoice.status === 'Unpaid') {
          const expectedAmount = invoice.totalAmount * 100;
          if (session.amount_total === expectedAmount && session.metadata?.userId === invoice.userId) {
            await storage.updateInvoice(invoiceId, { status: 'Paid' });
            await storage.updateContract(invoice.contractId, { status: 'Active' });
            console.log(`Webhook: Invoice ${invoiceId} marked as paid`);
          }
        }
      }
    }
  }
}
