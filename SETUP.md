# The Last Starfighter — Online Lobby Alpha 0.1

This release implements real-time **room creation, joining and readiness**, not shared combat yet. The existing v4.1 single-player/local hot-seat game is preserved in `game.html`.

## 1. Create your Firebase project

1. Go to https://console.firebase.google.com/ and click **Add project**.
2. Give it a name (for example `starfighter-online`). Google Analytics is optional.
3. In Project Overview, select **Add app → Web (`</>`)**. Register the web app. You do **not** need Firebase Hosting if using GitHub Pages.
4. Copy the **Firebase web app config** values into `firebase-config.js`, replacing the placeholders. The config is not a private key. Never commit a service account key.

## 2. Enable Firebase services

1. In **Build → Authentication → Sign-in method**, enable **Anonymous** authentication.
2. In **Build → Firestore Database**, create a database. Choose a region near your players (e.g. an available Singapore/Asia region).
3. In **Firestore Database → Rules**, paste the contents of `firestore.rules` and **Publish**. Do not leave broad test-mode rules in place.
4. In **Authentication → Settings → Authorized domains**, ensure your GitHub Pages domain (`YOUR-USERNAME.github.io`) is authorized if required by your auth configuration. Localhost can be added for development.

## 3. Deploy to GitHub Pages

1. Create a GitHub repository (for example `last-starfighter-online`).
2. Upload **all files** from this folder to the repository root, including `index.html`, `lobby.js`, `firebase-config.js`, `game.html`, and `firestore.rules`. Only `index.html`, `lobby.js`, `firebase-config.js`, and `game.html` are served to browsers; `firestore.rules` is intended for the Firebase console. Consider keeping rules and setup docs outside the published root in a later production deployment.
3. In repository **Settings → Pages**, choose **Deploy from a branch**, `main`, `/ (root)`.
4. Visit `https://YOUR-USERNAME.github.io/last-starfighter-online/` after deployment.
5. On one browser, choose **CREATE PRIVATE ROOM**, and copy the invitation link. Open it in another browser/private window or device and choose **JOIN AS KO-DAN** if not automatically joined. Both players can toggle **MARK READY** and see updates in real time.

## Limitations and security notes

- This is a **lobby prototype**. No shared movement, firing, or damage resolution yet; `game.html` remains local only.
- Room codes are invitation secrets, not strong authentication. A person with a code can look up a room and occupy the guest seat. Use for friendly testing only.
- Anonymous accounts are browser/device-specific. Clearing browser storage can lose the seat; the guest seat is not automatically released on disconnect.
- Firestore listeners track saved readiness, **not actual online presence**. The labels `CONNECTED` mean a player has joined, not necessarily that they are currently online.
- Firestore has quotas and potentially billable usage. Check Firebase pricing and set budget alerts before sharing widely.
- For full multiplayer, use a server-authoritative turn resolver (for example Cloud Functions or Cloud Run), private per-player orders, robust identity/reconnection, and authenticated security rules. Do not reveal both players' orders to clients before both commit.
- The game is based on copyrighted material. Public distribution may require permission.
