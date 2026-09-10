# Writing a domain doc that agents actually use

A domain doc is a **living map** of a fragile area: what is there, what must not break, how it works today, what is knowingly imperfect. It is not a changelog and not a design proposal.

## Where the content comes from

1. `git log --oneline -30 -- <dir>` — every "fix" commit is a candidate invariant. "fix: double booking when slot overlaps" → invariant: *a slot cannot be booked twice; overlap check lives in X*.
2. The tests in that directory — each `it("…")` is a stated expectation; copy the ones that encode business rules.
3. The types/schemas — enums and unions are the vocabulary; list them.
4. Ask the user one question per zone: "what breaks here?"

## Worked example (booking module of a sports app)

```
# booking — domain doc

## Code map
- src/features/booking/slots.ts — computes available slots from court hours + existing bookings
- src/features/booking/createBooking.ts — the only entry point that writes a booking
- src/features/booking/useBookingFlow.ts — UI state machine: pick court → pick slot → confirm → pay
- src/api/booking.ts — RTK Query endpoints; invalidates ["Booking", "Slot"] tags

## Do not break
- A slot is 30 min and aligned to :00/:30. Everything downstream assumes this.
- createBooking is idempotent by (userId, courtId, startsAt). Retrying must not double-book.
- Cancelling a paid booking never deletes it; it sets status=cancelled and triggers a refund job.

## Current facts
- Availability is computed client-side from server data; server re-validates on create.
- Time zones: server stores UTC, UI displays club-local; the club's tz comes from club.timezone.

## Known gaps / backlog
- Slot computation ignores maintenance windows (tracked in issue #142). Do not "fix" by hand-editing hours.
```

## What not to write

- History ("we migrated from X to Y in March") — belongs in git.
- Aspirations ("we should refactor this") unless labelled as a known gap.
- Generic advice ("write tests") — rules cover that.
- Anything you are guessing. Leave a `<!-- TODO: confirm with team -->` instead.
