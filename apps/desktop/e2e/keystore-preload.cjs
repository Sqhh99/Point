/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
// Local Linux/xvfb only (POINT_E2E_KEYRING=1): let safeStorage use a gnome-keyring started by the
// caller instead of Playwright's basic/mock store, so key-save e2e can run on a dev box.
// Never used on CI (Windows: DPAPI, macOS: keychain already work there).
const { app } = require("electron");
app.commandLine.removeSwitch("use-mock-keychain");
app.commandLine.removeSwitch("password-store");
app.commandLine.appendSwitch("password-store", "gnome-libsecret");
