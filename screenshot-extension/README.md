# Snap Folders (Chrome extension)

Take screenshots and organize them into folders.

## Install (developer mode)
1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this `screenshot-extension` folder
4. Pin the extension from the puzzle-piece menu

## Supabase login setup

### 1. Connect the project
In the Supabase dashboard go to **Project Settings → API** and copy the **Project URL** and the **anon / publishable key** into [config.js](config.js). Then click the reload icon on the extension in `chrome://extensions`.

### 2. Email + password
On by default (**Authentication → Sign In / Providers → Email**). If **Confirm email** is on, new users must click the link in their inbox before they can sign in. The link opens your Supabase **Site URL**, so the page may say it can't connect, but the account is still confirmed.

### 3. Google
1. Find your extension's redirect URL: it is `https://<extension-id>.chromiumapp.org/`, where the ID is shown on the extension's card in `chrome://extensions`.
2. In **Google Cloud Console → APIs & Services → Credentials**, create an **OAuth client ID** of type **Web application**. Under **Authorized redirect URIs** add `https://<your-project-ref>.supabase.co/auth/v1/callback`. You will need to fill in the OAuth consent screen first if you haven't.
3. In Supabase, open **Authentication → Sign In / Providers → Google**, turn it on and paste the Google **Client ID** and **Client Secret**.
4. In Supabase, open **Authentication → URL Configuration → Redirect URLs** and add `https://<extension-id>.chromiumapp.org/**`.

The ID of an unpacked extension stays the same as long as you load it from the same folder. If you move the folder or publish to the Web Store, the ID changes and step 4 must be updated.

## Use
- **Popup**: pick or create a folder, then **Visible area** or **Select area**
- **Shortcuts**: `Alt+Shift+S` (visible area), `Alt+Shift+A` (select area). Change them at `chrome://extensions/shortcuts`
- **Gallery** (popup → Open gallery): create, rename or delete folders; move, rename, download or delete screenshots
- **Download** saves to `Downloads/Snap Folders/<folder name>/`

Chrome doesn't allow capturing `chrome://` pages, the Web Store or other extension pages.

## Code layout
| File | Purpose |
| --- | --- |
| `storage.js` | Data layer for folders and screenshots (`chrome.storage.local`). Supabase will plug in here |
| `config.js` | Supabase project URL and anon key |
| `auth.js` | Supabase Auth over REST: email sign up/in, Google OAuth (PKCE via `chrome.identity`), token refresh, sign out |
| `background.js` | Captures and crops screenshots, handles keyboard shortcuts |
| `selector.js` | Area-selection overlay injected into the page |
| `popup.*` | Toolbar popup |
| `gallery.*` | Full-page folder and screenshot manager |
