EVERNOTE DESKTOP (unofficial)
=============================

Evernote has no Linux app. This opens Evernote's website in its own window and keeps you logged in,
so you aren't asked for a verification code over and over.

Not affiliated with or endorsed by Evernote.

INSTALL (about a minute)
------------------------
1. Unzip this file (right-click > Extract Here).
2. Open the new folder. Right-click an empty spot in it and choose "Open in Terminal".
3. Type this and press Enter:

       sh install.sh

   If you're asked for your password, that's a one-time permission for the app's security sandbox.
4. Open your app menu and search for "Evernote". Log in once. Done.

UNINSTALL
---------
In the same folder:   sh uninstall.sh
(add --purge to also delete your saved login)

IF IT DOESN'T OPEN
------------------
Open a terminal and run:

    ~/.local/share/evernote-desktop-app/evernote-desktop

Whatever error it prints is what you'll want to share when asking for help.
Requires a 64-bit Intel/AMD computer (x86_64).
