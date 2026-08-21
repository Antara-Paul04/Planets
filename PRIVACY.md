# Astray — Privacy Policy

**Effective date:** [EFFECTIVE DATE]
**Operated by:** [LEGAL ENTITY / OPERATOR NAME]
**Contact:** [CONTACT EMAIL]

Astray is a small, anonymous universe where people draw planets and leave them
for others to discover. This policy explains, in plain language, exactly what
happens to data when you use it. We try to collect as little as possible.

## The short version

- No accounts, no logins, no passwords, no profiles, no usernames.
- No advertising, no analytics, no behavioral tracking, no cookies.
- We never sell personal information.
- The planets you make (name + artwork) are **public** — that's the whole point.
- When you create or report a planet, the server briefly sees your IP address
  and turns it into a one-way coded identifier. We do **not** store your raw IP
  in the app's database. That coded identifier is still, technically,
  data derived from you — so we don't call Astray "completely anonymous."

## No accounts, no tracking

There is nothing to sign up for. Astray has no user accounts, no passwords, no
profiles, and no usernames tied to real people. It sets **no cookies** and runs
**no analytics or advertising trackers**. Your planets are not linked to your
real-world identity.

## What you create (planet content)

When you make a planet, this is stored in our database so the universe can show
it to everyone:

- the **name** you gave it (and a normalized version used to keep names unique
  and to power search)
- your **artwork** (stored as a file — see below)
- its **birth date** (the moment it was created; this is permanent and never
  changed)
- the **star and orbit** the universe assigned it, plus rendering settings you
  chose (surface style, moons or rings, "vibe", size, tilt, spin)
- a **moderation status** (visible or hidden)
- a random **client reference** (a UUID your browser generates) used only so a
  retried request doesn't create a duplicate planet

We separate this into two kinds of information:

1. **Things you intentionally contribute** to the shared universe: the name, the
   artwork, and the look of your planet.
2. **Technical information needed to run and protect the service**: the client
   reference, the assigned star/orbit, timestamps, and moderation status.

A planet is **not** connected to your name, email, or any account, because none
of those exist.

## Artwork

You draw your planet's surface yourself. Before upload, your browser
**compresses** the image (to WebP) to keep it small. The server checks that the
file is a real image of an allowed type (PNG, JPEG, or WebP) and within a small
size limit before saving it.

Artwork is stored in a **public** storage bucket. That means anyone who has the
link can view the image — which is how planets appear for everyone in the
universe. Artwork is **not** end-to-end encrypted and **not** private. Please
only draw things you're comfortable making public.

## IP addresses and coded identifiers

Like every website, our server can see the IP address of an incoming request.
Here's how we handle it:

- We do **not** store your raw IP address in the app's database.
- Instead, the server runs your IP through a **one-way keyed hash (HMAC)** using
  a secret key that lives only on the server. This produces a short coded
  identifier. The original IP cannot be read back out of it by anyone who only
  has the database.
- We keep **only** that coded identifier, and use it for two narrow purposes:
  - **reporting** — so the same network can't report the same planet twice, and
    so we can tell when several *different* sources have reported a planet;
  - **the one-planet limit** — so a single network can create only one planet.
    (For these two purposes we generate two *separate* coded identifiers, so the
    "creator" identifier and the "reporter" identifier can't be matched to each
    other.)
- We do **not** use these identifiers for advertising, analytics, profiling, or
  anything unrelated.

**One planet per *network*, not per person or device.** The limit is tied to
your public IP address — the network you connect through — not to you personally
and not to a specific device. So it is not a perfect one-per-person rule:
someone on a different network (or using a VPN) can create another planet, and,
conversely, people who share one internet connection (a home, an office, a
school) share a single planet slot between them. We chose this on purpose — it
discourages casual duplicates without any accounts, logins, or device
fingerprinting, which we don't do.

**An honest note:** a coded identifier derived from your IP is *pseudonymous*,
not anonymous. Under some privacy laws (such as the GDPR) it may still count as
personal data. This is not "encryption," and it is not "end-to-end encrypted" —
it's a one-way fingerprint used only to enforce simple fairness rules.

## Reporting and moderation

Anyone can report a planet they think doesn't belong. Moderation is entirely
community-driven — there is no automated or AI scanning of your artwork or
names.

The rule is simple and based on the coded identifiers above:

- one report per network per planet (reporting the same planet again does
  nothing);
- when **three different networks** report the same planet, it is **hidden**
  from the public universe.

Hidden planets are not deleted — they're just no longer shown. Reports are
private: a planet's creator is **never** told who reported it, and reports do
not reveal any reporter's identity.

## What your browser stores (localStorage)

Astray keeps a few small things in your own browser's local storage. These stay
on your device and are **not** sent to us as tracking:

- **your sound preference** (whether audio is on, and the volume);
- **an "intro seen" flag**, so the opening animation only plays once;
- **your own planet** — its name, birth date, position, orbit, and a small copy
  of your artwork — so "find my planet" still works after you refresh, and so
  the site can gently keep you to one planet per browser.

You can clear all of this at any time using your browser's "clear site data"
controls.

## Services we rely on

Astray is a small project built on a few external services:

- **Vercel** hosts the website and runs the small server functions. As the host,
  Vercel processes incoming requests (including IP addresses) as part of
  operating and protecting the service. See Vercel's privacy policy:
  https://vercel.com/legal/privacy-policy
- **Supabase** provides the database (planet records) and the storage for
  artwork files. See Supabase's privacy policy: https://supabase.com/privacy
- **Google Fonts** serves the site's typefaces. Because your browser loads the
  fonts directly from Google, Google receives your IP address and basic request
  information when the fonts load. See Google's privacy policy:
  https://policies.google.com/privacy

We describe their roles here based on how our code uses them; we don't control
and can't guarantee their internal practices.

## Logs

Our server functions write minimal operational log lines — for example, that a
planet was created, or that a report caused a planet to be hidden. These log
lines **do not include** your IP address, your coded identifier, your planet's
name, or your artwork. Separately, Vercel (as the host) keeps its own
infrastructure request logs under its own policies.

## Data retention

Being transparent: the code does **not** currently set automatic deletion or a
fixed retention period for anything.

- **Planet content** (name, artwork, birth date) is intended to be permanent —
  a planet is meant to stay in the universe.
- **Moderation/report records** and the **creator coded identifier** persist for
  as long as the associated planet exists.
- **Server logs** are kept according to Vercel's retention, not ours.

If you'd prefer defined limits (for example, purging report records or creator
identifiers after a certain period, or removing artwork for hidden planets),
that's a policy decision worth making explicitly — see the checklist the project
maintainer keeps alongside this file.

## Your privacy choices and rights

Depending on where you live, you may have rights to access, correct, delete, or
object to the processing of personal data, and to withdraw consent where
processing relies on it. Because Astray has no accounts, some of these work a
little differently:

- **Deletion / takedown:** if you want a specific planet removed, tell us its
  **name** so we can find it.
- **Access / correction / objection:** contact us and we'll do our best to help,
  keeping in mind that we hold very little that could identify you.

To make any request, contact **[CONTACT EMAIL]**.

## Children

Astray is a general-audience creative toy with no accounts and no knowingly
collected personal information. It is not directed at children, and we do not
knowingly collect personal data from children. If you are below the age of
digital consent in your country, please use Astray with a parent or guardian.

## Security

We take reasonable, sensible measures:

- raw IP addresses are **not intentionally stored** in the app's planet
  database;
- IP-derived identifiers are generated with a **secret server-side key**;
- database and storage access happens **only** through server-side code — the
  privileged keys are never exposed to your browser;
- uploaded artwork is **validated** (type and size) before it is stored.

No online service can promise perfect security, and we don't. We do our best to
protect the little data Astray holds.

## Changes to this policy

Astray is an evolving project, so this policy may change. If we make a material
change, we'll update the effective date above and note it on the site.

## Contact

Questions or requests about privacy? Email **[CONTACT EMAIL]**.
