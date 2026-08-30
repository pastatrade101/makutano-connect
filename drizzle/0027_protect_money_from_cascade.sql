-- Hard-deleting a booking, order or quotation must not destroy the money.
--
-- payment_requests cascaded from all three, so `delete from bookings ...` in a
-- console, a cleanup script or a test harness took the payment records with it
-- and said nothing. Nobody has hit it through the app — the app soft-deletes —
-- which is precisely the problem: it only fires where nobody is watching. It
-- came to light because a real customer's tap looked like it had been lost, and
-- the audit log was the only reason the truth was recoverable.
--
-- RESTRICT, not NO ACTION: both block the delete and both still allow a
-- whole-tenant removal (the tenant cascade clears payment_requests through its
-- own FK first — verified, not assumed). RESTRICT is the more explicit signal
-- and matches what the tenant's own system now does.
--
-- tenant_id stays CASCADE on purpose. Removing a tenant is a deliberate act
-- that is meant to take everything with it.
ALTER TABLE "payment_requests" DROP CONSTRAINT IF EXISTS "payment_requests_booking_id_bookings_id_fk";--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_booking_id_bookings_id_fk"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "payment_requests" DROP CONSTRAINT IF EXISTS "payment_requests_order_id_orders_id_fk";--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "payment_requests" DROP CONSTRAINT IF EXISTS "payment_requests_quotation_id_quotations_id_fk";--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_quotation_id_quotations_id_fk"
  FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT;
