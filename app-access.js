window.smartMoveRequireAccess = async function () {
  if (window.smartMoveConfigError) throw new Error(window.smartMoveConfigError);
  if (!window.smartMoveSupabase) throw new Error("Supabase is not configured.");

  let session;
  try {
    session = await window.smartMoveSupabase.getSession();
  } catch (error) {
    if (error.code !== "NETWORK") throw error;
    session = window.smartMoveSupabase.getCachedSession();
    if (session?.user?.id && window.smartMoveOffline.hasPaidAccess(session.user.id)) {
      document.body.classList.remove("protected-page");
      return true;
    }
    throw new Error("Connect to the internet and sign in to verify paid access before playing offline.");
  }

  if (!session?.access_token) {
    location.replace("index.html?notice=login");
    return false;
  }

  let hasAccess;
  try {
    hasAccess = await window.smartMoveSupabase.rpc("smart_move_has_access");
  } catch (error) {
    if (error.code !== "NETWORK") throw error;
    if (session.user?.id && window.smartMoveOffline.hasPaidAccess(session.user.id)) {
      document.body.classList.remove("protected-page");
      return true;
    }
    throw new Error("Connect to the internet and verify payment before playing offline.");
  }

  if (hasAccess !== true) {
    if (session.user?.id) {
      localStorage.removeItem(`smartMovePaidAccess:${session.user.id}`);
    }
    location.replace("index.html?notice=payment");
    return false;
  }

  window.smartMoveOffline.rememberPaidAccess(session.user.id);
  document.body.classList.remove("protected-page");
  return true;
};
