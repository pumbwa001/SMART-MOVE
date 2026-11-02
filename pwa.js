const installButton = document.getElementById("install-app");
const installHelp = document.getElementById("install-help");
let installPrompt;

const isInstalled = window.matchMedia("(display-mode: standalone)").matches;
if (installButton && isInstalled) {
  installButton.hidden = true;
  installHelp.textContent = "Smart Move is installed on this device.";
}

if (navigator.serviceWorker && window.isSecureContext) {
  navigator.serviceWorker.register("./service-worker.js")
    .catch((error) => {
      console.error("Smart Move offline support could not be enabled.", error);
    });
}

window.addEventListener("beforeinstallprompt", (event) => {
  if (!installButton) return;
  event.preventDefault();
  installPrompt = event;
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  if (installButton) installButton.hidden = true;
  if (installHelp) installHelp.textContent = "Smart Move was installed successfully.";
});

if (installButton && !isInstalled) {
  installButton.addEventListener("click", async () => {
    if (!installPrompt) {
      installHelp.textContent = window.isSecureContext
        ? "Open your browser menu and choose Install app or Add to Home screen."
        : "To install on Android, open Smart Move from an HTTPS website in Chrome, then choose Install app.";
      return;
    }

    try {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      installHelp.textContent = choice.outcome === "accepted"
        ? "Smart Move is being installed."
        : "You can install Smart Move later from your browser menu.";
    } catch (error) {
      console.error("Smart Move could not start installation.", error);
      installHelp.textContent = "Installation could not start. Try Install app from your browser menu.";
    } finally {
      installPrompt = null;
    }
  });
}
