const loginPanel = document.getElementById("admin-login");
const dashboard = document.getElementById("admin-dashboard");
const configMessage = document.getElementById("config-message");
const loginMessage = document.getElementById("admin-login-message");
const adminMessage = document.getElementById("admin-message");
const loginButton = document.getElementById("admin-login-button");
const transactionInput = document.getElementById("new-transaction-id");
const paymentList = document.getElementById("payment-list");
const verifiedAdminKey = "smartMoveVerifiedAdminId";
const adminEmail = "pumbwagrant@gmail.com";
let currentAdminId = null;
let offlineMode = false;

function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.style.color = isError ? "#ff8d8d" : "#bcd2ef";
}

function pendingStorageKey() {
  return `smartMovePendingPayments:${currentAdminId}`;
}

function getPendingCodes() {
  const stored = localStorage.getItem(pendingStorageKey());
  if (!stored) return [];

  let codes;
  try {
    codes = JSON.parse(stored);
  } catch {
    throw new Error("Offline payment drafts are damaged. Clear them before adding more IDs.");
  }

  if (!Array.isArray(codes) || codes.some((code) => typeof code !== "string")) {
    throw new Error("Offline payment drafts have an invalid format.");
  }
  return codes;
}

function savePendingCodes(codes) {
  localStorage.setItem(pendingStorageKey(), JSON.stringify(codes));
}

function renderPayments(serverPayments = []) {
  paymentList.replaceChildren();

  serverPayments.forEach((payment) => {
    const item = document.createElement("li");
    const date = new Date(payment.created_at);
    const formattedDate = Number.isNaN(date.getTime())
      ? "Date unavailable"
      : date.toLocaleString();
    item.textContent =
      `${formattedDate} — ${payment.redeemed ? "Redeemed" : "Available"}`;
    paymentList.appendChild(item);
  });

  const pendingCodes = getPendingCodes();
  pendingCodes.forEach((code) => {
    const item = document.createElement("li");
    item.textContent = `Pending sync — ${code}`;
    paymentList.appendChild(item);
  });

  if (serverPayments.length === 0 && pendingCodes.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No transaction IDs have been added yet.";
    paymentList.appendChild(empty);
  }

  document.getElementById("pending-count").textContent =
    `${pendingCodes.length} ID${pendingCodes.length === 1 ? "" : "s"} waiting to sync`;
  document.getElementById("sync-payments").disabled =
    offlineMode || pendingCodes.length === 0;
}

function queueOfflineCode(code) {
  const pendingCodes = getPendingCodes();
  if (pendingCodes.some((pending) => pending.trim() === code.trim())) {
    showMessage(adminMessage, "This ID is already in the offline sync queue.", true);
    return false;
  }

  pendingCodes.push(code);
  savePendingCodes(pendingCodes);
  renderPayments();
  showMessage(
    adminMessage,
    "Saved on this device. Clients cannot use this ID until the admin account syncs it online.",
  );
  return true;
}

async function syncPendingCodes() {
  if (!navigator.onLine || !window.smartMoveSupabase) {
    offlineMode = true;
    renderPayments();
    showMessage(
      adminMessage,
      "Offline. IDs are saved on this device and will be checked when you reconnect.",
    );
    return;
  }

  const pendingCodes = getPendingCodes();
  let syncedCount = 0;
  let duplicateCount = 0;

  for (let index = 0; index < pendingCodes.length; index += 1) {
    try {
      const added = await window.smartMoveSupabase.rpc(
        "smart_move_add_payment_code",
        { p_transaction_id: pendingCodes[index] },
      );
      if (added === true) {
        syncedCount += 1;
      } else if (added === false) {
        duplicateCount += 1;
      } else {
        throw new Error("Supabase returned an invalid result while syncing an ID.");
      }
    } catch (error) {
      savePendingCodes(pendingCodes.slice(index));
      if (error.code === "NETWORK") {
        offlineMode = true;
        renderPayments();
        showMessage(
          adminMessage,
          "Connection lost. Remaining IDs are saved on this device until you can sync again.",
        );
        return;
      }

      renderPayments();
      throw error;
    }
  }

  savePendingCodes([]);
  offlineMode = false;
  const serverPayments = await window.smartMoveSupabase.rpc(
    "smart_move_list_payment_codes",
  );
  if (!Array.isArray(serverPayments)) {
    throw new Error("Supabase returned an invalid payment list.");
  }
  renderPayments(serverPayments);

  if (syncedCount > 0) {
    showMessage(
      adminMessage,
      `${syncedCount} offline ID${syncedCount === 1 ? "" : "s"} synced. Clients can now redeem them.` +
        (duplicateCount > 0
          ? ` ${duplicateCount} duplicate ID${duplicateCount === 1 ? "" : "s"} already existed.`
          : ""),
    );
  } else if (duplicateCount > 0) {
    showMessage(
      adminMessage,
      `${duplicateCount} duplicate ID${duplicateCount === 1 ? "" : "s"} already existed; no new IDs were added.`,
    );
  }
}

async function showOfflineDashboard(error) {
  const session = window.smartMoveSupabase.getCachedSession();
  const wasVerifiedAdmin = session?.user?.id &&
    localStorage.getItem(verifiedAdminKey) === session.user.id;

  if (!wasVerifiedAdmin) throw error;

  currentAdminId = session.user.id;
  offlineMode = true;
  loginPanel.hidden = true;
  dashboard.hidden = false;
  renderPayments();
  showMessage(
    adminMessage,
    "Offline admin mode. New IDs stay on this device until you reconnect and sync; clients cannot use pending IDs.",
  );
}

async function showDashboard() {
  let session;
  try {
    session = await window.smartMoveSupabase.getSession();
  } catch (error) {
    if (error.code === "NETWORK") {
      await showOfflineDashboard(error);
      return;
    }
    throw error;
  }
  if (!session) {
    loginPanel.hidden = false;
    dashboard.hidden = true;
    return;
  }

  try {
    const isAdmin = await window.smartMoveSupabase.rpc("smart_move_is_admin");
    if (isAdmin !== true) {
      localStorage.removeItem(verifiedAdminKey);
      throw new Error("This account is not an administrator.");
    }

    currentAdminId = session.user.id;
    localStorage.setItem(verifiedAdminKey, currentAdminId);
    offlineMode = false;
    loginPanel.hidden = true;
    dashboard.hidden = false;
    await syncPendingCodes();
  } catch (error) {
    if (error.code === "NETWORK") {
      await showOfflineDashboard(error);
      return;
    }
    throw error;
  }
}

document.getElementById("admin-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  showMessage(loginMessage, "Signing in...");

  try {
    const email = document.getElementById("admin-email").value.trim();
    if (email.toLowerCase() !== adminEmail) {
      throw new Error(`Admin sign-in is limited to ${adminEmail}.`);
    }

    await window.smartMoveSupabase.signIn(
      email,
      document.getElementById("admin-password").value,
    );
    document.getElementById("admin-password").value = "";
    await showDashboard();
  } catch (error) {
    showMessage(loginMessage, error.message, true);
  } finally {
    loginButton.disabled = false;
  }
});

document.getElementById("add-payment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const addButton = document.getElementById("add-payment-button");
  const transactionId = transactionInput.value.trim();
  addButton.disabled = true;
  showMessage(adminMessage, "Adding verified transaction ID...");

  try {
    if (transactionId.length < 4 || transactionId.length > 128) {
      throw new Error("Enter a transaction ID between 4 and 128 characters.");
    }

    if (offlineMode || !navigator.onLine) {
      offlineMode = true;
      queueOfflineCode(transactionId);
      transactionInput.value = "";
      return;
    }

    const added = await window.smartMoveSupabase.rpc(
      "smart_move_add_payment_code",
      { p_transaction_id: transactionId },
    );
    if (added !== true) {
      showMessage(adminMessage, "This transaction ID is already on the list.", true);
      return;
    }

    transactionInput.value = "";
    showMessage(adminMessage, "Verified transaction ID added.");
    await syncPendingCodes();
  } catch (error) {
    if (error.code === "NETWORK") {
      offlineMode = true;
      queueOfflineCode(transactionId);
    } else {
      showMessage(adminMessage, error.message, true);
    }
  } finally {
    addButton.disabled = false;
  }
});

document.getElementById("sync-payments").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const session = await window.smartMoveSupabase.getSession();
    if (!session) throw new Error("Sign in again before syncing offline IDs.");
    const isAdmin = await window.smartMoveSupabase.rpc("smart_move_is_admin");
    if (isAdmin !== true) {
      localStorage.removeItem(verifiedAdminKey);
      throw new Error("This account is not an administrator.");
    }
    await syncPendingCodes();
  } catch (error) {
    if (error.code === "NETWORK") {
      offlineMode = true;
      renderPayments();
      showMessage(adminMessage, "Still offline. Pending IDs remain on this device.");
    } else {
      showMessage(adminMessage, error.message, true);
    }
  } finally {
    button.disabled = offlineMode || getPendingCodes().length === 0;
  }
});

document.getElementById("admin-sign-out").addEventListener("click", async () => {
  const button = document.getElementById("admin-sign-out");
  button.disabled = true;
  try {
    if (offlineMode) {
      window.smartMoveSupabase.clearLocalSession();
    } else {
      await window.smartMoveSupabase.signOut();
    }
    localStorage.removeItem(verifiedAdminKey);
    currentAdminId = null;
    offlineMode = false;
    dashboard.hidden = true;
    loginPanel.hidden = false;
    showMessage(loginMessage, "Signed out.");
  } catch (error) {
    if (error.code === "NETWORK") {
      window.smartMoveSupabase.clearLocalSession();
      localStorage.removeItem(verifiedAdminKey);
      currentAdminId = null;
      offlineMode = false;
      dashboard.hidden = true;
      loginPanel.hidden = false;
      showMessage(loginMessage, "Signed out on this device. Pending IDs remain saved locally.");
    } else {
      showMessage(adminMessage, error.message, true);
    }
  } finally {
    button.disabled = false;
  }
});

window.addEventListener("offline", () => {
  if (!currentAdminId) return;
  offlineMode = true;
  renderPayments();
  showMessage(
    adminMessage,
    "Offline. New IDs are saved on this device and cannot unlock clients until synced.",
  );
});

window.addEventListener("online", async () => {
  if (!currentAdminId || !offlineMode) return;
  try {
    const isAdmin = await window.smartMoveSupabase.rpc("smart_move_is_admin");
    if (isAdmin !== true) {
      localStorage.removeItem(verifiedAdminKey);
      throw new Error("This account is not an administrator.");
    }
    await syncPendingCodes();
  } catch (error) {
    offlineMode = error.code === "NETWORK";
    renderPayments();
    showMessage(
      adminMessage,
      error.code === "NETWORK" ? "Still offline. Pending IDs remain on this device." : error.message,
      error.code !== "NETWORK",
    );
  }
});

if (window.smartMoveConfigError || !window.smartMoveSupabase) {
  configMessage.textContent = window.smartMoveConfigError ||
    "Supabase is not configured. See SUPABASE_SETUP.md.";
  const setupLink = document.createElement("a");
  setupLink.href = "SUPABASE_SETUP.md";
  setupLink.textContent = " Open setup instructions.";
  setupLink.style.color = "#bcd2ef";
  configMessage.appendChild(setupLink);
  configMessage.hidden = false;
  loginPanel.hidden = true;
} else {
  showDashboard().catch((error) => {
    loginPanel.hidden = false;
    dashboard.hidden = true;
    showMessage(loginMessage, error.message, true);
  });
}
