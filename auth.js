const authPanel = document.getElementById("auth-panel");
const paymentPanel = document.getElementById("payment-panel");
const appPanel = document.getElementById("app-panel");
const configMessage = document.getElementById("config-message");
const authForm = document.getElementById("auth-form");
const authTitle = document.getElementById("auth-title");
const authSubmit = document.getElementById("auth-submit");
const toggleAuthButton = document.getElementById("toggle-auth");
const authMessage = document.getElementById("auth-message");
const paymentForm = document.getElementById("payment-form");
const paymentMessage = document.getElementById("payment-message");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const transactionInput = document.getElementById("transaction-id");
let creatingAccount = false;

function showError(element, error) {
  element.textContent = error.message || "Something went wrong. Please try again.";
  element.style.color = "#ff8d8d";
}

function showAuth() {
  authPanel.hidden = false;
  paymentPanel.hidden = true;
  appPanel.hidden = true;
}

function setAccountMode(createAccount) {
  creatingAccount = createAccount;
  authTitle.textContent = createAccount ? "Create your client account" : "Sign in to Smart Move";
  authSubmit.textContent = createAccount ? "CREATE ACCOUNT" : "SIGN IN";
  document.getElementById("password-label").textContent =
    createAccount ? "Create a separate account password" : "Password";
  document.getElementById("account-password-note").hidden = !createAccount;
  passwordInput.autocomplete = createAccount ? "new-password" : "current-password";
  toggleAuthButton.textContent = createAccount
    ? "ALREADY HAVE AN ACCOUNT? SIGN IN"
    : "CREATE CLIENT ACCOUNT";
  authMessage.textContent = "";
  authMessage.style.color = "";
}

async function showSignedInAccount(session) {
  let hasAccess;
  let isAdmin;
  let offline = false;
  try {
    [hasAccess, isAdmin] = await Promise.all([
      window.smartMoveSupabase.rpc("smart_move_has_access"),
      window.smartMoveSupabase.rpc("smart_move_is_admin"),
    ]);
  } catch (error) {
    if (
      error.code !== "NETWORK" ||
      !window.smartMoveOffline.hasPaidAccess(session.user?.id)
    ) {
      throw error;
    }
    hasAccess = true;
    isAdmin = false;
    offline = true;
  }
  if (typeof hasAccess !== "boolean" || typeof isAdmin !== "boolean") {
    throw new Error("Supabase returned an invalid account status.");
  }

  authPanel.hidden = true;
  document.getElementById("signed-in-email").textContent =
    `${session.user?.email || "Signed in"}${offline ? " (offline)" : ""}`;

  if (hasAccess) {
    if (!offline) window.smartMoveOffline.rememberPaidAccess(session.user?.id);
    paymentPanel.hidden = true;
    appPanel.hidden = false;
    document.getElementById("admin-link").hidden = offline || !isAdmin;
    const cacheStatus = document.getElementById("offline-cache-status");
    if (offline) {
      cacheStatus.textContent =
        "Offline access is active. Play subjects cached on this device after payment verification.";
    } else {
      cacheStatus.textContent = "Preparing questions for offline play...";
      window.smartMoveOffline.cacheQuestionSets(
        (...args) => window.smartMoveSupabase.rpc(...args),
      ).then((count) => {
        cacheStatus.textContent =
          `${count} questions saved on this device. You can play offline after this preparation completes.`;
      }).catch((error) => {
        console.error("Offline question preparation failed.", error);
        cacheStatus.textContent =
          `Offline preparation failed: ${error.message} Connect again to retry.`;
      });
    }
  } else {
    localStorage.removeItem(`smartMovePaidAccess:${session.user?.id}`);
    paymentPanel.hidden = false;
    appPanel.hidden = true;
  }
}

async function refreshAccount() {
  if (window.smartMoveConfigError || !window.smartMoveSupabase) {
    configMessage.textContent = window.smartMoveConfigError ||
      "Supabase is not configured. See SUPABASE_SETUP.md to enable secure access.";
    const setupLink = document.createElement("a");
    setupLink.href = "SUPABASE_SETUP.md";
    setupLink.textContent = " Open setup instructions.";
    setupLink.style.color = "#bcd2ef";
    configMessage.appendChild(setupLink);
    configMessage.hidden = false;
    authPanel.hidden = true;
    return;
  }

  let session;
  try {
    session = await window.smartMoveSupabase.getSession();
  } catch (error) {
    if (error.code !== "NETWORK") throw error;
    session = window.smartMoveSupabase.getCachedSession();
    if (!session?.user?.id || !window.smartMoveOffline.hasPaidAccess(session.user.id)) {
      throw error;
    }
  }
  if (!session) {
    showAuth();
    return;
  }

  await showSignedInAccount(session);
}

toggleAuthButton.addEventListener("click", () => {
  setAccountMode(!creatingAccount);
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authSubmit.disabled = true;
  authMessage.textContent = "Please wait...";
  authMessage.style.color = "";

  try {
    if (creatingAccount) {
      const result = await window.smartMoveSupabase.signUp(
        emailInput.value.trim(),
        passwordInput.value,
      );
      if (!result.access_token) {
        authMessage.textContent =
          "Account created. Verify your email, then sign in to continue.";
        authMessage.style.color = "#bcd2ef";
        setAccountMode(false);
        authMessage.textContent =
          "Account created. Verify your email, then sign in to continue.";
        return;
      }
    } else {
      await window.smartMoveSupabase.signIn(
        emailInput.value.trim(),
        passwordInput.value,
      );
    }

    passwordInput.value = "";
    await refreshAccount();
  } catch (error) {
    showError(authMessage, error);
  } finally {
    authSubmit.disabled = false;
  }
});

paymentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const redeemButton = document.getElementById("redeem-button");
  redeemButton.disabled = true;
  paymentMessage.textContent = "Checking transaction ID...";
  paymentMessage.style.color = "";

  try {
    const accepted = await window.smartMoveSupabase.rpc(
      "smart_move_redeem_payment",
      { p_transaction_id: transactionInput.value.trim() },
    );
    if (accepted !== true) {
      paymentMessage.textContent =
        "That transaction ID was not found or has already been used. Check it with the administrator.";
      paymentMessage.style.color = "#ff8d8d";
      return;
    }

    transactionInput.value = "";
    paymentMessage.textContent = "Payment verified. Your access is active.";
    paymentMessage.style.color = "#1ed760";
    await refreshAccount();
  } catch (error) {
    showError(paymentMessage, error);
  } finally {
    redeemButton.disabled = false;
  }
});

async function signOutCurrentAccount(signOutButton) {
  signOutButton.disabled = true;
  try {
    await window.smartMoveSupabase.signOut();
    showAuth();
    document.getElementById("admin-link").hidden = true;
    authMessage.textContent = "Signed out.";
    authMessage.style.color = "#bcd2ef";
  } catch (error) {
    showError(authMessage, error);
  } finally {
    signOutButton.disabled = false;
  }
}

document.getElementById("sign-out").addEventListener("click", (event) => {
  signOutCurrentAccount(event.currentTarget);
});
document.getElementById("payment-sign-out").addEventListener("click", (event) => {
  signOutCurrentAccount(event.currentTarget);
});

const notice = new URLSearchParams(location.search).get("notice");
if (notice === "payment") {
  authMessage.textContent = "Sign in and redeem a verified transaction ID to unlock the quizzes.";
} else if (notice === "login") {
  authMessage.textContent = "Please sign in to continue.";
}

refreshAccount().catch((error) => {
  configMessage.textContent = error.message;
  configMessage.hidden = false;
  authPanel.hidden = false;
});
