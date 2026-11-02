# Smart Move payment setup

Smart Move checks access through Supabase. It does not process mobile-money payments: an administrator must confirm each MWK 1,000 payment independently before entering its transaction ID.

## 1. Create a Supabase project

Create a project at [supabase.com/dashboard](https://supabase.com/dashboard). Keep the database password private.

In **Project Settings → API**, copy the **Project URL** and the **publishable key** (or legacy `anon` key). Put them in `supabase-config.js`:

```js
window.SMART_MOVE_SUPABASE_URL = "https://your-project.supabase.co";
window.SMART_MOVE_SUPABASE_ANON_KEY = "your-publishable-or-anon-key";
```

Only use the publishable/anon key in this file. **Never put a `service_role` or secret key in this app.**

Enable the email/password sign-in provider in **Authentication → Sign In / Providers**. Email confirmation is recommended; configure the project's email delivery before creating accounts.

## 2. Create the database functions

In the Supabase SQL Editor, run `supabase-schema.sql` from the app folder, followed by [`supabase-question-bank.sql`](../Smart%20move%20private/supabase-question-bank.sql) from the separate `Smart move private` folder. The question import contains all 1,037 questions; keep that file outside the website's published folder. The app only returns question data to signed-in accounts with paid access.

The schema creates the transaction-ID registry, administrator list, one-time redemption, and attempt limits. Transaction IDs are trimmed and stored as keyed HMAC-SHA-256 hashes, not as readable IDs. The random HMAC key is stored privately in the database and is never sent to the browser. Matching is case-sensitive.

## 3. Create and authorize the admin account

1. Host the app over HTTPS and add its URL to **Authentication → URL Configuration → Redirect URLs** in Supabase.
2. Open the hosted app, choose **CREATE CLIENT ACCOUNT**, and sign up with `pumbwagrant@gmail.com`. Choose a new, strong password directly in the sign-up form; credentials are not stored in the app's source files.
3. Verify the email if requested, then sign in once.
4. As the Supabase project owner, run this one-time SQL in the Supabase SQL Editor to grant admin status to that account:

```sql
insert into public.smart_move_admins (user_id)
select id
from auth.users
where lower(email) = lower('pumbwagrant@gmail.com')
on conflict (user_id) do nothing;
```

5. Sign in at `admin.html` with that account. Admin status can only be granted by the project owner in the database; creating a client account cannot grant itself admin rights.

## 4. Verify payments and unlock clients

1. The admin signs in while online and checks the MWK 1,000 payment in the mobile-money account outside this app.
2. In `admin.html`, the admin adds the transaction ID only after confirming the payment. The app does not verify payment with a mobile-money provider.
3. The client creates an account with their email and a separate password, verifies the email if requested, signs in, and submits the same transaction ID on the home page once. The transaction ID is a one-time activation code, not the account password.
4. Each transaction ID can be redeemed by only one account. Each account receives access after its first successful redemption.

After the administrator has signed in online and the browser has verified the admin account, `admin.html` can be reopened offline on that same device. New IDs are saved as **pending drafts on that device only**; they are not added to Supabase, do not unlock clients, and remain pending until the admin reconnects and syncs. Online, the server rechecks the admin role before accepting each ID. Offline drafts are stored in that browser's local storage, so use a trusted, device-locked admin device.

After a client successfully redeems an ID online, Smart Move saves the paid-access state and downloads the Biology, Chemistry, and Physics question sets into that browser's IndexedDB. Keep the app open and online until the home page confirms that all questions are saved. The client can then reopen the installed app and play those cached questions offline on that device. First-time account sign-in, email verification, and payment redemption still require internet. Offline access is a convenience for the paid device, not tamper-proof DRM: a person with access to the browser/device may inspect or copy cached content, and locally saved access cannot be remotely revoked until the app reconnects.

## 5. Host and install

Host the complete folder as a static site over HTTPS. Do not open the files directly with `file://`; secure sign-in and the offline service worker require a web server. On Android, open the HTTPS site in Chrome and choose **Install app** or **Add to Home screen**. On a laptop, open the site in a supported browser or install it from the browser menu.

First-time sign-in, payment redemption, and administrator operations need an internet connection. After a successful online access check and question download, the paid account can play its cached questions offline on that same browser/device. Install the app and open it online after payment until the home screen confirms the question sets are saved. Offline access may remain available on that device until it reconnects and can check the account again.

## Security notes

- The database enforces administrator-only ID entry, account-bound one-time redemption, and a five-attempt limit per account per 15 minutes.
- The app checks access on the server before downloading question sets. Supabase Row Level Security is enabled, and database tables are accessed through restricted functions.
- Question data is stored in Supabase and returned by a restricted function only after the server confirms paid access. It is then cached locally for offline play; cached content and offline access can be inspected or copied by someone with access to the device.
- Use a unique administrator password, enable multi-factor authentication for administrator accounts where available, and do not share administrator credentials or Supabase secret keys.
