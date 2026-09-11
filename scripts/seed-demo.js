#!/usr/bin/env node
'use strict';
// Creates ./demo-app — a small but real-looking Next.js + Prisma + Stripe repo with several areas and a
// "fixy" git history — so `fenceline init --depth standard` fans out per area and the README demo is reproducible.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(process.argv[2] || 'demo-app');
fs.rmSync(root, { recursive: true, force: true });
const w = (rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };
const env = { ...process.env, GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_EMAIL: 'dev@example.com' };
const git = (c, author = 'Dev') => execSync(`git ${c}`, { cwd: root, stdio: 'pipe', env: { ...env, GIT_AUTHOR_NAME: author, GIT_COMMITTER_NAME: author } });
const commit = (msg, author) => { git('add -A'); git(`commit -qm "${msg}"`, author); };

w('package.json', JSON.stringify({
  name: 'bookings-web', private: true,
  scripts: { dev: 'next dev', build: 'next build', lint: 'eslint .', 'type-check': 'tsc --noEmit', test: 'vitest run' },
  dependencies: { next: '15', react: '19', 'react-dom': '19', '@tanstack/react-query': '5', '@prisma/client': '6', stripe: '17', 'next-auth': '5', zod: '3' },
  devDependencies: { typescript: '5', eslint: '9', vitest: '3', prisma: '6', '@types/react': '19' },
}, null, 2) + '\n');
w('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'preserve', baseUrl: '.', paths: { '@/*': ['src/*'] }, noEmit: true }, include: ['src', 'tests'] }, null, 2) + '\n');
w('eslint.config.js', "export default [{ rules: { 'no-console': 'error' } }];\n");
w('.env.example', 'DATABASE_URL=\nSTRIPE_SECRET_KEY=\nSTRIPE_WEBHOOK_SECRET=\nNEXTAUTH_SECRET=\n');
w('.gitignore', 'node_modules/\n.next/\n.env\n');
w('README.md', '# bookings-web\n\nCourt booking for a padel club: players pick a court and a 30-minute slot, pay with Stripe, get a confirmation.\n');
w('.github/workflows/ci.yml', 'name: ci\non: [pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci && npm run lint && npm run type-check && npm test\n');
w('prisma/schema.prisma', `datasource db { provider = "postgresql"  url = env("DATABASE_URL") }
generator client { provider = "prisma-client-js" }

model Club    { id Int @id @default(autoincrement())  name String  timezone String  courts Court[] }
model Court   { id Int @id @default(autoincrement())  clubId Int  club Club @relation(fields: [clubId], references: [id])  name String  bookings Booking[] }
model Booking { id Int @id @default(autoincrement())  courtId Int  court Court @relation(fields: [courtId], references: [id])  userId String  startsAt DateTime  endsAt DateTime  status String  paymentId String?
  @@unique([courtId, startsAt]) }
`);
w('prisma/migrations/20260101000000_init/migration.sql', '-- CreateTable Club, Court, Booking\n');
w('prisma/migrations/20260301000000_booking_unique/migration.sql', 'CREATE UNIQUE INDEX "Booking_courtId_startsAt_key" ON "Booking"("courtId", "startsAt");\n');

// lib
w('src/lib/prisma.ts', "import { PrismaClient } from '@prisma/client';\nconst g = globalThis as unknown as { prisma?: PrismaClient };\nexport const prisma = g.prisma ?? new PrismaClient();\nif (process.env.NODE_ENV !== 'production') g.prisma = prisma;\n");
w('src/lib/time.ts', "export const SLOT_MINUTES = 30;\nexport const slotStart = (d: Date): Date => { const m = d.getMinutes(); const r = new Date(d); r.setMinutes(m - (m % SLOT_MINUTES), 0, 0); return r; };\nexport const addMinutes = (d: Date, n: number): Date => new Date(d.getTime() + n * 60_000);\nexport const inClubTz = (d: Date, tz: string): string => d.toLocaleString('en-GB', { timeZone: tz });\n");
w('src/lib/env.ts', "import { z } from 'zod';\nconst schema = z.object({ DATABASE_URL: z.string().url(), STRIPE_SECRET_KEY: z.string().min(1), STRIPE_WEBHOOK_SECRET: z.string().min(1), NEXTAUTH_SECRET: z.string().min(16) });\nexport const env = schema.parse(process.env);\n");
w('src/lib/errors.ts', "export class DomainError extends Error { constructor(public code: string, message: string) { super(message); } }\nexport const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;\n");
w('src/lib/log.ts', "export const log = (event: string, data: Record<string, unknown> = {}): void => { process.stdout.write(JSON.stringify({ event, ...data, ts: Date.now() }) + '\\n'); };\n");

// bookings feature
w('src/features/bookings/slots.ts', "import { SLOT_MINUTES, slotStart, addMinutes } from '@/lib/time';\nexport type Slot = { courtId: number; startsAt: Date; endsAt: Date };\nexport type Booked = { startsAt: Date; endsAt: Date };\n// Slots are 30 minutes, aligned to :00/:30, club-local. A slot is free when no booking overlaps it.\nexport const availableSlots = (courtId: number, open: Date, close: Date, booked: Booked[]): Slot[] => {\n  const out: Slot[] = [];\n  for (let t = slotStart(open); addMinutes(t, SLOT_MINUTES) <= close; t = addMinutes(t, SLOT_MINUTES)) {\n    const end = addMinutes(t, SLOT_MINUTES);\n    const clash = booked.some((b) => b.startsAt < end && b.endsAt > t);\n    if (!clash) out.push({ courtId, startsAt: t, endsAt: end });\n  }\n  return out;\n};\n");
w('src/features/bookings/createBooking.ts', "import { prisma } from '@/lib/prisma';\nimport { DomainError } from '@/lib/errors';\nimport { log } from '@/lib/log';\nexport type CreateBookingInput = { courtId: number; userId: string; startsAt: Date; endsAt: Date };\n// The only entry point that writes a Booking. Idempotent per (courtId, startsAt): the unique index makes retries safe.\nexport const createBooking = async (input: CreateBookingInput) => {\n  const existing = await prisma.booking.findUnique({ where: { courtId_startsAt: { courtId: input.courtId, startsAt: input.startsAt } } });\n  if (existing) { if (existing.userId === input.userId) return existing; throw new DomainError('SLOT_TAKEN', 'slot already booked'); }\n  const b = await prisma.booking.create({ data: { ...input, status: 'pending' } });\n  log('booking.created', { id: b.id });\n  return b;\n};\n");
w('src/features/bookings/cancelBooking.ts', "import { prisma } from '@/lib/prisma';\nimport { refund } from '@/features/payments/refund';\n// Cancelling never deletes: status → cancelled, then a refund is requested if the booking was paid.\nexport const cancelBooking = async (id: number) => {\n  const b = await prisma.booking.update({ where: { id }, data: { status: 'cancelled' } });\n  if (b.paymentId) await refund(b.paymentId);\n  return b;\n};\n");
w('src/features/bookings/useBookingFlow.ts', "import { useState } from 'react';\nexport type Step = 'court' | 'slot' | 'confirm' | 'pay' | 'done';\nexport const useBookingFlow = () => { const [step, setStep] = useState<Step>('court'); const next = () => setStep((s) => (s === 'court' ? 'slot' : s === 'slot' ? 'confirm' : s === 'confirm' ? 'pay' : 'done')); return { step, next, reset: () => setStep('court') }; };\n");
w('src/features/bookings/api.ts', "import { useQuery, useMutation } from '@tanstack/react-query';\nimport type { Slot } from './slots';\nexport const useSlots = (courtId: number, day: string) => useQuery<Slot[]>({ queryKey: ['slots', courtId, day], queryFn: () => fetch(`/api/slots?court=${courtId}&day=${day}`).then((r) => r.json()) });\nexport const useCreateBooking = () => useMutation({ mutationFn: (body: unknown) => fetch('/api/bookings', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json()) });\n");

// payments feature
w('src/features/payments/stripe.ts', "import Stripe from 'stripe';\nimport { env } from '@/lib/env';\nexport const stripe = new Stripe(env.STRIPE_SECRET_KEY);\n");
w('src/features/payments/charge.ts', "import { stripe } from './stripe';\nimport { prisma } from '@/lib/prisma';\n// Amount is in minor units (cents). Idempotency key = booking id so a retried request never double-charges.\nexport const chargeBooking = async (bookingId: number, amountMinor: number) => {\n  const intent = await stripe.paymentIntents.create({ amount: amountMinor, currency: 'eur', metadata: { bookingId: String(bookingId) } }, { idempotencyKey: `booking-${bookingId}` });\n  await prisma.booking.update({ where: { id: bookingId }, data: { paymentId: intent.id, status: 'paid' } });\n  return intent;\n};\n");
w('src/features/payments/refund.ts', "import { stripe } from './stripe';\nexport const refund = async (paymentId: string) => stripe.refunds.create({ payment_intent: paymentId });\n");
w('src/features/payments/webhook.ts', "import { stripe } from './stripe';\nimport { env } from '@/lib/env';\nimport { prisma } from '@/lib/prisma';\n// Webhooks are verified with STRIPE_WEBHOOK_SECRET; an unverifiable event is rejected, never processed.\nexport const handleWebhook = async (raw: string, sig: string) => {\n  const event = stripe.webhooks.constructEvent(raw, sig, env.STRIPE_WEBHOOK_SECRET);\n  if (event.type === 'payment_intent.payment_failed') { const id = (event.data.object as { metadata: { bookingId: string } }).metadata.bookingId; await prisma.booking.update({ where: { id: Number(id) }, data: { status: 'payment_failed' } }); }\n  return event.type;\n};\n");
w('src/features/payments/pricing.ts', "export const PRICE_PER_SLOT_MINOR = 1500;\nexport const priceFor = (slots: number, memberDiscount = 0): number => Math.round(slots * PRICE_PER_SLOT_MINOR * (1 - memberDiscount));\n");

// app + components
w('src/app/layout.tsx', "import type { ReactNode } from 'react';\nexport default function RootLayout({ children }: { children: ReactNode }) { return <html lang=\"en\"><body>{children}</body></html>; }\n");
w('src/app/page.tsx', "import { Header } from '@/components/Header/Header';\nimport { CourtList } from '@/components/CourtList/CourtList';\nexport default function Home() { return <main><Header /><CourtList /></main>; }\n");
w('src/app/api/slots/route.ts', "import { availableSlots } from '@/features/bookings/slots';\nimport { prisma } from '@/lib/prisma';\nexport async function GET(req: Request) { const u = new URL(req.url); const courtId = Number(u.searchParams.get('court')); const day = new Date(u.searchParams.get('day') ?? ''); const booked = await prisma.booking.findMany({ where: { courtId, status: { not: 'cancelled' } } }); const open = new Date(day); open.setHours(8, 0, 0, 0); const close = new Date(day); close.setHours(22, 0, 0, 0); return Response.json(availableSlots(courtId, open, close, booked)); }\n");
w('src/app/api/bookings/route.ts', "import { createBooking } from '@/features/bookings/createBooking';\nimport { isDomainError } from '@/lib/errors';\nexport async function POST(req: Request) { try { const b = await createBooking(await req.json()); return Response.json(b, { status: 201 }); } catch (e) { if (isDomainError(e)) return Response.json({ code: e.code }, { status: 409 }); throw e; } }\n");
w('src/app/api/stripe/webhook/route.ts', "import { handleWebhook } from '@/features/payments/webhook';\nexport async function POST(req: Request) { const t = await handleWebhook(await req.text(), req.headers.get('stripe-signature') ?? ''); return Response.json({ received: t }); }\n");
w('src/components/Header/Header.tsx', "export const Header = () => <header className=\"px-4 py-2 font-bold\">bookings-web</header>;\n");
w('src/components/CourtList/CourtList.tsx', "export const CourtList = () => <ul>{/* courts are rendered from useCourts() */}</ul>;\n");
w('src/components/SlotGrid/SlotGrid.tsx', "import type { Slot } from '@/features/bookings/slots';\nexport const SlotGrid = ({ slots, onPick }: { slots: Slot[]; onPick: (s: Slot) => void }) => <div className=\"grid grid-cols-4 gap-2\">{slots.map((s) => <button key={s.startsAt.toISOString()} onClick={() => onPick(s)}>{s.startsAt.toISOString().slice(11, 16)}</button>)}</div>;\n");
w('src/components/PayButton/PayButton.tsx', "export const PayButton = ({ amountMinor, onPay }: { amountMinor: number; onPay: () => void }) => <button onClick={onPay}>Pay €{(amountMinor / 100).toFixed(2)}</button>;\n");

// tests
w('tests/slots.test.ts', "import { describe, it, expect } from 'vitest';\nimport { availableSlots } from '@/features/bookings/slots';\ndescribe('availableSlots', () => {\n  const d = (h: number, m = 0) => new Date(2026, 0, 1, h, m);\n  it('excludes a slot that overlaps a booking', () => { const s = availableSlots(1, d(8), d(10), [{ startsAt: d(8, 30), endsAt: d(9) }]); expect(s.map((x) => x.startsAt.getMinutes() + x.startsAt.getHours() * 60)).toEqual([480, 540, 570]); });\n  it('treats back-to-back bookings as non-overlapping', () => { const s = availableSlots(1, d(8), d(9), [{ startsAt: d(8, 30), endsAt: d(9) }]); expect(s).toHaveLength(1); });\n  it('aligns an odd opening time down to :00/:30', () => { const s = availableSlots(1, d(8, 10), d(9), []); expect(s[0].startsAt.getMinutes()).toBe(0); });\n});\n");
w('tests/pricing.test.ts', "import { it, expect } from 'vitest';\nimport { priceFor } from '@/features/payments/pricing';\nit('applies the member discount and rounds to minor units', () => { expect(priceFor(3, 0.1)).toBe(4050); });\n");

git('init -q -b main');
commit('feat: initial court booking app (Next.js 15, Prisma, Stripe)', 'Anna');
// history with real fixes in bookings and payments, and a churny lib/time
const bump = (rel, line) => fs.appendFileSync(path.join(root, rel), line + '\n');
const fixes = [
  ['src/features/bookings/slots.ts', 'fix: overlapping slot when booking ends exactly at slot start', 'Dev'],
  ['src/features/bookings/slots.ts', 'fix: align opening time down, not up', 'Anna'],
  ['src/features/bookings/createBooking.ts', 'fix: retry after timeout created a second booking', 'Dev'],
  ['src/features/bookings/createBooking.ts', 'fix: SLOT_TAKEN when a different user already booked', 'Dev'],
  ['src/features/bookings/cancelBooking.ts', 'fix: cancel deleted the row; keep it and mark cancelled', 'Maria'],
  ['src/features/bookings/cancelBooking.ts', 'fix: refund only if paymentId is set', 'Dev'],
  ['src/features/bookings/slots.ts', 'fix: close time inclusive bug', 'Maria'],
  ['src/features/bookings/api.ts', 'feat: slots query keyed by day', 'Anna'],
  ['src/features/payments/charge.ts', 'fix: double charge on retried checkout — idempotency key', 'Dev'],
  ['src/features/payments/webhook.ts', 'fix: reject webhooks with an invalid signature', 'Maria'],
  ['src/features/payments/pricing.ts', 'fix: rounding of member discount', 'Dev'],
  ['src/lib/time.ts', 'fix: slotStart drops seconds', 'Anna'],
  ['src/lib/time.ts', 'fix: club timezone formatting', 'Dev'],
  ['src/lib/time.ts', 'chore: export addMinutes', 'Dev'],
  ['src/features/bookings/slots.ts', 'fix: booked list may contain cancelled bookings — filter in route', 'Anna'],
  ['src/app/api/slots/route.ts', 'fix: exclude cancelled bookings from availability', 'Anna'],
  ['src/features/bookings/slots.ts', 'fix: DST day produces a 23h grid', 'Maria'],
  ['src/features/payments/charge.ts', 'fix: status paid set before intent confirmed', 'Maria'],
];
fixes.forEach(([rel, msg, author], i) => { bump(rel, `// r${i + 1}`); commit(msg, author); });
console.log(`demo repo ready at ${root} (${fixes.length + 1} commits)`);
